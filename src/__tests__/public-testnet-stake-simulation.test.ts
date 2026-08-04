import { describe, expect, it, vi } from "vitest";
import { simulatePublicTestnetStake } from "../../scripts/simulate-public-testnet-stake.mjs";

const address = (digit: string) => `0x${digit.repeat(40)}`;
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const cruzible = address("1");
const stAethel = address("2");
const staker = address("3");
const genesisHash = hash("a");

function client(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    stAethel,
    vault: cruzible,
    getExchangeRate: 10n ** 18n,
    unbondingPeriod: 3600n,
    depositsPaused: false,
    uncoveredDeficit: 0n,
    identityRequired: false,
    complianceRequired: false,
    ...overrides,
  };

  return {
    getChainId: vi.fn().mockResolvedValue(7332),
    getBlock: vi.fn().mockResolvedValue({ number: 1n, hash: genesisHash }),
    getBytecode: vi.fn().mockResolvedValue("0x6000"),
    getBalance: vi.fn().mockResolvedValue(2n * 10n ** 18n),
    readContract: vi
      .fn()
      .mockImplementation(({ functionName }: { functionName: string }) =>
        Promise.resolve(values[functionName]),
      ),
    simulateContract: vi.fn().mockResolvedValue({ result: 10n ** 18n - 1000n }),
  };
}

function input(publicClient = client()) {
  return {
    publicClient,
    cruzibleAddress: cruzible,
    stAethelAddress: stAethel,
    expectedGenesisHash: genesisHash,
    testStakerAddress: staker,
    cruzibleAbi: [],
    stAethelAbi: [],
  };
}

describe("public-testnet candidate stake simulation", () => {
  it("proves current wiring and stakeWithMinShares without broadcasting", async () => {
    const publicClient = client();

    await expect(
      simulatePublicTestnetStake(input(publicClient)),
    ).resolves.toMatchObject({
      chainId: 7332,
      exchangeRate: 10n ** 18n,
      unbondingPeriod: 3600n,
      stakeAmountWei: 10n ** 18n,
    });
    expect(publicClient.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: cruzible,
        functionName: "stakeWithMinShares",
        account: staker,
        value: 10n ** 18n,
      }),
    );
  });

  it("rejects a stale or incompatible candidate before wallet signing", async () => {
    const publicClient = client();
    publicClient.simulateContract.mockRejectedValue(
      new Error("execution reverted"),
    );

    await expect(
      simulatePublicTestnetStake(input(publicClient)),
    ).rejects.toThrow("execution reverted");
  });

  it("requires admission gates to be off for the initial plain-stake gate", async () => {
    const publicClient = client({ identityRequired: true });

    await expect(
      simulatePublicTestnetStake(input(publicClient)),
    ).rejects.toThrow("admission gates to be disabled");
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
  });

  it("rejects a mismatched vault/token pair", async () => {
    const publicClient = client({ stAethel: address("9") });

    await expect(
      simulatePublicTestnetStake(input(publicClient)),
    ).rejects.toThrow("vault stAETHEL wiring");
    expect(publicClient.simulateContract).not.toHaveBeenCalled();
  });
});
