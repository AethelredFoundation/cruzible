import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted by vitest before any imports
// ---------------------------------------------------------------------------

// Mock PrismaClient so the scheduler constructor and fetchIndexedState work.
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    vaultState: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    stablecoinConfig: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(null),
    },
  })),
}));

// Mock logger — we need a reference to assert on specific messages.
vi.mock('../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Static import after mocks are hoisted — gets the mocked versions.
import { ReconciliationScheduler } from '../src/services/ReconciliationScheduler';
import { logger } from '../src/utils/logger';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReconciliationScheduler lifecycle and overlap guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.error).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Helper — build a scheduler with fully mocked dependencies
  // -----------------------------------------------------------------------

  function createScheduler(overrides?: {
    getLatestHeight?: (...args: unknown[]) => Promise<number>;
    getValidators?: (...args: unknown[]) => Promise<unknown>;
  }) {
    const blockchainService = {
      getLatestHeight:
        overrides?.getLatestHeight ??
        vi.fn().mockResolvedValue(100),
      getValidators:
        overrides?.getValidators ??
        vi.fn().mockResolvedValue({
          data: [
            { tokens: '1000', jailed: false },
            { tokens: '2000', jailed: false },
            { tokens: '3000', jailed: false },
            { tokens: '4000', jailed: false },
            { tokens: '5000', jailed: false },
          ],
        }),
    };

    const cacheService = {
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
    };

    const alertService = {
      sendAlert: vi.fn().mockResolvedValue(null),
      getActiveCriticalCount: vi.fn().mockReturnValue(0),
    };

    const scheduler = new ReconciliationScheduler(
      blockchainService as any,
      cacheService as any,
      alertService as any,
    );

    return { scheduler, blockchainService, cacheService, alertService };
  }

  // -----------------------------------------------------------------------
  // Lifecycle tests
  // -----------------------------------------------------------------------

  it('start() fires an immediate tick and produces a result', async () => {
    const { scheduler } = createScheduler();

    expect(scheduler.getLatestResult()).toBeNull();

    scheduler.start();

    // Let the immediate tick's async work (microtasks) complete
    await vi.advanceTimersByTimeAsync(0);

    expect(scheduler.getLatestResult()).not.toBeNull();
    expect(scheduler.getLatestResult()!.status).toBeDefined();

    scheduler.stop();
  });

  it('start() is idempotent — second call is a no-op', async () => {
    const { scheduler } = createScheduler();

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    // Second start should be a no-op with a warning
    scheduler.start();

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('already running'),
    );

    scheduler.stop();
  });

  it('stop() prevents further ticks after the initial one', async () => {
    const { scheduler, blockchainService } = createScheduler();

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0); // complete the immediate tick

    const callsAfterStart = vi.mocked(blockchainService.getLatestHeight).mock
      .calls.length;

    scheduler.stop();

    // Advance well past the default interval (5 min = 300 000 ms)
    await vi.advanceTimersByTimeAsync(600_000);

    const callsAfterStop = vi.mocked(blockchainService.getLatestHeight).mock
      .calls.length;

    // No new blockchain calls after stop()
    expect(callsAfterStop).toBe(callsAfterStart);
  });

  it('stop() before start() is a safe no-op', () => {
    const { scheduler } = createScheduler();

    // Should not throw
    scheduler.stop();

    expect(scheduler.getLatestResult()).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Overlap guard
  // -----------------------------------------------------------------------

  it('tickInFlight guard skips overlapping ticks', async () => {
    // Create a deferred promise so the first tick hangs
    let resolveHeight!: (value: number) => void;
    const slowHeight = new Promise<number>((resolve) => {
      resolveHeight = resolve;
    });

    // First call returns the slow promise; later calls resolve instantly.
    let callCount = 0;
    const { scheduler } = createScheduler({
      getLatestHeight: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return slowHeight;
        return Promise.resolve(200);
      }),
    });

    scheduler.start();
    // First tick is now in-flight, blocked on slowHeight.

    // Advance past the default interval to trigger the next scheduled tick.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    // The interval tick should have been skipped because the first is still
    // in-flight.
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('previous tick still in flight'),
    );

    // Now let the first tick complete.
    resolveHeight(100);
    await vi.advanceTimersByTimeAsync(0); // flush microtasks

    // The first tick should have finished and stored a result.
    expect(scheduler.getLatestResult()).not.toBeNull();

    scheduler.stop();
  });
});
