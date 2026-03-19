/**
 * Cruzible — Model Registry Page
 *
 * Premium dark-themed page for browsing registered AI models.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  RefreshCw,
  Box,
  CheckCircle,
  Clock,
  Activity,
  FileCode,
} from "lucide-react";
import Link from "next/link";
import { SEOHead } from "@/components/SEOHead";
import { TopNav, Footer } from "@/components/SharedComponents";
import { GlassCard } from "@/components/PagePrimitives";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "https://api.mainnet.aethelred.org";

interface Model {
  modelHash: string;
  name: string;
  owner: string;
  architecture: string;
  version: string;
  category: string;
  inputSchema: string;
  outputSchema: string;
  storageUri: string;
  registeredAt: string;
  verified: boolean;
  totalJobs: number;
}

async function fetchModels(): Promise<{ models: Model[]; total: number }> {
  const response = await fetch(`${API_URL}/v1/models?limit=50`);
  if (!response.ok) throw new Error("Failed to fetch models");
  return response.json();
}

function CategoryBadge({ category }: { category: string }) {
  const categoryColors: Record<string, string> = {
    MEDICAL: "bg-red-500/15 text-red-400 border border-red-500/30",
    SCIENTIFIC: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
    FINANCIAL:
      "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
    LEGAL: "bg-purple-500/15 text-purple-400 border border-purple-500/30",
    EDUCATIONAL: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
    ENVIRONMENTAL: "bg-teal-500/15 text-teal-400 border border-teal-500/30",
    GENERAL: "bg-slate-500/15 text-slate-400 border border-slate-500/30",
  };

  const normalizedCategory = category.replace("UTILITY_CATEGORY_", "");
  const color =
    categoryColors[normalizedCategory] ||
    "bg-slate-500/15 text-slate-400 border border-slate-500/30";

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${color}`}>
      {normalizedCategory.charAt(0) + normalizedCategory.slice(1).toLowerCase()}
    </span>
  );
}

export default function ModelsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["models"],
    queryFn: fetchModels,
    refetchInterval: 60000,
  });

  const truncateHash = (hash: string) => {
    if (!hash || hash.length <= 16) return hash || "-";
    return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const categories = [
    "MEDICAL",
    "SCIENTIFIC",
    "FINANCIAL",
    "LEGAL",
    "EDUCATIONAL",
    "ENVIRONMENTAL",
    "GENERAL",
  ];

  const filteredModels =
    data?.models?.filter(
      (model) =>
        (!searchQuery ||
          model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          model.modelHash.toLowerCase().includes(searchQuery.toLowerCase())) &&
        (!categoryFilter || model.category.includes(categoryFilter)),
    ) || [];

  return (
    <>
      <SEOHead
        title="Model Registry | Cruzible by Aethelred"
        description="Browse registered AI models on the Aethelred network."
      />

      <div className="min-h-screen bg-[#050810] text-white">
        <TopNav activePage="models" />

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-purple-500 flex items-center justify-center">
                <Box className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold font-display">
                  Model Registry
                </h1>
                <p className="text-sm text-slate-400">
                  Registered AI models on Aethelred
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

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <GlassCard className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/15 flex items-center justify-center">
                  <Box className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Total Models</p>
                  <p className="text-xl font-bold text-white">
                    {data?.total || 0}
                  </p>
                </div>
              </div>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Verified Models</p>
                  <p className="text-xl font-bold text-white">
                    {data?.models?.filter((m) => m.verified).length || 0}
                  </p>
                </div>
              </div>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/15 flex items-center justify-center">
                  <Activity className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Total Jobs Run</p>
                  <p className="text-xl font-bold text-white">
                    {data?.models
                      ?.reduce((sum, m) => sum + m.totalJobs, 0)
                      .toLocaleString() || 0}
                  </p>
                </div>
              </div>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/15 flex items-center justify-center">
                  <FileCode className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Architectures</p>
                  <p className="text-xl font-bold text-white">
                    {
                      new Set(data?.models?.map((m) => m.architecture) || [])
                        .size
                    }
                  </p>
                </div>
              </div>
            </GlassCard>
          </div>

          {/* Filters */}
          <GlassCard className="mb-6">
            <div className="p-4 flex flex-wrap gap-4 items-center">
              <div className="flex-1 min-w-64">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search by name or hash..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="input-premium w-full pl-10 pr-4 py-2.5"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">Category:</span>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="input-premium px-3 py-2.5 text-sm appearance-none cursor-pointer"
                >
                  <option value="">All Categories</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat.charAt(0) + cat.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </GlassCard>

          {/* Models Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {isLoading ? (
              <div className="col-span-full text-center py-12 text-slate-500">
                Loading models...
              </div>
            ) : filteredModels.length > 0 ? (
              filteredModels.map((model) => (
                <Link
                  key={model.modelHash}
                  href={`/models/${model.modelHash}`}
                  className="glass-card rounded-xl p-6 hover:border-slate-600/50 transition-all duration-300 group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Box className="w-6 h-6 text-purple-400 group-hover:text-purple-300 transition-colors" />
                      {model.verified && (
                        <CheckCircle className="w-5 h-5 text-emerald-400" />
                      )}
                    </div>
                    <CategoryBadge category={model.category} />
                  </div>

                  <h3 className="text-lg font-semibold text-white mb-1">
                    {model.name}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono mb-3">
                    {truncateHash(model.modelHash)}
                  </p>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Architecture:</span>
                      <span className="text-slate-300">
                        {model.architecture}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Version:</span>
                      <span className="text-slate-300">{model.version}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Total Jobs:</span>
                      <span className="text-white font-semibold">
                        {model.totalJobs.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-800/50 flex items-center justify-between">
                    <span className="text-xs text-slate-500">
                      Registered {formatDate(model.registeredAt)}
                    </span>
                    <span className="text-xs text-red-400 group-hover:text-red-300 transition-colors">
                      View details
                    </span>
                  </div>
                </Link>
              ))
            ) : (
              <div className="col-span-full text-center py-12 text-slate-500">
                No models found
              </div>
            )}
          </div>
        </main>

        <Footer />
      </div>
    </>
  );
}
