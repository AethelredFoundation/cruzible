/**
 * Model registry read service.
 *
 * Exposes a thin read-only interface for the `/v1/models` route using the
 * existing indexed Model table.
 */

import { injectable } from 'tsyringe';
import {
  ModelCategory,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { logger } from '../utils/logger';

export interface ModelListItem {
  modelHash: string;
  name: string;
  owner: string;
  architecture: string;
  version: string;
  category: string;
  inputSchema: string;
  outputSchema: string;
  storageUri: string;
  registeredAt: string;
  verified: boolean;
  totalJobs: number;
}

export interface ModelsListResult {
  models: ModelListItem[];
  total: number;
}

export interface ModelUsageBreakdownItem {
  proofType: string;
  count: number;
}

export interface ModelLineageJob {
  id: string;
  status: string;
  proofType: string;
  createdAt: string;
  completedAt: string | null;
  verificationScore: number | null;
  creatorAddress: string;
  validatorAddress: string | null;
}

export interface ModelDetailResult extends ModelListItem {
  sizeBytes: string | null;
  updatedAt: string;
  usage: {
    totalJobs: number;
    verifiedJobs: number;
    inFlightJobs: number;
    failedJobs: number;
    latestJobAt: string | null;
    latestVerifiedAt: string | null;
    proofTypeBreakdown: ModelUsageBreakdownItem[];
  };
  lineage: {
    recentJobs: ModelLineageJob[];
  };
}

const MODEL_SORT_FIELDS = {
  registered_at: 'registeredAt',
  total_jobs: 'totalJobs',
  name: 'name',
} as const;

type ModelSortField = keyof typeof MODEL_SORT_FIELDS;

@injectable()
export class ModelsService {
  private readonly prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async getModels(options: {
    limit: number;
    offset: number;
    category?: string;
    verified?: boolean;
    owner?: string;
    sort: string;
  }): Promise<ModelsListResult> {
    const { limit, offset, category, verified, owner, sort } = options;

    const where: Prisma.ModelWhereInput = {};
    if (category) {
      where.category = category as ModelCategory;
    }
    if (typeof verified === 'boolean') {
      where.verified = verified;
    }
    if (owner) {
      where.owner = owner;
    }

    try {
      const [models, total] = await Promise.all([
        this.prisma.model.findMany({
          where,
          orderBy: this.parseSort(sort),
          skip: offset,
          take: limit,
          select: {
            modelHash: true,
            name: true,
            owner: true,
            architecture: true,
            version: true,
            category: true,
            inputSchema: true,
            outputSchema: true,
            storageUri: true,
            registeredAt: true,
            verified: true,
            totalJobs: true,
          },
        }),
        this.prisma.model.count({ where }),
      ]);

      return {
        models: models.map((model) => this.mapModelListItem(model)),
        total,
      };
    } catch (error) {
      logger.error('Failed to fetch models', { error, options });
      throw error;
    }
  }

  async getModelByHash(modelHash: string): Promise<ModelDetailResult | null> {
    try {
      const model = await this.prisma.model.findUnique({
        where: { modelHash },
        select: {
          modelHash: true,
          name: true,
          owner: true,
          architecture: true,
          version: true,
          category: true,
          inputSchema: true,
          outputSchema: true,
          storageUri: true,
          sizeBytes: true,
          registeredAt: true,
          updatedAt: true,
          verified: true,
          totalJobs: true,
        },
      });

      if (!model) {
        return null;
      }

      const [verifiedJobs, inFlightJobs, failedJobs, recentJobs, latestVerifiedJob, proofTypeBreakdown] =
        await Promise.all([
          this.prisma.aIJob.count({
            where: {
              modelHash,
              status: 'VERIFIED',
            },
          }),
          this.prisma.aIJob.count({
            where: {
              modelHash,
              status: {
                in: ['PENDING', 'ASSIGNED', 'COMPUTING'],
              },
            },
          }),
          this.prisma.aIJob.count({
            where: {
              modelHash,
              status: 'FAILED',
            },
          }),
          this.prisma.aIJob.findMany({
            where: { modelHash },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
              id: true,
              status: true,
              proofType: true,
              createdAt: true,
              completedAt: true,
              verificationScore: true,
              creator: {
                select: {
                  address: true,
                },
              },
              validator: {
                select: {
                  address: true,
                },
              },
            },
          }),
          this.prisma.aIJob.findFirst({
            where: {
              modelHash,
              status: 'VERIFIED',
            },
            orderBy: { completedAt: 'desc' },
            select: {
              createdAt: true,
              completedAt: true,
            },
          }),
          this.prisma.aIJob.groupBy({
            by: ['proofType'],
            where: { modelHash },
            _count: {
              _all: true,
            },
          }),
        ]);

      return {
        ...this.mapModelListItem(model),
        sizeBytes: model.sizeBytes?.toString() ?? null,
        updatedAt: model.updatedAt.toISOString(),
        usage: {
          totalJobs: Number(model.totalJobs),
          verifiedJobs,
          inFlightJobs,
          failedJobs,
          latestJobAt: recentJobs[0]?.createdAt.toISOString() ?? null,
          latestVerifiedAt:
            latestVerifiedJob?.completedAt?.toISOString() ??
            latestVerifiedJob?.createdAt.toISOString() ??
            null,
          proofTypeBreakdown: proofTypeBreakdown.map((entry) => ({
            proofType: entry.proofType,
            count: entry._count._all,
          })),
        },
        lineage: {
          recentJobs: recentJobs.map((job) => ({
            id: job.id,
            status: job.status,
            proofType: job.proofType,
            createdAt: job.createdAt.toISOString(),
            completedAt: job.completedAt?.toISOString() ?? null,
            verificationScore: job.verificationScore,
            creatorAddress: job.creator.address,
            validatorAddress: job.validator?.address ?? null,
          })),
        },
      };
    } catch (error) {
      logger.error('Failed to fetch model detail', { error, modelHash });
      throw error;
    }
  }

  private parseSort(sort: string): Prisma.ModelOrderByWithRelationInput {
    const [requestedField = 'registered_at', requestedDirection = 'desc'] = sort.split(':');
    const sortField = this.isModelSortField(requestedField)
      ? requestedField
      : 'registered_at';
    const direction: Prisma.SortOrder = requestedDirection === 'asc' ? 'asc' : 'desc';

    return {
      [MODEL_SORT_FIELDS[sortField]]: direction,
    } as Prisma.ModelOrderByWithRelationInput;
  }

  private isModelSortField(value: string): value is ModelSortField {
    return Object.prototype.hasOwnProperty.call(MODEL_SORT_FIELDS, value);
  }

  private mapModelListItem(model: {
    modelHash: string;
    name: string;
    owner: string;
    architecture: string;
    version: string;
    category: ModelCategory;
    inputSchema: string;
    outputSchema: string;
    storageUri: string;
    registeredAt: Date;
    verified: boolean;
    totalJobs: bigint | number;
  }): ModelListItem {
    return {
      modelHash: model.modelHash,
      name: model.name,
      owner: model.owner,
      architecture: model.architecture,
      version: model.version,
      category: model.category,
      inputSchema: model.inputSchema,
      outputSchema: model.outputSchema,
      storageUri: model.storageUri,
      registeredAt: model.registeredAt.toISOString(),
      verified: model.verified,
      totalJobs: Number(model.totalJobs),
    };
  }
}
