import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Footer, TopNav } from "@/components/SharedComponents";
import { CopyButton, GlassCard } from "@/components/PagePrimitives";
import {
  fetchAllModels,
  formatDateTime,
  formatModelCategory,
  truncateIdentifier,
  type ModelRegistryRecord,
} from "@/lib/models";

type SortKey = "jobs" | "newest" | "name" | "verified";
type VerificationFilter = "all" | "verified" | "unverified";

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

function CategoryPill({ category }: { category: string }) {
  return (
    <span className="inline-flex rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-100">
      {formatModelCategory(category)}
    </span>
  );
}

function VerificationPill({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-200">
      <CheckCircle2 className="h-3.5 w-3.5" />
      Verified
    </span>
  ) : (
    <span className="inline-flex rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200">
      Unverified
    </span>
  );
}

function sortModels(
  models: ModelRegistryRecord[],
  sortKey: SortKey,
): ModelRegistryRecord[] {
  return [...models].sort((left, right) => {
    if (sortKey === "name") {
      return left.name.localeCompare(right.name);
    }

    if (sortKey === "verified") {
      if (left.verified !== right.verified) {
        return left.verified ? -1 : 1;
      }

      if (left.totalJobs !== right.totalJobs) {
        return right.totalJobs - left.totalJobs;
      }

      return left.name.localeCompare(right.name);
    }

    if (sortKey === "newest") {
      return (
        new Date(right.registeredAt).getTime() -
        new Date(left.registeredAt).getTime()
      );
    }

    if (left.totalJobs !== right.totalJobs) {
      return right.totalJobs - left.totalJobs;
    }

    return (
      new Date(right.registeredAt).getTime() -
      new Date(left.registeredAt).getTime()
    );
  });
}

export default function ModelsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [verificationFilter, setVerificationFilter] =
    useState<VerificationFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("jobs");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const modelsQuery = useQuery({
    queryKey: ["models-registry-universe"],
    queryFn: () => fetchAllModels({ sort: "registered_at:desc" }),
    refetchInterval: 120000,
    staleTime: 30000,
  });

  const models = useMemo(
    () => modelsQuery.data?.models ?? [],
    [modelsQuery.data?.models],
  );

  const metrics = useMemo(() => {
    const totalJobs = models.reduce((sum, model) => sum + model.totalJobs, 0);
    const verifiedCount = models.filter((model) => model.verified).length;
    const uniqueOwners = new Set(models.map((model) => model.owner)).size;
    const architectureCount = new Set(models.map((model) => model.architecture))
      .size;

    return {
      totalJobs,
      verifiedCount,
      uniqueOwners,
      architectureCount,
    };
  }, [models]);

  const categoryBreakdown = useMemo(() => {
    const counts = new Map<string, number>();

    for (const model of models) {
      counts.set(model.category, (counts.get(model.category) ?? 0) + 1);
    }

    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([category, count]) => ({
        category,
        count,
        share: models.length > 0 ? (count / models.length) * 100 : 0,
      }));
  }, [models]);

  const topModels = useMemo(
    () => sortModels(models, "jobs").slice(0, 4),
    [models],
  );

  const categories = useMemo(
    () => ["all", ...categoryBreakdown.map((entry) => entry.category)],
    [categoryBreakdown],
  );

  const filteredModels = useMemo(() => {
    const normalizedQuery = deferredSearchQuery.trim().toLowerCase();

    return sortModels(
      models.filter((model) => {
        if (categoryFilter !== "all" && model.category !== categoryFilter) {
          return false;
        }

        if (verificationFilter === "verified" && !model.verified) {
          return false;
        }

        if (verificationFilter === "unverified" && model.verified) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

        return [
          model.name,
          model.modelHash,
          model.owner,
          model.architecture,
          model.version,
          model.category,
        ]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(normalizedQuery));
      }),
      sortKey,
    );
  }, [
    categoryFilter,
    deferredSearchQuery,
    models,
    sortKey,
    verificationFilter,
  ]);

  const verifiedShare =
    models.length > 0 ? (metrics.verifiedCount / models.length) * 100 : 0;

  return (
    <>
      <SEOHead
        title="Models"
        description="Live Cruzible model registry explorer with registry metadata, usage context, and truth-first detail links."
        path="/models"
      />

      <div className="min-h-screen bg-slate-950 text-slate-100">
        <TopNav activePage="explorer" />

        <main className="mx-auto max-w-7xl px-6 py-10">
          <section className="mb-8 rounded-[32px] border border-slate-800 bg-[radial-gradient(circle_at_top_right,_rgba(34,197,94,0.16),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(14,165,233,0.14),_transparent_30%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-8 shadow-2xl">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-cyan-100">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Live registry explorer
                </div>
                <h1 className="mt-4 text-4xl font-bold tracking-tight text-white lg:text-5xl">
                  Registry-backed model discovery with real usage context.
                </h1>
                <p className="mt-4 text-sm leading-7 text-slate-300 lg:text-base">
                  This explorer is sourced from the live Cruzible model
                  registry. It highlights immutable identifiers, published
                  schemas, verification status, and observed job volume without
                  inventing quality or trust scores.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Link
                  href="/jobs"
                  className="inline-flex items-center justify-between rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-100 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/15"
                >
                  Open jobs explorer
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <button
                  onClick={() => void modelsQuery.refetch()}
                  className="inline-flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500"
                >
                  Refresh registry
                  <RefreshCw
                    className={`h-4 w-4 ${
                      modelsQuery.isFetching ? "animate-spin" : ""
                    }`}
                  />
                </button>
              </div>
            </div>
          </section>

          <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Registered Models"
              value={models.length.toLocaleString()}
              detail={`${modelsQuery.data?.total ?? models.length} live entries loaded from /v1/models.`}
            />
            <MetricCard
              label="Verified Coverage"
              value={`${verifiedShare.toFixed(1)}%`}
              detail={`${metrics.verifiedCount.toLocaleString()} registry entries are marked verified.`}
            />
            <MetricCard
              label="Observed Jobs"
              value={metrics.totalJobs.toLocaleString()}
              detail="Aggregate jobs recorded across the live model registry snapshot."
            />
            <MetricCard
              label="Owner Diversity"
              value={metrics.uniqueOwners.toLocaleString()}
              detail={`${metrics.architectureCount.toLocaleString()} architecture families are currently represented.`}
            />
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.45fr_1fr]">
            <GlassCard className="p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                    Registry Directory
                  </p>
                  <h2 className="mt-2 text-2xl font-bold text-white">
                    Searchable explorer for published model records
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Filters apply to live registry data only. Search spans model
                    name, hash, owner, architecture, version, and category.
                  </p>
                </div>

                <p className="text-sm text-slate-400">
                  Showing {filteredModels.length.toLocaleString()} of{" "}
                  {models.length.toLocaleString()} loaded models
                </p>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="relative xl:col-span-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search name, hash, owner, or architecture"
                    className="w-full rounded-xl border border-slate-800 bg-slate-900/70 py-2 pl-9 pr-3 text-sm text-white outline-none transition-colors focus:border-cyan-500/40"
                  />
                </div>

                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-cyan-500/40"
                >
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category === "all"
                        ? "All categories"
                        : formatModelCategory(category)}
                    </option>
                  ))}
                </select>

                <select
                  value={verificationFilter}
                  onChange={(event) =>
                    setVerificationFilter(
                      event.target.value as VerificationFilter,
                    )
                  }
                  className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-cyan-500/40"
                >
                  <option value="all">All verification states</option>
                  <option value="verified">Verified only</option>
                  <option value="unverified">Unverified only</option>
                </select>

                <select
                  value={sortKey}
                  onChange={(event) =>
                    setSortKey(event.target.value as SortKey)
                  }
                  className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-cyan-500/40"
                >
                  <option value="jobs">Sort by jobs</option>
                  <option value="newest">Sort by newest</option>
                  <option value="verified">Sort by verification</option>
                  <option value="name">Sort by name</option>
                </select>
              </div>

              {modelsQuery.isLoading ? (
                <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">
                  Loading live model registry...
                </div>
              ) : modelsQuery.error ? (
                <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-sm text-red-100">
                  Model registry data is unavailable right now. This page only
                  renders live API data, so it stays empty until `/v1/models`
                  responds successfully.
                </div>
              ) : filteredModels.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">
                  No models matched the current filters.
                </div>
              ) : (
                <div className="mt-6 grid gap-4 xl:grid-cols-2">
                  {filteredModels.map((model) => {
                    const schemaCount =
                      Number(Boolean(model.inputSchema)) +
                      Number(Boolean(model.outputSchema));
                    const jobShare =
                      metrics.totalJobs > 0
                        ? (model.totalJobs / metrics.totalJobs) * 100
                        : 0;

                    return (
                      <div
                        key={model.modelHash}
                        className="rounded-[28px] border border-slate-800 bg-slate-950/80 p-5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <CategoryPill category={model.category} />
                            <VerificationPill verified={model.verified} />
                          </div>
                          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-right">
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                              Jobs
                            </p>
                            <p className="mt-1 text-lg font-semibold text-white">
                              {model.totalJobs.toLocaleString()}
                            </p>
                          </div>
                        </div>

                        <div className="mt-5">
                          <div className="flex items-start gap-3">
                            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-cyan-100">
                              <Bot className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="text-xl font-semibold text-white">
                                {model.name}
                              </h3>
                              <div className="mt-2 flex items-start gap-2">
                                <p className="break-all font-mono text-xs text-slate-500">
                                  {model.modelHash}
                                </p>
                                <CopyButton
                                  text={model.modelHash}
                                  stopPropagation={false}
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                              Owner
                            </p>
                            <p className="mt-2 break-all font-mono text-sm text-slate-200">
                              {truncateIdentifier(model.owner, 14, 10)}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                              Architecture
                            </p>
                            <p className="mt-2 text-sm text-slate-200">
                              {model.architecture}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                              Version
                            </p>
                            <p className="mt-2 text-sm text-slate-200">
                              {model.version}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                              Registered
                            </p>
                            <p className="mt-2 text-sm text-slate-200">
                              {formatDateTime(model.registeredAt)}
                            </p>
                          </div>
                        </div>

                        <div className="mt-5">
                          <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-500">
                            <span>Observed job share</span>
                            <span>{jobShare.toFixed(2)}%</span>
                          </div>
                          <div className="mt-2 h-2 rounded-full bg-slate-900">
                            <div
                              className="h-2 rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400"
                              style={{
                                width: `${Math.min(jobShare, 100)}%`,
                              }}
                            />
                          </div>
                        </div>

                        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4 text-sm">
                          <div className="flex flex-wrap gap-2 text-slate-400">
                            <span className="rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1">
                              {schemaCount}/2 schemas published
                            </span>
                            {model.storageUri ? (
                              <span className="rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1">
                                Storage URI published
                              </span>
                            ) : null}
                          </div>

                          <Link
                            href={`/models/${encodeURIComponent(model.modelHash)}`}
                            className="inline-flex items-center gap-2 font-medium text-cyan-200 hover:text-cyan-100"
                          >
                            Inspect registry detail
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </GlassCard>

            <div className="space-y-6">
              <GlassCard className="p-6">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  Registry Leaders
                </p>
                <h2 className="mt-2 text-2xl font-bold text-white">
                  Most used models in the live snapshot
                </h2>

                <div className="mt-5 space-y-3">
                  {topModels.map((model, index) => (
                    <Link
                      key={model.modelHash}
                      href={`/models/${encodeURIComponent(model.modelHash)}`}
                      className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 transition-colors hover:border-slate-700"
                    >
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                          Rank #{index + 1}
                        </p>
                        <p className="mt-1 truncate text-sm font-medium text-white">
                          {model.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {formatModelCategory(model.category)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-base font-semibold text-white">
                          {model.totalJobs.toLocaleString()}
                        </p>
                        <p className="text-xs text-slate-400">jobs</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </GlassCard>

              <GlassCard className="p-6">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  Category Distribution
                </p>
                <h2 className="mt-2 text-2xl font-bold text-white">
                  Registry composition by model category
                </h2>

                <div className="mt-5 space-y-4">
                  {categoryBreakdown.slice(0, 5).map((entry) => (
                    <div key={entry.category}>
                      <div className="flex items-center justify-between text-sm text-slate-300">
                        <span>{formatModelCategory(entry.category)}</span>
                        <span>{entry.count.toLocaleString()} models</span>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-slate-900">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400"
                          style={{ width: `${entry.share}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </GlassCard>

              <GlassCard className="p-6">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  Trust Design
                </p>
                <h2 className="mt-2 text-2xl font-bold text-white">
                  Why this surface is defensible
                </h2>

                <div className="mt-5 space-y-3 text-sm leading-6 text-slate-300">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                    Counts, verification state, owners, schemas, and usage
                    volume come directly from the live `/v1/models` response.
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                    The explorer deliberately avoids invented quality rankings,
                    synthetic benchmark scores, or unverifiable yield claims.
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                    Detail pages prefer the dedicated `/v1/models/:modelHash`
                    endpoint and explicitly degrade to a list snapshot when that
                    route is unavailable.
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
