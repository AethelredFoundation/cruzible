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
} from "react";
import { useQuery } from "@tanstack/react-query";

import {
  useAccount,
  useBalance,
  useChainId,
  useConnect,
  useDisconnect,
  useReadContracts,
  useSwitchChain,
  useBlockNumber,
  type Connector,
} from "wagmi";

import { formatUnits, zeroAddress } from "viem";
import { activeChain } from "@/config/wagmi";
import { ERC20ABI } from "@/config/abis";
import { getContractAddress } from "@/config/contracts";
import {
  RECONCILIATION_CONTROL_PLANE_QUERY_KEY,
  fetchReconciliationControlPlane,
  type ReconciliationControlPlaneSummary,
} from "@/lib/reconciliation";
import { isQuerySnapshotFresh } from "@/lib/homeTruth";
import {
  classifyBalanceRead,
  type BalanceReadStatus,
} from "@/lib/balanceTruth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WalletState {
  /** Whether a wallet is connected */
  connected: boolean;
  /** The connected EVM address (checksummed) */
  address: string;
  /** Native network-token balance used for gas display (human-readable units) */
  balance: number;
  /** Native network-token balance in base units */
  balanceWei: bigint;
  /** ERC20 AETHEL token balance (human-readable units) used for staking */
  aethelBalance: number;
  /** ERC20 AETHEL token balance in base units used for staking safety checks */
  aethelBalanceWei: bigint;
  /** stAETHEL token balance (human-readable units) */
  stBalance: number;
  /** stAETHEL token balance in base units for transaction safety checks */
  stBalanceWei: bigint;
  /** Stablecoin balances keyed by symbol (human-readable units) */
  stablecoinBalances: Record<string, number>;
  /** Stablecoin balances keyed by symbol in native token base units */
  stablecoinBalanceUnits: Record<string, bigint>;
  /** Whether we're currently connecting */
  isConnecting: boolean;
  /** Whether we're on the wrong network */
  isWrongNetwork: boolean;
  /** The connected chain ID (0 if disconnected) */
  chainId: number;
  balanceSnapshots: {
    native: WalletBalanceSnapshot;
    aethel: WalletBalanceSnapshot;
    stAethel: WalletBalanceSnapshot;
    stablecoins: Record<string, WalletBalanceSnapshot>;
  };
}

export interface WalletBalanceSnapshot {
  value: number | null;
  valueUnits: bigint | null;
  status: BalanceReadStatus;
  updatedAt: number | null;
}

export interface RealTimeState {
  blockHeight: number;
  tps: number;
  gasPrice: number;
  epoch: number;
  epochSource: string;
  networkLoad: number;
  aethelPrice: number;
  lastBlockTime: number;
  protocolCapturedAt: string | null;
  validatorUniverseHash: string;
  reconciliationWarnings: number;
  reconciliationComplete: boolean | null;
  blockStatus: "live" | "stale" | "unavailable";
  controlPlaneStatus: "live" | "stale" | "unavailable";
}

export interface Notification {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message: string;
  timestamp: number;
}

export interface AppContextValue {
  // Wallet (real blockchain state)
  wallet: WalletState;
  connectWallet: (connector?: Connector) => void;
  disconnectWallet: () => void;
  switchNetwork: () => void;

  // Real-time data
  realTime: RealTimeState;

  // Notifications
  notifications: Notification[];
  addNotification: (
    type: Notification["type"],
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
  address: "",
  balance: 0,
  balanceWei: 0n,
  aethelBalance: 0,
  aethelBalanceWei: 0n,
  stBalance: 0,
  stBalanceWei: 0n,
  stablecoinBalances: {},
  stablecoinBalanceUnits: {},
  isConnecting: false,
  isWrongNetwork: false,
  chainId: 0,
  balanceSnapshots: {
    native: {
      value: null,
      valueUnits: null,
      status: "unavailable",
      updatedAt: null,
    },
    aethel: {
      value: null,
      valueUnits: null,
      status: "unavailable",
      updatedAt: null,
    },
    stAethel: {
      value: null,
      valueUnits: null,
      status: "unavailable",
      updatedAt: null,
    },
    stablecoins: {},
  },
};

const DEFAULT_REALTIME: RealTimeState = {
  blockHeight: 0,
  tps: 0,
  gasPrice: 0,
  epoch: 0,
  epochSource: "rpc/block-height-estimate",
  networkLoad: 0,
  aethelPrice: 0,
  lastBlockTime: 0,
  protocolCapturedAt: null,
  validatorUniverseHash: "",
  reconciliationWarnings: 0,
  reconciliationComplete: null,
  blockStatus: "unavailable",
  controlPlaneStatus: "unavailable",
};

// ERC-20 balances only. AETHEL is deliberately NOT here: it is the NATIVE
// coin on Aethelred, and its balance comes from the native useBalance query —
// reading it as an ERC-20 (via the optional aethelToken wrapper address,
// blank on testnet) reported 0 for funded accounts.
const TRACKED_TOKEN_CONTRACTS = [
  {
    symbol: "stAETHEL",
    address: getContractAddress("stAethel"),
    decimals: 18,
  },
  {
    symbol: "USDC",
    address: getContractAddress("usdcToken"),
    decimals: 6,
  },
  {
    symbol: "USDT",
    address: getContractAddress("usdtToken"),
    decimals: 6,
  },
] as const;

/**
 * Only tokens with a configured contract address can be read. Filtering here
 * (instead of gating the whole batch on `every(address)`) means one unset
 * env var — e.g. no bridged-AETHEL ERC-20 on a chain where AETHEL is native —
 * no longer silently disables every other token read (stAETHEL included).
 */
const CONFIGURED_TOKEN_CONTRACTS = TRACKED_TOKEN_CONTRACTS.filter((token) =>
  Boolean(token.address),
);

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

  // Query native network-token balance for gas/context display.
  const nativeBalanceQuery = useBalance({
    address: address,
    chainId: activeChain.id,
    query: { enabled: isConnected, refetchInterval: 12_000 },
  });

  const tokenBalancesQuery = useReadContracts({
    contracts: CONFIGURED_TOKEN_CONTRACTS.map((token) => ({
      address: token.address ?? zeroAddress,
      abi: ERC20ABI,
      functionName: "balanceOf",
      args: [address ?? "0x0000000000000000000000000000000000000000"],
      chainId: activeChain.id,
    })),
    query: {
      enabled:
        isConnected && !!address && CONFIGURED_TOKEN_CONTRACTS.length > 0,
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
    const stablecoinBalanceUnits: Record<string, bigint> = {};
    const tokenBalanceUnits = new Map<string, bigint>();
    const tokenSnapshots = new Map<string, WalletBalanceSnapshot>();

    CONFIGURED_TOKEN_CONTRACTS.forEach((token, index) => {
      const read = tokenBalancesQuery.data?.[index];
      const balance = read?.result as bigint | undefined;
      const hasValue = typeof read?.result === "bigint";
      const status = classifyBalanceRead({
        hasValue,
        isLoading: tokenBalancesQuery.isLoading,
        isError: tokenBalancesQuery.isError || read?.status === "failure",
        dataUpdatedAt: tokenBalancesQuery.dataUpdatedAt,
      });
      tokenSnapshots.set(token.symbol, {
        value:
          hasValue && balance !== undefined
            ? parseFloat(formatUnits(balance, token.decimals))
            : null,
        valueUnits: hasValue && balance !== undefined ? balance : null,
        status,
        updatedAt:
          tokenBalancesQuery.dataUpdatedAt > 0
            ? tokenBalancesQuery.dataUpdatedAt
            : null,
      });
      if (balance !== undefined) {
        tokenBalanceUnits.set(token.symbol, balance);
      }
    });

    // AETHEL is the NATIVE coin on Aethelred (x/precisebank bridges the
    // 6-decimal bank denom to the 18-decimal EVM face) — there is no ERC-20
    // to read, so the stakeable balance comes from the native query. A
    // configured bridged-AETHEL ERC-20 (other chains) still takes priority.
    const aethelBalance =
      tokenBalanceUnits.get("AETHEL") ?? nativeBalanceQuery.data?.value;
    const stAethelBalance = tokenBalanceUnits.get("stAETHEL");
    const usdcBalance = tokenBalanceUnits.get("USDC");
    const usdtBalance = tokenBalanceUnits.get("USDT");
    const nativeHasValue = nativeBalanceQuery.data?.value !== undefined;
    const nativeStatus = classifyBalanceRead({
      hasValue: nativeHasValue,
      isLoading: nativeBalanceQuery.isLoading,
      isError: nativeBalanceQuery.isError,
      dataUpdatedAt: nativeBalanceQuery.dataUpdatedAt,
    });
    const nativeSnapshot: WalletBalanceSnapshot = {
      value: nativeHasValue
        ? parseFloat(
            formatUnits(
              nativeBalanceQuery.data!.value,
              nativeBalanceQuery.data!.decimals,
            ),
          )
        : null,
      valueUnits: nativeBalanceQuery.data?.value ?? null,
      status: nativeStatus,
      updatedAt:
        nativeBalanceQuery.dataUpdatedAt > 0
          ? nativeBalanceQuery.dataUpdatedAt
          : null,
    };
    const stAethelSnapshot =
      tokenSnapshots.get("stAETHEL") ??
      DEFAULT_WALLET.balanceSnapshots.stAethel;
    const usdcSnapshot = tokenSnapshots.get("USDC") ?? {
      ...DEFAULT_WALLET.balanceSnapshots.native,
    };
    const usdtSnapshot = tokenSnapshots.get("USDT") ?? {
      ...DEFAULT_WALLET.balanceSnapshots.native,
    };

    if (usdcBalance !== undefined) {
      stablecoinBalances.USDC = parseFloat(formatUnits(usdcBalance, 6));
      stablecoinBalanceUnits.USDC = usdcBalance;
    }
    if (usdtBalance !== undefined) {
      stablecoinBalances.USDT = parseFloat(formatUnits(usdtBalance, 6));
      stablecoinBalanceUnits.USDT = usdtBalance;
    }

    return {
      connected: true,
      address: address,
      balance: nativeSnapshot.value ?? 0,
      balanceWei: nativeSnapshot.valueUnits ?? 0n,
      aethelBalance:
        aethelBalance !== undefined
          ? parseFloat(formatUnits(aethelBalance, 18))
          : 0,
      aethelBalanceWei: aethelBalance ?? 0n,
      stBalance:
        stAethelBalance !== undefined
          ? parseFloat(formatUnits(stAethelBalance, 18))
          : 0,
      stBalanceWei: stAethelBalance ?? 0n,
      stablecoinBalances,
      stablecoinBalanceUnits,
      isConnecting: false,
      isWrongNetwork,
      chainId,
      balanceSnapshots: {
        native: nativeSnapshot,
        aethel: nativeSnapshot,
        stAethel: stAethelSnapshot,
        stablecoins: {
          USDC: usdcSnapshot,
          USDT: usdtSnapshot,
        },
      },
    };
  }, [
    isConnected,
    address,
    nativeBalanceQuery.data,
    nativeBalanceQuery.dataUpdatedAt,
    nativeBalanceQuery.isError,
    nativeBalanceQuery.isLoading,
    tokenBalancesQuery.data,
    tokenBalancesQuery.dataUpdatedAt,
    tokenBalancesQuery.isError,
    tokenBalancesQuery.isLoading,
    wagmiConnecting,
    isWrongNetwork,
    chainId,
  ]);

  // Connect: honor explicit user choice, otherwise prefer injected wallets.
  const connectWallet = useCallback(
    (selectedConnector?: Connector) => {
      const injectedConnector = connectors.find(
        (c) => c.id === "injected" || c.id === "metaMask",
      );
      const connector = selectedConnector || injectedConnector || connectors[0];
      if (connector) {
        connect({ connector, chainId: activeChain.id });
      }
    },
    [connect, connectors],
  );

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
        "warning",
        "Wrong Network",
        `Please switch to ${activeChain.name} to use Cruzible.`,
      );
    }
    prevWrongNetwork.current = isWrongNetwork;
  }, [isWrongNetwork]);

  // --- Real-time block data via wagmi --------------------------------------
  const blockQuery = useBlockNumber({
    chainId: activeChain.id,
    watch: false,
    query: { refetchInterval: 30_000, staleTime: 10_000 },
  });
  const blockNumber = blockQuery.data;

  const [realTime, setRealTime] = useState<RealTimeState>(DEFAULT_REALTIME);
  const controlPlaneQuery = useQuery<ReconciliationControlPlaneSummary | null>({
    queryKey: RECONCILIATION_CONTROL_PLANE_QUERY_KEY,
    queryFn: fetchReconciliationControlPlane,
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });
  const controlPlane = controlPlaneQuery.data ?? null;
  const blockIsFresh = isQuerySnapshotFresh({
    hasData: blockNumber !== undefined,
    isError: blockQuery.isError,
    dataUpdatedAt: blockQuery.dataUpdatedAt,
  });
  const controlPlaneIsFresh = isQuerySnapshotFresh({
    hasData: controlPlane !== null,
    isError: controlPlaneQuery.isError,
    dataUpdatedAt: controlPlaneQuery.dataUpdatedAt,
  });
  const blockStatus = blockIsFresh
    ? "live"
    : blockNumber !== undefined
      ? "stale"
      : "unavailable";
  const controlPlaneStatus = controlPlaneIsFresh
    ? "live"
    : controlPlane !== null
      ? "stale"
      : "unavailable";

  useEffect(() => {
    setRealTime((prev) => {
      const nextBlockHeight =
        blockIsFresh && blockNumber !== undefined
          ? Number(blockNumber)
          : controlPlaneIsFresh && controlPlane
            ? controlPlane.chain_height
            : prev.blockHeight;
      const fallbackEpoch =
        blockIsFresh && blockNumber !== undefined
          ? Math.floor(Number(blockNumber) / 1000)
          : prev.epoch;
      const controlPlaneCapturedAt =
        controlPlaneIsFresh && controlPlane
          ? Date.parse(controlPlane.captured_at)
          : Number.NaN;
      const lastBlockTime = blockIsFresh
        ? blockQuery.dataUpdatedAt
        : Number.isFinite(controlPlaneCapturedAt)
          ? controlPlaneCapturedAt
          : prev.lastBlockTime;

      return {
        ...prev,
        blockHeight: nextBlockHeight,
        lastBlockTime,
        epoch:
          controlPlaneIsFresh && controlPlane
            ? controlPlane.epoch
            : fallbackEpoch,
        epochSource:
          (controlPlaneIsFresh ? controlPlane?.epoch_source : undefined) ??
          (blockIsFresh && blockNumber !== undefined
            ? "rpc/block-height-estimate"
            : prev.epochSource),
        protocolCapturedAt:
          (controlPlaneIsFresh ? controlPlane?.captured_at : undefined) ??
          prev.protocolCapturedAt,
        validatorUniverseHash:
          (controlPlaneIsFresh
            ? controlPlane?.validator_universe_hash
            : undefined) ?? prev.validatorUniverseHash,
        reconciliationWarnings:
          (controlPlaneIsFresh ? controlPlane?.warning_count : undefined) ??
          prev.reconciliationWarnings,
        reconciliationComplete:
          (controlPlaneIsFresh
            ? controlPlane?.stake_snapshot_complete
            : undefined) ?? prev.reconciliationComplete,
        blockStatus,
        controlPlaneStatus,
      };
    });
  }, [
    blockIsFresh,
    blockNumber,
    blockQuery.dataUpdatedAt,
    blockStatus,
    controlPlane,
    controlPlaneIsFresh,
    controlPlaneStatus,
  ]);

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
    (type: Notification["type"], title: string, message: string) => {
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
    throw new Error("useApp must be used within an <AppProvider>");
  }
  return ctx;
}
