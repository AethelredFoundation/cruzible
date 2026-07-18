/**
 * Wagmi Configuration for Aethelred Cruzible
 *
 * Configures wallet connectors, transports, and chain setup
 * for the Cruzible dApp frontend.
 */

import { http, createConfig, createStorage, injected } from "wagmi";
import { coinbaseWallet } from "@cruzible/wagmi-connector-coinbase";
import { walletConnect } from "@cruzible/wagmi-connector-walletconnect";
import { activeChain, supportedChains } from "./chains";

// ---------------------------------------------------------------------------
// WalletConnect Project ID
// ---------------------------------------------------------------------------

const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";
const APP_ORIGIN = "https://vault.aethelred.org";
const APP_LOGO_URL = `${APP_ORIGIN}/cruzible-logo.png`;
const IS_BROWSER = typeof window !== "undefined";

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

const connectors = IS_BROWSER
  ? [
      injected({
        shimDisconnect: true,
      }),
      ...(WALLETCONNECT_PROJECT_ID
        ? [
            walletConnect({
              projectId: WALLETCONNECT_PROJECT_ID,
              metadata: {
                name: "Cruzible by Aethelred",
                description:
                  "Compliance-gated liquid staking for sovereign and regulated institutions",
                url: APP_ORIGIN,
                icons: [APP_LOGO_URL],
              },
              showQrModal: true,
            }),
          ]
        : []),
      coinbaseWallet({
        appName: "Cruzible by Aethelred",
        appLogoUrl: APP_LOGO_URL,
      }),
    ]
  : [];

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

// Testnet and devnet share the confirmed EVM chain id (7332, different
// endpoints), so one 7332 transport covers both; mainnet is the distinct id.
// wagmi rejects duplicate chain ids in its chains tuple, so dedupe by id.
// Map keeps the LAST entry per key, so activeChain goes last: without it,
// devnet (last in the list) survived as the 7332 chain and its default
// 127.0.0.1:8545 RPC would serve TESTNET traffic. With activeChain last, the
// surviving 7332 entry carries the endpoints of the selected environment.
const uniqueChains = Array.from(
  new Map(
    [...supportedChains, activeChain].map(
      (chain) => [chain.id, chain] as const,
    ),
  ).values(),
);
const transports = Object.fromEntries(
  uniqueChains.map((chain) => [chain.id, http()]),
);

// ---------------------------------------------------------------------------
// Wagmi Config
// ---------------------------------------------------------------------------

export const wagmiConfig = createConfig({
  chains: uniqueChains as unknown as readonly [
    typeof activeChain,
    ...(typeof activeChain)[],
  ],
  connectors,
  transports,
  // Use noopStorage on server to avoid hydration mismatches
  storage: createStorage({
    storage:
      typeof window !== "undefined"
        ? window.localStorage
        : {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          },
    key: "cruzible-wallet",
  }),
  // Disable auto-connect on SSR
  ssr: true,
});

export { activeChain };
