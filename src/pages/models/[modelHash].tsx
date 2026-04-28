import Link from "next/link";
import { useRouter } from "next/router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  RefreshCw,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { CopyButton, GlassCard } from "@/components/PagePrimitives";
import { Footer, TopNav } from "@/components/SharedComponents";
import {
  fetchModelDetail,
  formatBytes,
  formatDateTime,
  formatModelCategory,
  formatNullableNumber,
  formatRelativeTime,
  isHttpUrl,
  prettyPrintSchema,
  truncateIdentifier,
} from "@/lib/models";

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

function formatProofType(proofType: string): string {
  return proofType
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function ModelDetailPage() {
  const router = useRouter();
  const modelHash =
    typeof router.query.modelHash === "string" ? router.query.modelHash : "";

  const modelQuery = useQuery({
    queryKey: ["model-detail", modelHash],
    enabled: Boolean(modelHash),
    queryFn: () => fetchModelDetail(modelHash),
    refetchInterval: 120000,
  });

  const model = modelQuery.data;
  const registry = model?.registry;
  const usage = model?.usage;
  const lineage = model?.lineage.recentJobs ?? [];
  const proofBreakdown = usage?.proofTypeBreakdown ?? [];
  const totalProofJobs = proofBreakdown.reduce(
    (sum, entry) => sum + entry.count,
    0,
  );

  return (
    <>
      <SEOHead
        title={registry?.name || "Model Detail"}
        description="Inspect a live Cruzible model registry entry with lineage, usage, and publication metadata."
        path={
          modelHash ? `/models/${encodeURIComponent(modelHash)}` : "/models"
        }
      />

      <div className="min-h-screen bg-slate-950 text-slate-100">
        <TopNav activePage="explorer" />

        <main className="mx-auto max-w-7xl px-6 py-10">
          <section className="mb-8 rounded-[32px] border border-slate-800 bg-[radial-gradient(circle_at_top_right,_rgba(34,197,94,0.16),_transparent_30%),radial-gradient(circle_at_bottom_left,_rgba(14,165,233,0.14),_transparent_28%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-8 shadow-2xl">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <Link
                  href="/models"
                  className="text-sm font-medium text-cyan-200 hover:text-cyan-100"
                >
                  ← Back to models
                </Link>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-cyan-100">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Live model detail
                  </span>
                  {registry?.verified ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Verified
                    </span>
                  ) : null}
                  {model?.source === "list-fallback" ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      List fallback
                    </span>
                  ) : null}
                </div>
                <h1 className="mt-4 text-4xl font-bold tracking-tight text-white lg:text-5xl">
                  {registry?.name || "Model detail"}
                </h1>
                <p className="mt-4 text-sm leading-7 text-slate-300 lg:text-base">
                  Registry metadata, usage telemetry, and recent lineage are
                  sourced from live explorer APIs. This page avoids inventing
                  model quality scores and instead exposes what the registry and
                  job ledger can actually defend.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Link
                  href="/jobs"
                  className="inline-flex items-center justify-between rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-100 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/15"
                >
                  Open jobs explorer
                  <Workflow className="h-4 w-4" />
                </Link>
                <button
                  onClick={() => void modelQuery.refetch()}
                  className="inline-flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500"
                >
                  Refresh detail
                  <RefreshCw
                    className={`h-4 w-4 ${
                      modelQuery.isFetching ? "animate-spin" : ""
                    }`}
                  />
                </button>
              </div>
            </div>
          </section>

          {modelQuery.isLoading ? (
            <GlassCard className="p-6 text-sm text-slate-400">
              Loading live model detail...
            </GlassCard>
          ) : modelQuery.error || !model || !registry || !usage ? (
            <GlassCard className="border border-red-500/20 bg-red-500/10 p-6 text-sm text-red-100">
              Model detail is unavailable right now. This page only renders live
              registry data, so it stays empty until the backing API responds.
            </GlassCard>
          ) : (
            <>
              <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Observed Jobs"
                  value={usage.totalJobs.toLocaleString()}
                  detail={`${formatNullableNumber(
                    usage.verifiedJobs,
                  )} verified jobs are currently recorded.`}
                />
                <MetricCard
                  label="In Flight"
                  value={formatNullableNumber(usage.inFlightJobs)}
                  detail="Pending, assigned, or actively computing jobs for this model."
                />
                <MetricCard
                  label="Failed Jobs"
                  value={formatNullableNumber(usage.failedJobs)}
                  detail="Observed failures in the live telemetry window."
                />
                <MetricCard
                  label="Published Size"
                  value={formatBytes(model.sizeBytes)}
                  detail={`Updated ${formatRelativeTime(model.updatedAt)}.`}
                />
              </section>

              <section className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
                <div className="space-y-6">
                  <GlassCard className="p-6">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-start gap-3">
                          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-cyan-100">
                            <Bot className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                              Registry Identity
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-100">
                                {formatModelCategory(registry.category)}
                              </span>
                              <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300">
                                {registry.architecture}
                              </span>
                              <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300">
                                v{registry.version}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="mt-5 space-y-4">
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                              Model Hash
                            </p>
                            <div className="mt-2 flex items-start gap-2">
                              <p className="break-all font-mono text-sm text-slate-200">
                                {registry.modelHash}
                              </p>
                              <CopyButton
                                text={registry.modelHash}
                                stopPropagation={false}
                              />
                            </div>
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                Owner
                              </p>
                              <p className="mt-2 break-all font-mono text-sm text-slate-200">
                                {registry.owner}
                              </p>
                            </div>
                            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                Registered
                              </p>
                              <p className="mt-2 text-sm text-slate-200">
                                {formatDateTime(registry.registeredAt)}
                              </p>
                            </div>
                            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                Last Verified
                              </p>
                              <p className="mt-2 text-sm text-slate-200">
                                {formatDateTime(usage.latestVerifiedAt)}
                              </p>
                            </div>
                            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                Storage URI
                              </p>
                              {registry.storageUri ? (
                                <div className="mt-2 flex items-start gap-2">
                                  <p className="break-all text-sm text-slate-200">
                                    {truncateIdentifier(
                                      registry.storageUri,
                                      24,
                                      12,
                                    )}
                                  </p>
                                  <CopyButton
                                    text={registry.storageUri}
                                    stopPropagation={false}
                                  />
                                </div>
                              ) : (
                                <p className="mt-2 text-sm text-slate-500">
                                  Unpublished
                                </p>
                              )}
                              {isHttpUrl(registry.storageUri) ? (
                                <a
                                  href={registry.storageUri}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-cyan-200 hover:text-cyan-100"
                                >
                                  Open storage
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </GlassCard>

                  <GlassCard className="p-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                          Recent Lineage
                        </p>
                        <h2 className="mt-2 text-2xl font-bold text-white">
                          Most recent jobs linked to this model
                        </h2>
                      </div>
                      <Link
                        href="/jobs"
                        className="inline-flex items-center gap-2 text-sm font-medium text-cyan-200 hover:text-cyan-100"
                      >
                        Full jobs explorer
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>

                    <div className="mt-5 space-y-3">
                      {lineage.length > 0 ? (
                        lineage.map((job) => (
                          <Link
                            key={job.id}
                            href={`/jobs/${encodeURIComponent(job.id)}`}
                            className="block rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4 transition-colors hover:border-cyan-500/30"
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0">
                                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                  Job ID
                                </p>
                                <p className="mt-2 break-all font-mono text-sm text-white">
                                  {job.id}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <span className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-medium text-slate-200">
                                  {job.status}
                                </span>
                                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-100">
                                  {formatProofType(job.proofType)}
                                </span>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                              <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                  Created
                                </p>
                                <p className="mt-1 text-sm text-slate-200">
                                  {formatDateTime(job.createdAt)}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                  Completed
                                </p>
                                <p className="mt-1 text-sm text-slate-200">
                                  {formatDateTime(job.completedAt)}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                  Creator
                                </p>
                                <p className="mt-1 break-all font-mono text-sm text-slate-200">
                                  {job.creatorAddress || "Unpublished"}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                                  Validator
                                </p>
                                <p className="mt-1 break-all font-mono text-sm text-slate-200">
                                  {job.validatorAddress || "Unassigned"}
                                </p>
                              </div>
                            </div>
                          </Link>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-5 text-sm text-slate-400">
                          No recent jobs are exposed for this model yet.
                        </div>
                      )}
                    </div>
                  </GlassCard>

                  <GlassCard className="p-6">
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-3 text-slate-100">
                        <FileCode2 className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                          Interface Contract
                        </p>
                        <h2 className="mt-2 text-2xl font-bold text-white">
                          Published input and output schemas
                        </h2>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 xl:grid-cols-2">
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                          Input Schema
                        </p>
                        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-200">
                          {prettyPrintSchema(registry.inputSchema)}
                        </pre>
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                          Output Schema
                        </p>
                        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-200">
                          {prettyPrintSchema(registry.outputSchema)}
                        </pre>
                      </div>
                    </div>
                  </GlassCard>
                </div>

                <div className="space-y-6">
                  <GlassCard className="p-6">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Trust Posture
                    </p>
                    <h2 className="mt-2 text-2xl font-bold text-white">
                      Why this page is defensible
                    </h2>
                    <div className="mt-5 space-y-3 text-sm leading-6 text-slate-300">
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                        Registry metadata comes from live `/v1/models` and
                        `/v1/models/:modelHash` responses, not hand-authored
                        content.
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                        Usage metrics show observed job counts and timestamps,
                        not quality rankings or unverified performance claims.
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                        When the detail endpoint is unavailable, the page
                        downgrades transparently to a live list fallback rather
                        than inventing lineage data.
                      </div>
                    </div>
                  </GlassCard>

                  <GlassCard className="p-6">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Proof Mix
                    </p>
                    <h2 className="mt-2 text-2xl font-bold text-white">
                      Observed proof distribution
                    </h2>
                    <div className="mt-5 space-y-4">
                      {proofBreakdown.length > 0 ? (
                        proofBreakdown.map((entry) => {
                          const share =
                            totalProofJobs > 0
                              ? (entry.count / totalProofJobs) * 100
                              : 0;

                          return (
                            <div key={entry.proofType}>
                              <div className="mb-2 flex items-center justify-between text-sm">
                                <span className="text-slate-300">
                                  {formatProofType(entry.proofType)}
                                </span>
                                <span className="text-slate-500">
                                  {entry.count.toLocaleString()}
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-slate-900">
                                <div
                                  className="h-2 rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400"
                                  style={{ width: `${Math.min(share, 100)}%` }}
                                />
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-5 text-sm text-slate-400">
                          No proof breakdown is published for this model yet.
                        </div>
                      )}
                    </div>
                  </GlassCard>

                  <GlassCard className="p-6">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Publication Footprint
                    </p>
                    <div className="mt-4 space-y-3 text-sm text-slate-300">
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                        Owner address:{" "}
                        <span className="font-mono text-slate-100">
                          {truncateIdentifier(registry.owner, 16, 10)}
                        </span>
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                        Latest observed job: {formatDateTime(usage.latestJobAt)}
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                        Latest verified job:{" "}
                        {formatDateTime(usage.latestVerifiedAt)}
                      </div>
                    </div>
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
