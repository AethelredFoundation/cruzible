import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Blocks,
  CheckCircle2,
  FileCheck,
  Lock,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Footer, TopNav } from "@/components/SharedComponents";
import {
  CopyButton,
  GlassCard,
  SectionHeader,
} from "@/components/PagePrimitives";
import { useApp } from "@/contexts/AppContext";
import {
  fetchLiveReconciliation,
  fetchReconciliationControlPlane,
  type LiveReconciliationDocument,
  type ReconciliationControlPlaneSummary,
} from "@/lib/reconciliation";
import {
  buildValidatorMetrics,
  fetchValidators,
  formatRawTokenAmount,
  getCommissionPercent,
  getProfileCompleteness,
  type ValidatorsResponse,
} from "@/lib/validators";

function formatDateTime(value?: string | null): string {
  if (!value) return "Unavailable";
  return new Date(value).toLocaleString();
}

function parseBigIntSafe(value?: string | null): bigint | null {
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function formatPercent(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  return `${value.toFixed(digits)}%`;
}

function formatCoveragePercent(
  numerator?: string | null,
  denominator?: string | null,
): number | null {
  const left = parseBigIntSafe(numerator);
  const right = parseBigIntSafe(denominator);

  if (left == null || right == null || right <= 0n) {
    return null;
  }

  return Number((left * 10000n) / right) / 100;
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

function StatusNotice({
  title,
  body,
  tone = "neutral",
}: {
  title: string;
  body: string;
  tone?: "neutral" | "warning" | "success";
}) {
  const styles =
    tone === "warning"
      ? "border-amber-500/20 bg-amber-500/10 text-amber-50"
      : tone === "success"
        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-50"
        : "border-slate-800 bg-slate-900/70 text-slate-300";

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${styles}`}>
      <p className="font-medium text-white">{title}</p>
      <p className="mt-1">{body}</p>
    </div>
  );
}

export default function HomePage() {
  const { realTime } = useApp();

  const controlPlaneQuery = useQuery<ReconciliationControlPlaneSummary>({
    queryKey: ["home-control-plane"],
    queryFn: fetchReconciliationControlPlane,
    refetchInterval: 30000,
  });

  const liveReconciliationQuery = useQuery<LiveReconciliationDocument>({
    queryKey: ["home-live-reconciliation"],
    queryFn: () => fetchLiveReconciliation(200),
    refetchInterval: 30000,
  });

  const validatorsQuery = useQuery<ValidatorsResponse>({
    queryKey: ["home-validators"],
    queryFn: () => fetchValidators({ limit: 100 }),
    refetchInterval: 30000,
  });

  const controlPlane = controlPlaneQuery.data ?? null;
  const liveReconciliation = liveReconciliationQuery.data ?? null;
  const validators = useMemo(
    () => validatorsQuery.data?.data ?? [],
    [validatorsQuery.data?.data],
  );

  const validatorMetrics = useMemo(
    () => buildValidatorMetrics(validators),
    [validators],
  );

  const topValidators = useMemo(() => validators.slice(0, 5), [validators]);

  const shareCoverage = useMemo(
    () =>
      formatCoveragePercent(
        liveReconciliation?.stake_snapshot?.meta?.included_total_shares,
        liveReconciliation?.stake_snapshot?.meta?.vault_total_shares,
      ),
    [liveReconciliation],
  );

  const loading =
    controlPlaneQuery.isLoading &&
    liveReconciliationQuery.isLoading &&
    validatorsQuery.isLoading;

  const hasWarning =
    (controlPlane?.warning_count ?? 0) > 0 ||
    (realTime.epochSource || "").includes("fallback");

  return (
    <>
      <SEOHead
        title="Cruzible"
        description="Truth-first liquid staking for Aethelred with live reconciliation, validator intelligence, and proof-backed protocol telemetry."
        path="/"
      />

      <div className="min-h-screen bg-slate-950 text-slate-100">
        <TopNav activePage="explorer" />

        <main className="mx-auto max-w-7xl px-6 py-10">
          <section className="rounded-[32px] border border-slate-800 bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.18),_transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-8 shadow-2xl">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-cyan-100">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Truth-first protocol surface
                </div>
                <h1 className="mt-4 text-4xl font-bold tracking-tight text-white lg:text-5xl">
                  Live staking telemetry, proof coverage, and validator lineage.
                </h1>
                <p className="mt-4 text-sm leading-7 text-slate-300 lg:text-base">
                  Cruzible is being hardened into a world-class staking product
                  by showing only what the protocol can defend: live vault
                  state, reconciliation hashes, validator concentration, and
                  freshness posture. Decorative explorer feeds and seeded
                  analytics are being phased out in favor of public evidence.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Link
                  href="/vault"
                  className="inline-flex items-center justify-between rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-100 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/15"
                >
                  Open live vault
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/reconciliation"
                  className="inline-flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500"
                >
                  View reconciliation
                  <FileCheck className="h-4 w-4" />
                </Link>
              </div>
            </div>

            <div className="mt-6 grid gap-3 lg:grid-cols-2">
              <StatusNotice
                title="Production posture"
                body={
                  hasWarning
                    ? "Some protocol telemetry is still on a warning path, so Cruzible is explicitly surfacing that state instead of pretending conditions are normal."
                    : "Public control-plane state is available and the landing page is anchored to live reconciliation and validator data."
                }
                tone={hasWarning ? "warning" : "success"}
              />
              <StatusNotice
                title="What is intentionally gated"
                body="Historical activity feeds, synthetic block/transaction explorer panels, and seeded protocol charts remain hidden until indexed provenance is good enough for audit-grade public use."
                tone="neutral"
              />
            </div>
          </section>

          <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Latest Block"
              value={
                realTime.blockHeight > 0
                  ? String(realTime.blockHeight)
                  : "Unavailable"
              }
              detail="Live block height from the current public chain connection."
            />
            <MetricCard
              label="Protocol Epoch"
              value={
                realTime.epoch > 0 ? String(realTime.epoch) : "Unavailable"
              }
              detail={`Source: ${realTime.epochSource || "unavailable"}`}
            />
            <MetricCard
              label="Control-Plane Warnings"
              value={String(
                controlPlane?.warning_count ?? realTime.reconciliationWarnings,
              )}
              detail={
                controlPlane
                  ? `Latest public capture ${formatDateTime(controlPlane.captured_at)}`
                  : "Waiting for public reconciliation capture"
              }
            />
            <MetricCard
              label="Stake Coverage"
              value={formatPercent(shareCoverage)}
              detail="Included shares over indexed vault total shares in the latest reconciliation document."
            />
          </section>

          <section className="mt-12 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <GlassCard className="p-6">
              <SectionHeader
                title="Protocol Truth Now"
                subtitle="Every card below is backed by live protocol state or public reconciliation data."
              />

              <div className="grid gap-4 md:grid-cols-2">
                <GlassCard className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-cyan-100">
                      <FileCheck className="h-5 w-5" />
                    </div>
                    <Link
                      href="/reconciliation"
                      className="text-sm font-medium text-cyan-200 hover:text-cyan-100"
                    >
                      Open
                    </Link>
                  </div>
                  <h3 className="mt-4 text-xl font-semibold text-white">
                    Reconciliation Control Plane
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Public epoch source, capture freshness, validator-universe
                    hash, stake snapshot status, and warning posture.
                  </p>
                  <div className="mt-4 space-y-2 text-sm text-slate-300">
                    <div className="flex justify-between gap-3">
                      <span>Epoch source</span>
                      <span className="text-right text-white">
                        {controlPlane?.epoch_source ?? realTime.epochSource}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>Stake snapshot</span>
                      <span className="text-right text-white">
                        {controlPlane?.stake_snapshot_complete == null
                          ? "Unavailable"
                          : controlPlane.stake_snapshot_complete
                            ? "Complete"
                            : "Partial"}
                      </span>
                    </div>
                  </div>
                </GlassCard>

                <GlassCard className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-emerald-100">
                      <Users className="h-5 w-5" />
                    </div>
                    <Link
                      href="/validators"
                      className="text-sm font-medium text-cyan-200 hover:text-cyan-100"
                    >
                      Open
                    </Link>
                  </div>
                  <h3 className="mt-4 text-xl font-semibold text-white">
                    Validator Intelligence
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Concentration, identity coverage, commission posture, and
                    live validator status without invented uptime or APY
                    rankings.
                  </p>
                  <div className="mt-4 space-y-2 text-sm text-slate-300">
                    <div className="flex justify-between gap-3">
                      <span>Active validators</span>
                      <span className="text-right text-white">
                        {String(validatorMetrics.activeCount)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>Top 10 share</span>
                      <span className="text-right text-white">
                        {validatorMetrics.topTenShare.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </GlassCard>

                <GlassCard className="p-5 md:col-span-2">
                  <div className="flex items-center justify-between">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-red-100">
                      <Lock className="h-5 w-5" />
                    </div>
                    <Link
                      href="/vault"
                      className="text-sm font-medium text-cyan-200 hover:text-cyan-100"
                    >
                      Open
                    </Link>
                  </div>
                  <h3 className="mt-4 text-xl font-semibold text-white">
                    Live Vault Actions
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Staking, unstaking, live reward-proof claiming, and live
                    vault state have been hardened to fail closed when telemetry
                    is not available instead of rendering seeded balances or
                    fake queues.
                  </p>
                </GlassCard>
              </div>
            </GlassCard>

            <GlassCard className="p-6">
              <SectionHeader
                title="Hash Lineage"
                subtitle="Copy the latest public trust anchors directly from the landing page."
                size="sm"
              />

              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                        Validator Universe Hash
                      </p>
                      <p className="mt-2 break-all font-mono text-xs text-cyan-100">
                        {controlPlane?.validator_universe_hash ?? "Unavailable"}
                      </p>
                    </div>
                    {controlPlane?.validator_universe_hash ? (
                      <CopyButton
                        text={controlPlane.validator_universe_hash}
                        stopPropagation={false}
                      />
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                        Stake Snapshot Hash
                      </p>
                      <p className="mt-2 break-all font-mono text-xs text-cyan-100">
                        {controlPlane?.stake_snapshot_hash ?? "Unavailable"}
                      </p>
                    </div>
                    {controlPlane?.stake_snapshot_hash ? (
                      <CopyButton
                        text={controlPlane.stake_snapshot_hash}
                        stopPropagation={false}
                      />
                    ) : null}
                  </div>
                </div>

                {controlPlane?.warnings?.length ? (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-amber-100">
                      <AlertTriangle className="h-4 w-4" />
                      Active public warnings
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-amber-50">
                      {controlPlane.warnings.map((warning, index) => (
                        <p key={`${warning}-${index}`}>{warning}</p>
                      ))}
                    </div>
                  </div>
                ) : (
                  <StatusNotice
                    title="Warning posture"
                    body="No public control-plane warnings are active in the latest snapshot."
                    tone="success"
                  />
                )}
              </div>
            </GlassCard>
          </section>

          <section className="mt-12 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <GlassCard className="p-6">
              <SectionHeader
                title="Validator Snapshot"
                subtitle="Top operators by observed stake in the current live validator universe."
              />

              {validatorsQuery.error instanceof Error ? (
                <StatusNotice
                  title="Validator intelligence unavailable"
                  body="The landing page will not synthesize validator rankings if the live validator API is unavailable."
                  tone="warning"
                />
              ) : topValidators.length === 0 ? (
                <StatusNotice
                  title="Awaiting validator set"
                  body="No live validators were returned yet."
                  tone="neutral"
                />
              ) : (
                <div className="space-y-3">
                  {topValidators.map((validator, index) => (
                    <Link
                      key={validator.address}
                      href={`/validators/${encodeURIComponent(validator.address)}`}
                      className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4 transition-colors hover:border-slate-700 hover:bg-slate-900"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <span className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-medium text-slate-300">
                            #{index + 1}
                          </span>
                          <p className="truncate text-sm font-semibold text-white">
                            {validator.moniker || "Unnamed validator"}
                          </p>
                        </div>
                        <p className="mt-2 truncate font-mono text-xs text-slate-500">
                          {validator.address}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                          <span className="rounded-full bg-slate-950 px-2.5 py-1">
                            Profile {getProfileCompleteness(validator)}%
                          </span>
                          <span className="rounded-full bg-slate-950 px-2.5 py-1">
                            Commission{" "}
                            {getCommissionPercent(
                              validator.commission.rate,
                            ).toFixed(2)}
                            %
                          </span>
                        </div>
                      </div>

                      <div className="ml-4 text-right">
                        <p className="text-sm font-semibold text-white">
                          {formatRawTokenAmount(validator.tokens)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">raw stake</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </GlassCard>

            <GlassCard className="p-6">
              <SectionHeader
                title="Moat Direction"
                subtitle="What Cruzible is optimizing toward instead of cosmetic explorer density."
                size="sm"
              />

              <div className="space-y-3">
                <StatusNotice
                  title="Public freshness"
                  body="Every trust claim should ship with capture time, epoch source, and warning posture."
                />
                <StatusNotice
                  title="Proof coverage"
                  body="Stake snapshot completeness and share coverage should be visible before users trust higher-level analytics."
                />
                <StatusNotice
                  title="Validator lineage"
                  body="Concentration, operator disclosure, and commission posture should be explicit and explainable."
                />
                <StatusNotice
                  title="Audit posture"
                  body="If a metric is not chain-backed, API-backed, or indexer-backed with a testable path, it should remain gated."
                  tone="warning"
                />
              </div>
            </GlassCard>
          </section>

          {loading ? (
            <div className="mt-12 flex items-center gap-2 text-sm text-slate-400">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading live protocol surfaces...
            </div>
          ) : null}

          {controlPlaneQuery.error instanceof Error ||
          liveReconciliationQuery.error instanceof Error ? (
            <div className="mt-8 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-50">
              The landing page is intentionally conservative while live protocol
              queries are unavailable. It will not backfill seeded explorer
              data.
            </div>
          ) : null}
        </main>

        <Footer />
      </div>
    </>
  );
}
