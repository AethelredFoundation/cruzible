/**
 * AI Jobs Service
 * 
 * Handles AI job-related queries and operations
 */

import { injectable } from 'tsyringe';
import { Prisma, PrismaClient } from '@prisma/client';
import { BlockchainService } from './BlockchainService';

const JOB_SORT_FIELDS = {
  created_at: 'createdAt',
  completed_at: 'completedAt',
  priority: 'priority',
  verification_score: 'verificationScore',
} as const;

type JobSortField = keyof typeof JOB_SORT_FIELDS;

@injectable()
export class JobsService {
  private prisma: PrismaClient;

  constructor(private blockchainService: BlockchainService) {
    this.prisma = new PrismaClient();
  }

  async getJobs(options: {
    limit: number;
    offset: number;
    status?: string;
    modelHash?: string;
    creator?: string;
    sort: string;
  }): Promise<any> {
    const { limit, offset, status, modelHash, creator, sort } = options;

    // Build where clause
    const where: any = {};
    if (status) {
      where.status = status.toUpperCase();
    }
    if (modelHash) {
      where.modelHash = modelHash;
    }
    if (creator) {
      where.creator = {
        is: {
          address: creator,
        },
      };
    }

    // Query database
    const [jobs, total] = await Promise.all([
      this.prisma.aIJob.findMany({
        where,
        orderBy: this.parseSort(sort),
        skip: offset,
        take: limit,
        include: {
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
          computeMetrics: true,
          teeAttestation: true,
        },
      }),
      this.prisma.aIJob.count({ where }),
    ]);

    return {
      jobs: jobs.map(this.mapJobToResponse),
      total,
      limit,
      offset,
    };
  }

  async getJobById(id: string): Promise<any | null> {
    const job = await this.prisma.aIJob.findUnique({
      where: { id },
      include: {
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
        computeMetrics: true,
        teeAttestation: true,
        verificationProof: {
          include: {
            validatorSignatures: true,
          },
        },
      },
    });

    if (!job) return null;

    return this.mapJobToResponse(job);
  }

  async getJobStats(): Promise<any> {
    const [
      totalJobs,
      pendingJobs,
      completedJobs,
      failedJobs,
      avgScore,
      totalCompute,
    ] = await Promise.all([
      this.prisma.aIJob.count(),
      this.prisma.aIJob.count({
        where: { status: { in: ['PENDING', 'ASSIGNED', 'COMPUTING'] } },
      }),
      this.prisma.aIJob.count({ where: { status: 'VERIFIED' } }),
      this.prisma.aIJob.count({ where: { status: 'FAILED' } }),
      this.prisma.aIJob.aggregate({
        where: { status: 'VERIFIED' },
        _avg: { verificationScore: true },
      }),
      this.prisma.computeMetrics.aggregate({
        _sum: { cpuCycles: true },
      }),
    ]);

    return {
      totalJobs,
      pendingJobs,
      completedJobs,
      failedJobs,
      averageVerificationScore: avgScore._avg.verificationScore || 0,
      totalComputeCycles: totalCompute._sum.cpuCycles || 0,
      successRate: totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0,
    };
  }

  async getPricing(options: {
    modelHash?: string;
    estimatedCpuCycles?: number;
    estimatedMemoryMb?: number;
  }): Promise<any> {
    const { modelHash, estimatedCpuCycles = 1_000_000_000, estimatedMemoryMb = 2048 } = options;

    // Get recent job costs for pricing
    const recentJobs = await this.prisma.aIJob.findMany({
      where: { status: 'VERIFIED' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { computeMetrics: true },
    });

    // Calculate average cost per compute unit
    let totalCost = BigInt(0);
    let totalUnits = BigInt(0);

    for (const job of recentJobs) {
      if (job.actualCost && job.computeMetrics) {
        totalCost += BigInt(job.actualCost);
        totalUnits +=
          BigInt(job.computeMetrics.cpuCycles) +
          BigInt(job.computeMetrics.memoryUsed) * BigInt(1000);
      }
    }

    const basePrice = totalUnits > 0 
      ? Number(totalCost) / Number(totalUnits)
      : 0.000001; // Default price

    // Calculate multipliers
    const modelMultiplier = modelHash ? await this.getModelMultiplier(modelHash) : 1.0;
    const networkLoad = await this.getNetworkLoad();
    const priorityMultiplier = 1.0 + (networkLoad * 0.5); // Up to 50% premium

    // Estimate cost
    const computeUnits = estimatedCpuCycles + estimatedMemoryMb * 1000;
    const estimatedCost = computeUnits * basePrice * modelMultiplier * priorityMultiplier;

    return {
      basePrice,
      modelMultiplier,
      priorityMultiplier,
      networkLoad,
      estimatedCpuCycles,
      estimatedMemoryMb,
      estimatedCost: Math.ceil(estimatedCost),
      currency: 'aeth',
    };
  }

  async getJobVerifications(jobId: string): Promise<any[]> {
    const verifications = await this.prisma.verificationProof.findMany({
      where: { jobId },
      include: {
        validatorSignatures: true,
      },
    });

    return verifications;
  }

  async getJobQueue(limit: number): Promise<any[]> {
    const queue = await this.prisma.aIJob.findMany({
      where: { status: 'PENDING' },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'asc' },
      ],
      take: limit,
      select: {
        id: true,
        modelHash: true,
        creator: {
          select: {
            address: true,
          },
        },
        priority: true,
        maxCost: true,
        createdAt: true,
      },
    });

    return queue.map((job) => ({
      id: job.id,
      modelHash: job.modelHash,
      creator: job.creator.address,
      creatorAddress: job.creator.address,
      priority: job.priority,
      maxCost: job.maxCost,
      createdAt: job.createdAt,
    }));
  }

  private mapJobToResponse(job: any): any {
    return {
      id: job.id,
      status: job.status,
      modelHash: job.modelHash,
      inputHash: job.inputHash,
      outputHash: job.outputHash,
      creator: job.creator?.address ?? null,
      creatorAddress: job.creator?.address ?? null,
      validator: job.validator?.address ?? null,
      validatorAddress: job.validator?.address ?? null,
      proofType: job.proofType,
      priority: job.priority,
      maxCost: job.maxCost,
      actualCost: job.actualCost,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      verificationScore: job.verificationScore,
      computeMetrics: job.computeMetrics ? {
        cpuCycles: job.computeMetrics.cpuCycles,
        memoryUsed: job.computeMetrics.memoryUsed,
        computeTimeMs: job.computeMetrics.computeTimeMs,
        energyMj: job.computeMetrics.energyMj,
      } : null,
      teeAttestation: job.teeAttestation ? {
        teeType: job.teeAttestation.teeType,
        quoteVersion: job.teeAttestation.quoteVersion,
        timestamp: job.teeAttestation.timestamp,
      } : null,
    };
  }

  private async getModelMultiplier(modelHash: string): Promise<number> {
    const model = await this.prisma.model.findUnique({
      where: { modelHash },
    });

    if (!model) return 1.0;

    // Complexity multipliers by architecture
    const multipliers: Record<string, number> = {
      'transformer-large': 2.0,
      'transformer-base': 1.5,
      'cnn': 1.2,
      'rnn': 1.0,
      'mlp': 0.8,
    };

    return multipliers[model.architecture] || 1.0;
  }

  private async getNetworkLoad(): Promise<number> {
    const pendingCount = await this.prisma.aIJob.count({
      where: { status: { in: ['PENDING', 'ASSIGNED', 'COMPUTING'] } },
    });

    const activeValidators = await this.prisma.validator.count({
      where: { status: 'BONDED', teeAttested: true },
    });

    // Load = pending jobs / (validators * capacity per validator)
    const capacityPerValidator = 10;
    const totalCapacity = Math.max(activeValidators * capacityPerValidator, 1);
    
    return Math.min(pendingCount / totalCapacity, 1.0);
  }

  private parseSort(sort: string): Prisma.AIJobOrderByWithRelationInput {
    const [requestedField = 'created_at', requestedDirection = 'desc'] = sort.split(':');
    const sortField = this.isJobSortField(requestedField) ? requestedField : 'created_at';
    const direction: Prisma.SortOrder = requestedDirection === 'asc' ? 'asc' : 'desc';

    return {
      [JOB_SORT_FIELDS[sortField]]: direction,
    } as Prisma.AIJobOrderByWithRelationInput;
  }

  private isJobSortField(value: string): value is JobSortField {
    return Object.prototype.hasOwnProperty.call(JOB_SORT_FIELDS, value);
  }
}
