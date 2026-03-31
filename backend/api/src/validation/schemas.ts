/**
 * API Validation Schemas using Zod
 *
 * Production-grade input validation for all endpoints.
 * Every user-controlled parameter is validated with strict types,
 * length bounds, format checks, and whitelist constraints.
 */

import { z } from 'zod';

// =============================================================================
// PRIMITIVE SCHEMAS
// =============================================================================

/**
 * Block height: must be a positive integer (>= 1).
 * Accepts either a numeric string from URL params or a plain number.
 */
export const BlockHeightSchema = z
  .string()
  .or(z.number())
  .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
  .refine((val) => Number.isInteger(val) && val >= 1, {
    message: 'Block height must be a positive integer (>= 1)',
  });

/**
 * Transaction hash: exactly 64 lower-case hex characters.
 */
export const TxHashSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-f0-9]{64}$/, 'Transaction hash must be exactly 64 hex characters');

/**
 * Job ID: UUID v4 format or a short alphanumeric ID (max 64 chars).
 * We accept both formats because the indexer may generate either.
 */
export const JobIdSchema = z
  .string()
  .trim()
  .min(1, 'Job ID is required')
  .max(64, 'Job ID too long')
  .regex(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$|^[a-zA-Z0-9_-]{1,64}$/,
    'Job ID must be a valid UUID v4 or alphanumeric identifier',
  );

/**
 * Ethereum address: 0x prefix followed by exactly 40 hex characters.
 */
export const EthAddressSchema = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid Ethereum address (0x + 40 hex chars)');

/**
 * Cosmos-style bech32 address (the Aethelred chain uses these for validators).
 */
export const AddressSchema = z
  .string()
  .trim()
  .min(1, 'Address is required')
  .max(64, 'Address too long')
  .regex(/^[a-z0-9]+$/, 'Invalid address format');

/**
 * Generic hex hash (variable length, used for model hashes, etc.).
 */
export const HashSchema = z
  .string()
  .trim()
  .min(1, 'Hash is required')
  .max(128, 'Hash too long')
  .regex(/^[a-fA-F0-9]+$/, 'Hash must be hexadecimal');

/**
 * Positive integer from a query/path parameter.
 */
export const PositiveIntegerSchema = z
  .string()
  .or(z.number())
  .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
  .refine((val) => Number.isInteger(val) && val >= 0, 'Must be a non-negative integer');

// =============================================================================
// PAGINATION & SORTING
// =============================================================================

/** Whitelist of fields that are valid sort targets. */
const ALLOWED_SORT_FIELDS = [
  'created_at',
  'updated_at',
  'height',
  'block_height',
  'priority',
  'status',
  'amount',
  'timestamp',
  'verification_score',
  'actual_cost',
] as const;

const ALLOWED_SORT_ORDERS = ['asc', 'desc'] as const;

/**
 * Sort parameter: "field:order" where both parts are whitelisted.
 */
export const SortParamSchema = z
  .string()
  .trim()
  .default('created_at:desc')
  .refine(
    (val) => {
      const parts = val.split(':');
      if (parts.length !== 2) return false;
      const [field, order] = parts;
      return (
        (ALLOWED_SORT_FIELDS as readonly string[]).includes(field) &&
        (ALLOWED_SORT_ORDERS as readonly string[]).includes(order)
      );
    },
    {
      message: `Sort must be "field:order" where field is one of [${ALLOWED_SORT_FIELDS.join(', ')}] and order is asc|desc`,
    },
  );

/**
 * Standard pagination: limit (1-100, default 50), offset (>= 0, default 0).
 */
export const PaginationSchema = z.object({
  limit: z
    .string()
    .or(z.number())
    .default('50')
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => Number.isInteger(val) && val >= 1 && val <= 100, {
      message: 'Limit must be an integer between 1 and 100',
    }),
  offset: z
    .string()
    .or(z.number())
    .default('0')
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => Number.isInteger(val) && val >= 0, {
      message: 'Offset must be a non-negative integer',
    }),
});

/**
 * Page-based pagination (kept for backward-compat).
 */
export const PagePaginationSchema = z.object({
  page: z
    .string()
    .or(z.number())
    .default('1')
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => val >= 1, 'Page must be at least 1'),
  limit: z
    .string()
    .or(z.number())
    .default('50')
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => val >= 1 && val <= 100, 'Limit must be between 1 and 100'),
});

// =============================================================================
// BLOCK SCHEMAS
// =============================================================================

export const GetBlockParamsSchema = z.object({
  height: BlockHeightSchema,
});

export const ListBlocksQuerySchema = PaginationSchema.extend({
  height: BlockHeightSchema.optional(),
  start_height: PositiveIntegerSchema.optional(),
  end_height: PositiveIntegerSchema.optional(),
  proposer: AddressSchema.optional(),
});

// =============================================================================
// TRANSACTION SCHEMAS
// =============================================================================

export const GetTransactionParamsSchema = z.object({
  hash: TxHashSchema,
});

export const ListTransactionsQuerySchema = PaginationSchema.extend({
  block_height: PositiveIntegerSchema.optional(),
  sender: AddressSchema.optional(),
  recipient: AddressSchema.optional(),
  tx_type: z
    .enum(['transfer', 'stake', 'unstake', 'submit_job', 'vote', 'claim'])
    .optional(),
  min_amount: z.string().regex(/^\d+(\.\d+)?$/, 'Invalid amount format').optional(),
  max_amount: z.string().regex(/^\d+(\.\d+)?$/, 'Invalid amount format').optional(),
});

export const SubmitTransactionBodySchema = z.object({
  sender: AddressSchema,
  recipient: AddressSchema,
  amount: z
    .string()
    .refine((val) => !isNaN(parseFloat(val)), 'Invalid amount')
    .refine((val) => parseFloat(val) > 0, 'Amount must be positive'),
  denom: z.string().min(1).max(20),
  memo: z.string().max(256).optional(),
  gas_limit: z.number().int().min(1).max(10_000_000).default(200_000),
});

// =============================================================================
// VALIDATOR SCHEMAS
// =============================================================================

export const GetValidatorParamsSchema = z.object({
  address: AddressSchema,
});

export const ListValidatorsQuerySchema = PaginationSchema.extend({
  status: z.enum(['active', 'inactive', 'jailed']).optional(),
  min_voting_power: PositiveIntegerSchema.optional(),
});

export const DelegateBodySchema = z.object({
  delegator: AddressSchema,
  validator: AddressSchema,
  amount: z
    .string()
    .refine((val) => !isNaN(parseFloat(val)), 'Invalid amount')
    .refine((val) => parseFloat(val) > 0, 'Amount must be positive'),
});

// =============================================================================
// AI JOB SCHEMAS
// =============================================================================

export const GetJobParamsSchema = z.object({
  id: JobIdSchema,
});

export const ListJobsQuerySchema = PaginationSchema.extend({
  status: z
    .enum([
      'pending',
      'assigned',
      'computing',
      'completed',
      'verified',
      'failed',
      'expired',
      'cancelled',
    ])
    .optional(),
  creator: AddressSchema.optional(),
  validator: AddressSchema.optional(),
  model_hash: HashSchema.optional(),
  sort: SortParamSchema.optional(),
});

export const SubmitJobBodySchema = z.object({
  model_hash: HashSchema,
  input_hash: HashSchema,
  proof_type: z.enum(['tee_attestation', 'zk_proof', 'mpc_proof', 'optimistic']),
  priority: z.number().int().min(0).max(100).default(50),
  timeout: z.number().int().min(100).max(10_000),
  max_payment: z
    .string()
    .refine((val) => !isNaN(parseFloat(val)), 'Invalid payment amount')
    .refine((val) => parseFloat(val) >= 1000, 'Payment too small'),
});

export const AssignJobBodySchema = z.object({
  job_id: JobIdSchema,
  validator_address: AddressSchema,
});

// =============================================================================
// STAKING SCHEMAS
// =============================================================================

export const StakeBodySchema = z.object({
  amount: z
    .string()
    .refine((val) => !isNaN(parseFloat(val)), 'Invalid amount')
    .refine((val) => parseFloat(val) >= 1_000_000, 'Amount below minimum stake'),
  validator: AddressSchema.optional(),
});

export const UnstakeBodySchema = z.object({
  amount: z
    .string()
    .refine((val) => !isNaN(parseFloat(val)), 'Invalid amount')
    .refine((val) => parseFloat(val) > 0, 'Amount must be positive'),
});

export const ClaimRewardsBodySchema = z.object({
  validator: AddressSchema.optional(),
});

// =============================================================================
// GOVERNANCE SCHEMAS
// =============================================================================

export const GetProposalParamsSchema = z.object({
  proposal_id: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => val > 0, 'Invalid proposal ID'),
});

export const ListProposalsQuerySchema = PaginationSchema.extend({
  status: z.enum(['pending', 'active', 'passed', 'rejected', 'failed']).optional(),
  proposer: AddressSchema.optional(),
});

export const SubmitProposalBodySchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().min(1).max(10_000),
  deposit: z
    .string()
    .refine((val) => !isNaN(parseFloat(val)), 'Invalid deposit')
    .refine((val) => parseFloat(val) >= 1_000_000, 'Deposit below minimum'),
});

export const VoteBodySchema = z.object({
  proposal_id: z.number().int().positive(),
  option: z.enum(['yes', 'no', 'abstain', 'no_with_veto']),
});

// =============================================================================
// RECONCILIATION SCHEMAS
// =============================================================================

export const ReconciliationLiveQuerySchema = z.object({
  validator_limit: z
    .string()
    .or(z.number())
    .default('200')
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => Number.isInteger(val) && val >= 1 && val <= 500, {
      message: 'validator_limit must be an integer between 1 and 500',
    }),
});

// =============================================================================
// AUTH SCHEMAS
// =============================================================================

export const LoginBodySchema = z.object({
  address: AddressSchema,
  signature: z.string().min(1).max(256),
  message: z.string().min(1).max(256),
});

export const RefreshTokenBodySchema = z.object({
  refresh_token: z.string().min(1),
});

// =============================================================================
// EVM / INDEXER-SPECIFIC SCHEMAS
// =============================================================================

export const EthTxHashSchema = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Must be a valid Ethereum transaction hash (0x + 64 hex chars)');

export const BlockNumberOrTagSchema = z
  .string()
  .trim()
  .refine(
    (val) =>
      /^\d+$/.test(val) ||
      ['latest', 'earliest', 'pending', 'finalized', 'safe'].includes(val),
    'Must be a block number or one of: latest, earliest, pending, finalized, safe',
  );

// =============================================================================
// STABLECOIN BRIDGE SCHEMAS
// =============================================================================

/** bytes32 asset identifier: 0x prefix + 64 hex chars */
export const AssetIdSchema = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Must be a valid bytes32 asset ID (0x + 64 hex chars)');

/** Allowed bridge event type values */
export const BridgeEventTypeEnum = z.enum([
  'StablecoinConfigured',
  'CCTPBurnInitiated',
  'CCTPMessageRelayed',
  'CCTPFastMessageRelayed',
  'MintExecuted',
  'CircuitBreakerTriggered',
  'ReserveCheckPerformed',
  'TeeRedemptionRequested',
  'MerkleAuditRootRecorded',
]);

export const GetStablecoinParamsSchema = z.object({
  assetId: AssetIdSchema,
});

export const ListBridgeEventsQuerySchema = PaginationSchema.extend({
  event_type: BridgeEventTypeEnum.optional(),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type GetBlockParams = z.infer<typeof GetBlockParamsSchema>;
export type ListBlocksQuery = z.infer<typeof ListBlocksQuerySchema>;
export type GetTransactionParams = z.infer<typeof GetTransactionParamsSchema>;
export type ListTransactionsQuery = z.infer<typeof ListTransactionsQuerySchema>;
export type SubmitTransactionBody = z.infer<typeof SubmitTransactionBodySchema>;
export type GetValidatorParams = z.infer<typeof GetValidatorParamsSchema>;
export type ListValidatorsQuery = z.infer<typeof ListValidatorsQuerySchema>;
export type GetJobParams = z.infer<typeof GetJobParamsSchema>;
export type ListJobsQuery = z.infer<typeof ListJobsQuerySchema>;
export type SubmitJobBody = z.infer<typeof SubmitJobBodySchema>;
export type ReconciliationLiveQuery = z.infer<typeof ReconciliationLiveQuerySchema>;
export type GetStablecoinParams = z.infer<typeof GetStablecoinParamsSchema>;
export type ListBridgeEventsQuery = z.infer<typeof ListBridgeEventsQuerySchema>;
export type BridgeEventType = z.infer<typeof BridgeEventTypeEnum>;
