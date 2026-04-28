import Link from "next/link";
import { useRouter } from "next/router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ExternalLink,
  FileCheck,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Footer, TopNav } from "@/components/SharedComponents";
import { CopyButton, GlassCard } from "@/components/PagePrimitives";
import {
  fetchValidator,
  formatAgeSeconds,
  formatRawTokenAmount,
  formatTimestamp,
  getCommissionPercent,
  getProfileCompleteness,
  getValidatorSharePercent,
  getValidatorStatus,
  parseTokenAmount,
  type ValidatorLifecycleStatus,
  type ValidatorRiskLevel,
} from "@/lib/validators";

function DetailCard({
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

function StatusPill({ status }: { status: ValidatorLifecycleStatus }) {
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

export default function ValidatorDetailPage() {
  const router = useRouter();
  const address =
    typeof router.query.address === "string" ? router.query.address : "";

  const validatorQuery = useQuery({
    queryKey: ["validator-detail", address],
    enabled: Boolean(address),
    queryFn: () => fetchValidator(address),
  });

  const validator = validatorQuery.data?.validator;
  const protocol = validatorQuery.data?.protocol;
  const canonicalTotalStake = parseTokenAmount(
    protocol?.totalBondedTokens ?? "0",
  );
  const sharePercent = validator
    ? getValidatorSharePercent(validator, canonicalTotalStake)
    : 0;
  const profileCompleteness = validator ? getProfileCompleteness(validator) : 0;
  const status = validator ? getValidatorStatus(validator) : "inactive";

  return (
    <>
      <SEOHead
        title={validator?.moniker || "Validator Detail"}
        description="Inspect a live validator profile, canonical universe context, and explainable operator-risk evidence for the Cruzible validator set."
        path={
          address ? `/validators/${encodeURIComponent(address)}` : "/validators"
        }
      />

      <div className="min-h-screen bg-slate-950 text-slate-100">
        <TopNav activePage="validators" />

        <main className="mx-auto max-w-6xl px-6 py-10">
          <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <Link
                href="/validators"
                className="text-sm font-medium text-cyan-200 hover:text-cyan-100"
              >
                ← Back to validators
              </Link>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-cyan-100">
                <ShieldCheck className="h-3.5 w-3.5" />
                Validator intelligence
              </div>
              <h1 className="mt-4 text-4xl font-bold tracking-tight text-white">
                {validator?.moniker || "Validator detail"}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
                One canonical payload now carries operator metadata,
                bonded-universe lineage, freshness posture, and explainable risk
                components for this validator.
              </p>
            </div>

            <button
              onClick={() => {
                void validatorQuery.refetch();
              }}
              className="inline-flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500"
            >
              Refresh
              <RefreshCw
                className={`ml-2 h-4 w-4 ${
                  validatorQuery.isFetching ? "animate-spin" : ""
                }`}
              />
            </button>
          </div>

          {validatorQuery.isLoading ? (
            <GlassCard className="p-6 text-sm text-slate-400">
              Loading validator detail...
            </GlassCard>
          ) : validatorQuery.error || !validator ? (
            <GlassCard className="p-6 text-sm text-red-100">
              Validator detail is unavailable right now.
            </GlassCard>
          ) : (
            <>
              <GlassCard className="mb-8 p-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <StatusPill status={status} />
                      <RiskPill
                        level={validator.risk?.level ?? "guarded"}
                        score={validator.risk?.score ?? 0}
                      />
                      <FreshnessPill status={validator.risk?.freshnessStatus} />
                      <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300">
                        Profile {profileCompleteness}%
                      </span>
                    </div>
                    <p className="mt-4 font-mono text-sm text-slate-400">
                      {validator.address}
                    </p>
                    <div className="mt-3">
                      <CopyButton
                        text={validator.address}
                        stopPropagation={false}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Link
                      href="/reconciliation"
                      className="inline-flex items-center justify-between rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-100 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/15"
                    >
                      Reconciliation
                      <FileCheck className="h-4 w-4" />
                    </Link>
                    {validator.website ? (
                      <a
                        href={validator.website}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500"
                      >
                        Operator website
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    ) : null}
                  </div>
                </div>
              </GlassCard>

              <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <DetailCard
                  label="Bonded Share"
                  value={`${sharePercent.toFixed(2)}%`}
                  detail="Share of the canonical bonded validator universe carried by the API response."
                />
                <DetailCard
                  label="Reported Stake"
                  value={formatRawTokenAmount(validator.tokens)}
                  detail="Raw stake amount reported by the staking module for this validator."
                />
                <DetailCard
                  label="Commission"
                  value={`${(
                    validator.commissionPercent ??
                    getCommissionPercent(validator.commission.rate)
                  ).toFixed(2)}%`}
                  detail={`Max ${getCommissionPercent(
                    validator.commission.maxRate,
                  ).toFixed(2)}%, max change ${getCommissionPercent(
                    validator.commission.maxChangeRate,
                  ).toFixed(2)}%.`}
                />
                <DetailCard
                  label="Snapshot Freshness"
                  value={formatAgeSeconds(
                    validator.risk?.evidence.indexedStateAgeSeconds ?? null,
                  )}
                  detail={
                    protocol?.freshnessMessage ||
                    "Public freshness posture is unavailable until the scheduler emits a result."
                  }
                />
              </section>

              <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
                <GlassCard className="p-6">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                    Operator Metadata
                  </p>
                  <h2 className="mt-2 text-2xl font-bold text-white">
                    Published identity and profile signals
                  </h2>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <GlassCard className="p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                        Moniker
                      </p>
                      <p className="mt-2 text-sm text-white">
                        {validator.moniker || "Not published"}
                      </p>
                    </GlassCard>
                    <GlassCard className="p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                        Identity
                      </p>
                      <p className="mt-2 break-all text-sm text-white">
                        {validator.identity || "Not published"}
                      </p>
                    </GlassCard>
                    <GlassCard className="p-4 md:col-span-2">
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                        Details
                      </p>
                      <p className="mt-2 text-sm leading-7 text-slate-300">
                        {validator.details || "No operator details published."}
                      </p>
                    </GlassCard>
                    <GlassCard className="p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                        Website
                      </p>
                      <p className="mt-2 break-all text-sm text-white">
                        {validator.website || "Not published"}
                      </p>
                    </GlassCard>
                    <GlassCard className="p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                        Unbonding
                      </p>
                      <p className="mt-2 text-sm text-white">
                        Height {validator.unbondingHeight || 0}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatTimestamp(validator.unbondingTime)}
                      </p>
                    </GlassCard>
                  </div>

                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    {(validator.risk?.components ?? []).map((component) => (
                      <GlassCard key={component.key} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                              {component.label}
                            </p>
                            <p className="mt-2 text-lg font-semibold text-white">
                              {component.value}
                            </p>
                          </div>
                          <FreshnessPill status={component.status} />
                        </div>
                        <p className="mt-3 text-sm leading-6 text-slate-300">
                          {component.message}
                        </p>
                      </GlassCard>
                    ))}
                  </div>
                </GlassCard>

                <div className="space-y-6">
                  <GlassCard className="p-6">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Risk Summary
                    </p>
                    <h2 className="mt-2 text-2xl font-bold text-white">
                      Why this posture was assigned
                    </h2>
                    <div className="mt-5 space-y-3 text-sm leading-6 text-slate-300">
                      {(validator.risk?.reasons ?? []).map((reason) => (
                        <div
                          key={reason}
                          className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3"
                        >
                          {reason}
                        </div>
                      ))}
                    </div>
                  </GlassCard>

                  <GlassCard className="p-6">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Canonical Context
                    </p>
                    <div className="mt-3 space-y-3 text-sm text-slate-300">
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                        Universe membership:{" "}
                        {validator.eligibleForUniverse === false
                          ? "outside bonded universe"
                          : "included in bonded universe"}
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                        Reconciliation status:{" "}
                        {validator.risk?.evidence.reconciliationStatus ??
                          "UNKNOWN"}
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                        Epoch lag:{" "}
                        {validator.risk?.evidence.epochLag ?? "Unavailable"}
                      </div>
                    </div>
                  </GlassCard>

                  {protocol?.eligibleUniverseHash ? (
                    <GlassCard className="p-6">
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                        Universe Hash
                      </p>
                      <div className="mt-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="break-all font-mono text-xs text-cyan-100">
                            {protocol.eligibleUniverseHash}
                          </p>
                          {protocol.snapshotAt ? (
                            <p className="mt-2 text-xs text-cyan-200/80">
                              Snapshot{" "}
                              {new Date(protocol.snapshotAt).toLocaleString()}
                            </p>
                          ) : null}
                        </div>
                        <CopyButton
                          text={protocol.eligibleUniverseHash}
                          stopPropagation={false}
                        />
                      </div>
                    </GlassCard>
                  ) : null}

                  <GlassCard className="p-6">
                    <Link
                      href="/validators"
                      className="inline-flex items-center gap-2 text-sm font-medium text-cyan-200 hover:text-cyan-100"
                    >
                      Explore the rest of the validator set
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </GlassCard>
                </div>
              </section>
            </>
          )}
        </main>

        <Footer />
      </div>
    </>
  );
}
