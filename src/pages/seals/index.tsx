/**
 * Aethelred Dashboard - Seals Explorer Page
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Filter,
  RefreshCw,
  Shield,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";
import Link from "next/link";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "https://api.mainnet.aethelred.org";

interface Seal {
  id: string;
  jobId: string;
  status: string;
  modelCommitment: string;
  inputCommitment: string;
  outputCommitment: string;
  requester: string;
  validatorCount: number;
  createdAt: string;
  expiresAt: string | null;
}

async function fetchSeals(
  page: number,
  status?: string,
): Promise<{ seals: Seal[]; total: number }> {
  const params = new URLSearchParams({
    limit: "20",
    offset: String((page - 1) * 20),
    sort: "created_at:desc",
  });
  if (status) params.set("status", status);

  const response = await fetch(`${API_URL}/v1/seals?${params}`);
  if (!response.ok) throw new Error("Failed to fetch seals");
  return response.json();
}

function StatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { color: string; icon: React.ReactNode }> =
    {
      active: {
        color: "bg-green-100 text-green-800",
        icon: <CheckCircle className="w-3 h-3" />,
      },
      revoked: {
        color: "bg-red-100 text-red-800",
        icon: <XCircle className="w-3 h-3" />,
      },
      expired: {
        color: "bg-gray-100 text-gray-800",
        icon: <Clock className="w-3 h-3" />,
      },
      superseded: {
        color: "bg-yellow-100 text-yellow-800",
        icon: <Shield className="w-3 h-3" />,
      },
    };

  const normalizedStatus = status.toLowerCase().replace("seal_status_", "");
  const config = statusConfig[normalizedStatus] || {
    color: "bg-gray-100 text-gray-800",
    icon: null,
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${config.color}`}
    >
      {config.icon}
      {normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1)}
    </span>
  );
}

export default function SealsPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["seals", page, statusFilter],
    queryFn: () => fetchSeals(page, statusFilter),
  });

  const truncateHash = (hash: string) => {
    if (!hash || hash.length <= 16) return hash || "-";
    return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const filteredSeals =
    data?.seals?.filter(
      (seal) =>
        !searchQuery ||
        seal.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        seal.jobId.toLowerCase().includes(searchQuery.toLowerCase()),
    ) || [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <Link href="/" className="text-indigo-600 hover:text-indigo-700">
                ← Back
              </Link>
              <h1 className="text-xl font-bold text-gray-900">
                Digital Seals Explorer
              </h1>
            </div>
            <button
              onClick={() => refetch()}
              className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex flex-wrap gap-4">
            {/* Search */}
            <div className="flex-1 min-w-64">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by seal ID or job ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-gray-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="revoked">Revoked</option>
                <option value="expired">Expired</option>
                <option value="superseded">Superseded</option>
              </select>
            </div>
          </div>
        </div>

        {/* Seals Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading ? (
            <div className="col-span-full text-center py-12 text-gray-500">
              Loading seals...
            </div>
          ) : filteredSeals.length > 0 ? (
            filteredSeals.map((seal) => (
              <Link
                key={seal.id}
                href={`/seals/${seal.id}`}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <Shield className="w-8 h-8 text-indigo-600" />
                  <StatusBadge status={seal.status} />
                </div>

                <h3 className="text-sm font-medium text-gray-900 font-mono mb-2">
                  {truncateHash(seal.id)}
                </h3>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Job:</span>
                    <span className="font-mono text-gray-700">
                      {truncateHash(seal.jobId)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Validators:</span>
                    <span className="text-gray-700">{seal.validatorCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Created:</span>
                    <span className="text-gray-700">
                      {new Date(seal.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="text-xs text-gray-500">
                    <div className="mb-1">
                      Model: {truncateHash(seal.modelCommitment)}
                    </div>
                    <div>Output: {truncateHash(seal.outputCommitment)}</div>
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className="col-span-full text-center py-12 text-gray-500">
              No seals found
            </div>
          )}
        </div>

        {/* Pagination */}
        <div className="mt-6 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Showing {filteredSeals.length} of {data?.total || 0} seals
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50 hover:bg-gray-50"
            >
              Previous
            </button>
            <span className="px-4 py-2 text-sm text-gray-600">Page {page}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!data?.seals || data.seals.length < 20}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
