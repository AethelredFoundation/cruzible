import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockStablecoinUpdate = vi.fn();
const mockStablecoinUpsert = vi.fn();
const mockFindUnique = vi.fn();

const mockContractInstance = {
  stablecoins: vi.fn(),
  epochUsage: vi.fn(),
};

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    stablecoinConfig: {
      update: mockStablecoinUpdate,
      upsert: mockStablecoinUpsert,
      findUnique: mockFindUnique,
    },
  })),
}));

vi.mock('../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('ethers', async () => {
  const actual = await vi.importActual<typeof import('ethers')>('ethers');

  return {
    ...actual,
    Contract: vi.fn().mockImplementation(() => mockContractInstance),
  };
});

describe('IndexerService.refreshStablecoinConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('materializes stablecoin config from the real bridge getter tuple shape', async () => {
    const { IndexerService } = await import('../src/services/IndexerService');

    const service = new IndexerService({} as any);
    (service as any).cfg.stablecoinBridgeAddress =
      '0x1234567890123456789012345678901234567890';
    (service as any).httpProvider = {};

    mockContractInstance.stablecoins.mockResolvedValue([
      true, // enabled
      false, // mintPaused
      1, // routingType (CCTP_V2)
      '0xAABBCCDDEEFF0011223344556677889900AABBCC', // token
      '0x1111111111111111111111111111111111111111', // tokenMessengerV2
      '0x2222222222222222222222222222222222222222', // messageTransmitterV2
      '0x3333333333333333333333333333333333333333', // proofOfReserveFeed
      1_000_000_000n, // mintCeilingPerEpoch
      500_000_000n, // dailyTxLimit
      500, // hourlyOutflowBps
      1000, // dailyOutflowBps
      200, // porDeviationBps
      3600, // porHeartbeatSeconds
    ]);

    mockContractInstance.epochUsage.mockResolvedValue([
      42n, // epochId
      100_000_000n, // mintedAmount
      250_000_000n, // txVolume
    ]);

    mockStablecoinUpdate.mockResolvedValue(undefined);

    await (service as any).refreshStablecoinConfig(
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );

    expect(mockContractInstance.stablecoins).toHaveBeenCalledWith(
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );
    expect(mockContractInstance.epochUsage).toHaveBeenCalledWith(
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );
    expect(mockStablecoinUpdate).toHaveBeenCalledWith({
      where: {
        assetId:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      },
      data: {
        tokenAddress: '0xaabbccddeeff0011223344556677889900aabbcc',
        routingType: 1,
        active: true,
        maxBridgeAmount: '1000000000',
        dailyLimit: '500000000',
        dailyUsed: '250000000',
      },
    });
  });
});
