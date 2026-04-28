import 'reflect-metadata';
import express from 'express';
import { container } from 'tsyringe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withHttpServer } from './helpers/http';

function registerTestInstance<T>(token: new (...args: never[]) => T, instance: T) {
  container.registerInstance(token, instance);
}

describe('backend routes', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    container.clearInstances();
    (container as unknown as { reset?: () => void }).reset?.();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('serves health status', async () => {
    const { router } = await import('../src/routes/health');
    const app = express();
    app.use('/health', router);

    await withHttpServer(app, async (baseUrl) => {
      // The full /health endpoint probes database and blockchain RPC.
      // Without real infrastructure the probes fail, so expect 503 with
      // a well-formed response body.
      const response = await fetch(`${baseUrl}/health`);
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.ok).toBe(false);
      expect(body.status).toBe('unhealthy');
      expect(body.service).toBe('cruzible-api');
      expect(body.checks).toBeDefined();
      expect(body.checks.database).toBeDefined();
      expect(body.checks.blockchainRpc).toBeDefined();
      expect(body.memory).toBeDefined();
      expect(body.uptime).toBeDefined();

      // The liveness sub-endpoint must always return 200.
      const live = await fetch(`${baseUrl}/health/live`);
      const liveBody = await live.json();
      expect(live.status).toBe(200);
      expect(liveBody.ok).toBe(true);
    });
  });

  it('serves blocks through the registered blockchain service', async () => {
    const { CacheService } = await import('../src/services/CacheService');
    const { BlockchainService } = await import('../src/services/BlockchainService');
    const cache = new CacheService();
    const blockchain = {
      getBlocks: vi.fn().mockResolvedValue({
        data: [{ height: 42, hash: 'ABCD' }],
        pagination: { limit: 20, offset: 0, total: 1, hasMore: false },
      }),
    } as unknown as BlockchainService;

    registerTestInstance(CacheService, cache);
    registerTestInstance(BlockchainService, blockchain);

    const { blocksRouter } = await import('../src/routes/v1/blocks');
    const app = express();
    app.use('/v1/blocks', blocksRouter);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/blocks?limit=20&offset=0`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data[0].height).toBe(42);
      expect((blockchain.getBlocks as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({
        limit: 20,
        offset: 0,
        height: undefined,
      });
    });
  });

  it('serves jobs through the registered jobs service', async () => {
    const { CacheService } = await import('../src/services/CacheService');
    const { JobsService } = await import('../src/services/JobsService');
    const cache = new CacheService();
    const jobs = {
      getJobs: vi.fn().mockResolvedValue({
        jobs: [{ id: 'job-1', status: 'VERIFIED' }],
        total: 1,
        limit: 20,
        offset: 0,
      }),
    } as unknown as JobsService;

    registerTestInstance(CacheService, cache);
    registerTestInstance(JobsService, jobs);

    const { jobsRouter } = await import('../src/routes/v1/jobs');
    const app = express();
    app.use('/v1/jobs', jobsRouter);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/jobs?limit=20&offset=0`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.jobs[0].id).toBe('job-1');
      expect((jobs.getJobs as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
        limit: 20,
        offset: 0,
        sort: 'created_at:desc',
      });
    });
  });

  it('serves the jobs queue through the registered jobs service without falling through to :id', async () => {
    const { CacheService } = await import('../src/services/CacheService');
    const { JobsService } = await import('../src/services/JobsService');
    const cache = new CacheService();
    const jobs = {
      getJobs: vi.fn(),
      getJobStats: vi.fn(),
      getPricing: vi.fn(),
      getJobById: vi.fn(),
      getJobVerifications: vi.fn(),
      getJobQueue: vi.fn().mockResolvedValue([
        {
          id: 'queued-job-1',
          modelHash: 'model-1',
          creator: 'aeth1creator',
          creatorAddress: 'aeth1creator',
          priority: 8,
          maxCost: '1000',
          createdAt: '2026-04-24T00:00:00.000Z',
        },
      ]),
    } as unknown as JobsService;

    registerTestInstance(CacheService, cache);
    registerTestInstance(JobsService, jobs);

    const { jobsRouter } = await import('../src/routes/v1/jobs');
    const app = express();
    app.use('/v1/jobs', jobsRouter);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/jobs/queue?limit=5`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body[0].id).toBe('queued-job-1');
      expect((jobs.getJobQueue as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(5);
      expect((jobs.getJobById as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });
  });

  it('serves live reconciliation documents through the registered reconciliation service', async () => {
    const { CacheService } = await import('../src/services/CacheService');
    const { ReconciliationService } = await import('../src/services/ReconciliationService');
    const { ReconciliationScheduler } = await import('../src/services/ReconciliationScheduler');
    const cache = new CacheService();
    const reconciliation = {
      getLiveDocument: vi.fn().mockResolvedValue({
        epoch: 42,
        network: 'aethelred',
        mode: 'live-snapshot',
        captured_at: '2026-03-10T00:00:00.000Z',
        source: {
          epoch_source: 'evm/cruzible.currentEpoch',
          validator_source: 'rpc/staking.validators',
          stake_source: 'indexer.stAethelBalance+delegation',
          validator_limit: 200,
          validator_count: 2,
          total_eligible_validators: 2,
          chain_height: 42,
        },
        warnings: [],
        validator_selection: {
          input: { eligible_addresses: ['aethelvaloper1abc', 'aethelvaloper1def'] },
          observed: { universe_hash: '0x1234' },
          meta: { validator_count: 2, total_eligible_validators: 2 },
        },
      }),
    } as unknown as ReconciliationService;
    const reconciliationScheduler = {
      getLatestResult: vi.fn().mockReturnValue(null),
    } as unknown as ReconciliationScheduler;

    registerTestInstance(CacheService, cache);
    registerTestInstance(ReconciliationService, reconciliation);
    registerTestInstance(ReconciliationScheduler, reconciliationScheduler);

    const { reconciliationRouter } = await import('../src/routes/v1/reconciliation');
    const app = express();
    app.use('/v1/reconciliation', reconciliationRouter);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/reconciliation/live?validator_limit=200`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.epoch).toBe(42);
      expect(body.validator_selection.observed.universe_hash).toBe('0x1234');
      expect(
        (reconciliation.getLiveDocument as ReturnType<typeof vi.fn>).mock.calls[0][0]
      ).toEqual({
        validatorLimit: 200,
        persist: false,
      });
    });
  });

  it('serves the public reconciliation control-plane summary', async () => {
    const { CacheService } = await import('../src/services/CacheService');
    const { ReconciliationService } = await import('../src/services/ReconciliationService');
    const { ReconciliationScheduler } = await import('../src/services/ReconciliationScheduler');
    const cache = new CacheService();
    const reconciliation = {
      getControlPlaneSummary: vi.fn().mockResolvedValue({
        epoch: 42,
        epoch_source: 'evm/cruzible.currentEpoch',
        captured_at: '2026-04-24T00:00:00.000Z',
        chain_height: 424242,
        validator_count: 32,
        total_eligible_validators: 32,
        validator_universe_hash: '0x1234',
        stake_snapshot_hash: '0xabcd',
        stake_snapshot_complete: true,
        warning_count: 0,
        discrepancy_count: 0,
        critical_discrepancy_count: 0,
        warning_discrepancy_count: 0,
        info_discrepancy_count: 0,
        warnings: [],
      }),
    } as unknown as ReconciliationService;
    const reconciliationScheduler = {
      getLatestResult: vi.fn().mockReturnValue(null),
    } as unknown as ReconciliationScheduler;

    registerTestInstance(CacheService, cache);
    registerTestInstance(ReconciliationService, reconciliation);
    registerTestInstance(ReconciliationScheduler, reconciliationScheduler);

    const { reconciliationRouter } = await import('../src/routes/v1/reconciliation');
    const app = express();
    app.use('/v1/reconciliation', reconciliationRouter);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/reconciliation/control-plane`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.epoch).toBe(42);
      expect(body.epoch_source).toBe('evm/cruzible.currentEpoch');
      expect(body.validator_universe_hash).toBe('0x1234');
      expect(
        (reconciliation.getControlPlaneSummary as ReturnType<typeof vi.fn>).mock
          .calls[0][0],
      ).toEqual({
        persist: false,
      });
    });
  });

  it('serves the public reconciliation scorecard with freshness context', async () => {
    const { CacheService } = await import('../src/services/CacheService');
    const { ReconciliationService } = await import('../src/services/ReconciliationService');
    const { ReconciliationScheduler } = await import('../src/services/ReconciliationScheduler');
    const cache = new CacheService();
    const reconciliation = {
      getControlPlaneSummary: vi.fn().mockResolvedValue({
        epoch: 42,
        epoch_source: 'evm/cruzible.currentEpoch',
        captured_at: '2026-04-24T00:00:00.000Z',
        chain_height: 424242,
        validator_count: 32,
        total_eligible_validators: 32,
        validator_universe_hash: '0x1234',
        stake_snapshot_hash: '0xabcd',
        stake_snapshot_complete: true,
        warning_count: 0,
        discrepancy_count: 1,
        critical_discrepancy_count: 0,
        warning_discrepancy_count: 1,
        info_discrepancy_count: 0,
        warnings: [],
      }),
    } as unknown as ReconciliationService;
    const reconciliationScheduler = {
      getLatestResult: vi.fn().mockReturnValue({
        timestamp: '2026-04-24T00:01:00.000Z',
        status: 'WARNING',
        epoch: 42,
        epochSource: 'evm/cruzible.currentEpoch',
        durationMs: 150,
        onChainState: null,
        indexedState: null,
        checks: [
          {
            name: 'epoch_freshness',
            status: 'WARNING',
            message: 'indexed epoch 41 trails protocol epoch 42 by 1',
            metadata: {
              indexedEpoch: 41,
              protocolEpoch: 42,
              epochLag: 1,
              ageMs: 90000,
              staleLimitMs: 7200000,
            },
          },
        ],
      }),
    } as unknown as ReconciliationScheduler;

    registerTestInstance(CacheService, cache);
    registerTestInstance(ReconciliationService, reconciliation);
    registerTestInstance(ReconciliationScheduler, reconciliationScheduler);

    const { reconciliationRouter } = await import('../src/routes/v1/reconciliation');
    const app = express();
    app.use('/v1/reconciliation', reconciliationRouter);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/reconciliation/scorecard`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe('WARNING');
      expect(body.freshness.status).toBe('WARNING');
      expect(body.freshness.epoch_lag).toBe(1);
      expect(body.evidence.validator_universe_hash).toBe('0x1234');
      expect(body.pillars.some((pillar: { key: string }) => pillar.key === 'epoch_freshness')).toBe(true);
      expect(
        (reconciliation.getControlPlaneSummary as ReturnType<typeof vi.fn>).mock
          .calls[0][0],
      ).toEqual({
        persist: false,
      });
    });
  });

  it('requires an operator or admin before capturing reconciliation snapshots', async () => {
    const { CacheService } = await import('../src/services/CacheService');
    const { ReconciliationService } = await import('../src/services/ReconciliationService');
    const { ReconciliationScheduler } = await import('../src/services/ReconciliationScheduler');
    const cache = new CacheService();
    const reconciliation = {
      getLiveDocument: vi.fn(),
    } as unknown as ReconciliationService;
    const reconciliationScheduler = {
      getLatestResult: vi.fn().mockReturnValue(null),
    } as unknown as ReconciliationScheduler;

    registerTestInstance(CacheService, cache);
    registerTestInstance(ReconciliationService, reconciliation);
    registerTestInstance(ReconciliationScheduler, reconciliationScheduler);

    const { reconciliationRouter } = await import('../src/routes/v1/reconciliation');
    const app = express();
    app.use('/v1/reconciliation', reconciliationRouter);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/reconciliation/capture`, {
        method: 'POST',
      });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.message).toContain('Authorization header missing');
      expect(
        reconciliation.getLiveDocument as ReturnType<typeof vi.fn>,
      ).not.toHaveBeenCalled();
    });
  });

  it('captures and persists reconciliation snapshots for authenticated operators', async () => {
    const { CacheService } = await import('../src/services/CacheService');
    const { ReconciliationService } = await import('../src/services/ReconciliationService');
    const { ReconciliationScheduler } = await import('../src/services/ReconciliationScheduler');
    const { generateTokens } = await import('../src/auth/service');
    const cache = new CacheService();
    const reconciliation = {
      getLiveDocument: vi.fn().mockResolvedValue({
        epoch: 42,
        network: 'aethelred',
        mode: 'live-snapshot',
        captured_at: '2026-03-10T00:00:00.000Z',
        source: {
          epoch_source: 'evm/cruzible.currentEpoch',
          validator_source: 'rpc/staking.validators',
          stake_source: 'indexer.stAethelBalance+delegation',
          validator_limit: 125,
          validator_count: 2,
          total_eligible_validators: 2,
          chain_height: 42,
        },
        warnings: [],
        discrepancies: [],
        validator_selection: {
          input: { eligible_addresses: ['aethelvaloper1abc', 'aethelvaloper1def'] },
          observed: { universe_hash: '0x1234' },
          meta: { validator_count: 2, total_eligible_validators: 2 },
        },
      }),
    } as unknown as ReconciliationService;
    const reconciliationScheduler = {
      getLatestResult: vi.fn().mockReturnValue(null),
    } as unknown as ReconciliationScheduler;
    const { accessToken } = generateTokens({
      address: 'aeth1operator',
      roles: ['operator'],
    });

    registerTestInstance(CacheService, cache);
    registerTestInstance(ReconciliationService, reconciliation);
    registerTestInstance(ReconciliationScheduler, reconciliationScheduler);

    const { reconciliationRouter } = await import('../src/routes/v1/reconciliation');
    const app = express();
    app.use('/v1/reconciliation', reconciliationRouter);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/v1/reconciliation/capture?validator_limit=125`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.epoch).toBe(42);
      expect(
        (reconciliation.getLiveDocument as ReturnType<typeof vi.fn>).mock.calls[0][0],
      ).toEqual({
        validatorLimit: 125,
        persist: true,
      });
    });
  });

  it('serves immutable reconciliation history', async () => {
    const { CacheService } = await import('../src/services/CacheService');
    const { ReconciliationService } = await import('../src/services/ReconciliationService');
    const { ReconciliationScheduler } = await import('../src/services/ReconciliationScheduler');
    const cache = new CacheService();
    const reconciliation = {
      getHistory: vi.fn().mockResolvedValue([
        {
          snapshot_id: 'snap-1',
          snapshot_key: '42:0x1234:0xabcd:0:1',
          epoch: 42,
          captured_at: '2026-04-24T00:00:00.000Z',
          validator_universe_hash: '0x1234',
          stake_snapshot_hash: '0xabcd',
          warning_count: 0,
          discrepancy_count: 1,
          status: 'WARNING',
          epoch_source: 'evm/cruzible.currentEpoch',
          chain_height: 424242,
          stake_snapshot_complete: true,
        },
      ]),
    } as unknown as ReconciliationService;
    const reconciliationScheduler = {
      getLatestResult: vi.fn().mockReturnValue(null),
    } as unknown as ReconciliationScheduler;

    registerTestInstance(CacheService, cache);
    registerTestInstance(ReconciliationService, reconciliation);
    registerTestInstance(ReconciliationScheduler, reconciliationScheduler);

    const { reconciliationRouter } = await import('../src/routes/v1/reconciliation');
    const app = express();
    app.use('/v1/reconciliation', reconciliationRouter);

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/reconciliation/history?limit=5`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body[0].snapshot_id).toBe('snap-1');
      expect((reconciliation.getHistory as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(5);
    });
  });

  it('wires /v1/models through the shared v1 router with the frontend response shape', async () => {
    const { CacheService } = await import('../src/services/CacheService');
    const { BlockchainService } = await import('../src/services/BlockchainService');
    const { JobsService } = await import('../src/services/JobsService');
    const { ReconciliationService } = await import('../src/services/ReconciliationService');
    const { AlertService } = await import('../src/services/AlertService');
    const { ReconciliationScheduler } = await import('../src/services/ReconciliationScheduler');
    const { StablecoinBridgeService } = await import('../src/services/StablecoinBridgeService');
    const { ModelsService } = await import('../src/services/ModelsService');
    const { SealsService } = await import('../src/services/SealsService');

    const cache = {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    } as unknown as CacheService;
    const blockchain = {
      getBlocks: vi.fn(),
      getLatestBlock: vi.fn(),
      getBlockByHeight: vi.fn(),
      getBlockTransactions: vi.fn(),
    } as unknown as BlockchainService;
    const jobs = {
      getJobs: vi.fn(),
      getJobStats: vi.fn(),
      getPricing: vi.fn(),
      getJobById: vi.fn(),
      getJobVerifications: vi.fn(),
      getJobQueue: vi.fn(),
    } as unknown as JobsService;
    const reconciliation = {
      getLiveDocument: vi.fn(),
    } as unknown as ReconciliationService;
    const alerts = {
      getAlertHistory: vi.fn().mockReturnValue({ data: [], total: 0 }),
      getAlertSummary: vi.fn().mockReturnValue({ critical: 0, warning: 0, info: 0 }),
    } as unknown as AlertService;
    const reconciliationScheduler = {
      getLatestResult: vi.fn().mockReturnValue(null),
    } as unknown as ReconciliationScheduler;
    const stablecoins = {
      getConfigs: vi.fn().mockResolvedValue([]),
      getConfig: vi.fn().mockResolvedValue(null),
      getBridgeHistory: vi.fn().mockResolvedValue({
        data: [],
        pagination: { total: 0, limit: 50, offset: 0 },
      }),
      getStatus: vi.fn().mockResolvedValue(null),
    } as unknown as StablecoinBridgeService;
    const models = {
      getModels: vi.fn().mockResolvedValue({
        models: [
          {
            modelHash: 'model-hash-1',
            name: 'Inference XL',
            owner: 'aethel1owner',
            architecture: 'transformer-large',
            version: '1.0.0',
            category: 'SCIENTIFIC',
            inputSchema: '{"type":"object"}',
            outputSchema: '{"type":"object"}',
            storageUri: 'ipfs://model',
            registeredAt: '2026-03-10T00:00:00.000Z',
            verified: true,
            totalJobs: 128,
          },
        ],
        total: 1,
      }),
    } as unknown as ModelsService;
    const seals = {
      getSeals: vi.fn().mockResolvedValue({
        seals: [],
        total: 0,
      }),
    } as unknown as SealsService;

    registerTestInstance(CacheService, cache);
    registerTestInstance(BlockchainService, blockchain);
    registerTestInstance(JobsService, jobs);
    registerTestInstance(ReconciliationService, reconciliation);
    registerTestInstance(AlertService, alerts);
    registerTestInstance(ReconciliationScheduler, reconciliationScheduler);
    registerTestInstance(StablecoinBridgeService, stablecoins);
    registerTestInstance(ModelsService, models);
    registerTestInstance(SealsService, seals);

    const { router: v1Router } = await import('../src/routes/v1');
    const app = express();
    app.use('/v1', v1Router);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.statusCode || err.status || 500).json({
        error: err.message || 'Internal Server Error',
        details: err.details || undefined,
      });
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/models?limit=50`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.total).toBe(1);
      expect(body.models[0]).toMatchObject({
        modelHash: 'model-hash-1',
        name: 'Inference XL',
        category: 'SCIENTIFIC',
        verified: true,
        totalJobs: 128,
      });
      expect((models.getModels as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({
        limit: 50,
        offset: 0,
        category: undefined,
        verified: undefined,
        owner: undefined,
        sort: 'registered_at:desc',
      });
    });
  });

  it('wires /v1/models/:modelHash through the shared v1 router with lineage fields', async () => {
    const { CacheService } = await import('../src/services/CacheService');
    const { BlockchainService } = await import('../src/services/BlockchainService');
    const { JobsService } = await import('../src/services/JobsService');
    const { ReconciliationService } = await import('../src/services/ReconciliationService');
    const { AlertService } = await import('../src/services/AlertService');
    const { ReconciliationScheduler } = await import('../src/services/ReconciliationScheduler');
    const { StablecoinBridgeService } = await import('../src/services/StablecoinBridgeService');
    const { ModelsService } = await import('../src/services/ModelsService');
    const { SealsService } = await import('../src/services/SealsService');

    registerTestInstance(
      CacheService,
      {
        get: vi.fn().mockReturnValue(null),
        set: vi.fn().mockResolvedValue(undefined),
      } as unknown as CacheService,
    );
    registerTestInstance(
      BlockchainService,
      {
        getBlocks: vi.fn(),
        getLatestBlock: vi.fn(),
        getBlockByHeight: vi.fn(),
        getBlockTransactions: vi.fn(),
      } as unknown as BlockchainService,
    );
    registerTestInstance(
      JobsService,
      {
        getJobs: vi.fn(),
        getJobStats: vi.fn(),
        getPricing: vi.fn(),
        getJobById: vi.fn(),
        getJobVerifications: vi.fn(),
        getJobQueue: vi.fn(),
      } as unknown as JobsService,
    );
    registerTestInstance(
      ReconciliationService,
      {
        getLiveDocument: vi.fn(),
      } as unknown as ReconciliationService,
    );
    registerTestInstance(
      AlertService,
      {
        getAlertHistory: vi.fn().mockReturnValue({ data: [], total: 0 }),
        getAlertSummary: vi.fn().mockReturnValue({ critical: 0, warning: 0, info: 0 }),
      } as unknown as AlertService,
    );
    registerTestInstance(
      ReconciliationScheduler,
      {
        getLatestResult: vi.fn().mockReturnValue(null),
      } as unknown as ReconciliationScheduler,
    );
    registerTestInstance(
      StablecoinBridgeService,
      {
        getConfigs: vi.fn().mockResolvedValue([]),
        getConfig: vi.fn().mockResolvedValue(null),
        getBridgeHistory: vi.fn().mockResolvedValue({
          data: [],
          pagination: { total: 0, limit: 50, offset: 0 },
        }),
        getStatus: vi.fn().mockResolvedValue(null),
      } as unknown as StablecoinBridgeService,
    );

    const models = {
      getModels: vi.fn().mockResolvedValue({ models: [], total: 0 }),
      getModelByHash: vi.fn().mockResolvedValue({
        modelHash: 'model-hash-1',
        name: 'Atlas Model',
        owner: 'aeth1owner',
        architecture: 'transformer-base',
        version: '1.0.0',
        category: 'SCIENTIFIC',
        inputSchema: 'input:v1',
        outputSchema: 'output:v1',
        storageUri: 'ipfs://atlas-model',
        registeredAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-24T00:00:00.000Z',
        verified: true,
        totalJobs: 12,
        sizeBytes: '1048576',
        usage: {
          totalJobs: 12,
          verifiedJobs: 10,
          inFlightJobs: 1,
          failedJobs: 1,
          latestJobAt: '2026-04-24T00:00:00.000Z',
          latestVerifiedAt: '2026-04-23T00:00:00.000Z',
          proofTypeBreakdown: [{ proofType: 'TEE_ATTESTATION', count: 10 }],
        },
        lineage: {
          recentJobs: [
            {
              id: 'job-1',
              status: 'VERIFIED',
              proofType: 'TEE_ATTESTATION',
              createdAt: '2026-04-24T00:00:00.000Z',
              completedAt: '2026-04-24T00:05:00.000Z',
              verificationScore: 9988,
              creatorAddress: 'aeth1creator',
              validatorAddress: 'aeth1validator',
            },
          ],
        },
      }),
    } as unknown as ModelsService;
    const seals = {
      getSeals: vi.fn().mockResolvedValue({ seals: [], total: 0 }),
      getSealById: vi.fn(),
    } as unknown as SealsService;

    registerTestInstance(ModelsService, models);
    registerTestInstance(SealsService, seals);

    const { router: v1Router } = await import('../src/routes/v1');
    const app = express();
    app.use('/v1', v1Router);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.statusCode || err.status || 500).json({
        error: err.message || 'Internal Server Error',
      });
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/models/model-hash-1`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.modelHash).toBe('model-hash-1');
      expect(body.usage.verifiedJobs).toBe(10);
      expect(body.lineage.recentJobs[0].id).toBe('job-1');
      expect((models.getModelByHash as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        'model-hash-1',
      );
    });
  });

  it('wires /v1/seals through the shared v1 router and forwards frontend filters', async () => {
    const { CacheService } = await import('../src/services/CacheService');
    const { BlockchainService } = await import('../src/services/BlockchainService');
    const { JobsService } = await import('../src/services/JobsService');
    const { ReconciliationService } = await import('../src/services/ReconciliationService');
    const { AlertService } = await import('../src/services/AlertService');
    const { ReconciliationScheduler } = await import('../src/services/ReconciliationScheduler');
    const { StablecoinBridgeService } = await import('../src/services/StablecoinBridgeService');
    const { ModelsService } = await import('../src/services/ModelsService');
    const { SealsService } = await import('../src/services/SealsService');

    const cache = {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    } as unknown as CacheService;
    const blockchain = {
      getBlocks: vi.fn(),
      getLatestBlock: vi.fn(),
      getBlockByHeight: vi.fn(),
      getBlockTransactions: vi.fn(),
    } as unknown as BlockchainService;
    const jobs = {
      getJobs: vi.fn(),
      getJobStats: vi.fn(),
      getPricing: vi.fn(),
      getJobById: vi.fn(),
      getJobVerifications: vi.fn(),
      getJobQueue: vi.fn(),
    } as unknown as JobsService;
    const reconciliation = {
      getLiveDocument: vi.fn(),
    } as unknown as ReconciliationService;
    const alerts = {
      getAlertHistory: vi.fn().mockReturnValue({ data: [], total: 0 }),
      getAlertSummary: vi.fn().mockReturnValue({ critical: 0, warning: 0, info: 0 }),
    } as unknown as AlertService;
    const reconciliationScheduler = {
      getLatestResult: vi.fn().mockReturnValue(null),
    } as unknown as ReconciliationScheduler;
    const stablecoins = {
      getConfigs: vi.fn().mockResolvedValue([]),
      getConfig: vi.fn().mockResolvedValue(null),
      getBridgeHistory: vi.fn().mockResolvedValue({
        data: [],
        pagination: { total: 0, limit: 50, offset: 0 },
      }),
      getStatus: vi.fn().mockResolvedValue(null),
    } as unknown as StablecoinBridgeService;
    const models = {
      getModels: vi.fn().mockResolvedValue({ models: [], total: 0 }),
    } as unknown as ModelsService;
    const seals = {
      getSeals: vi.fn().mockResolvedValue({
        seals: [
          {
            id: 'seal-1',
            jobId: 'job-1',
            status: 'active',
            modelCommitment: 'model-commitment',
            inputCommitment: 'input-commitment',
            outputCommitment: 'output-commitment',
            requester: 'aethel1requester',
            validatorCount: 3,
            createdAt: '2026-03-10T00:00:00.000Z',
            expiresAt: null,
          },
        ],
        total: 1,
      }),
    } as unknown as SealsService;

    registerTestInstance(CacheService, cache);
    registerTestInstance(BlockchainService, blockchain);
    registerTestInstance(JobsService, jobs);
    registerTestInstance(ReconciliationService, reconciliation);
    registerTestInstance(AlertService, alerts);
    registerTestInstance(ReconciliationScheduler, reconciliationScheduler);
    registerTestInstance(StablecoinBridgeService, stablecoins);
    registerTestInstance(ModelsService, models);
    registerTestInstance(SealsService, seals);

    const { router: v1Router } = await import('../src/routes/v1');
    const app = express();
    app.use('/v1', v1Router);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.statusCode || err.status || 500).json({
        error: err.message || 'Internal Server Error',
        details: err.details || undefined,
      });
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/v1/seals?limit=20&offset=20&status=active&sort=created_at:desc`,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.total).toBe(1);
      expect(body.seals[0]).toMatchObject({
        id: 'seal-1',
        jobId: 'job-1',
        status: 'active',
        validatorCount: 3,
      });
      expect((seals.getSeals as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({
        limit: 20,
        offset: 20,
        status: 'active',
        requester: undefined,
        jobId: undefined,
        sort: 'created_at:desc',
      });
    });
  });

  it('wires /v1/seals/:id through the shared v1 router with proof lineage fields', async () => {
    const { CacheService } = await import('../src/services/CacheService');
    const { BlockchainService } = await import('../src/services/BlockchainService');
    const { JobsService } = await import('../src/services/JobsService');
    const { ReconciliationService } = await import('../src/services/ReconciliationService');
    const { AlertService } = await import('../src/services/AlertService');
    const { ReconciliationScheduler } = await import('../src/services/ReconciliationScheduler');
    const { StablecoinBridgeService } = await import('../src/services/StablecoinBridgeService');
    const { ModelsService } = await import('../src/services/ModelsService');
    const { SealsService } = await import('../src/services/SealsService');

    registerTestInstance(
      CacheService,
      {
        get: vi.fn().mockReturnValue(null),
        set: vi.fn().mockResolvedValue(undefined),
      } as unknown as CacheService,
    );
    registerTestInstance(
      BlockchainService,
      {
        getBlocks: vi.fn(),
        getLatestBlock: vi.fn(),
        getBlockByHeight: vi.fn(),
        getBlockTransactions: vi.fn(),
      } as unknown as BlockchainService,
    );
    registerTestInstance(
      JobsService,
      {
        getJobs: vi.fn(),
        getJobStats: vi.fn(),
        getPricing: vi.fn(),
        getJobById: vi.fn(),
        getJobVerifications: vi.fn(),
        getJobQueue: vi.fn(),
      } as unknown as JobsService,
    );
    registerTestInstance(
      ReconciliationService,
      {
        getLiveDocument: vi.fn(),
      } as unknown as ReconciliationService,
    );
    registerTestInstance(
      AlertService,
      {
        getAlertHistory: vi.fn().mockReturnValue({ data: [], total: 0 }),
        getAlertSummary: vi.fn().mockReturnValue({ critical: 0, warning: 0, info: 0 }),
      } as unknown as AlertService,
    );
    registerTestInstance(
      ReconciliationScheduler,
      {
        getLatestResult: vi.fn().mockReturnValue(null),
      } as unknown as ReconciliationScheduler,
    );
    registerTestInstance(
      StablecoinBridgeService,
      {
        getConfigs: vi.fn().mockResolvedValue([]),
        getConfig: vi.fn().mockResolvedValue(null),
        getBridgeHistory: vi.fn().mockResolvedValue({
          data: [],
          pagination: { total: 0, limit: 50, offset: 0 },
        }),
        getStatus: vi.fn().mockResolvedValue(null),
      } as unknown as StablecoinBridgeService,
    );
    registerTestInstance(
      ModelsService,
      {
        getModels: vi.fn().mockResolvedValue({ models: [], total: 0 }),
        getModelByHash: vi.fn(),
      } as unknown as ModelsService,
    );

    const seals = {
      getSeals: vi.fn().mockResolvedValue({ seals: [], total: 0 }),
      getSealById: vi.fn().mockResolvedValue({
        id: 'seal-1',
        jobId: 'job-1',
        status: 'active',
        modelCommitment: 'model-commitment',
        inputCommitment: 'input-commitment',
        outputCommitment: 'output-commitment',
        requester: 'aeth1requester',
        validatorCount: 2,
        validators: ['aethvaloper1', 'aethvaloper2'],
        createdAt: '2026-04-24T00:00:00.000Z',
        expiresAt: '2026-05-24T00:00:00.000Z',
        revokedAt: null,
        revokedBy: null,
        revocationReason: null,
        job: {
          id: 'job-1',
          status: 'VERIFIED',
          modelHash: 'model-hash-1',
          modelName: 'Atlas Model',
          proofType: 'TEE_ATTESTATION',
          verificationScore: 9991,
          createdAt: '2026-04-24T00:00:00.000Z',
          completedAt: '2026-04-24T00:05:00.000Z',
          outputHash: 'output-hash',
          creatorAddress: 'aeth1creator',
          validatorAddress: 'aeth1validator',
        },
        proofLineage: {
          proofType: 'TEE_ATTESTATION',
          merkleRoot: 'merkle-root',
          validatorSignatureCount: 2,
          teeType: 'AWS_NITRO',
          teeTimestamp: '2026-04-24T00:05:00.000Z',
          teeMeasurement: 'measurement',
          computeMetrics: {
            cpuCycles: '100',
            memoryUsed: '200',
            computeTimeMs: '300',
            energyMj: '400',
          },
        },
      }),
    } as unknown as SealsService;

    registerTestInstance(SealsService, seals);

    const { router: v1Router } = await import('../src/routes/v1');
    const app = express();
    app.use('/v1', v1Router);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.statusCode || err.status || 500).json({
        error: err.message || 'Internal Server Error',
      });
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/seals/seal-1`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.id).toBe('seal-1');
      expect(body.proofLineage.validatorSignatureCount).toBe(2);
      expect(body.job.modelName).toBe('Atlas Model');
      expect((seals.getSealById as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        'seal-1',
      );
    });
  });

  it('wires /v1/validators through the shared v1 router with validator intelligence metadata', async () => {
    const { CacheService } = await import('../src/services/CacheService');
    const { BlockchainService } = await import('../src/services/BlockchainService');
    const { JobsService } = await import('../src/services/JobsService');
    const { ReconciliationService } = await import('../src/services/ReconciliationService');
    const { AlertService } = await import('../src/services/AlertService');
    const { ReconciliationScheduler } = await import('../src/services/ReconciliationScheduler');
    const { StablecoinBridgeService } = await import('../src/services/StablecoinBridgeService');
    const { ModelsService } = await import('../src/services/ModelsService');
    const { SealsService } = await import('../src/services/SealsService');

    const cache = {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    } as unknown as CacheService;
    const blockchain = {
      getBlocks: vi.fn(),
      getLatestBlock: vi.fn(),
      getBlockByHeight: vi.fn(),
      getBlockTransactions: vi.fn(),
      getValidators: vi.fn().mockImplementation(({ status }: { status?: string }) => {
        if (status === 'BOND_STATUS_UNBONDED') {
          return Promise.resolve({
            data: [
              {
                address: 'aethinactive1',
                moniker: 'Archive Operator',
                identity: '',
                website: '',
                details: '',
                tokens: '250',
                delegatorShares: '250',
                commission: { rate: '0.0300', maxRate: '0.2000', maxChangeRate: '0.0100' },
                status: 'BOND_STATUS_UNBONDED',
                jailed: false,
                unbondingHeight: 12,
                unbondingTime: 0,
              },
            ],
            pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
          });
        }

        return Promise.resolve({
          data: [
            {
              address: 'aethvaloper1',
              moniker: 'Atlas One',
              identity: 'atlas',
              website: 'https://atlas.example',
              details: 'Primary operator',
              tokens: '1000',
              delegatorShares: '1000',
              commission: { rate: '0.0500', maxRate: '0.2000', maxChangeRate: '0.0200' },
              status: 'BOND_STATUS_BONDED',
              jailed: false,
              unbondingHeight: 0,
              unbondingTime: 0,
            },
            {
              address: 'aethvaloper2',
              moniker: 'Jailed Ops',
              identity: '',
              website: '',
              details: '',
              tokens: '400',
              delegatorShares: '400',
              commission: { rate: '0.1000', maxRate: '0.2000', maxChangeRate: '0.0100' },
              status: 'BOND_STATUS_BONDED',
              jailed: true,
              unbondingHeight: 0,
              unbondingTime: 0,
            },
          ],
          pagination: { limit: 100, offset: 0, total: 2, hasMore: false },
        });
      }),
      getValidator: vi.fn().mockResolvedValue({
        address: 'aethvaloper1',
        moniker: 'Atlas One',
        identity: 'atlas',
        website: 'https://atlas.example',
        details: 'Primary operator',
        tokens: '1000',
        delegatorShares: '1000',
        commission: { rate: '0.0500', maxRate: '0.2000', maxChangeRate: '0.0200' },
        status: 'BOND_STATUS_BONDED',
        jailed: false,
        unbondingHeight: 0,
        unbondingTime: 0,
      }),
    } as unknown as BlockchainService;
    const jobs = {
      getJobs: vi.fn(),
      getJobStats: vi.fn(),
      getPricing: vi.fn(),
      getJobById: vi.fn(),
      getJobVerifications: vi.fn(),
      getJobQueue: vi.fn(),
    } as unknown as JobsService;
    const reconciliation = {
      getLiveDocument: vi.fn(),
    } as unknown as ReconciliationService;
    const alerts = {
      getAlertHistory: vi.fn().mockReturnValue({ data: [], total: 0 }),
      getAlertSummary: vi.fn().mockReturnValue({ critical: 0, warning: 0, info: 0 }),
    } as unknown as AlertService;
    const reconciliationScheduler = {
      getLatestResult: vi.fn().mockReturnValue(null),
    } as unknown as ReconciliationScheduler;
    const stablecoins = {
      getConfigs: vi.fn().mockResolvedValue([]),
      getConfig: vi.fn().mockResolvedValue(null),
      getBridgeHistory: vi.fn().mockResolvedValue({
        data: [],
        pagination: { total: 0, limit: 50, offset: 0 },
      }),
      getStatus: vi.fn().mockResolvedValue(null),
    } as unknown as StablecoinBridgeService;
    const models = {
      getModels: vi.fn().mockResolvedValue({ models: [], total: 0 }),
    } as unknown as ModelsService;
    const seals = {
      getSeals: vi.fn().mockResolvedValue({ seals: [], total: 0 }),
    } as unknown as SealsService;

    registerTestInstance(CacheService, cache);
    registerTestInstance(BlockchainService, blockchain);
    registerTestInstance(JobsService, jobs);
    registerTestInstance(ReconciliationService, reconciliation);
    registerTestInstance(AlertService, alerts);
    registerTestInstance(ReconciliationScheduler, reconciliationScheduler);
    registerTestInstance(StablecoinBridgeService, stablecoins);
    registerTestInstance(ModelsService, models);
    registerTestInstance(SealsService, seals);

    const { router: v1Router } = await import('../src/routes/v1');
    const app = express();
    app.use('/v1', v1Router);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.statusCode || err.status || 500).json({
        error: err.message || 'Internal Server Error',
      });
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/validators?limit=10`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(3);
      expect(body.data[0].lifecycleStatus).toBe('active');
      expect(body.data[1].lifecycleStatus).toBe('jailed');
      expect(body.data[0].risk.level).toBeDefined();
      expect(body.data[0].risk.components).toHaveLength(5);
      expect(body.protocol.eligibleUniverseHash).toBeDefined();
      expect(body.protocol.totalListedTokens).toBe('1650');
      expect(body.protocol.totalBondedTokens).toBe('1400');
      expect(body.protocol.totalEligibleValidators).toBe(2);
      expect(body.protocol.freshnessStatus).toBe('UNKNOWN');
    });
  });

  it('wires /v1/validators/:address through the shared v1 router', async () => {
    const { CacheService } = await import('../src/services/CacheService');
    const { BlockchainService } = await import('../src/services/BlockchainService');
    const { ReconciliationScheduler } = await import('../src/services/ReconciliationScheduler');
    const cache = {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    } as unknown as CacheService;
    const blockchain = {
      getValidators: vi.fn().mockResolvedValue({
        data: [
          {
            address: 'aethvaloper1',
            moniker: 'Atlas One',
            identity: 'atlas',
            website: 'https://atlas.example',
            details: 'Primary operator',
            tokens: '1000',
            delegatorShares: '1000',
            commission: { rate: '0.0500', maxRate: '0.2000', maxChangeRate: '0.0200' },
            status: 'BOND_STATUS_BONDED',
            jailed: false,
            unbondingHeight: 0,
            unbondingTime: 0,
          },
        ],
        pagination: { limit: 100, offset: 0, total: 1, hasMore: false },
      }),
      getValidator: vi.fn().mockResolvedValue({
        address: 'aethvaloper1',
        moniker: 'Atlas One',
        identity: 'atlas',
        website: 'https://atlas.example',
        details: 'Primary operator',
        tokens: '1000',
        delegatorShares: '1000',
        commission: { rate: '0.0500', maxRate: '0.2000', maxChangeRate: '0.0200' },
        status: 'BOND_STATUS_BONDED',
        jailed: false,
        unbondingHeight: 0,
        unbondingTime: 0,
      }),
    } as unknown as BlockchainService;
    const reconciliationScheduler = {
      getLatestResult: vi.fn().mockReturnValue({
        timestamp: '2026-04-24T00:01:00.000Z',
        status: 'OK',
        epoch: 42,
        epochSource: 'evm/cruzible.currentEpoch',
        durationMs: 20,
        onChainState: null,
        indexedState: null,
        checks: [
          {
            name: 'epoch_freshness',
            status: 'PASS',
            message: 'fresh',
            metadata: {
              indexedEpoch: 42,
              protocolEpoch: 42,
              epochLag: 0,
              ageMs: 12000,
              staleLimitMs: 7200000,
            },
          },
        ],
      }),
    } as unknown as ReconciliationScheduler;

    registerTestInstance(CacheService, cache);
    registerTestInstance(BlockchainService, blockchain);
    registerTestInstance(ReconciliationScheduler, reconciliationScheduler);

    const { validatorsRouter } = await import('../src/routes/v1/validators');
    const app = express();
    app.use('/v1/validators', validatorsRouter);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.statusCode || err.status || 500).json({
        error: err.message || 'Internal Server Error',
      });
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/validators/aethvaloper1`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.validator.address).toBe('aethvaloper1');
      expect(body.validator.lifecycleStatus).toBe('active');
      expect(body.validator.transparencyScore).toBeGreaterThan(0);
      expect(body.validator.commissionPercent).toBe(5);
      expect(body.validator.sharePercent).toBe(100);
      expect(body.protocol.eligibleUniverseHash).toBeDefined();
      expect(body.protocol.freshnessStatus).toBe('PASS');
    });
  });

  it('validates /v1/seals status filters', async () => {
    const { CacheService } = await import('../src/services/CacheService');
    const { BlockchainService } = await import('../src/services/BlockchainService');
    const { JobsService } = await import('../src/services/JobsService');
    const { ReconciliationService } = await import('../src/services/ReconciliationService');
    const { AlertService } = await import('../src/services/AlertService');
    const { ReconciliationScheduler } = await import('../src/services/ReconciliationScheduler');
    const { StablecoinBridgeService } = await import('../src/services/StablecoinBridgeService');
    const { ModelsService } = await import('../src/services/ModelsService');
    const { SealsService } = await import('../src/services/SealsService');

    registerTestInstance(
      CacheService,
      {
        get: vi.fn().mockReturnValue(null),
        set: vi.fn().mockResolvedValue(undefined),
      } as unknown as CacheService,
    );
    registerTestInstance(
      BlockchainService,
      {
        getBlocks: vi.fn(),
        getLatestBlock: vi.fn(),
        getBlockByHeight: vi.fn(),
        getBlockTransactions: vi.fn(),
      } as unknown as BlockchainService,
    );
    registerTestInstance(
      JobsService,
      {
        getJobs: vi.fn(),
        getJobStats: vi.fn(),
        getPricing: vi.fn(),
        getJobById: vi.fn(),
        getJobVerifications: vi.fn(),
        getJobQueue: vi.fn(),
      } as unknown as JobsService,
    );
    registerTestInstance(
      ReconciliationService,
      {
        getLiveDocument: vi.fn(),
      } as unknown as ReconciliationService,
    );
    registerTestInstance(
      AlertService,
      {
        getAlertHistory: vi.fn().mockReturnValue({ data: [], total: 0 }),
        getAlertSummary: vi.fn().mockReturnValue({ critical: 0, warning: 0, info: 0 }),
      } as unknown as AlertService,
    );
    registerTestInstance(
      ReconciliationScheduler,
      {
        getLatestResult: vi.fn().mockReturnValue(null),
      } as unknown as ReconciliationScheduler,
    );
    registerTestInstance(
      StablecoinBridgeService,
      {
        getConfigs: vi.fn().mockResolvedValue([]),
        getConfig: vi.fn().mockResolvedValue(null),
        getBridgeHistory: vi.fn().mockResolvedValue({
          data: [],
          pagination: { total: 0, limit: 50, offset: 0 },
        }),
        getStatus: vi.fn().mockResolvedValue(null),
      } as unknown as StablecoinBridgeService,
    );
    registerTestInstance(
      ModelsService,
      {
        getModels: vi.fn().mockResolvedValue({ models: [], total: 0 }),
      } as unknown as ModelsService,
    );
    registerTestInstance(
      SealsService,
      {
        getSeals: vi.fn().mockResolvedValue({ seals: [], total: 0 }),
      } as unknown as SealsService,
    );

    const { router: v1Router } = await import('../src/routes/v1');
    const app = express();
    app.use('/v1', v1Router);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.statusCode || err.status || 500).json({
        error: err.message || 'Internal Server Error',
        details: err.details || undefined,
      });
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/seals?status=unknown`);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });
  });
});
