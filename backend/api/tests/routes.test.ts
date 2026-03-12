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

  it('serves live reconciliation documents through the registered reconciliation service', async () => {
    const { CacheService } = await import('../src/services/CacheService');
    const { ReconciliationService } = await import('../src/services/ReconciliationService');
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

    registerTestInstance(CacheService, cache);
    registerTestInstance(ReconciliationService, reconciliation);

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
      });
    });
  });
});
