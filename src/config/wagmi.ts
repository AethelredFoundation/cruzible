/**
 * Wagmi Configuration for Aethelred Cruzible
 *
 * Configures wallet connectors, transports, and chain setup
 * for the Cruzible dApp frontend.
 */

import { http, createConfig, createStorage, injected } from "wagmi";
import { coinbaseWallet } from "@cruzible/wagmi-connector-coinbase";
import { walletConnect } from "@cruzible/wagmi-connector-walletconnect";
import {
  aethelredMainnet,
  aethelredTestnet,
  aethelredDevnet,
  activeChain,
} from "./chains";

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
const transports = {
  [aethelredMainnet.id]: http(),
  [aethelredTestnet.id]: http(), // 7332 — also serves aethelredDevnet
};

// wagmi rejects duplicate chain ids in its chains tuple, so dedupe by id.
// activeChain is always one of the three, so it is always present.
const uniqueChains = Array.from(
  new Map(
    [aethelredMainnet, aethelredTestnet, aethelredDevnet].map(
      (c) => [c.id, c] as const,
    ),
  ).values(),
);

// ---------------------------------------------------------------------------
// Wagmi Config
// ---------------------------------------------------------------------------

export const wagmiConfig = createConfig({
  chains: uniqueChains as unknown as readonly [
    typeof aethelredMainnet,
    ...(typeof aethelredMainnet)[],
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
