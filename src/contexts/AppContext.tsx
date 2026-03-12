/**
 * AppContext — Global application state for the Aethelred Dashboard.
 *
 * Provides real wallet state via wagmi, real-time blockchain data,
 * a notification queue, network status, and global search state
 * to every page via React context.
 *
 * PRODUCTION: Uses wagmi hooks for real wallet connection, balance
 * queries, network detection, and transaction signing. No simulated
 * wallet or localStorage-derived balances.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  useAccount,
  useBalance,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
  useBlockNumber,
} from 'wagmi';

import { formatUnits } from 'viem';
import { activeChain } from '@/config/wagmi';
import { CONTRACT_ADDRESSES, STABLECOIN_TOKEN_ADDRESS_KEYS } from '@/config/chains';
import { getAllStablecoins } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WalletState {
  /** Whether a wallet is connected */
  connected: boolean;
  /** The connected EVM address (checksummed) */
  address: string;
  /** Native AETHEL balance (human-readable units) */
  balance: number;
  /** stAETHEL token balance (human-readable units) */
  stBalance: number;
  /** Stablecoin balances keyed by symbol (human-readable units) */
  stablecoinBalances: Record<string, number>;
  /** Whether we're currently connecting */
  isConnecting: boolean;
  /** Whether we're on the wrong network */
  isWrongNetwork: boolean;
  /** The connected chain ID (0 if disconnected) */
  chainId: number;
}

export interface RealTimeState {
  blockHeight: number;
  tps: number;
  gasPrice: number;
  epoch: number;
  networkLoad: number;
  aethelPrice: number;
  lastBlockTime: number;
}

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: number;
}

export interface AppContextValue {
  // Wallet (real blockchain state)
  wallet: WalletState;
  connectWallet: () => void;
  disconnectWallet: () => void;
  switchNetwork: () => void;

  // Real-time data
  realTime: RealTimeState;

  // Notifications
  notifications: Notification[];
  addNotification: (
    type: Notification['type'],
    title: string,
    message: string,
  ) => void;
  removeNotification: (id: string) => void;

  // Search
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let notifCounter = 0;
function nextNotifId(): string {
  notifCounter += 1;
  return `notif-${Date.now()}-${notifCounter}`;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_WALLET: WalletState = {
  connected: false,
  address: '',
  balance: 0,
  stBalance: 0,
  stablecoinBalances: {},
  isConnecting: false,
  isWrongNetwork: false,
  chainId: 0,
};

const DEFAULT_REALTIME: RealTimeState = {
  blockHeight: 0,
  tps: 0,
  gasPrice: 0,
  epoch: 0,
  networkLoad: 0,
  aethelPrice: 0,
  lastBlockTime: 0,
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AppContext = createContext<AppContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AppProvider({ children }: { children: React.ReactNode }) {
  // --- Real Wallet via wagmi ------------------------------------------------
  const { address, isConnected, isConnecting: wagmiConnecting } = useAccount();
  const chainId = useChainId();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  // Query native AETHEL balance
  const { data: nativeBalance } = useBalance({
    address: address,
    query: { enabled: isConnected, refetchInterval: 12_000 },
  });

  // Query stAETHEL token balance (ERC-20)
  const { data: stAethelBalance } = useBalance({
    address: address,
    token: CONTRACT_ADDRESSES.stAethel
      ? (CONTRACT_ADDRESSES.stAethel as `0x${string}`)
      : undefined,
    query: {
      enabled: isConnected && !!CONTRACT_ADDRESSES.stAethel,
      refetchInterval: 12_000,
    },
  });

  // --- Stablecoin balances ---------------------------------------------------
  // Build balance queries for every registered stablecoin.
  // Each useBalance call is keyed by the token address from CONTRACT_ADDRESSES.
  const stablecoins = getAllStablecoins();

  const { data: usdcBalance } = useBalance({
    address: address,
    token: CONTRACT_ADDRESSES.usdcToken
      ? (CONTRACT_ADDRESSES.usdcToken as `0x${string}`)
      : undefined,
    query: {
      enabled: isConnected && !!CONTRACT_ADDRESSES.usdcToken,
      refetchInterval: 15_000,
    },
  });

  const { data: usdtBalance } = useBalance({
    address: address,
    token: CONTRACT_ADDRESSES.usdtToken
      ? (CONTRACT_ADDRESSES.usdtToken as `0x${string}`)
      : undefined,
    query: {
      enabled: isConnected && !!CONTRACT_ADDRESSES.usdtToken,
      refetchInterval: 15_000,
    },
  });

  // Detect wrong network
  const isWrongNetwork = isConnected && chainId !== activeChain.id;

  // Derive wallet state from wagmi hooks
  const wallet = useMemo<WalletState>(() => {
    if (!isConnected || !address) {
      return { ...DEFAULT_WALLET, isConnecting: wagmiConnecting };
    }

    // Build stablecoin balance map from wagmi query results.
    // Each balance entry uses the token's native decimals (6 for USDC/USDT).
    const stablecoinBalances: Record<string, number> = {};
    if (usdcBalance) {
      stablecoinBalances.USDC = parseFloat(
        formatUnits(usdcBalance.value, usdcBalance.decimals),
      );
    }
    if (usdtBalance) {
      stablecoinBalances.USDT = parseFloat(
        formatUnits(usdtBalance.value, usdtBalance.decimals),
      );
    }

    return {
      connected: true,
      address: address,
      balance: nativeBalance
        ? parseFloat(formatUnits(nativeBalance.value, nativeBalance.decimals))
        : 0,
      stBalance: stAethelBalance
        ? parseFloat(
            formatUnits(stAethelBalance.value, stAethelBalance.decimals),
          )
        : 0,
      stablecoinBalances,
      isConnecting: false,
      isWrongNetwork,
      chainId,
    };
  }, [
    isConnected,
    address,
    nativeBalance,
    stAethelBalance,
    usdcBalance,
    usdtBalance,
    wagmiConnecting,
    isWrongNetwork,
    chainId,
  ]);

  // Connect: use the first available connector (MetaMask/injected preferred)
  const connectWallet = useCallback(() => {
    const injectedConnector = connectors.find(
      (c) => c.id === 'injected' || c.id === 'metaMask',
    );
    const connector = injectedConnector || connectors[0];
    if (connector) {
      connect({ connector, chainId: activeChain.id });
    }
  }, [connect, connectors]);

  const disconnectWallet = useCallback(() => {
    disconnect();
  }, [disconnect]);

  const switchNetwork = useCallback(() => {
    if (switchChain) {
      switchChain({ chainId: activeChain.id });
    }
  }, [switchChain]);

  // Notify on network mismatch
  const prevWrongNetwork = useRef(false);
  useEffect(() => {
    if (isWrongNetwork && !prevWrongNetwork.current) {
      addNotificationRef.current?.(
        'warning',
        'Wrong Network',
        `Please switch to ${activeChain.name} to use Cruzible.`,
      );
    }
    prevWrongNetwork.current = isWrongNetwork;
  }, [isWrongNetwork]);

  // --- Real-time block data via wagmi --------------------------------------
  const { data: blockNumber } = useBlockNumber({
    watch: true,
    query: { refetchInterval: 3_000 },
  });

  const [realTime, setRealTime] = useState<RealTimeState>(DEFAULT_REALTIME);

  useEffect(() => {
    if (blockNumber !== undefined) {
      setRealTime((prev) => ({
        ...prev,
        blockHeight: Number(blockNumber),
        lastBlockTime: Date.now(),
        // Epoch estimate: blockHeight / 1000 (actual epoch should come from contract)
        epoch: Math.floor(Number(blockNumber) / 1000),
      }));
    }
  }, [blockNumber]);

  // --- Notifications --------------------------------------------------------
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const timerMap = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    if (timerMap.current[id]) {
      clearTimeout(timerMap.current[id]);
      delete timerMap.current[id];
    }
  }, []);

  const addNotification = useCallback(
    (type: Notification['type'], title: string, message: string) => {
      const id = nextNotifId();
      const notif: Notification = {
        id,
        type,
        title,
        message,
        timestamp: Date.now(),
      };

      setNotifications((prev) => [...prev, notif]);

      // Auto-remove after 5 seconds
      timerMap.current[id] = setTimeout(() => {
        removeNotification(id);
      }, 5000);
    },
    [removeNotification],
  );

  // Stable ref for addNotification (used in effects without deps)
  const addNotificationRef = useRef(addNotification);
  addNotificationRef.current = addNotification;

  // Clean up timers on unmount
  useEffect(() => {
    const timers = timerMap.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  // --- Search ---------------------------------------------------------------
  const [searchOpen, setSearchOpen] = useState(false);

  // --- Memoised context value -----------------------------------------------
  const value = useMemo<AppContextValue>(
    () => ({
      wallet,
      connectWallet,
      disconnectWallet,
      switchNetwork,
      realTime,
      notifications,
      addNotification,
      removeNotification,
      searchOpen,
      setSearchOpen,
    }),
    [
      wallet,
      connectWallet,
      disconnectWallet,
      switchNetwork,
      realTime,
      notifications,
      addNotification,
      removeNotification,
      searchOpen,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within an <AppProvider>');
  }
  return ctx;
}
