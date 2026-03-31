/**
 * Aethelred Dashboard - Models Registry Page
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
    MEDICAL: "bg-red-100 text-red-800",
    SCIENTIFIC: "bg-blue-100 text-blue-800",
    FINANCIAL: "bg-green-100 text-green-800",
    LEGAL: "bg-purple-100 text-purple-800",
    EDUCATIONAL: "bg-yellow-100 text-yellow-800",
    ENVIRONMENTAL: "bg-teal-100 text-teal-800",
    GENERAL: "bg-gray-100 text-gray-800",
  };

  const normalizedCategory = category.replace("UTILITY_CATEGORY_", "");
  const color =
    categoryColors[normalizedCategory] || "bg-gray-100 text-gray-800";

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${color}`}>
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
                Model Registry
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
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <Box className="w-8 h-8 text-indigo-600" />
              <div>
                <p className="text-sm text-gray-500">Total Models</p>
                <p className="text-2xl font-bold">{data?.total || 0}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-8 h-8 text-green-600" />
              <div>
                <p className="text-sm text-gray-500">Verified Models</p>
                <p className="text-2xl font-bold">
                  {data?.models?.filter((m) => m.verified).length || 0}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <Activity className="w-8 h-8 text-blue-600" />
              <div>
                <p className="text-sm text-gray-500">Total Jobs Run</p>
                <p className="text-2xl font-bold">
                  {data?.models
                    ?.reduce((sum, m) => sum + m.totalJobs, 0)
                    .toLocaleString() || 0}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <FileCode className="w-8 h-8 text-purple-600" />
              <div>
                <p className="text-sm text-gray-500">Architectures</p>
                <p className="text-2xl font-bold">
                  {new Set(data?.models?.map((m) => m.architecture) || []).size}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex-1 min-w-64">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name or hash..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Category:</span>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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
        </div>

        {/* Models Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading ? (
            <div className="col-span-full text-center py-12 text-gray-500">
              Loading models...
            </div>
          ) : filteredModels.length > 0 ? (
            filteredModels.map((model) => (
              <Link
                key={model.modelHash}
                href={`/models/${model.modelHash}`}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Box className="w-6 h-6 text-indigo-600" />
                    {model.verified && (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    )}
                  </div>
                  <CategoryBadge category={model.category} />
                </div>

                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  {model.name}
                </h3>
                <p className="text-xs text-gray-500 font-mono mb-3">
                  {truncateHash(model.modelHash)}
                </p>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Architecture:</span>
                    <span className="text-gray-700">{model.architecture}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Version:</span>
                    <span className="text-gray-700">{model.version}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total Jobs:</span>
                    <span className="text-gray-700 font-semibold">
                      {model.totalJobs.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-xs text-gray-500">
                    Registered {formatDate(model.registeredAt)}
                  </span>
                  <span className="text-xs text-indigo-600 hover:text-indigo-700">
                    View details →
                  </span>
                </div>
              </Link>
            ))
          ) : (
            <div className="col-span-full text-center py-12 text-gray-500">
              No models found
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
