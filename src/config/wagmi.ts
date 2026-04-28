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

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

const connectors = [
  injected({
    shimDisconnect: true,
  }),
  ...(WALLETCONNECT_PROJECT_ID
    ? [
        walletConnect({
          projectId: WALLETCONNECT_PROJECT_ID,
          metadata: {
            name: "Cruzible by Aethelred",
            description: "TEE-verified liquid staking protocol",
            url: "https://cruzible.aethelred.network",
            icons: ["https://cruzible.aethelred.network/icon.png"],
          },
          showQrModal: true,
        }),
      ]
    : []),
  coinbaseWallet({
    appName: "Cruzible by Aethelred",
    appLogoUrl: "https://cruzible.aethelred.network/icon.png",
  }),
];

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

const transports = {
  [aethelredMainnet.id]: http(),
  [aethelredTestnet.id]: http(),
  [aethelredDevnet.id]: http(),
};

// ---------------------------------------------------------------------------
// Wagmi Config
// ---------------------------------------------------------------------------

export const wagmiConfig = createConfig({
  chains: [aethelredMainnet, aethelredTestnet, aethelredDevnet],
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
