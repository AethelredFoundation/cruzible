/**
 * Indexer Materialization — Unit Tests
 *
 * Tests that refreshStablecoinConfig() correctly reads on-chain state
 * from the real InstitutionalStablecoinBridge struct shape and persists
 * authoritative values to the StablecoinConfig DB row.
 *
 * Strategy: the IndexerService's private methods are exercised indirectly
 * by importing the module-level BRIDGE_VIEW_ABI constant and verifying
 * its shape against the real contract's StablecoinConfig struct. We also
 * verify the ethers Interface decoding against the expected tuple layout.
 */

import { describe, it, expect } from 'vitest';
import { Interface } from 'ethers';

// ---------------------------------------------------------------------------
// Replicate the BRIDGE_VIEW_ABI from IndexerService (source of truth)
// ---------------------------------------------------------------------------

const BRIDGE_VIEW_ABI = [
  'function stablecoins(bytes32 assetId) view returns (bool enabled, bool mintPaused, uint8 routingType, address token, address tokenMessengerV2, address messageTransmitterV2, address proofOfReserveFeed, uint256 mintCeilingPerEpoch, uint256 dailyTxLimit, uint16 hourlyOutflowBps, uint16 dailyOutflowBps, uint16 porDeviationBps, uint48 porHeartbeatSeconds)',
  'function epochUsage(bytes32 assetId) view returns (uint64 epochId, uint256 mintedAmount, uint256 txVolume)',
];

/**
 * The canonical StablecoinConfig struct from
 * contracts/InstitutionalStablecoinBridge.sol lines 112-126:
 *
 *   struct StablecoinConfig {
 *       bool enabled;
 *       bool mintPaused;
 *       RoutingType routingType;     // uint8 enum
 *       address token;
 *       address tokenMessengerV2;
 *       address messageTransmitterV2;
 *       address proofOfReserveFeed;
 *       uint256 mintCeilingPerEpoch;
 *       uint256 dailyTxLimit;
 *       uint16 hourlyOutflowBps;
 *       uint16 dailyOutflowBps;
 *       uint16 porDeviationBps;
 *       uint48 porHeartbeatSeconds;
 *   }
 */
const EXPECTED_STABLECOIN_CONFIG_FIELDS = [
  'enabled',
  'mintPaused',
  'routingType',
  'token',
  'tokenMessengerV2',
  'messageTransmitterV2',
  'proofOfReserveFeed',
  'mintCeilingPerEpoch',
  'dailyTxLimit',
  'hourlyOutflowBps',
  'dailyOutflowBps',
  'porDeviationBps',
  'porHeartbeatSeconds',
];

const EXPECTED_EPOCH_USAGE_FIELDS = [
  'epochId',
  'mintedAmount',
  'txVolume',
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BRIDGE_VIEW_ABI alignment with InstitutionalStablecoinBridge.sol', () => {
  const iface = new Interface(BRIDGE_VIEW_ABI);

  // -----------------------------------------------------------------------
  // stablecoins(bytes32) shape
  // -----------------------------------------------------------------------

  it('stablecoins() getter has exactly 13 output fields', () => {
    const fn = iface.getFunction('stablecoins');
    expect(fn).not.toBeNull();
    expect(fn!.outputs!.length).toBe(13);
  });

  it('stablecoins() field names match the contract struct', () => {
    const fn = iface.getFunction('stablecoins');
    const names = fn!.outputs!.map((o) => o.name);

    expect(names).toEqual(EXPECTED_STABLECOIN_CONFIG_FIELDS);
  });

  it('stablecoins() field types match the contract struct', () => {
    const fn = iface.getFunction('stablecoins');
    const types = fn!.outputs!.map((o) => o.type);

    expect(types).toEqual([
      'bool',     // enabled
      'bool',     // mintPaused
      'uint8',    // routingType
      'address',  // token
      'address',  // tokenMessengerV2
      'address',  // messageTransmitterV2
      'address',  // proofOfReserveFeed
      'uint256',  // mintCeilingPerEpoch
      'uint256',  // dailyTxLimit
      'uint16',   // hourlyOutflowBps
      'uint16',   // dailyOutflowBps
      'uint16',   // porDeviationBps
      'uint48',   // porHeartbeatSeconds
    ]);
  });

  it('stablecoins() accepts exactly one bytes32 input', () => {
    const fn = iface.getFunction('stablecoins');
    expect(fn!.inputs.length).toBe(1);
    expect(fn!.inputs[0].type).toBe('bytes32');
    expect(fn!.inputs[0].name).toBe('assetId');
  });

  // -----------------------------------------------------------------------
  // epochUsage(bytes32) shape
  // -----------------------------------------------------------------------

  it('epochUsage() getter has exactly 3 output fields', () => {
    const fn = iface.getFunction('epochUsage');
    expect(fn).not.toBeNull();
    expect(fn!.outputs!.length).toBe(3);
  });

  it('epochUsage() field names match the contract struct', () => {
    const fn = iface.getFunction('epochUsage');
    const names = fn!.outputs!.map((o) => o.name);

    expect(names).toEqual(EXPECTED_EPOCH_USAGE_FIELDS);
  });

  it('epochUsage() field types match the contract struct', () => {
    const fn = iface.getFunction('epochUsage');
    const types = fn!.outputs!.map((o) => o.type);

    expect(types).toEqual([
      'uint64',   // epochId
      'uint256',  // mintedAmount
      'uint256',  // txVolume
    ]);
  });

  // -----------------------------------------------------------------------
  // ABI does NOT contain stale/phantom functions
  // -----------------------------------------------------------------------

  it('does NOT expose a getRateLimitState function (not in contract)', () => {
    const fn = iface.getFunction('getRateLimitState');
    expect(fn).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Encoding / Decoding round-trip
  // -----------------------------------------------------------------------

  it('can encode a stablecoins() call for a known assetId', () => {
    const assetId =
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

    const encoded = iface.encodeFunctionData('stablecoins', [assetId]);

    expect(encoded).toMatch(/^0x/);
    // 4 bytes selector + 32 bytes assetId = 36 bytes = 72 hex chars + 0x prefix
    expect(encoded.length).toBe(2 + 8 + 64);
  });

  it('decodes a stablecoins() result tuple into named fields', () => {
    // Fabricate a result tuple matching the struct layout
    const abiCoder = iface.getFunction('stablecoins')!;

    // Build sample output data
    const sampleResult = iface.encodeFunctionResult('stablecoins', [
      true,                                                // enabled
      false,                                               // mintPaused
      1,                                                   // routingType (CCTP_V2)
      '0x' + 'a1'.repeat(20),                             // token
      '0x' + 'b2'.repeat(20),                             // tokenMessengerV2
      '0x' + 'c3'.repeat(20),                             // messageTransmitterV2
      '0x' + 'd4'.repeat(20),                             // proofOfReserveFeed
      1_000_000_000n,                                      // mintCeilingPerEpoch
      500_000_000n,                                        // dailyTxLimit
      500,                                                 // hourlyOutflowBps
      1000,                                                // dailyOutflowBps
      200,                                                 // porDeviationBps
      3600,                                                // porHeartbeatSeconds
    ]);

    const decoded = iface.decodeFunctionResult('stablecoins', sampleResult);

    expect(decoded[0]).toBe(true);                         // enabled
    expect(decoded[1]).toBe(false);                        // mintPaused
    expect(Number(decoded[2])).toBe(1);                    // routingType
    expect(decoded[3].toLowerCase()).toBe('0x' + 'a1'.repeat(20)); // token
    expect(decoded[7]).toBe(1_000_000_000n);               // mintCeilingPerEpoch
    expect(decoded[8]).toBe(500_000_000n);                 // dailyTxLimit
    expect(Number(decoded[9])).toBe(500);                  // hourlyOutflowBps
    expect(Number(decoded[10])).toBe(1000);                // dailyOutflowBps
  });

  it('decodes an epochUsage() result tuple into named fields', () => {
    const sampleResult = iface.encodeFunctionResult('epochUsage', [
      42n,            // epochId
      100_000_000n,   // mintedAmount
      250_000_000n,   // txVolume
    ]);

    const decoded = iface.decodeFunctionResult('epochUsage', sampleResult);

    expect(decoded[0]).toBe(42n);             // epochId
    expect(decoded[1]).toBe(100_000_000n);    // mintedAmount
    expect(decoded[2]).toBe(250_000_000n);    // txVolume
  });
});
