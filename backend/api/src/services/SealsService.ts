/**
 * Digital seal read service.
 *
 * Reads from the indexed Seal table and shapes responses to match the
 * frontend explorer's list view.
 */

import { injectable } from 'tsyringe';
import {
  Prisma,
  PrismaClient,
  SealStatus,
} from '@prisma/client';
import { logger } from '../utils/logger';

export interface SealListItem {
  id: string;
  jobId: string;
  status: string;
  modelCommitment: string;
  inputCommitment: string;
  outputCommitment: string;
  requester: string;
  validatorCount: number;
  createdAt: string;
  expiresAt: string | null;
}

export interface SealsListResult {
  seals: SealListItem[];
  total: number;
}

export interface SealLinkedJob {
  id: string;
  status: string;
  modelHash: string;
  modelName: string | null;
  proofType: string;
  verificationScore: number | null;
  createdAt: string;
  completedAt: string | null;
  outputHash: string | null;
  creatorAddress: string;
  validatorAddress: string | null;
}

export interface SealProofLineage {
  proofType: string | null;
  merkleRoot: string | null;
  validatorSignatureCount: number;
  teeType: string | null;
  teeTimestamp: string | null;
  teeMeasurement: string | null;
  computeMetrics: {
    cpuCycles: string;
    memoryUsed: string;
    computeTimeMs: string;
    energyMj: string;
  } | null;
}

export interface SealDetailResult extends SealListItem {
  validators: string[];
  revokedAt: string | null;
  revokedBy: string | null;
  revocationReason: string | null;
  job: SealLinkedJob | null;
  proofLineage: SealProofLineage;
}

const SEAL_SORT_FIELDS = {
  created_at: 'createdAt',
  expires_at: 'expiresAt',
} as const;

type SealSortField = keyof typeof SEAL_SORT_FIELDS;

@injectable()
export class SealsService {
  private readonly prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async getSeals(options: {
    limit: number;
    offset: number;
    status?: string;
    requester?: string;
    jobId?: string;
    sort: string;
  }): Promise<SealsListResult> {
    const { limit, offset, status, requester, jobId, sort } = options;

    const where: Prisma.SealWhereInput = {};
    if (status) {
      where.status = status.toUpperCase() as SealStatus;
    }
    if (requester) {
      where.requester = requester;
    }
    if (jobId) {
      where.jobId = jobId;
    }

    try {
      const [seals, total] = await Promise.all([
        this.prisma.seal.findMany({
          where,
          orderBy: this.parseSort(sort),
          skip: offset,
          take: limit,
          select: {
            id: true,
            jobId: true,
            status: true,
            modelCommitment: true,
            inputCommitment: true,
            outputCommitment: true,
            requester: true,
            validators: true,
            createdAt: true,
            expiresAt: true,
          },
        }),
        this.prisma.seal.count({ where }),
      ]);

      return {
        seals: seals.map((seal) => this.mapSealListItem(seal)),
        total,
      };
    } catch (error) {
      logger.error('Failed to fetch seals', { error, options });
      throw error;
    }
  }

  async getSealById(id: string): Promise<SealDetailResult | null> {
    try {
      const seal = await this.prisma.seal.findUnique({
        where: { id },
        select: {
          id: true,
          jobId: true,
          status: true,
          modelCommitment: true,
          inputCommitment: true,
          outputCommitment: true,
          requester: true,
          validators: true,
          createdAt: true,
          expiresAt: true,
          revokedAt: true,
          revokedBy: true,
          revocationReason: true,
        },
      });

      if (!seal) {
        return null;
      }

      const linkedJob = await this.prisma.aIJob.findUnique({
        where: { id: seal.jobId },
        select: {
          id: true,
          status: true,
          modelHash: true,
          proofType: true,
          verificationScore: true,
          createdAt: true,
          completedAt: true,
          outputHash: true,
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
          teeAttestation: {
            select: {
              teeType: true,
              timestamp: true,
              measurement: true,
            },
          },
          verificationProof: {
            select: {
              proofType: true,
              merkleRoot: true,
              validatorSignatures: {
                select: {
                  id: true,
                },
              },
            },
          },
          computeMetrics: {
            select: {
              cpuCycles: true,
              memoryUsed: true,
              computeTimeMs: true,
              energyMj: true,
            },
          },
        },
      });

      const linkedModel = linkedJob
        ? await this.prisma.model.findUnique({
            where: { modelHash: linkedJob.modelHash },
            select: {
              name: true,
            },
          })
        : null;

      return {
        ...this.mapSealListItem(seal),
        validators: seal.validators,
        revokedAt: seal.revokedAt?.toISOString() ?? null,
        revokedBy: seal.revokedBy ?? null,
        revocationReason: seal.revocationReason ?? null,
        job: linkedJob
          ? {
              id: linkedJob.id,
              status: linkedJob.status,
              modelHash: linkedJob.modelHash,
              modelName: linkedModel?.name ?? null,
              proofType: linkedJob.proofType,
              verificationScore: linkedJob.verificationScore,
              createdAt: linkedJob.createdAt.toISOString(),
              completedAt: linkedJob.completedAt?.toISOString() ?? null,
              outputHash: linkedJob.outputHash ?? null,
              creatorAddress: linkedJob.creator.address,
              validatorAddress: linkedJob.validator?.address ?? null,
            }
          : null,
        proofLineage: {
          proofType:
            linkedJob?.verificationProof?.proofType ?? linkedJob?.proofType ?? null,
          merkleRoot: linkedJob?.verificationProof?.merkleRoot ?? null,
          validatorSignatureCount:
            linkedJob?.verificationProof?.validatorSignatures.length ?? 0,
          teeType: linkedJob?.teeAttestation?.teeType ?? null,
          teeTimestamp: linkedJob?.teeAttestation?.timestamp?.toISOString() ?? null,
          teeMeasurement: linkedJob?.teeAttestation?.measurement ?? null,
          computeMetrics: linkedJob?.computeMetrics
            ? {
                cpuCycles: linkedJob.computeMetrics.cpuCycles.toString(),
                memoryUsed: linkedJob.computeMetrics.memoryUsed.toString(),
                computeTimeMs: linkedJob.computeMetrics.computeTimeMs.toString(),
                energyMj: linkedJob.computeMetrics.energyMj.toString(),
              }
            : null,
        },
      };
    } catch (error) {
      logger.error('Failed to fetch seal detail', { error, id });
      throw error;
    }
  }

  private parseSort(sort: string): Prisma.SealOrderByWithRelationInput {
    const [requestedField = 'created_at', requestedDirection = 'desc'] = sort.split(':');
    const sortField = this.isSealSortField(requestedField)
      ? requestedField
      : 'created_at';
    const direction: Prisma.SortOrder = requestedDirection === 'asc' ? 'asc' : 'desc';

    return {
      [SEAL_SORT_FIELDS[sortField]]: direction,
    } as Prisma.SealOrderByWithRelationInput;
  }

  private isSealSortField(value: string): value is SealSortField {
    return Object.prototype.hasOwnProperty.call(SEAL_SORT_FIELDS, value);
  }

  private mapSealListItem(seal: {
    id: string;
    jobId: string;
    status: SealStatus;
    modelCommitment: string;
    inputCommitment: string;
    outputCommitment: string;
    requester: string;
    validators: string[];
    createdAt: Date;
    expiresAt: Date | null;
  }): SealListItem {
    return {
      id: seal.id,
      jobId: seal.jobId,
      status: seal.status.toLowerCase(),
      modelCommitment: seal.modelCommitment,
      inputCommitment: seal.inputCommitment,
      outputCommitment: seal.outputCommitment,
      requester: seal.requester,
      validatorCount: seal.validators.length,
      createdAt: seal.createdAt.toISOString(),
      expiresAt: seal.expiresAt?.toISOString() ?? null,
    };
  }
}
