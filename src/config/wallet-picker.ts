/**
 * Wallet picker ordering for the connect menu.
 *
 * wagmi discovers every EIP-6963 wallet on the page (Aethelred Wallet,
 * MetaMask, ...) and appends them after the connectors declared in
 * `wagmi.ts`. Raw discovery order is whatever the extensions raced to —
 * the menu wants a deliberate order instead:
 *
 *   1. Aethelred Wallet (first-party, rdns org.aethelred.wallet)
 *   2. MetaMask (io.metamask)
 *   3. Any other discovered wallet, in discovery order
 *   4. The generic "Injected" fallback — shown ONLY when discovery found
 *      nothing, so users with a legacy window.ethereum-only wallet can
 *      still connect, but nobody sees a confusing duplicate entry when
 *      named wallets are available.
 */

export const AETHELRED_WALLET_RDNS = "org.aethelred.wallet";
export const AETHELRED_CONNECTOR_ID = "aethelred";
export const METAMASK_RDNS = "io.metamask";

/** The id wagmi assigns to the generic injected() connector. */
const GENERIC_INJECTED_ID = "injected";

export interface PickerConnector {
  id?: string;
  name: string;
  icon?: string | null;
}

/**
 * EIP-6963-discovered connectors carry the wallet's rdns as their id
 * (org.aethelred.wallet, io.metamask, ...). Configured connectors use
 * bare ids (injected, walletConnect, coinbaseWalletSDK) — the dot is
 * what separates "a real injected wallet was discovered" from "the app
 * happens to configure other transport connectors".
 */
function isDiscoveredWallet(connector: PickerConnector): boolean {
  return connector.id !== undefined && connector.id.includes(".");
}

function rank(connector: PickerConnector): number {
  if (
    connector.id === AETHELRED_WALLET_RDNS ||
    connector.id === AETHELRED_CONNECTOR_ID
  )
    return 0;
  if (connector.id === METAMASK_RDNS || /metamask/i.test(connector.name))
    return 1;
  if (connector.id === GENERIC_INJECTED_ID) return 3;
  return 2;
}

/**
 * Order connectors for display and drop the generic injected fallback
 * when at least one discovered (named) wallet is present. Stable within
 * equal ranks, so discovery order is preserved for "other" wallets.
 */
export function orderWalletConnectors<T extends PickerConnector>(
  connectors: readonly T[],
): T[] {
  const hasDiscoveredWallet = connectors.some(isDiscoveredWallet);
  const seenWallets = new Set<string>();
  return connectors
    .filter((c) => !(hasDiscoveredWallet && c.id === GENERIC_INJECTED_ID))
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map(({ c }) => c)
    .filter((connector) => {
      const identity = connector.name.trim().toLowerCase();
      if (seenWallets.has(identity)) return false;
      seenWallets.add(identity);
      return true;
    });
}

/** True for the first-party wallet — the menu highlights it. */
export function isAethelredWallet(connector: PickerConnector): boolean {
  return (
    connector.id === AETHELRED_WALLET_RDNS ||
    connector.id === AETHELRED_CONNECTOR_ID
  );
}
