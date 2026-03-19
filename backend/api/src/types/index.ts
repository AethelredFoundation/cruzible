export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  protocol?: Record<string, unknown>;
}

export interface Block {
  height: number;
  hash: string;
  parentHash: string;
  timestamp: string;
  proposer: string;
  txCount: number;
  gasUsed: number;
  gasLimit: number;
  size: number;
  appHash: string;
}

export interface Transaction {
  hash: string;
  height: number;
  index: number;
  gasUsed: number;
  gasWanted: number;
  code: number;
  log: string;
  timestamp: number | string;
  memo: string;
  messages: unknown[];
}

export interface Validator {
  address: string;
  moniker: string;
  identity: string;
  website: string;
  details: string;
  tokens: string;
  delegatorShares: string;
  commission: {
    rate: string;
    maxRate: string;
    maxChangeRate: string;
  };
  status: string | number;
  jailed: boolean;
  unbondingHeight: number;
  unbondingTime: number;
}

export interface NetworkStats {
  blockHeight: number;
  totalTransactions: number;
  totalAccounts: number;
  totalValidators: number;
  activeValidators: number;
  totalStaked: string;
  inflationRate: number;
  communityPool: string;
}

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
    user?: {
      address: string;
      roles: string[];
      iat: number;
      exp: number;
    };
  }
}
