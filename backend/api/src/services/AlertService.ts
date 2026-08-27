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

import { createHash, randomUUID } from "node:crypto";
import { singleton } from "tsyringe";
import { Prisma, PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";
import { config } from "../config";
import { assertPublicHostnameResolution } from "../utils/networkSafety";
import { redactRecord } from "../utils/redaction";
import { errorContext } from "../utils/errorContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum AlertSeverity {
  INFO = "INFO",
  WARNING = "WARNING",
  CRITICAL = "CRITICAL",
}

export enum AlertType {
  RECONCILIATION_MISMATCH = "RECONCILIATION_MISMATCH",
  EXCHANGE_RATE_DRIFT = "EXCHANGE_RATE_DRIFT",
  TVL_ANOMALY = "TVL_ANOMALY",
  EPOCH_STALE = "EPOCH_STALE",
  VALIDATOR_COUNT_DROP = "VALIDATOR_COUNT_DROP",
  // Stablecoin bridge alerts
  STABLECOIN_CIRCUIT_BREAKER = "STABLECOIN_CIRCUIT_BREAKER",
  STABLECOIN_RESERVE_DRIFT = "STABLECOIN_RESERVE_DRIFT",
  STABLECOIN_CONFIG_MISMATCH = "STABLECOIN_CONFIG_MISMATCH",
  PRIVILEGED_ACCESS_REJECTED = "PRIVILEGED_ACCESS_REJECTED",
  PRIVILEGED_AUDIT_PERSISTENCE_FAILURE = "PRIVILEGED_AUDIT_PERSISTENCE_FAILURE",
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

type AlertDeliveryChannel = "console" | "webhook";

interface AlertDeliveryResult {
  channel: AlertDeliveryChannel;
  required: boolean;
  success: boolean;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of alerts to keep in the ring buffer. */
const MAX_ALERT_HISTORY = 100;

/**
 * How recently a CRITICAL alert must have been raised to count as ACTIVE for
 * readiness. Sources re-raise alerts on every failing evaluation (e.g. each
 * reconciliation tick), so a healed condition stops producing alerts and
 * drains out of this window. Without the window, one transient CRITICAL
 * permanently reported the API as not-ready (verified live 2026-07-14).
 */
const ALERT_ACTIVE_WINDOW_MS = 15 * 60 * 1000;
const ALERT_METADATA_MAX_DEPTH = 5;
const ALERT_OUTBOX_BATCH_LIMIT = 20;
const ALERT_OUTBOX_MAX_ATTEMPTS = 8;
const ALERT_OUTBOX_BASE_BACKOFF_MS = 30_000;
const ALERT_OUTBOX_MAX_BACKOFF_MS = 15 * 60 * 1000;

function webhookOriginForLogs(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "[invalid-url]";
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@singleton()
export class AlertService {
  /** In-memory ring buffer of recent alerts. Used as fallback and hot cache. */
  private readonly history: Alert[] = [];

  /** Tracks the last time an alert was sent for each type (for rate limiting). */
  private readonly lastAlertAt = new Map<string, number>();

  /** Prisma client for durable alert history in production deployments. */
  private readonly prisma: PrismaClient | null;
  private disconnected = false;

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
    const safeMetadata = redactRecord(metadata, {
      maxDepth: ALERT_METADATA_MAX_DEPTH,
    });
    const alert: Alert = {
      id: `alert_${randomUUID()}`,
      severity,
      type,
      message,
      metadata: safeMetadata,
      timestamp: new Date(now).toISOString(),
      delivered: false,
    };

    // Deliver through required channels and persist evidence without treating
    // logged-but-undelivered webhook attempts as successful notifications.
    const deliveryResults = [
      this.deliverConsole(alert),
      await this.deliverWebhook(alert),
    ].filter((result): result is AlertDeliveryResult => result !== null);
    const deliveryFailures = deliveryResults.filter(
      (result) => result.required && !result.success,
    );

    alert.delivered = deliveryFailures.length === 0;
    if (deliveryFailures.length > 0) {
      alert.metadata = {
        ...alert.metadata,
        deliveryFailures: deliveryFailures.map((failure) => ({
          channel: failure.channel,
          ...failure.metadata,
        })),
      };
    }

    // Update rate-limit tracker
    this.lastAlertAt.set(rateLimitKey, now);

    // Store in ring buffer
    this.pushHistory(alert);
    await this.persistAlert(alert);

    return alert;
  }

  /**
   * Persist a deterministic outbox record before attempting delivery.
   *
   * Reconciliation leaders use this path so a failover can retry an
   * undelivered alert using the same id, while an already-delivered alert is
   * suppressed across replicas. Webhook consumers receive the deterministic
   * id and can therefore make their own delivery handling idempotent too.
   */
  async sendDurableAlert(
    idempotencyKey: string,
    severity: AlertSeverity,
    type: AlertType,
    message: string,
    metadata: AlertMetadata = {},
  ): Promise<Alert | null> {
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey) {
      throw new Error("A durable alert idempotency key is required");
    }

    // Local development has no durable store. Production configuration
    // requires DATABASE_URL, so this fallback cannot silently weaken a
    // production reconciliation alert.
    if (!this.prisma) {
      return this.sendAlert(severity, type, message, metadata);
    }

    const id = `alert_${createHash("sha256")
      .update(normalizedKey)
      .digest("hex")}`;
    const safeMetadata = redactRecord(metadata, {
      maxDepth: ALERT_METADATA_MAX_DEPTH,
    });
    const createdAt = new Date();

    let stored;
    try {
      stored = await this.prisma.alertEvent.upsert({
        where: { id },
        update: {},
        create: {
          id,
          severity,
          type,
          message,
          metadata: safeMetadata as Prisma.InputJsonValue,
          delivered: false,
          attemptCount: 0,
          nextAttemptAt: createdAt,
          createdAt,
        },
      });
    } catch (error) {
      logger.error("Failed to persist durable alert before delivery", {
        alertId: id,
        ...errorContext(error),
      });
      throw Object.assign(new Error("Durable alert persistence failed"), {
        cause: error,
      });
    }

    if (
      stored.delivered ||
      stored.deadLetteredAt ||
      (stored.nextAttemptAt && stored.nextAttemptAt.getTime() > Date.now())
    ) {
      return this.mapAlertEvent(stored);
    }

    return this.attemptDurableAlert(stored);
  }

  /**
   * Drain due outbox rows independently of whether the originating condition
   * is emitted again. The scheduler supplies a Redis lease-fenced claim so
   * only one replica attempts each row at a time.
   */
  async retryUndeliveredAlerts(options?: {
    limit?: number;
    claim?: (alertId: string) => Promise<boolean>;
  }): Promise<{ attempted: number; delivered: number; deadLettered: number }> {
    if (!this.prisma) {
      return { attempted: 0, delivered: 0, deadLettered: 0 };
    }

    const now = new Date();
    const limit = Math.max(
      1,
      Math.min(options?.limit ?? ALERT_OUTBOX_BATCH_LIMIT, 100),
    );
    let pending;
    try {
      pending = await this.prisma.alertEvent.findMany({
        where: {
          delivered: false,
          deadLetteredAt: null,
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
        take: limit,
      });
    } catch (error) {
      logger.error("Durable alert outbox scan failed", errorContext(error));
      return { attempted: 0, delivered: 0, deadLettered: 0 };
    }

    let attempted = 0;
    let delivered = 0;
    let deadLettered = 0;
    for (const stored of pending) {
      try {
        if (options?.claim && !(await options.claim(stored.id))) continue;
        attempted += 1;
        const alert = await this.attemptDurableAlert(stored);
        if (alert.delivered) delivered += 1;
        if (
          !alert.delivered &&
          stored.attemptCount + 1 >= ALERT_OUTBOX_MAX_ATTEMPTS
        ) {
          deadLettered += 1;
        }
      } catch (error) {
        logger.error("Durable alert outbox retry failed", {
          alertId: stored.id,
          ...errorContext(error),
        });
      }
    }

    return { attempted, delivered, deadLettered };
  }

  private async attemptDurableAlert(stored: {
    id: string;
    severity: string;
    type: string;
    message: string;
    metadata: Prisma.JsonValue;
    delivered: boolean;
    attemptCount: number;
    createdAt: Date;
  }): Promise<Alert> {
    if (!this.prisma) {
      throw new Error("Durable alert storage is unavailable");
    }

    const alert = this.mapAlertEvent(stored);
    const attemptAt = new Date();
    const deliveryResults = [
      this.deliverConsole(alert),
      await this.deliverWebhook(alert),
    ].filter((result): result is AlertDeliveryResult => result !== null);
    const deliveryFailures = deliveryResults.filter(
      (result) => result.required && !result.success,
    );
    alert.delivered = deliveryFailures.length === 0;
    if (deliveryFailures.length > 0) {
      alert.metadata = {
        ...alert.metadata,
        deliveryFailures: deliveryFailures.map((failure) => ({
          channel: failure.channel,
          ...failure.metadata,
        })),
      };
    }

    const attemptCount = stored.attemptCount + 1;
    const exhausted =
      !alert.delivered && attemptCount >= ALERT_OUTBOX_MAX_ATTEMPTS;
    const backoffMs = Math.min(
      ALERT_OUTBOX_BASE_BACKOFF_MS * 2 ** Math.max(attemptCount - 1, 0),
      ALERT_OUTBOX_MAX_BACKOFF_MS,
    );

    try {
      await this.prisma.alertEvent.update({
        where: { id: stored.id },
        data: {
          delivered: alert.delivered,
          metadata: alert.metadata as Prisma.InputJsonValue,
          attemptCount,
          lastAttemptAt: attemptAt,
          nextAttemptAt:
            alert.delivered || exhausted
              ? null
              : new Date(attemptAt.getTime() + backoffMs),
          deadLetteredAt: exhausted ? attemptAt : null,
        },
      });
    } catch (error) {
      logger.error("Failed to finalize durable alert delivery state", {
        alertId: stored.id,
        ...errorContext(error),
      });
      throw Object.assign(
        new Error("Durable alert delivery state persistence failed"),
        { cause: error },
      );
    }

    if (exhausted) {
      logger.error("Durable alert moved to the dead-letter state", {
        alertId: alert.id,
        attemptCount,
      });
    }

    this.pushHistory(alert);
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
          orderBy: { createdAt: "desc" },
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
        orderBy: { createdAt: "desc" },
        take: MAX_ALERT_HISTORY,
      });

      return this.summarizeAlerts(
        events.map((event) => this.mapAlertEvent(event)),
      );
    }

    return this.summarizeAlerts(this.history);
  }

  /**
   * Return the count of active CRITICAL alerts (used by health check).
   */
  async getActiveCriticalCount(): Promise<number> {
    if (this.prisma) {
      // Readiness must not infer this from the newest-N history sample: a
      // burst of INFO/WARNING events could otherwise push a still-active
      // CRITICAL out of that window. Delivery state does not change whether
      // the underlying critical condition was raised.
      return this.prisma.alertEvent.count({
        where: {
          severity: AlertSeverity.CRITICAL,
          createdAt: { gte: new Date(Date.now() - ALERT_ACTIVE_WINDOW_MS) },
        },
      });
    }
    const summary = await this.getAlertSummary();
    return summary.activeCritical;
  }

  async disconnect(): Promise<void> {
    if (!this.prisma || this.disconnected) {
      return;
    }

    this.disconnected = true;
    await this.prisma.$disconnect();
  }

  private summarizeAlerts(alerts: Alert[]): AlertSummary {
    const bySeverity = {
      [AlertSeverity.INFO]: 0,
      [AlertSeverity.WARNING]: 0,
      [AlertSeverity.CRITICAL]: 0,
    };
    const byType = Object.values(AlertType).reduce(
      (counts, type) => {
        counts[type] = 0;
        return counts;
      },
      {} as Record<AlertType, number>,
    );

    for (const alert of alerts) {
      bySeverity[alert.severity]++;
      byType[alert.type]++;
    }

    const activeCutoff = Date.now() - ALERT_ACTIVE_WINDOW_MS;
    const activeCritical = alerts.filter(
      (alert) =>
        alert.severity === AlertSeverity.CRITICAL &&
        Date.parse(alert.timestamp) >= activeCutoff,
    ).length;

    return {
      total: alerts.length,
      bySeverity,
      byType,
      activeCritical,
    };
  }

  // -----------------------------------------------------------------------
  // Delivery channels
  // -----------------------------------------------------------------------

  private deliverConsole(alert: Alert): AlertDeliveryResult {
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

    return {
      channel: "console",
      required: true,
      success: true,
    };
  }

  private async deliverWebhook(
    alert: Alert,
  ): Promise<AlertDeliveryResult | null> {
    if (!this.webhookUrl) {
      return null;
    }

    try {
      if (config.isProduction) {
        await assertPublicHostnameResolution(
          new URL(this.webhookUrl).hostname,
          "ALERT_WEBHOOK_URL",
        );
      }

      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        redirect: "error",
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
        logger.warn(`Alert webhook delivery failed: HTTP ${response.status}`);
        return {
          channel: "webhook",
          required: true,
          success: false,
          metadata: {
            errorType: "HTTP_STATUS",
            status: response.status,
            webhookOrigin: webhookOriginForLogs(this.webhookUrl),
          },
        };
      }

      return {
        channel: "webhook",
        required: true,
        success: true,
        metadata: {
          status: response.status,
          webhookOrigin: webhookOriginForLogs(this.webhookUrl),
        },
      };
    } catch (error) {
      const errorType = error instanceof Error ? error.name : typeof error;
      logger.warn("Alert webhook delivery error", {
        webhookOrigin: webhookOriginForLogs(this.webhookUrl),
        errorType,
      });
      return {
        channel: "webhook",
        required: true,
        success: false,
        metadata: {
          errorType,
          webhookOrigin: webhookOriginForLogs(this.webhookUrl),
        },
      };
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
      logger.error("Failed to persist alert event", {
        alertId: alert.id,
        ...errorContext(error),
      });
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
