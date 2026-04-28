import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  Filter,
  RefreshCw,
  Search,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Footer, TopNav } from "@/components/SharedComponents";
import { GlassCard } from "@/components/PagePrimitives";
import {
  buildSealMetrics,
  fetchSeals,
  formatRelativeTime,
  formatTimestamp,
  getSealCommitmentCoverage,
  shortenHash,
  type SealLifecycleStatus,
  type SealListItem,
} from "@/lib/seals";

const PAGE_SIZE = 24;

type StatusFilter = SealLifecycleStatus | "all";
type SortKey =
  | "created_at:desc"
  | "expires_at:asc"
  | "expires_at:desc"
  | "validators:desc";

function getStatusClasses(status: SealLifecycleStatus): string {
  const classes: Record<SealLifecycleStatus, string> = {
    active: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    revoked: "border-rose-500/20 bg-rose-500/10 text-rose-200",
    expired: "border-amber-500/20 bg-amber-500/10 text-amber-200",
    superseded: "border-cyan-500/20 bg-cyan-500/10 text-cyan-200",
    unknown: "border-slate-700 bg-slate-800 text-slate-200",
  };

  return classes[status];
}

function StatusPill({ status }: { status: SealLifecycleStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${getStatusClasses(
        status,
      )}`}
    >
      {status}
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

function SealCard({ seal }: { seal: SealListItem }) {
  const commitmentCoverage = getSealCommitmentCoverage(seal);

  return (
    <Link
      href={`/seals/${encodeURIComponent(seal.id)}`}
      className="group block rounded-[28px] border border-slate-800 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(2,6,23,0.96))] p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-500/30 hover:shadow-2xl hover:shadow-cyan-950/20"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              Digital seal
            </p>
            <h3 className="mt-2 break-all font-mono text-sm font-semibold text-white sm:text-base">
              {seal.id}
            </h3>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <StatusPill status={seal.status} />
            <ArrowRight className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-1 group-hover:text-cyan-200" />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Created
            </p>
            <p className="mt-2 text-sm font-medium text-white">
              {formatRelativeTime(seal.createdAt)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {formatTimestamp(seal.createdAt)}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Validator quorum
            </p>
            <p className="mt-2 text-sm font-medium text-white">
              {seal.validatorCount} validators
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Recorded on the registry entry
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Commitment coverage
            </p>
            <p className="mt-2 text-sm font-medium text-white">
              {commitmentCoverage}%
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Model, input, and output commitments present
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Expiry
            </p>
            <p className="mt-2 text-sm font-medium text-white">
              {seal.expiresAt
                ? formatRelativeTime(seal.expiresAt)
                : "No expiry"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {seal.expiresAt
                ? formatTimestamp(seal.expiresAt)
                : "Seal remains active until revoked or superseded."}
            </p>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Related job
            </p>
            <p className="mt-2 font-mono text-sm text-cyan-100">
              {shortenHash(seal.jobId || "Unavailable", 12, 8)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Requester {shortenHash(seal.requester || "Unavailable", 10, 6)}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Proof anchors
            </p>
            <div className="mt-2 space-y-1.5 text-xs text-slate-300">
              <p>Model {shortenHash(seal.modelCommitment, 12, 8)}</p>
              <p>Input {shortenHash(seal.inputCommitment, 12, 8)}</p>
              <p>Output {shortenHash(seal.outputCommitment, 12, 8)}</p>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function SealsPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("created_at:desc");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const sealsQuery = useQuery({
    queryKey: ["seal-registry", page, statusFilter, sortKey],
    queryFn: () =>
      fetchSeals({
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        status: statusFilter === "all" ? "" : statusFilter,
        sort: sortKey === "validators:desc" ? "created_at:desc" : sortKey,
      }),
    refetchInterval: 30000,
  });

  const visibleSeals = useMemo(() => {
    const normalizedQuery = deferredSearchQuery.trim().toLowerCase();
    const seals = (sealsQuery.data?.seals ?? []).filter((seal) => {
      if (!normalizedQuery) {
        return true;
      }

      return [
        seal.id,
        seal.jobId,
        seal.requester,
        seal.modelCommitment,
        seal.inputCommitment,
        seal.outputCommitment,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });

    if (sortKey === "validators:desc") {
      return [...seals].sort((left, right) => {
        if (left.validatorCount === right.validatorCount) {
          return right.createdAt.localeCompare(left.createdAt);
        }
        return right.validatorCount - left.validatorCount;
      });
    }

    return seals;
  }, [deferredSearchQuery, sealsQuery.data?.seals, sortKey]);

  const metrics = useMemo(
    () => buildSealMetrics(sealsQuery.data?.seals ?? []),
    [sealsQuery.data?.seals],
  );

  const statusMix = useMemo(() => {
    const counts = {
      active: 0,
      revoked: 0,
      expired: 0,
      superseded: 0,
      unknown: 0,
    };

    for (const seal of visibleSeals) {
      counts[seal.status] += 1;
    }

    return counts;
  }, [visibleSeals]);

  const totalPages = Math.max(
    1,
    Math.ceil((sealsQuery.data?.total ?? 0) / PAGE_SIZE),
  );

  return (
    <>
      <SEOHead
        title="Digital Seals"
        description="Explore live Cruzible seal records with validator quorum, commitment anchors, revocation posture, and job linkage."
        path="/seals"
      />

      <div className="min-h-screen bg-slate-950 text-slate-100">
        <TopNav activePage="explorer" />

        <main className="mx-auto max-w-7xl px-6 py-10">
          <section className="mb-8 rounded-[32px] border border-slate-800 bg-[radial-gradient(circle_at_top_right,_rgba(34,197,94,0.16),_transparent_26%),radial-gradient(circle_at_bottom_left,_rgba(14,165,233,0.14),_transparent_28%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-8 shadow-2xl">
            <div className="grid gap-6 lg:grid-cols-[1.35fr_0.9fr] lg:items-end">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-emerald-100">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Live seal registry
                </div>
                <p className="mt-4 text-xs font-medium uppercase tracking-[0.24em] text-slate-500">
                  Explorer / seals
                </p>
                <h1 className="mt-3 text-4xl font-bold tracking-tight text-white lg:text-5xl">
                  Proof lineage you can actually inspect.
                </h1>
                <p className="mt-4 text-sm leading-7 text-slate-300 lg:text-base">
                  This page renders only live seal records from the Cruzible
                  API. Status, commitment anchors, validator quorum, and job
                  linkage are sourced from the registry, while search and
                  summary cards are computed from the currently loaded result
                  set.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Link
                  href="/jobs"
                  className="inline-flex items-center justify-between rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-100 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/15"
                >
                  Job lineage
                  <Workflow className="h-4 w-4" />
                </Link>
                <button
                  onClick={() => void sealsQuery.refetch()}
                  className="inline-flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500"
                >
                  Refresh live set
                  <RefreshCw
                    className={`h-4 w-4 ${
                      sealsQuery.isFetching ? "animate-spin" : ""
                    }`}
                  />
                </button>
              </div>
            </div>
          </section>

          <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Active In Slice"
              value={String(metrics.activeCount)}
              detail="Active seals in the currently loaded registry slice."
            />
            <MetricCard
              label="Revoked Or Superseded"
              value={String(metrics.revokedOrSupersededCount)}
              detail="Entries whose lifecycle already ended through revocation or replacement."
            />
            <MetricCard
              label="Average Quorum"
              value={metrics.averageValidatorQuorum.toFixed(1)}
              detail="Average validator participation per loaded seal record."
            />
            <MetricCard
              label="Commitment Coverage"
              value={`${metrics.commitmentCoverage}%`}
              detail="Loaded entries with model, input, and output commitments present."
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
            <GlassCard className="p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                    Registry Surface
                  </p>
                  <h2 className="mt-2 text-2xl font-bold text-white">
                    Searchable seal evidence
                  </h2>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search seal, job, requester"
                      className="w-full rounded-xl border border-slate-800 bg-slate-900/70 py-2 pl-9 pr-3 text-sm text-white outline-none transition-colors focus:border-cyan-500/40"
                    />
                  </div>

                  <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-3">
                    <Filter className="h-4 w-4 text-slate-500" />
                    <select
                      value={statusFilter}
                      onChange={(event) =>
                        setStatusFilter(event.target.value as StatusFilter)
                      }
                      className="w-full bg-transparent py-2 text-sm text-white outline-none"
                    >
                      <option value="all">All statuses</option>
                      <option value="active">Active</option>
                      <option value="revoked">Revoked</option>
                      <option value="expired">Expired</option>
                      <option value="superseded">Superseded</option>
                    </select>
                  </div>

                  <select
                    value={sortKey}
                    onChange={(event) =>
                      setSortKey(event.target.value as SortKey)
                    }
                    className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-cyan-500/40"
                  >
                    <option value="created_at:desc">Newest first</option>
                    <option value="expires_at:asc">Expiry soonest</option>
                    <option value="expires_at:desc">Latest expiry</option>
                    <option value="validators:desc">Highest quorum</option>
                  </select>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span>
                  Showing {visibleSeals.length} of{" "}
                  {sealsQuery.data?.seals.length ?? 0} loaded entries
                </span>
                <span>
                  {sealsQuery.data?.total ?? 0} total records in the registry
                </span>
                <span>
                  {metrics.expiringSoonCount} expire within 7 days in this slice
                </span>
              </div>

              {sealsQuery.isLoading ? (
                <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">
                  Loading live seal registry...
                </div>
              ) : sealsQuery.error ? (
                <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-sm text-red-100">
                  The seal registry is unavailable right now. This surface will
                  remain empty rather than render mock data.
                </div>
              ) : visibleSeals.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">
                  No live seals matched the current filters.
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  {visibleSeals.map((seal) => (
                    <SealCard key={seal.id} seal={seal} />
                  ))}
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 border-t border-slate-800 pt-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-400">
                  Page {page} of {totalPages}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                    disabled={page === 1}
                    className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() =>
                      setPage((current) => Math.min(totalPages, current + 1))
                    }
                    disabled={page >= totalPages}
                    className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </GlassCard>

            <div className="space-y-6">
              <GlassCard className="p-6">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  Trust Posture
                </p>
                <h2 className="mt-2 text-2xl font-bold text-white">
                  Why this surface is defensible
                </h2>
                <div className="mt-5 space-y-3 text-sm leading-6 text-slate-300">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                    Seal status, requester, job linkage, and commitment anchors
                    come directly from the live registry API.
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                    Summary cards are derived from the loaded result set, not
                    from invented protocol-wide estimates.
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                    Detail pages prefer the first-class seal detail endpoint and
                    fall back only to a live registry lookup when that endpoint
                    is unavailable.
                  </div>
                </div>
              </GlassCard>

              <GlassCard className="p-6">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  Status Mix
                </p>
                <h2 className="mt-2 text-2xl font-bold text-white">
                  Current filtered view
                </h2>
                <div className="mt-5 space-y-4">
                  {(
                    [
                      ["active", statusMix.active],
                      ["revoked", statusMix.revoked],
                      ["expired", statusMix.expired],
                      ["superseded", statusMix.superseded],
                    ] as const
                  ).map(([status, count]) => {
                    const denominator = visibleSeals.length || 1;
                    const width = `${(count / denominator) * 100}%`;

                    return (
                      <div key={status}>
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span className="capitalize text-slate-300">
                            {status}
                          </span>
                          <span className="text-slate-500">{count}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-900">
                          <div
                            className={`h-2 rounded-full ${
                              getStatusClasses(status).includes("emerald")
                                ? "bg-emerald-400"
                                : getStatusClasses(status).includes("rose")
                                  ? "bg-rose-400"
                                  : getStatusClasses(status).includes("amber")
                                    ? "bg-amber-400"
                                    : "bg-cyan-400"
                            }`}
                            style={{ width }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </GlassCard>

              <GlassCard className="p-6">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-amber-200">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Scope Note
                    </p>
                    <h2 className="mt-2 text-xl font-bold text-white">
                      Truth beats breadth
                    </h2>
                    <p className="mt-3 text-sm leading-7 text-slate-300">
                      Until the API exposes protocol-level seal aggregates, this
                      page reports exactly what is loaded and avoids pretending
                      it has more coverage than it does.
                    </p>
                    <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-cyan-200">
                      <Clock3 className="h-4 w-4" />
                      Live refresh every 30 seconds
                    </div>
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
