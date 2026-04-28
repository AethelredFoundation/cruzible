import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FileJson,
  FileText,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Footer, TopNav } from "@/components/SharedComponents";
import { CopyButton, GlassCard } from "@/components/PagePrimitives";
import {
  downloadTextFile,
  fetchLiveReconciliation,
  fetchReconciliationHistory,
  fetchReconciliationScorecard,
  renderLiveReconciliationMarkdown,
  type ReconciliationHistoryEntry,
  type LiveReconciliationDocument,
  type ReconciliationCheckStatus,
  type ReconciliationScorecard,
} from "@/lib/reconciliation";

function StatusPill({ status }: { status: string | undefined }) {
  const normalized = (status || "UNKNOWN").toUpperCase();
  const styles: Record<string, string> = {
    OK: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    PASS: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    WARNING: "border-amber-500/20 bg-amber-500/10 text-amber-100",
    CRITICAL: "border-red-500/20 bg-red-500/10 text-red-100",
    SKIPPED: "border-slate-700 bg-slate-900/80 text-slate-300",
    UNKNOWN: "border-slate-700 bg-slate-900/80 text-slate-300",
  };

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${styles[normalized] ?? styles.UNKNOWN}`}
    >
      {normalized.toLowerCase()}
    </span>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <GlassCard className="p-5">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
        {label}
      </p>
      <p className="mt-3 text-3xl font-bold text-white">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p>
    </GlassCard>
  );
}

function formatAge(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) {
    return "Unavailable";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

function SignalCard({
  label,
  status,
  value,
  message,
}: {
  label: string;
  status: ReconciliationCheckStatus;
  value?: string;
  message: string;
}) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
            {label}
          </p>
          {value ? (
            <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
          ) : null}
        </div>
        <StatusPill status={status} />
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-300">{message}</p>
    </GlassCard>
  );
}

function EvidenceRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
        {label}
      </p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <p className="break-all font-mono text-xs text-slate-200">
          {value || "Unavailable"}
        </p>
        {value ? <CopyButton text={value} stopPropagation={false} /> : null}
      </div>
    </div>
  );
}

export default function ReconciliationPage() {
  const scorecardQuery = useQuery<ReconciliationScorecard>({
    queryKey: ["reconciliation-scorecard-page"],
    queryFn: fetchReconciliationScorecard,
    refetchInterval: 15000,
  });
  const liveDocumentQuery = useQuery<LiveReconciliationDocument>({
    queryKey: ["live-reconciliation-page"],
    queryFn: () => fetchLiveReconciliation(200),
    refetchInterval: 15000,
  });
  const historyQuery = useQuery<ReconciliationHistoryEntry[]>({
    queryKey: ["reconciliation-history-page"],
    queryFn: () => fetchReconciliationHistory(8),
    refetchInterval: 30000,
  });

  const scorecard = scorecardQuery.data;
  const liveDocument = liveDocumentQuery.data;
  const history = historyQuery.data ?? [];
  const rawJson = useMemo(
    () => (liveDocument ? JSON.stringify(liveDocument, null, 2) : ""),
    [liveDocument],
  );
  const markdown = useMemo(
    () => (liveDocument ? renderLiveReconciliationMarkdown(liveDocument) : ""),
    [liveDocument],
  );

  const isLoading =
    (scorecardQuery.isLoading && !scorecard) ||
    (liveDocumentQuery.isLoading && !liveDocument);
  const error =
    (scorecardQuery.error instanceof Error && scorecardQuery.error.message) ||
    (liveDocumentQuery.error instanceof Error &&
      liveDocumentQuery.error.message) ||
    null;

  return (
    <>
      <SEOHead
        title="Reconciliation"
        description="Public reconciliation scorecard for Cruzible with freshness posture, trust pillars, and downloadable proof artifacts."
        path="/reconciliation"
      />

      <div className="min-h-screen bg-slate-950 text-slate-100">
        <TopNav activePage="reconciliation" />

        <main className="mx-auto max-w-7xl px-6 py-10">
          <section className="mb-8 rounded-[32px] border border-slate-800 bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.18),_transparent_32%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-8 shadow-2xl">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-cyan-100">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Reconciliation scorecard
                </div>
                <h1 className="mt-4 text-4xl font-bold tracking-tight text-white lg:text-5xl">
                  Public trust posture, not just a raw snapshot.
                </h1>
                <p className="mt-4 text-sm leading-7 text-slate-300 lg:text-base">
                  This page combines control-plane lineage with scheduler
                  freshness checks so degraded truth is obvious. Exported
                  artifacts still come from the live reconciliation document,
                  but the scorecard tells you whether those artifacts are fresh,
                  canonical, and complete enough to trust.
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <StatusPill status={scorecard?.status} />
                  <StatusPill status={scorecard?.freshness.status} />
                  {scorecard?.epoch != null ? (
                    <span className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs text-slate-300">
                      Epoch {scorecard.epoch}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    void scorecardQuery.refetch();
                    void liveDocumentQuery.refetch();
                    void historyQuery.refetch();
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:border-cyan-400"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${
                      scorecardQuery.isFetching || liveDocumentQuery.isFetching
                        ? "animate-spin"
                        : ""
                    }`}
                  />
                  Refresh
                </button>
                <button
                  onClick={() =>
                    liveDocument &&
                    downloadTextFile(
                      `cruzible-live-reconciliation-epoch-${liveDocument.epoch}.json`,
                      rawJson,
                    )
                  }
                  disabled={!liveDocument}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FileJson className="h-4 w-4" />
                  Download JSON
                </button>
                <button
                  onClick={() =>
                    liveDocument &&
                    downloadTextFile(
                      `cruzible-live-reconciliation-epoch-${liveDocument.epoch}.md`,
                      markdown,
                    )
                  }
                  disabled={!liveDocument}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FileText className="h-4 w-4" />
                  Download Markdown
                </button>
                <Link
                  href="/devtools"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:border-slate-500"
                >
                  Devtools
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </section>

          {isLoading ? (
            <GlassCard className="mb-8 p-6 text-sm text-slate-400">
              Loading reconciliation scorecard...
            </GlassCard>
          ) : null}

          {error ? (
            <GlassCard className="mb-8 border border-red-500/20 bg-red-500/10 p-6 text-sm text-red-100">
              {error}
            </GlassCard>
          ) : null}

          {scorecard ? (
            <>
              <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Freshness"
                  value={formatAge(scorecard.snapshot_age_seconds)}
                  detail={scorecard.freshness.message}
                />
                <MetricCard
                  label="Epoch Lag"
                  value={String(scorecard.freshness.epoch_lag ?? "0")}
                  detail="Difference between the indexed epoch and the protocol epoch in the latest public scheduler result."
                />
                <MetricCard
                  label="Validator Coverage"
                  value={
                    scorecard.validator_coverage_percent == null
                      ? "Unavailable"
                      : `${scorecard.validator_coverage_percent.toFixed(2)}%`
                  }
                  detail={`${scorecard.evidence.validator_count}/${scorecard.evidence.total_eligible_validators} eligible validators are represented in the public control plane.`}
                />
                <MetricCard
                  label="Stake Snapshot"
                  value={scorecard.stake_snapshot_status}
                  detail={`${scorecard.evidence.warning_count} warning${scorecard.evidence.warning_count === 1 ? "" : "s"} and ${scorecard.evidence.discrepancy_count} structured discrepancy${scorecard.evidence.discrepancy_count === 1 ? "" : "ies"} in the current capture.`}
                />
              </section>

              <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-6">
                  <GlassCard className="p-6">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                          Trust Pillars
                        </p>
                        <h2 className="mt-2 text-2xl font-bold text-white">
                          Explicit verdicts for the public capture
                        </h2>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      {scorecard.pillars.map((pillar) => (
                        <SignalCard
                          key={pillar.key}
                          label={pillar.label}
                          status={pillar.status}
                          value={pillar.value}
                          message={pillar.message}
                        />
                      ))}
                    </div>
                  </GlassCard>

                  <GlassCard className="p-6">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Structured Discrepancies
                    </p>
                    <h2 className="mt-2 text-2xl font-bold text-white">
                      Explicit exceptions in the live capture
                    </h2>

                    <div className="mt-5 space-y-3">
                      {(liveDocument?.discrepancies?.length ?? 0) > 0 ? (
                        liveDocument?.discrepancies?.map((discrepancy) => (
                          <div
                            key={`${discrepancy.code}-${discrepancy.message}`}
                            className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
                          >
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div>
                                <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                                  {discrepancy.code.replace(/_/g, " ")}
                                </p>
                                <p className="mt-2 text-sm font-semibold text-white">
                                  {discrepancy.title}
                                </p>
                                <p className="mt-2 text-sm leading-6 text-slate-300">
                                  {discrepancy.message}
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                                  <span className="rounded-full bg-slate-950 px-2.5 py-1">
                                    {discrepancy.affected_accounts} accounts
                                  </span>
                                  {discrepancy.affected_shares ? (
                                    <span className="rounded-full bg-slate-950 px-2.5 py-1">
                                      {discrepancy.affected_shares} shares
                                    </span>
                                  ) : null}
                                  {typeof discrepancy.impact_bps ===
                                  "number" ? (
                                    <span className="rounded-full bg-slate-950 px-2.5 py-1">
                                      {discrepancy.impact_bps} bps impact
                                    </span>
                                  ) : null}
                                </div>
                                {discrepancy.sample_addresses.length > 0 ? (
                                  <p className="mt-3 font-mono text-xs text-slate-500">
                                    {discrepancy.sample_addresses.join(", ")}
                                  </p>
                                ) : null}
                              </div>
                              <StatusPill status={discrepancy.severity} />
                            </div>
                            {discrepancy.remediation ? (
                              <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
                                {discrepancy.remediation}
                              </div>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                          No structured discrepancies were returned for the live
                          capture.
                        </div>
                      )}
                    </div>
                  </GlassCard>

                  <GlassCard className="p-6">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Scheduler Checks
                    </p>
                    <h2 className="mt-2 text-2xl font-bold text-white">
                      Full check ledger
                    </h2>

                    <div className="mt-5 space-y-3">
                      {scorecard.checks.length > 0 ? (
                        scorecard.checks.map((check) => (
                          <div
                            key={check.name}
                            className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
                          >
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div>
                                <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                                  {check.name.replace(/_/g, " ")}
                                </p>
                                <p className="mt-2 text-sm leading-6 text-slate-200">
                                  {check.message}
                                </p>
                              </div>
                              <StatusPill status={check.status} />
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-400">
                          Public scheduler checks are not available yet.
                        </div>
                      )}
                    </div>
                  </GlassCard>

                  <GlassCard className="p-6">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Verification Workflow
                    </p>
                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4">
                        <p className="text-sm font-semibold text-white">
                          1. Check freshness
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-300">
                          Confirm the epoch source, indexed age, and epoch lag
                          are acceptable before trusting any exported artifact.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4">
                        <p className="text-sm font-semibold text-white">
                          2. Copy lineage hashes
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-300">
                          Cross-check the universe hash, stake snapshot hash,
                          and registry roots against your own recomputation.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4">
                        <p className="text-sm font-semibold text-white">
                          3. Export artifacts
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-300">
                          Download the live JSON or Markdown snapshot for audit
                          trails, incident review, or independent verification.
                        </p>
                      </div>
                    </div>
                  </GlassCard>
                </div>

                <div className="space-y-6">
                  <GlassCard className="p-6">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                          Evidence
                        </p>
                        <h2 className="mt-2 text-2xl font-bold text-white">
                          Lineage anchors
                        </h2>
                      </div>
                      <Download className="h-5 w-5 text-cyan-300" />
                    </div>

                    <div className="mt-5 space-y-3">
                      <EvidenceRow
                        label="Validator universe hash"
                        value={scorecard.evidence.validator_universe_hash}
                      />
                      <EvidenceRow
                        label="Stake snapshot hash"
                        value={
                          liveDocument?.stake_snapshot?.observed
                            ?.stake_snapshot_hash
                        }
                      />
                      <EvidenceRow
                        label="Staker registry root"
                        value={
                          liveDocument?.stake_snapshot?.observed
                            ?.staker_registry_root
                        }
                      />
                      <EvidenceRow
                        label="Delegation registry root"
                        value={
                          liveDocument?.stake_snapshot?.observed
                            ?.delegation_registry_root
                        }
                      />
                      <EvidenceRow
                        label="Delegation payload"
                        value={
                          liveDocument?.stake_snapshot?.observed
                            ?.delegation_payload_hex
                        }
                      />
                    </div>
                  </GlassCard>

                  <GlassCard className="p-6">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Capture metadata
                    </p>
                    <div className="mt-5 space-y-3 text-sm text-slate-300">
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                        Captured at{" "}
                        {new Date(
                          scorecard.evidence.captured_at,
                        ).toLocaleString()}
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                        Chain height {scorecard.evidence.chain_height}
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                        Scheduler timestamp{" "}
                        {scorecard.evidence.scheduler_timestamp
                          ? new Date(
                              scorecard.evidence.scheduler_timestamp,
                            ).toLocaleString()
                          : "Unavailable"}
                      </div>
                    </div>
                  </GlassCard>

                  <GlassCard className="p-6">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Immutable History
                    </p>
                    <div className="mt-5 space-y-3">
                      {history.length > 0 ? (
                        history.map((entry) => (
                          <div
                            key={entry.snapshot_id}
                            className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-white">
                                  Epoch {entry.epoch}
                                </p>
                                <p className="mt-1 text-xs text-slate-400">
                                  {new Date(entry.captured_at).toLocaleString()}
                                </p>
                              </div>
                              <StatusPill status={entry.status} />
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                              <span className="rounded-full bg-slate-950 px-2.5 py-1">
                                {entry.discrepancy_count} discrepancies
                              </span>
                              <span className="rounded-full bg-slate-950 px-2.5 py-1">
                                {entry.warning_count} warnings
                              </span>
                            </div>
                            <p className="mt-3 break-all font-mono text-[11px] text-slate-500">
                              {entry.snapshot_key}
                            </p>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-400">
                          Immutable reconciliation history has not been captured
                          yet.
                        </div>
                      )}
                    </div>
                  </GlassCard>

                  <GlassCard className="p-6">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Warnings
                    </p>
                    <div className="mt-5 space-y-3">
                      {scorecard.evidence.warnings.length > 0 ? (
                        scorecard.evidence.warnings.map((warning) => (
                          <div
                            key={warning}
                            className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-50"
                          >
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                            <span>{warning}</span>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                          No public warnings were returned for the current
                          capture.
                        </div>
                      )}
                    </div>
                  </GlassCard>
                </div>
              </section>
            </>
          ) : null}
        </main>

        <Footer />
      </div>
    </>
  );
}
