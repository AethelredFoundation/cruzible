/**
 * AlertService
 *
 * Production-grade alerting service for the Cruzible vault reconciliation system.
 *
 * Responsibilities:
 *  - Send alerts via console log (default) and optional webhook
 *  - Enforce alert severity levels: INFO, WARNING, CRITICAL
 *  - Categorize alerts by type (reconciliation mismatch, exchange rate drift, etc.)
 *  - Rate-limit alerts so the same alert type is not spammed within a configurable window
 *  - Persist alert history when DATABASE_URL is configured
 *  - Maintain an in-memory fallback ring buffer for local/test operation
 */

import { injectable } from 'tsyringe';
import { Prisma, PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { config } from '../config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum AlertSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
}

export enum AlertType {
  RECONCILIATION_MISMATCH = 'RECONCILIATION_MISMATCH',
  EXCHANGE_RATE_DRIFT = 'EXCHANGE_RATE_DRIFT',
  TVL_ANOMALY = 'TVL_ANOMALY',
  EPOCH_STALE = 'EPOCH_STALE',
  VALIDATOR_COUNT_DROP = 'VALIDATOR_COUNT_DROP',
  // Stablecoin bridge alerts
  STABLECOIN_CIRCUIT_BREAKER = 'STABLECOIN_CIRCUIT_BREAKER',
  STABLECOIN_RESERVE_DRIFT = 'STABLECOIN_RESERVE_DRIFT',
  STABLECOIN_CONFIG_MISMATCH = 'STABLECOIN_CONFIG_MISMATCH',
}

export type AlertMetadata = Record<string, unknown>;

export interface Alert {
  id: string;
  severity: AlertSeverity;
  type: AlertType;
  message: string;
  metadata: AlertMetadata;
  timestamp: string;
  delivered: boolean;
}

export interface AlertSummary {
  total: number;
  bySeverity: Record<AlertSeverity, number>;
  byType: Record<AlertType, number>;
  activeCritical: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of alerts to keep in the ring buffer. */
const MAX_ALERT_HISTORY = 100;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@injectable()
export class AlertService {
  /** In-memory ring buffer of recent alerts. Used as fallback and hot cache. */
  private readonly history: Alert[] = [];

  /** Tracks the last time an alert was sent for each type (for rate limiting). */
  private readonly lastAlertAt = new Map<string, number>();

  /** Prisma client for durable alert history in production deployments. */
  private readonly prisma: PrismaClient | null;

  /** Webhook URL for forwarding alerts (optional). */
  private readonly webhookUrl: string | undefined;

  /** Rate-limit window in milliseconds. */
  private readonly rateLimitMs: number;

  constructor() {
    this.webhookUrl = config.alertWebhookUrl;
    this.rateLimitMs = config.alertRateLimitMs;
    this.prisma = config.databaseUrl ? new PrismaClient() : null;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Send an alert through all configured channels (console, webhook).
   *
   * The alert is rate-limited by a composite key of `severity:type` so that
   * the same category of alert is not fired more than once within the
   * configured rate-limit window.
   */
  async sendAlert(
    severity: AlertSeverity,
    type: AlertType,
    message: string,
    metadata: AlertMetadata = {},
  ): Promise<Alert | null> {
    // Rate-limit check
    const rateLimitKey = `${severity}:${type}`;
    const now = Date.now();
    const lastSent = this.lastAlertAt.get(rateLimitKey);

    if (lastSent && now - lastSent < this.rateLimitMs) {
      logger.info(
        `Alert rate-limited [${rateLimitKey}]: suppressed for another ${Math.ceil(
          (this.rateLimitMs - (now - lastSent)) / 1000,
        )}s`,
      );
      return null;
    }

    // Build alert record
    const alert: Alert = {
      id: `alert_${now}_${Math.random().toString(36).slice(2, 10)}`,
      severity,
      type,
      message,
      metadata,
      timestamp: new Date(now).toISOString(),
      delivered: false,
    };

    // Deliver through channels
    this.deliverConsole(alert);
    await this.deliverWebhook(alert);
    alert.delivered = true;

    // Update rate-limit tracker
    this.lastAlertAt.set(rateLimitKey, now);

    // Store in ring buffer
    this.pushHistory(alert);
    await this.persistAlert(alert);

    return alert;
  }

  /**
   * Return the most recent alerts, newest first.
   * Optionally filter by severity or type.
   */
  async getAlertHistory(options?: {
    severity?: AlertSeverity;
    type?: AlertType;
    limit?: number;
    offset?: number;
  }): Promise<{ data: Alert[]; total: number }> {
    if (this.prisma) {
      const where: Prisma.AlertEventWhereInput = {};
      if (options?.severity) {
        where.severity = options.severity;
      }
      if (options?.type) {
        where.type = options.type;
      }

      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 50;
      const [events, total] = await Promise.all([
        this.prisma.alertEvent.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
        }),
        this.prisma.alertEvent.count({ where }),
      ]);

      return {
        data: events.map((event) => this.mapAlertEvent(event)),
        total,
      };
    }

    let filtered = [...this.history];

    if (options?.severity) {
      filtered = filtered.filter((a) => a.severity === options.severity);
    }
    if (options?.type) {
      filtered = filtered.filter((a) => a.type === options.type);
    }

    // Newest first
    filtered.reverse();

    const total = filtered.length;
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;

    return {
      data: filtered.slice(offset, offset + limit),
      total,
    };
  }

  /**
   * Return a summary of current alert counts by severity and type.
   */
  async getAlertSummary(): Promise<AlertSummary> {
    if (this.prisma) {
      const events = await this.prisma.alertEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: MAX_ALERT_HISTORY,
      });

      return this.summarizeAlerts(events.map((event) => this.mapAlertEvent(event)));
    }

    return this.summarizeAlerts(this.history);
  }

  /**
   * Return the count of active CRITICAL alerts (used by health check).
   */
  async getActiveCriticalCount(): Promise<number> {
    const summary = await this.getAlertSummary();
    return summary.activeCritical;
  }

  private summarizeAlerts(alerts: Alert[]): AlertSummary {
    const bySeverity = {
      [AlertSeverity.INFO]: 0,
      [AlertSeverity.WARNING]: 0,
      [AlertSeverity.CRITICAL]: 0,
    };
    const byType = {
      [AlertType.RECONCILIATION_MISMATCH]: 0,
      [AlertType.EXCHANGE_RATE_DRIFT]: 0,
      [AlertType.TVL_ANOMALY]: 0,
      [AlertType.EPOCH_STALE]: 0,
      [AlertType.VALIDATOR_COUNT_DROP]: 0,
      [AlertType.STABLECOIN_CIRCUIT_BREAKER]: 0,
      [AlertType.STABLECOIN_RESERVE_DRIFT]: 0,
      [AlertType.STABLECOIN_CONFIG_MISMATCH]: 0,
    };

    for (const alert of alerts) {
      bySeverity[alert.severity]++;
      byType[alert.type]++;
    }

    return {
      total: alerts.length,
      bySeverity,
      byType,
      activeCritical: bySeverity[AlertSeverity.CRITICAL],
    };
  }

  // -----------------------------------------------------------------------
  // Delivery channels
  // -----------------------------------------------------------------------

  private deliverConsole(alert: Alert): void {
    const prefix = `[ALERT:${alert.severity}:${alert.type}]`;

    switch (alert.severity) {
      case AlertSeverity.CRITICAL:
        logger.error(`${prefix} ${alert.message}`, alert.metadata);
        break;
      case AlertSeverity.WARNING:
        logger.warn(`${prefix} ${alert.message}`, alert.metadata);
        break;
      case AlertSeverity.INFO:
      default:
        logger.info(`${prefix} ${alert.message}`, alert.metadata);
        break;
    }
  }

  private async deliverWebhook(alert: Alert): Promise<void> {
    if (!this.webhookUrl) {
      return;
    }

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: alert.id,
          severity: alert.severity,
          type: alert.type,
          message: alert.message,
          metadata: alert.metadata,
          timestamp: alert.timestamp,
        }),
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        logger.warn(
          `Alert webhook delivery failed: HTTP ${response.status} ${response.statusText}`,
        );
      }
    } catch (error) {
      logger.warn('Alert webhook delivery error', { error });
    }
  }

  // -----------------------------------------------------------------------
  // Ring buffer
  // -----------------------------------------------------------------------

  private pushHistory(alert: Alert): void {
    this.history.push(alert);

    // Evict oldest entries when the buffer exceeds the cap
    while (this.history.length > MAX_ALERT_HISTORY) {
      this.history.shift();
    }
  }

  private async persistAlert(alert: Alert): Promise<void> {
    if (!this.prisma) {
      return;
    }

    try {
      await this.prisma.alertEvent.upsert({
        where: { id: alert.id },
        update: {
          delivered: alert.delivered,
          metadata: alert.metadata as Prisma.InputJsonValue,
        },
        create: {
          id: alert.id,
          severity: alert.severity,
          type: alert.type,
          message: alert.message,
          metadata: alert.metadata as Prisma.InputJsonValue,
          delivered: alert.delivered,
          createdAt: new Date(alert.timestamp),
        },
      });
    } catch (error) {
      logger.error('Failed to persist alert event', { error, alertId: alert.id });
    }
  }

  private mapAlertEvent(event: {
    id: string;
    severity: string;
    type: string;
    message: string;
    metadata: Prisma.JsonValue;
    delivered: boolean;
    createdAt: Date;
  }): Alert {
    return {
      id: event.id,
      severity: event.severity as AlertSeverity,
      type: event.type as AlertType,
      message: event.message,
      metadata: event.metadata as AlertMetadata,
      timestamp: event.createdAt.toISOString(),
      delivered: event.delivered,
    };
  }
}
