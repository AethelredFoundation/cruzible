/**
 * API Client
 * Type-safe API client with automatic error handling and caching
 */

import { BRAND } from "./constants";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/v1";

// =============================================================================
// TYPES
// =============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    has_more: boolean;
  };
}

export interface ApiError {
  success: false;
  error: string;
  message: string;
  details?: Record<string, string[]>;
}

// =============================================================================
// BLOCKS
// =============================================================================

export interface Block {
  height: number;
  hash: string;
  timestamp: string;
  proposer: string;
  num_txs: number;
  gas_used: number;
  gas_limit: number;
  transactions?: Transaction[];
}

export async function getBlocks(
  page = 1,
  limit = 50,
): Promise<ApiResponse<Block[]>> {
  return fetchApi(`/blocks?page=${page}&limit=${limit}`);
}

export async function getBlock(height: number): Promise<ApiResponse<Block>> {
  return fetchApi(`/blocks/${height}`);
}

export async function getLatestBlock(): Promise<ApiResponse<Block>> {
  return fetchApi("/blocks/latest");
}

// =============================================================================
// TRANSACTIONS
// =============================================================================

export interface Transaction {
  hash: string;
  block_height: number;
  sender: string;
  recipient: string;
  amount: string;
  denom: string;
  gas_used: number;
  gas_wanted: number;
  status: "success" | "failed" | "pending";
  timestamp: string;
  type: string;
  memo?: string;
}

export async function getTransactions(
  params: {
    page?: number;
    limit?: number;
    sender?: string;
    recipient?: string;
    block_height?: number;
    tx_type?: string;
  } = {},
): Promise<ApiResponse<Transaction[]>> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", params.page.toString());
  if (params.limit) query.set("limit", params.limit.toString());
  if (params.sender) query.set("sender", params.sender);
  if (params.recipient) query.set("recipient", params.recipient);
  if (params.block_height)
    query.set("block_height", params.block_height.toString());
  if (params.tx_type) query.set("tx_type", params.tx_type);

  return fetchApi(`/transactions?${query.toString()}`);
}

export async function getTransaction(
  hash: string,
): Promise<ApiResponse<Transaction>> {
  return fetchApi(`/transactions/${hash}`);
}

// =============================================================================
// VALIDATORS
// =============================================================================

export interface Validator {
  address: string;
  moniker: string;
  status: "active" | "inactive" | "jailed";
  voting_power: number;
  commission: number;
  uptime: number;
  total_staked: string;
  delegators?: number;
  website?: string;
  description?: string;
}

export async function getValidators(
  params: {
    page?: number;
    limit?: number;
    status?: string;
  } = {},
): Promise<ApiResponse<Validator[]>> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", params.page.toString());
  if (params.limit) query.set("limit", params.limit.toString());
  if (params.status) query.set("status", params.status);

  return fetchApi(`/validators?${query.toString()}`);
}

export async function getValidator(
  address: string,
): Promise<ApiResponse<Validator>> {
  return fetchApi(`/validators/${address}`);
}

// =============================================================================
// AI JOBS
// =============================================================================

export interface AIJob {
  id: string;
  creator: string;
  validator?: string;
  status:
    | "pending"
    | "assigned"
    | "computing"
    | "completed"
    | "verified"
    | "failed"
    | "expired";
  model_hash: string;
  input_hash: string;
  output_hash?: string;
  max_payment: string;
  actual_payment?: string;
  created_at: string;
  completed_at?: string;
  verification_score?: number;
}

export async function getJobs(
  params: {
    page?: number;
    limit?: number;
    status?: string;
    creator?: string;
    validator?: string;
  } = {},
): Promise<ApiResponse<AIJob[]>> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", params.page.toString());
  if (params.limit) query.set("limit", params.limit.toString());
  if (params.status) query.set("status", params.status);
  if (params.creator) query.set("creator", params.creator);
  if (params.validator) query.set("validator", params.validator);

  return fetchApi(`/jobs?${query.toString()}`);
}

export async function getJob(id: string): Promise<ApiResponse<AIJob>> {
  return fetchApi(`/jobs/${id}`);
}

export async function submitJob(jobData: {
  model_hash: string;
  input_hash: string;
  proof_type: string;
  priority: number;
  timeout: number;
  max_payment: string;
}): Promise<ApiResponse<AIJob>> {
  return fetchApi("/jobs", {
    method: "POST",
    body: JSON.stringify(jobData),
  });
}

// =============================================================================
// STAKING
// =============================================================================

export interface StakingInfo {
  address: string;
  staked_amount: string;
  rewards: string;
  unbonding: string;
  validators: Array<{
    address: string;
    amount: string;
  }>;
}

export async function getStakingInfo(
  address: string,
): Promise<ApiResponse<StakingInfo>> {
  return fetchApi(`/staking/${address}`);
}

export async function getStakingValidators(): Promise<
  ApiResponse<{ validators: Validator[] }>
> {
  return fetchApi("/staking/validators");
}

// =============================================================================
// NETWORK STATS
// =============================================================================

export interface NetworkStats {
  block_height: number;
  total_transactions: number;
  total_validators: number;
  active_validators: number;
  total_staked: string;
  inflation_rate: number;
  community_pool: string;
  gas_price: string;
}

export async function getNetworkStats(): Promise<ApiResponse<NetworkStats>> {
  return fetchApi("/network/stats");
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const url = `${API_BASE_URL}${endpoint}`;

  const defaultOptions: RequestInit = {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Client-Name": BRAND.NAME,
      "X-Client-Version": process.env.NEXT_PUBLIC_APP_VERSION || "1.0.0",
    },
  };

  // Add auth token if available
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("auth_token");
    if (token) {
      defaultOptions.headers = {
        ...defaultOptions.headers,
        Authorization: `Bearer ${token}`,
      };
    }
  }

  try {
    const response = await fetch(url, {
      ...defaultOptions,
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiClientError(
        data.message || "API request failed",
        response.status,
        data,
      );
    }

    return data;
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error;
    }

    throw new ApiClientError(
      "Network error. Please check your connection.",
      0,
      { error: "network_error" },
    );
  }
}

class ApiClientError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public data: any,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

// =============================================================================
// REACT QUERY HOOKS (Optional)
// =============================================================================

import { useQuery, useMutation, UseQueryOptions } from "@tanstack/react-query";

export function useBlocks(
  page = 1,
  limit = 50,
  options?: UseQueryOptions<Block[]>,
) {
  return useQuery({
    queryKey: ["blocks", page, limit],
    queryFn: () => getBlocks(page, limit).then((r) => r.data),
    ...options,
  });
}

export function useBlock(height: number, options?: UseQueryOptions<Block>) {
  return useQuery({
    queryKey: ["block", height],
    queryFn: () => getBlock(height).then((r) => r.data),
    enabled: !!height,
    ...options,
  });
}

export function useValidators(
  params: { page?: number; limit?: number; status?: string } = {},
  options?: UseQueryOptions<Validator[]>,
) {
  return useQuery({
    queryKey: ["validators", params],
    queryFn: () => getValidators(params).then((r) => r.data),
    ...options,
  });
}

export function useNetworkStats(options?: UseQueryOptions<NetworkStats>) {
  return useQuery({
    queryKey: ["network-stats"],
    queryFn: () => getNetworkStats().then((r) => r.data),
    refetchInterval: 30000, // Refetch every 30 seconds
    ...options,
  });
}
