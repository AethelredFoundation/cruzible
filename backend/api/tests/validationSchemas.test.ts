import { describe, expect, it } from 'vitest';
import {
  BlockHeightSchema,
  GetProposalParamsSchema,
  ListTransactionsQuerySchema,
  PaginationSchema,
  ReconciliationLiveQuerySchema,
  StakeBodySchema,
  SubmitJobBodySchema,
  SubmitTransactionBodySchema,
} from '../src/validation/schemas';

describe('validation schemas', () => {
  it('rejects partially parsed integer parameters', () => {
    expect(BlockHeightSchema.safeParse('123').data).toBe(123);
    expect(BlockHeightSchema.safeParse('123abc').success).toBe(false);
    expect(BlockHeightSchema.safeParse('1.5').success).toBe(false);

    expect(
      PaginationSchema.safeParse({ limit: '25', offset: '10' }).data,
    ).toEqual({ limit: 25, offset: 10 });
    expect(
      PaginationSchema.safeParse({ limit: '25x', offset: '0' }).success,
    ).toBe(false);
  });

  it('rejects partially parsed governance and reconciliation integers', () => {
    expect(
      GetProposalParamsSchema.safeParse({ proposal_id: '42' }).data
        ?.proposal_id,
    ).toBe(42);
    expect(
      GetProposalParamsSchema.safeParse({ proposal_id: '42abc' }).success,
    ).toBe(false);
    expect(
      ReconciliationLiveQuerySchema.safeParse({ validator_limit: '500x' })
        .success,
    ).toBe(false);
  });

  it('rejects partially parsed decimal amounts', () => {
    expect(
      SubmitTransactionBodySchema.safeParse({
        sender: 'aeth1sender',
        recipient: 'aeth1recipient',
        amount: '1.25',
        denom: 'aeth',
      }).success,
    ).toBe(true);
    expect(
      SubmitTransactionBodySchema.safeParse({
        sender: 'aeth1sender',
        recipient: 'aeth1recipient',
        amount: '1abc',
        denom: 'aeth',
      }).success,
    ).toBe(false);
    expect(StakeBodySchema.safeParse({ amount: '1000000abc' }).success).toBe(
      false,
    );
    expect(
      SubmitJobBodySchema.safeParse({
        model_hash: 'abcdef',
        input_hash: '123456',
        proof_type: 'zk_proof',
        timeout: 100,
        max_payment: '1000abc',
      }).success,
    ).toBe(false);
  });

  it('bounds transaction amount filters', () => {
    expect(
      ListTransactionsQuerySchema.safeParse({
        min_amount: '1abc',
        max_amount: '2',
      }).success,
    ).toBe(false);
    expect(
      ListTransactionsQuerySchema.safeParse({
        min_amount: '1',
        max_amount: '9'.repeat(81),
      }).success,
    ).toBe(false);
  });
});
