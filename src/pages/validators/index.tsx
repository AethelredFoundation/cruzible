import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  FileCheck,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Footer, TopNav } from "@/components/SharedComponents";
import { CopyButton, GlassCard } from "@/components/PagePrimitives";
import {
  buildValidatorMetrics,
  fetchValidators,
  formatAgeSeconds,
  formatRawTokenAmount,
  getCommissionPercent,
  getProfileCompleteness,
  getValidatorSharePercent,
  getValidatorStatus,
  parseTokenAmount,
  type ValidatorLifecycleStatus,
  type ValidatorRecord,
  type ValidatorRiskLevel,
} from "@/lib/validators";

type SortKey = "stake" | "risk" | "commission" | "coverage" | "name";

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

function StatusPill({ validator }: { validator: ValidatorRecord }) {
  const status = getValidatorStatus(validator);
  const styles: Record<ValidatorLifecycleStatus, string> = {
    active: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    inactive: "border-amber-500/20 bg-amber-500/10 text-amber-200",
    jailed: "border-red-500/20 bg-red-500/10 text-red-200",
  };

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function RiskPill({
  level,
  score,
}: {
  level: ValidatorRiskLevel;
  score: number;
}) {
  const styles: Record<ValidatorRiskLevel, string> = {
    low: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    guarded: "border-cyan-500/20 bg-cyan-500/10 text-cyan-100",
    elevated: "border-amber-500/20 bg-amber-500/10 text-amber-100",
    high: "border-red-500/20 bg-red-500/10 text-red-100",
  };

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${styles[level]}`}
    >
      {level} risk · {score}
    </span>
  );
}

function FreshnessPill({ status }: { status: string | undefined }) {
  const normalized = (status || "UNKNOWN").toUpperCase();
  const styles: Record<string, string> = {
    PASS: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    WARNING: "border-amber-500/20 bg-amber-500/10 text-amber-100",
    CRITICAL: "border-red-500/20 bg-red-500/10 text-red-100",
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

export default function ValidatorsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    ValidatorLifecycleStatus | "all"
  >("all");
  const [sortKey, setSortKey] = useState<SortKey>("stake");

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["validators-intelligence", statusFilter],
    queryFn: () =>
      fetchValidators({
        limit: 100,
        status: statusFilter === "all" ? "" : statusFilter,
      }),
    refetchInterval: 30000,
  });

  const validators = useMemo(() => data?.data ?? [], [data]);
  const canonicalTotalStake = useMemo(
    () => parseTokenAmount(data?.protocol?.totalBondedTokens ?? "0"),
    [data?.protocol?.totalBondedTokens],
  );
  const metrics = useMemo(
    () =>
      buildValidatorMetrics(validators, {
        totalStakeOverride:
          canonicalTotalStake > 0n ? canonicalTotalStake : undefined,
      }),
    [canonicalTotalStake, validators],
  );

  const rankedValidators = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const denominator =
      canonicalTotalStake > 0n ? canonicalTotalStake : metrics.totalStake;

    const filtered = validators.filter((validator) => {
      if (
        statusFilter !== "all" &&
        getValidatorStatus(validator) !== statusFilter
      ) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return [
        validator.moniker,
        validator.address,
        validator.website,
        validator.identity,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });

    const sorted = [...filtered].sort((left, right) => {
      if (sortKey === "name") {
        return (left.moniker || left.address).localeCompare(
          right.moniker || right.address,
        );
      }

      if (sortKey === "risk") {
        return (left.risk?.score ?? 0) - (right.risk?.score ?? 0);
      }

      if (sortKey === "commission") {
        return (
          getCommissionPercent(left.commission.rate) -
          getCommissionPercent(right.commission.rate)
        );
      }

      if (sortKey === "coverage") {
        return getProfileCompleteness(right) - getProfileCompleteness(left);
      }

      const leftStake = parseTokenAmount(left.tokens);
      const rightStake = parseTokenAmount(right.tokens);
      if (leftStake === rightStake) {
        return (left.moniker || left.address).localeCompare(
          right.moniker || right.address,
        );
      }
      return leftStake > rightStake ? -1 : 1;
    });

    return sorted.map((validator, index) => ({
      rank: index + 1,
      validator,
      sharePercent: getValidatorSharePercent(validator, denominator),
      profileCompleteness: getProfileCompleteness(validator),
    }));
  }, [
    canonicalTotalStake,
    metrics.totalStake,
    searchQuery,
    sortKey,
    statusFilter,
    validators,
  ]);

  const freshnessAge = formatAgeSeconds(data?.protocol?.indexedStateAgeSeconds);
  const snapshotAge = formatAgeSeconds(
    data?.protocol?.indexedStateAgeSeconds ?? null,
  );
  const protocolStatus = data?.protocol?.reconciliationStatus ?? "UNKNOWN";
  const validatorCoverage =
    typeof data?.protocol?.totalEligibleValidators === "number" &&
    validators.length > 0
      ? `${validators.length}/${data.protocol.totalEligibleValidators}`
      : `${validators.length}`;

  return (
    <>
      <SEOHead
        title="Validators"
        description="Live validator intelligence for Cruzible with canonical universe lineage, freshness posture, and explainable operator risk."
        path="/validators"
      />

      <div className="min-h-screen bg-slate-950 text-slate-100">
        <TopNav activePage="validators" />

        <main className="mx-auto max-w-7xl px-6 py-10">
          <section className="mb-8 rounded-[32px] border border-slate-800 bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.18),_transparent_32%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-8 shadow-2xl">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-cyan-100">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Validator intelligence
                </div>
                <h1 className="mt-4 text-4xl font-bold tracking-tight text-white lg:text-5xl">
                  Canonical validator context with explainable operator risk.
                </h1>
                <p className="mt-4 text-sm leading-7 text-slate-300 lg:text-base">
                  Cruzible now scores validator posture from a backend-owned
                  contract: lifecycle state, concentration, commission,
                  transparency, and reconciliation freshness. No client-side
                  performance theater, no invented uptime claims.
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <FreshnessPill status={data?.protocol?.freshnessStatus} />
                  <span className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs text-slate-300">
                    Reconciliation {protocolStatus.toLowerCase()}
                  </span>
                  {data?.protocol?.epoch != null ? (
                    <span className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs text-slate-300">
                      Epoch {data.protocol.epoch}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Link
                  href="/reconciliation"
                  className="inline-flex items-center justify-between rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-100 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/15"
                >
                  Open scorecard
                  <FileCheck className="h-4 w-4" />
                </Link>
                <button
                  onClick={() => refetch()}
                  className="inline-flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500"
                >
                  Refresh live set
                  <RefreshCw
                    className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
                  />
                </button>
              </div>
            </div>
          </section>

          <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Active Validators"
              value={String(metrics.activeCount)}
              detail={`${metrics.jailedCount} jailed. Lifecycle comes from the staking module, not page-local inference.`}
            />
            <MetricCard
              label="Nakamoto 33%"
              value={String(metrics.nakamoto33)}
              detail="Validators needed to exceed one-third of the bonded universe represented by the current protocol context."
            />
            <MetricCard
              label="Freshness"
              value={freshnessAge}
              detail={
                data?.protocol?.freshnessMessage ||
                "Public freshness posture is unavailable until the reconciliation scheduler emits a result."
              }
            />
            <MetricCard
              label="Universe Coverage"
              value={validatorCoverage}
              detail={`Bonded universe hash and freshness posture are carried in the API response for every validator row.`}
            />
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.45fr_1fr]">
            <GlassCard className="p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                    Validator Set
                  </p>
                  <h2 className="mt-2 text-2xl font-bold text-white">
                    Explainable operator posture from the live backend contract
                  </h2>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search validator"
                      className="w-full rounded-xl border border-slate-800 bg-slate-900/70 py-2 pl-9 pr-3 text-sm text-white outline-none transition-colors focus:border-cyan-500/40"
                    />
                  </div>

                  <select
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(
                        event.target.value as ValidatorLifecycleStatus | "all",
                      )
                    }
                    className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-cyan-500/40"
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="jailed">Jailed</option>
                  </select>

                  <select
                    value={sortKey}
                    onChange={(event) =>
                      setSortKey(event.target.value as SortKey)
                    }
                    className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-cyan-500/40"
                  >
                    <option value="stake">Sort by stake</option>
                    <option value="risk">Sort by lowest risk</option>
                    <option value="commission">Sort by commission</option>
                    <option value="coverage">Sort by profile quality</option>
                    <option value="name">Sort by name</option>
                  </select>
                </div>
              </div>

              {isLoading ? (
                <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">
                  Loading live validator set...
                </div>
              ) : error ? (
                <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-sm text-red-100">
                  Validator data is currently unavailable. This page only
                  renders live backend truth, so it will stay empty until the
                  API is reachable.
                </div>
              ) : rankedValidators.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">
                  No validators matched the current filters.
                </div>
              ) : (
                <div className="mt-6 overflow-hidden rounded-2xl border border-slate-800">
                  <div className="hidden grid-cols-[72px_minmax(0,1.6fr)_160px_120px_150px_56px] gap-4 bg-slate-900/90 px-5 py-3 text-xs font-medium uppercase tracking-[0.2em] text-slate-500 md:grid">
                    <span>Rank</span>
                    <span>Validator</span>
                    <span>Risk</span>
                    <span>Share</span>
                    <span>Commission</span>
                    <span />
                  </div>

                  <div className="divide-y divide-slate-800 bg-slate-950/80">
                    {rankedValidators.map(
                      ({
                        rank,
                        validator,
                        sharePercent,
                        profileCompleteness,
                      }) => (
                        <Link
                          key={validator.address}
                          href={`/validators/${encodeURIComponent(validator.address)}`}
                          className="grid gap-4 px-5 py-4 transition-colors hover:bg-slate-900 md:grid-cols-[72px_minmax(0,1.6fr)_160px_120px_150px_56px] md:items-center"
                        >
                          <div>
                            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500 md:hidden">
                              Rank
                            </p>
                            <p className="text-lg font-semibold text-white">
                              #{rank}
                            </p>
                          </div>

                          <div>
                            <div className="flex flex-wrap items-center gap-3">
                              <p className="text-base font-semibold text-white">
                                {validator.moniker || "Unnamed validator"}
                              </p>
                              <StatusPill validator={validator} />
                              <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300">
                                Profile {profileCompleteness}%
                              </span>
                            </div>
                            <p className="mt-2 font-mono text-xs text-slate-500">
                              {validator.address}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                              {validator.eligibleForUniverse === false ? (
                                <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-100">
                                  Outside bonded universe
                                </span>
                              ) : null}
                              <span className="rounded-full bg-slate-900 px-2.5 py-1">
                                Stake {formatRawTokenAmount(validator.tokens)}{" "}
                                raw
                              </span>
                              {validator.risk?.reasons?.[0] ? (
                                <span className="rounded-full bg-slate-900 px-2.5 py-1">
                                  {validator.risk.reasons[0]}
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div>
                            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500 md:hidden">
                              Risk
                            </p>
                            <div className="mt-1 flex flex-col gap-2 md:mt-0">
                              <RiskPill
                                level={validator.risk?.level ?? "guarded"}
                                score={validator.risk?.score ?? 0}
                              />
                              <FreshnessPill
                                status={validator.risk?.freshnessStatus}
                              />
                            </div>
                          </div>

                          <div>
                            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500 md:hidden">
                              Share
                            </p>
                            <p className="mt-1 text-lg font-semibold text-white md:mt-0">
                              {sharePercent.toFixed(2)}%
                            </p>
                          </div>

                          <div>
                            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500 md:hidden">
                              Commission
                            </p>
                            <p className="mt-1 text-lg font-semibold text-white md:mt-0">
                              {(
                                validator.commissionPercent ??
                                getCommissionPercent(validator.commission.rate)
                              ).toFixed(2)}
                              %
                            </p>
                          </div>

                          <div className="flex items-center justify-end text-slate-500">
                            <ArrowRight className="h-4 w-4" />
                          </div>
                        </Link>
                      ),
                    )}
                  </div>
                </div>
              )}
            </GlassCard>

            <div className="space-y-6">
              <GlassCard className="p-6">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  Data Provenance
                </p>
                <h2 className="mt-2 text-2xl font-bold text-white">
                  Canonical universe and freshness context
                </h2>
                <div className="mt-5 space-y-3 text-sm leading-6 text-slate-300">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                    Risk scores are backend-owned and derived from lifecycle,
                    concentration, commission, transparency, and reconciliation
                    freshness.
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                    Snapshot freshness is {snapshotAge}. Epoch lag is{" "}
                    {data?.protocol?.epochLag ?? "unavailable"}.
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                    {data?.protocol?.freshnessMessage ||
                      "Public freshness message is not yet available."}
                  </div>
                </div>

                {data?.protocol?.eligibleUniverseHash ? (
                  <div className="mt-6 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-cyan-100">
                          Eligible Universe Hash
                        </p>
                        <p className="mt-2 break-all font-mono text-xs text-cyan-50">
                          {data.protocol.eligibleUniverseHash}
                        </p>
                        {data.protocol.snapshotAt ? (
                          <p className="mt-2 text-xs text-cyan-200/80">
                            Snapshot{" "}
                            {new Date(
                              data.protocol.snapshotAt,
                            ).toLocaleString()}
                          </p>
                        ) : null}
                      </div>
                      <CopyButton
                        text={data.protocol.eligibleUniverseHash}
                        stopPropagation={false}
                      />
                    </div>
                  </div>
                ) : null}
              </GlassCard>

              <GlassCard className="p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Lowest Risk First
                    </p>
                    <h2 className="mt-2 text-2xl font-bold text-white">
                      Review shortlist
                    </h2>
                  </div>
                  <Link
                    href="/reconciliation"
                    className="inline-flex items-center gap-2 text-sm font-medium text-cyan-200 hover:text-cyan-100"
                  >
                    Reconciliation
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </div>

                <div className="mt-5 space-y-3">
                  {[...rankedValidators]
                    .sort(
                      (left, right) =>
                        (left.validator.risk?.score ?? 0) -
                        (right.validator.risk?.score ?? 0),
                    )
                    .slice(0, 5)
                    .map(({ validator, sharePercent }) => (
                      <Link
                        key={validator.address}
                        href={`/validators/${encodeURIComponent(validator.address)}`}
                        className="block rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 transition-colors hover:border-slate-700 hover:bg-slate-900"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">
                              {validator.moniker || "Unnamed validator"}
                            </p>
                            <p className="mt-1 font-mono text-xs text-slate-500">
                              {validator.address}
                            </p>
                          </div>
                          <div className="text-right">
                            <RiskPill
                              level={validator.risk?.level ?? "guarded"}
                              score={validator.risk?.score ?? 0}
                            />
                            <p className="mt-2 text-xs text-slate-500">
                              {sharePercent.toFixed(2)}% share
                            </p>
                          </div>
                        </div>
                      </Link>
                    ))}
                </div>
              </GlassCard>

              <GlassCard className="p-6">
                <div className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-300" />
                  <div className="text-sm leading-6 text-amber-50">
                    These are operator-posture scores, not performance promises.
                    Cruzible does not claim uptime, APY, or slash history here
                    until those signals are backed by a first-class indexed
                    telemetry pipeline.
                  </div>
                </div>
              </GlassCard>
            </div>
          </section>
        </main>

        <Footer />
      </div>
    </>
  );
}
