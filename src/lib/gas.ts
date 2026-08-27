/**
 * Gas-limit buffering for Aethelred write transactions.
 *
 * The Aethelred EVM's `eth_estimateGas` under-reports the gas a
 * state-changing call actually needs — for a simple `registerIdentity`
 * it returns ~23,690 (essentially intrinsic gas) while the call really
 * consumes ~90k–200k. wagmi/viem submit the raw estimate as the gas
 * limit, so the transaction runs out of gas and reverts. Every write
 * path in the app hits this; read-only views don't (no gas), which is
 * why the app *looks* like it works until you click an action.
 *
 * Until the chain-side estimator is fixed, we buffer the estimate before
 * it becomes the gas limit. The chain's block gas limit is ~4.29e9 and
 * unused gas is refunded (capped at half the limit), so over-providing on
 * the testnet is safe and cheap.
 */

/** Multiply the (under-reported) estimate to cover the real cost. */
export const GAS_BUFFER_MULTIPLIER = 8n;
/** Floor for calls whose estimate collapses to ~intrinsic gas. */
export const GAS_FLOOR = 700_000n;
/** Sane ceiling so a bad estimate can never request an absurd limit. */
export const GAS_CEILING = 30_000_000n;

/**
 * Turn an `eth_estimateGas` result into a safe gas limit:
 * `clamp(estimate * MULTIPLIER, FLOOR, CEILING)`.
 */
export function bufferGasLimit(estimate: bigint): bigint {
  const buffered = estimate * GAS_BUFFER_MULTIPLIER;
  const floored = buffered > GAS_FLOOR ? buffered : GAS_FLOOR;
  return floored > GAS_CEILING ? GAS_CEILING : floored;
}
