import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BlockchainService } from '../src/services/BlockchainService';

function makeRawValidator(id: number) {
  return {
    operatorAddress: `aethvaloper${id}`,
    description: {
      moniker: `Validator ${id}`,
      identity: '',
      website: '',
      details: '',
    },
    tokens: String(id * 100),
    delegatorShares: String(id * 100),
    commission: {
      commissionRates: {
        rate: '0.0500',
        maxRate: '0.2000',
        maxChangeRate: '0.0100',
      },
    },
    status: 'BOND_STATUS_BONDED',
    jailed: false,
    unbondingHeight: 0,
    unbondingTime: new Date(0),
  };
}

function installValidatorQueryClient(
  service: BlockchainService,
  validators: ReturnType<typeof vi.fn>,
) {
  Object.assign(service as unknown as { queryClient: unknown }, {
    queryClient: {
      staking: {
        validators,
      },
    },
  });
}

function makeRawTransaction(id: number) {
  return {
    hash: Uint8Array.from([id]),
    height: 100,
    index: id,
    txResult: {
      gasUsed: 10,
      gasWanted: 20,
      code: 0,
      log: '',
    },
  };
}

function installTmClient(
  service: BlockchainService,
  txSearch: ReturnType<typeof vi.fn>,
) {
  Object.assign(service as unknown as { tmClient: unknown }, {
    tmClient: {
      txSearch,
    },
  });
}

describe('BlockchainService', () => {
  it('walks validator pagination keys before applying offsets', async () => {
    const service = new BlockchainService();
    const validators = vi
      .fn()
      .mockResolvedValueOnce({
        validators: [makeRawValidator(1), makeRawValidator(2)],
        pagination: { nextKey: Uint8Array.from([9]) },
      })
      .mockResolvedValueOnce({
        validators: [makeRawValidator(3)],
        pagination: { nextKey: new Uint8Array() },
      });
    installValidatorQueryClient(service, validators);

    const result = await service.getValidators({
      limit: 2,
      offset: 1,
      status: 'BOND_STATUS_BONDED',
    });

    expect(result.data.map((validator) => validator.address)).toEqual([
      'aethvaloper2',
      'aethvaloper3',
    ]);
    expect(result.pagination).toMatchObject({
      limit: 2,
      offset: 1,
      total: 3,
      hasMore: false,
    });
    expect(validators.mock.calls[0][1]).toEqual(new Uint8Array());
    expect(validators.mock.calls[1][1]).toEqual(Uint8Array.from([9]));
  });

  it('reports more validator pages when the requested slice fills before pagination ends', async () => {
    const service = new BlockchainService();
    const validators = vi.fn().mockResolvedValueOnce({
      validators: [makeRawValidator(1), makeRawValidator(2)],
      pagination: { nextKey: Uint8Array.from([7]) },
    });
    installValidatorQueryClient(service, validators);

    const result = await service.getValidators({
      limit: 1,
      offset: 0,
      status: 'BOND_STATUS_BONDED',
    });

    expect(result.data.map((validator) => validator.address)).toEqual([
      'aethvaloper1',
    ]);
    expect(result.pagination.hasMore).toBe(true);
  });

  it('honors transaction offsets inside Tendermint search pages', async () => {
    const service = new BlockchainService();
    const txSearch = vi
      .fn()
      .mockResolvedValueOnce({
        totalCount: 4,
        txs: [makeRawTransaction(1), makeRawTransaction(2)],
      })
      .mockResolvedValueOnce({
        totalCount: 4,
        txs: [makeRawTransaction(3), makeRawTransaction(4)],
      });
    installTmClient(service, txSearch);

    const result = await service.getBlockTransactions(100, {
      limit: 2,
      offset: 1,
    });

    expect(result.data.map((transaction) => transaction.hash)).toEqual([
      '02',
      '03',
    ]);
    expect(result.pagination).toMatchObject({
      limit: 2,
      offset: 1,
      total: 4,
      hasMore: true,
    });
    expect(txSearch.mock.calls[0][0]).toMatchObject({
      query: 'tx.height=100',
      per_page: 2,
      page: 1,
    });
    expect(txSearch.mock.calls[1][0]).toMatchObject({
      query: 'tx.height=100',
      per_page: 2,
      page: 2,
    });
  });
});
