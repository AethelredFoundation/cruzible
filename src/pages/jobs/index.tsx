/**
 * Cruzible Jobs Explorer
 *
 * Live job registry surface. This page deliberately renders empty/error states
 * instead of synthetic rows when the API is unavailable.
 */

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Cpu,
  Filter,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Footer, TopNav } from "@/components/SharedComponents";
import { GlassCard } from "@/components/PagePrimitives";
import { apiJson } from "@/lib/api-request";

const PAGE_SIZE = 20;

interface Job {
  id: string;
  status: string;
  modelHash: string;
  inputHash: string;
  outputHash: string | null;
  creator: string;
  proofType: string;
  priority: number;
  createdAt: string;
  completedAt: string | null;
  validatorAddress: string | null;
}

type JobsResponse = {
  jobs: Job[];
  total: number;
};

async function fetchJobs(page: number, status?: string): Promise<JobsResponse> {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
    sort: "created_at:desc",
  });

  if (status) {
    params.set("status", status);
  }

  return apiJson<JobsResponse>(`/jobs?${params}`);
}

function normalizeJobStatus(status: string): string {
  return status.toLowerCase().replace("job_status_", "");
}

function formatJobStatus(status: string): string {
  const normalized = normalizeJobStatus(status);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatProofType(proofType: string): string {
  return proofType
    .replace("PROOF_TYPE_", "")
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function truncateIdentifier(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return value.length <= 18
    ? value
    : `${value.slice(0, 9)}...${value.slice(-7)}`;
}

function formatDate(dateString: string | null): string {
  if (!dateString) {
    return "Pending";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(dateString));
}

function StatusBadge({ status }: { status: string }) {
  const normalizedStatus = normalizeJobStatus(status);
  const statusConfig: Record<string, { className: string; icon: JSX.Element }> =
    {
      completed: {
        className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      },
      verified: {
        className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      },
      pending: {
        className: "border-amber-500/20 bg-amber-500/10 text-amber-200",
        icon: <Clock3 className="h-3.5 w-3.5" />,
      },
      computing: {
        className: "border-cyan-500/20 bg-cyan-500/10 text-cyan-200",
        icon: <Cpu className="h-3.5 w-3.5" />,
      },
      failed: {
        className: "border-rose-500/20 bg-rose-500/10 text-rose-200",
        icon: <XCircle className="h-3.5 w-3.5" />,
      },
    };
  const config = statusConfig[normalizedStatus] ?? {
    className: "border-slate-700 bg-slate-800 text-slate-200",
    icon: <AlertCircle className="h-3.5 w-3.5" />,
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${config.className}`}
    >
      {config.icon}
      {formatJobStatus(status)}
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

export default function JobsPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const jobsQuery = useQuery({
    queryKey: ["jobs", page, statusFilter],
    queryFn: () => fetchJobs(page, statusFilter),
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

  const jobs = useMemo(
    () => jobsQuery.data?.jobs ?? [],
    [jobsQuery.data?.jobs],
  );
  const filteredJobs = useMemo(() => {
    const normalizedQuery = deferredSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return jobs;
    }

    return jobs.filter(
      (job) =>
        job.id.toLowerCase().includes(normalizedQuery) ||
        job.creator.toLowerCase().includes(normalizedQuery) ||
        job.modelHash.toLowerCase().includes(normalizedQuery),
    );
  }, [deferredSearchQuery, jobs]);

  const loadedStatuses = useMemo(() => {
    return new Set(jobs.map((job) => normalizeJobStatus(job.status))).size;
  }, [jobs]);

  const errorMessage =
    jobsQuery.error instanceof Error
      ? jobsQuery.error.message
      : "The live job registry could not be loaded.";

  return (
    <>
      <SEOHead
        title="Jobs Explorer"
        description="Inspect live Cruzible verification jobs with status, model lineage, proof type, creator, and timestamp metadata."
        path="/jobs"
      />

      <div className="min-h-screen bg-slate-950 text-slate-100">
        <TopNav activePage="explorer" />

        <main className="mx-auto max-w-7xl px-6 py-10">
          <section className="mb-8 rounded-[32px] border border-slate-800 bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.18),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(220,38,38,0.12),_transparent_30%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-8 shadow-2xl">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-cyan-100">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Live execution registry
                </div>
                <h1 className="mt-4 text-4xl font-bold tracking-tight text-white lg:text-5xl">
                  Jobs Explorer
                </h1>
                <p className="mt-4 text-sm leading-7 text-slate-300 lg:text-base">
                  Track Cruzible verification jobs from the live API with
                  status, proof type, model linkage, creator, and execution
                  timing. Empty states stay empty when the registry is
                  unavailable; this surface does not fabricate pipeline
                  activity.
                </p>
              </div>
              <button
                type="button"
                onClick={() => jobsQuery.refetch()}
                className="inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-cyan-500/40 hover:text-white"
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${jobsQuery.isFetching ? "animate-spin" : ""}`}
                />
                Refresh registry
              </button>
            </div>
          </section>

          <section className="mb-6 grid gap-4 md:grid-cols-3">
            <MetricCard
              label="Registry total"
              value={(jobsQuery.data?.total ?? 0).toLocaleString()}
              detail="Reported by the backend for the current filter."
            />
            <MetricCard
              label="Loaded page"
              value={filteredJobs.length.toLocaleString()}
              detail="Rows matching the current local search query."
            />
            <MetricCard
              label="Status coverage"
              value={loadedStatuses.toLocaleString()}
              detail="Distinct statuses observed in the loaded page."
            />
          </section>

          <GlassCard className="mb-6 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                <input
                  type="search"
                  placeholder="Search job, creator, or model hash"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 py-3 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20"
                />
              </div>

              <div className="flex items-center gap-2">
                <Filter className="h-5 w-5 text-slate-500" />
                <select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value);
                    setPage(1);
                  }}
                  className="rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-200 outline-none transition focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20"
                >
                  <option value="">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="computing">Computing</option>
                  <option value="completed">Completed</option>
                  <option value="verified">Verified</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="overflow-hidden">
            {jobsQuery.isLoading ? (
              <div className="px-6 py-14 text-center">
                <RefreshCw className="mx-auto h-6 w-6 animate-spin text-cyan-300" />
                <p className="mt-3 text-sm text-slate-400">
                  Loading live jobs from the registry...
                </p>
              </div>
            ) : jobsQuery.isError ? (
              <div className="px-6 py-14 text-center">
                <AlertCircle className="mx-auto h-8 w-8 text-amber-300" />
                <h2 className="mt-4 text-lg font-semibold text-white">
                  Job registry unavailable
                </h2>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">
                  {errorMessage}
                </p>
              </div>
            ) : filteredJobs.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <Cpu className="mx-auto h-8 w-8 text-slate-500" />
                <h2 className="mt-4 text-lg font-semibold text-white">
                  No jobs match this view
                </h2>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">
                  The current page returned no live rows for the selected
                  status/search combination.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-800">
                  <thead className="bg-slate-950/70">
                    <tr>
                      {[
                        "Job",
                        "Status",
                        "Proof",
                        "Creator",
                        "Model",
                        "Created",
                      ].map((label) => (
                        <th
                          key={label}
                          className="px-6 py-4 text-left text-xs font-medium uppercase tracking-[0.2em] text-slate-500"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredJobs.map((job) => (
                      <tr
                        key={job.id}
                        className="transition hover:bg-slate-900/70"
                      >
                        <td className="px-6 py-4">
                          <Link
                            href={`/jobs/${encodeURIComponent(job.id)}`}
                            className="group inline-flex items-center gap-2 font-mono text-sm font-medium text-cyan-200 hover:text-cyan-100"
                          >
                            {truncateIdentifier(job.id)}
                            <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                          </Link>
                        </td>
                        <td className="px-6 py-4">
                          <StatusBadge status={job.status} />
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-300">
                          {formatProofType(job.proofType)}
                        </td>
                        <td className="px-6 py-4 font-mono text-sm text-slate-400">
                          {truncateIdentifier(job.creator)}
                        </td>
                        <td className="px-6 py-4 font-mono text-sm text-slate-400">
                          {truncateIdentifier(job.modelHash)}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-400">
                          {formatDate(job.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-col gap-3 border-t border-slate-800 bg-slate-950/60 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-500">
                Page {page} · showing {filteredJobs.length} of{" "}
                {(jobsQuery.data?.total ?? 0).toLocaleString()} reported jobs
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1}
                  className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-cyan-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => current + 1)}
                  disabled={jobs.length < PAGE_SIZE}
                  className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-cyan-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </GlassCard>
        </main>

        <Footer />
      </div>
    </>
  );
}
