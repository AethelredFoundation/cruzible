import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

describe('AlertService', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      ALERT_RATE_LIMIT_MS: '60000',
    };
    delete process.env.DATABASE_URL;
    delete process.env.ALERT_WEBHOOK_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('stores alert history and summaries in the local fallback buffer', async () => {
    const { AlertService, AlertSeverity, AlertType } = await import(
      '../src/services/AlertService'
    );
    const service = new AlertService();

    const alert = await service.sendAlert(
      AlertSeverity.CRITICAL,
      AlertType.EXCHANGE_RATE_DRIFT,
      'Exchange rate drift exceeded threshold',
      { drift: 0.08 },
    );

    const history = await service.getAlertHistory({ limit: 10 });
    const summary = await service.getAlertSummary();
    const activeCritical = await service.getActiveCriticalCount();

    expect(alert?.delivered).toBe(true);
    expect(history.total).toBe(1);
    expect(history.data[0]).toMatchObject({
      severity: AlertSeverity.CRITICAL,
      type: AlertType.EXCHANGE_RATE_DRIFT,
      metadata: { drift: 0.08 },
    });
    expect(summary.activeCritical).toBe(1);
    expect(activeCritical).toBe(1);
  });

  it('rate-limits duplicate alert categories', async () => {
    const { AlertService, AlertSeverity, AlertType } = await import(
      '../src/services/AlertService'
    );
    const service = new AlertService();

    const first = await service.sendAlert(
      AlertSeverity.WARNING,
      AlertType.TVL_ANOMALY,
      'TVL warning',
    );
    const second = await service.sendAlert(
      AlertSeverity.WARNING,
      AlertType.TVL_ANOMALY,
      'TVL warning replay',
    );

    const history = await service.getAlertHistory();

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(history.total).toBe(1);
  });
});
