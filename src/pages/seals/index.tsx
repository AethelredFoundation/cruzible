/**
 * Cruzible — Digital Seals Explorer
 *
 * Premium dark-themed page for browsing TEE verification seals.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Filter, RefreshCw, Shield, CheckCircle, XCircle, Clock, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { SEOHead } from '@/components/SEOHead';
import { TopNav, Footer } from '@/components/SharedComponents';
import { GlassCard, SectionHeader } from '@/components/PagePrimitives';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.mainnet.aethelred.org';

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

async function fetchSeals(page: number, status?: string): Promise<{ seals: Seal[]; total: number }> {
  const params = new URLSearchParams({
    limit: '20',
    offset: String((page - 1) * 20),
    sort: 'created_at:desc',
  });
  if (status) params.set('status', status);

  const response = await fetch(`${API_URL}/v1/seals?${params}`);
  if (!response.ok) throw new Error('Failed to fetch seals');
  return response.json();
}

function StatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { classes: string; icon: React.ReactNode }> = {
    active: { classes: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30', icon: <CheckCircle className="w-3 h-3" /> },
    revoked: { classes: 'bg-red-500/15 text-red-400 border border-red-500/30', icon: <XCircle className="w-3 h-3" /> },
    expired: { classes: 'bg-slate-500/15 text-slate-400 border border-slate-500/30', icon: <Clock className="w-3 h-3" /> },
    superseded: { classes: 'bg-amber-500/15 text-amber-400 border border-amber-500/30', icon: <Shield className="w-3 h-3" /> },
  };

  const normalizedStatus = status.toLowerCase().replace('seal_status_', '');
  const config = statusConfig[normalizedStatus] || { classes: 'bg-slate-500/15 text-slate-400 border border-slate-500/30', icon: null };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${config.classes}`}>
      {config.icon}
      {normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1)}
    </span>
  );
}

export default function SealsPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['seals', page, statusFilter],
    queryFn: () => fetchSeals(page, statusFilter),
  });

  const truncateHash = (hash: string) => {
    if (!hash || hash.length <= 16) return hash || '-';
    return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
  };

  const filteredSeals = data?.seals?.filter(seal =>
    !searchQuery ||
    seal.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    seal.jobId.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  return (
    <>
      <SEOHead
        title="Digital Seals | Cruzible by Aethelred"
        description="Explore TEE verification seals on the Aethelred network."
      />

      <div className="min-h-screen bg-[#050810] text-white">
        <TopNav activePage="seals" />

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-500 flex items-center justify-center">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold font-display">Digital Seals</h1>
                <p className="text-sm text-slate-400">TEE verification seals explorer</p>
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
                    placeholder="Search by seal ID or job ID..."
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
                  <option value="active">Active</option>
                  <option value="revoked">Revoked</option>
                  <option value="expired">Expired</option>
                  <option value="superseded">Superseded</option>
                </select>
              </div>
            </div>
          </GlassCard>

          {/* Seals Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {isLoading ? (
              <div className="col-span-full text-center py-12 text-slate-500">
                Loading seals...
              </div>
            ) : filteredSeals.length > 0 ? (
              filteredSeals.map((seal) => (
                <Link
                  key={seal.id}
                  href={`/seals/${seal.id}`}
                  className="glass-card rounded-xl p-6 hover:border-slate-600/50 transition-all duration-300 group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <Shield className="w-8 h-8 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
                    <StatusBadge status={seal.status} />
                  </div>

                  <h3 className="text-sm font-medium text-white font-mono mb-2">
                    {truncateHash(seal.id)}
                  </h3>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Job:</span>
                      <span className="font-mono text-slate-300">{truncateHash(seal.jobId)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Validators:</span>
                      <span className="text-slate-300">{seal.validatorCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Created:</span>
                      <span className="text-slate-300">{new Date(seal.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-800/50">
                    <div className="text-xs text-slate-500">
                      <div className="mb-1">Model: {truncateHash(seal.modelCommitment)}</div>
                      <div>Output: {truncateHash(seal.outputCommitment)}</div>
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="col-span-full text-center py-12 text-slate-500">
                No seals found
              </div>
            )}
          </div>

          {/* Pagination */}
          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm text-slate-500">
              Showing {filteredSeals.length} of {data?.total || 0} seals
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 border border-slate-700/50 rounded-lg text-sm text-slate-300 disabled:opacity-40 hover:bg-slate-800/50 transition-colors"
              >
                Previous
              </button>
              <span className="px-4 py-2 text-sm text-slate-400">Page {page}</span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={!data?.seals || data.seals.length < 20}
                className="px-4 py-2 border border-slate-700/50 rounded-lg text-sm text-slate-300 disabled:opacity-40 hover:bg-slate-800/50 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </>
  );
}
