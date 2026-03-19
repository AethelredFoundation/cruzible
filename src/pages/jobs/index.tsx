/**
 * Cruzible — Jobs Explorer Page
 *
 * Premium dark-themed page for browsing AI verification jobs.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Filter,
  RefreshCw,
  Cpu,
  Clock,
  CheckCircle,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { SEOHead } from "@/components/SEOHead";
import { TopNav, Footer } from "@/components/SharedComponents";
import { GlassCard } from "@/components/PagePrimitives";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "https://api.mainnet.aethelred.org";

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

async function fetchJobs(
  page: number,
  status?: string,
): Promise<{ jobs: Job[]; total: number }> {
  const params = new URLSearchParams({
    limit: "20",
    offset: String((page - 1) * 20),
    sort: "created_at:desc",
  });
  if (status) params.set("status", status);

  const response = await fetch(`${API_URL}/v1/jobs?${params}`);
  if (!response.ok) throw new Error("Failed to fetch jobs");
  return response.json();
}

function StatusBadge({ status }: { status: string }) {
  const statusConfig: Record<
    string,
    { classes: string; icon: React.ReactNode }
  > = {
    completed: {
      classes:
        "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
      icon: <CheckCircle className="w-3 h-3" />,
    },
    pending: {
      classes: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
      icon: <Clock className="w-3 h-3" />,
    },
    computing: {
      classes: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
      icon: <Cpu className="w-3 h-3" />,
    },
    failed: {
      classes: "bg-red-500/15 text-red-400 border border-red-500/30",
      icon: <XCircle className="w-3 h-3" />,
    },
  };

  const normalizedStatus = status.toLowerCase().replace("job_status_", "");
  const config = statusConfig[normalizedStatus] || {
    classes: "bg-slate-500/15 text-slate-400 border border-slate-500/30",
    icon: null,
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${config.classes}`}
    >
      {config.icon}
      {normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1)}
    </span>
  );
}

export default function JobsPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["jobs", page, statusFilter],
    queryFn: () => fetchJobs(page, statusFilter),
  });

  const truncateHash = (hash: string) => {
    if (!hash || hash.length <= 16) return hash || "-";
    return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const filteredJobs =
    data?.jobs?.filter(
      (job) =>
        !searchQuery ||
        job.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        job.creator.toLowerCase().includes(searchQuery.toLowerCase()),
    ) || [];

  return (
    <>
      <SEOHead
        title="Jobs Explorer | Cruzible by Aethelred"
        description="Browse AI verification jobs on the Aethelred network."
      />

      <div className="min-h-screen bg-[#050810] text-white">
        <TopNav activePage="jobs" />

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-blue-500 flex items-center justify-center">
                <Cpu className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold font-display">
                  Jobs Explorer
                </h1>
                <p className="text-sm text-slate-400">
                  AI verification job tracker
                </p>
              </div>
            </div>
            <button
              onClick={() => refetch()}
              className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>

          {/* Filters */}
          <GlassCard className="mb-6">
            <div className="p-4 flex flex-wrap gap-4">
              <div className="flex-1 min-w-64">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search by job ID or creator..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="input-premium w-full pl-10 pr-4 py-2.5"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-slate-500" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="input-premium px-3 py-2.5 text-sm appearance-none cursor-pointer"
                >
                  <option value="">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="computing">Computing</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
            </div>
          </GlassCard>

          {/* Jobs Table */}
          <GlassCard>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-slate-800/50">
                    <th className="px-6 py-3.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Job ID
                    </th>
                    <th className="px-6 py-3.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Proof Type
                    </th>
                    <th className="px-6 py-3.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Creator
                    </th>
                    <th className="px-6 py-3.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Model Hash
                    </th>
                    <th className="px-6 py-3.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/30">
                  {isLoading ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-6 py-12 text-center text-slate-500"
                      >
                        Loading jobs...
                      </td>
                    </tr>
                  ) : filteredJobs.length > 0 ? (
                    filteredJobs.map((job) => (
                      <tr
                        key={job.id}
                        className="hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Link
                            href={`/jobs/${job.id}`}
                            className="text-sm font-medium text-red-400 hover:text-red-300 font-mono transition-colors"
                          >
                            {truncateHash(job.id)}
                          </Link>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <StatusBadge status={job.status} />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                          {job.proofType.replace("PROOF_TYPE_", "")}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Link
                            href={`/address/${job.creator}`}
                            className="text-sm text-red-400 hover:text-red-300 font-mono transition-colors"
                          >
                            {truncateHash(job.creator)}
                          </Link>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400 font-mono">
                          {truncateHash(job.modelHash)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                          {formatDate(job.createdAt)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-6 py-12 text-center text-slate-500"
                      >
                        No jobs found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="px-6 py-3 border-t border-slate-800/30 flex items-center justify-between">
              <div className="text-sm text-slate-500">
                Showing {filteredJobs.length} of {data?.total || 0} jobs
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 border border-slate-700/50 rounded-lg text-sm text-slate-300 disabled:opacity-40 hover:bg-slate-800/50 transition-colors"
                >
                  Previous
                </button>
                <span className="px-4 py-2 text-sm text-slate-400">
                  Page {page}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!data?.jobs || data.jobs.length < 20}
                  className="px-4 py-2 border border-slate-700/50 rounded-lg text-sm text-slate-300 disabled:opacity-40 hover:bg-slate-800/50 transition-colors"
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
