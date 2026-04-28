/**
 * AethelVault -- Liquid Staking Protocol Dashboard
 *
 * Dark-themed, 5-tab layout: Overview, Stake, Unstake, Rewards, Analytics
 * Uses shared components, AppContext, recharts, lucide-react, tailwind.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { SEOHead } from "@/components/SEOHead";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Shield,
  Lock,
  TrendingUp,
  Users,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Copy,
  Check,
  AlertCircle,
  Clock,
  BarChart3,
  Activity,
  Layers,
  Award,
  ShieldCheck,
  RefreshCw,
  Wallet,
  Server,
  ArrowRight,
  Info,
  Star,
  CheckCircle,
  Plus,
  ArrowDown,
  ArrowUp,
  Gift,
  Target,
  Sparkles,
  Calculator,
  Download,
  Settings,
  Eye,
  EyeOff,
  Coins,
  Timer,
  CircleDot,
  ExternalLink,
} from "lucide-react";
import { useApp } from "@/contexts/AppContext";
import {
  TopNav,
  Footer,
  Modal,
  Drawer,
  AnimatedNumber,
  Tabs,
  Badge,
  LiveDot,
  ConfirmDialog,
  ProgressRing,
} from "@/components/SharedComponents";
import { seededRandom, seededRange as sr } from "@/lib/utils";
import { BRAND } from "@/lib/constants";
import { GlassCard } from "@/components/PagePrimitives";
import {
  useVaultState,
  useStake,
  useUnstake,
  useWithdraw,
  useClaimRewards,
  useUserWithdrawals,
  type VaultState,
} from "@/hooks/useVault";
import { formatEther } from "viem";
import {
  fetchReconciliationControlPlane,
  type ReconciliationControlPlaneSummary,
} from "@/lib/reconciliation";
import { getApiUrl } from "@/config/api";

// ============================================================================
// TYPES
// ============================================================================

type VaultTab = "overview" | "stake" | "unstake" | "rewards" | "analytics";
type ChartToggle = "value" | "apy" | "rate";
type RewardView = "daily" | "weekly" | "monthly";
type CompoundFreq = "epoch" | "daily" | "weekly";

interface UnstakeRequest {
  id: string;
  amount: number;
  stAethelAmount: number;
  startDate: string;
  completionDate: string;
  status: "pending" | "ready" | "claimed";
  daysRemaining: number;
  totalDays: number;
}

interface RewardEntry {
  date: string;
  epoch: number;
  amount: number;
  type: "staking" | "mev" | "protocol";
  cumulative: number;
}

interface ActivityEvent {
  id: string;
  type: "stake" | "unstake" | "claim" | "epoch" | "validator";
  address: string;
  amount: number;
  timestamp: string;
  txHash: string;
  detail: string;
}

interface TopStaker {
  rank: number;
  address: string;
  staked: number;
  pctOfPool: number;
  firstStake: string;
}

// ============================================================================
// DATA FORMATTING
// ============================================================================

function fmtNum(n: number, d = 0): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(d > 0 ? d : 1)}K`;
  return n.toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function fmtAddr(a: string): string {
  if (a.length <= 14) return a;
  return `${a.slice(0, 8)}...${a.slice(-4)}`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "Unavailable";
  return new Date(value).toLocaleString();
}

function getLiveVaultSnapshot(vaultState: VaultState) {
  const tvl =
    vaultState.totalPooledAethel > 0n
      ? parseFloat(formatEther(vaultState.totalPooledAethel))
      : null;
  const exchangeRate =
    vaultState.exchangeRate > 0n
      ? parseFloat(formatEther(vaultState.exchangeRate))
      : null;
  const apy =
    vaultState.effectiveAPY > 0n ? Number(vaultState.effectiveAPY) / 100 : null;
  const epoch =
    vaultState.currentEpoch > 0n ? Number(vaultState.currentEpoch) : null;

  return {
    tvl,
    exchangeRate,
    apy,
    epoch,
    hasAuthoritativeState:
      tvl !== null && exchangeRate !== null && apy !== null && epoch !== null,
  };
}

function VaultTruthNotice({
  title,
  body,
  tone = "neutral",
}: {
  title: string;
  body: string;
  tone?: "neutral" | "warning";
}) {
  const styles =
    tone === "warning"
      ? "border-amber-500/20 bg-amber-500/10 text-amber-50"
      : "border-slate-800 bg-slate-900/70 text-slate-300";

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${styles}`}>
      <p className="font-medium text-white">{title}</p>
      <p className="mt-1">{body}</p>
    </div>
  );
}

function generateDayLabel(daysAgo: number): string {
  const d = new Date(2026, 2, 7);
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// 90 days of TVL data
const TVL_DATA = Array.from({ length: 90 }, (_, i) => {
  const day = 89 - i;
  const seed = 1000 + i;
  const base = 105e6 + i * 420000;
  const noise = sr(seed, -2e6, 2e6);
  return {
    date: generateDayLabel(day),
    tvl: Math.round(base + noise),
    stakers: Math.round(30000 + i * 95 + sr(seed + 1, -200, 200)),
  };
});

// 90 days of APY data
const APY_DATA = Array.from({ length: 90 }, (_, i) => {
  const day = 89 - i;
  const seed = 2000 + i;
  return {
    date: generateDayLabel(day),
    apy: parseFloat((7.8 + sr(seed, -0.6, 1.2)).toFixed(2)),
    baseApy: parseFloat((6.2 + sr(seed + 1, -0.3, 0.8)).toFixed(2)),
    mevBoost: parseFloat((1.4 + sr(seed + 2, -0.3, 0.6)).toFixed(2)),
  };
});

// 90 days of exchange rate
const RATE_DATA = Array.from({ length: 90 }, (_, i) => {
  const seed = 3000 + i;
  return {
    date: generateDayLabel(89 - i),
    rate: parseFloat((1.0 + i * 0.00094 + sr(seed, -0.001, 0.001)).toFixed(6)),
  };
});

// 30 days portfolio value
const PORTFOLIO_DATA = Array.from({ length: 30 }, (_, i) => {
  const seed = 4000 + i;
  const base = 115200 + i * 120;
  return {
    date: generateDayLabel(29 - i),
    value: parseFloat((base + sr(seed, -500, 500)).toFixed(2)),
    apy: parseFloat((8.0 + sr(seed + 1, -0.5, 0.8)).toFixed(2)),
    rate: parseFloat(
      (1.06 + i * 0.0008 + sr(seed + 2, -0.001, 0.001)).toFixed(6),
    ),
  };
});

// 30 days reward history
const REWARD_HISTORY: RewardEntry[] = Array.from({ length: 30 }, (_, i) => {
  const seed = 5000 + i;
  const types: ("staking" | "mev" | "protocol")[] = [
    "staking",
    "mev",
    "protocol",
  ];
  const amt = parseFloat((280 + sr(seed, -60, 120)).toFixed(2));
  let cum = 0;
  for (let j = 0; j <= i; j++) cum += 280 + sr(5000 + j, -60, 120);
  return {
    date: generateDayLabel(29 - i),
    epoch: 218 + i,
    amount: amt,
    type: types[Math.floor(sr(seed + 3, 0, 3))],
    cumulative: parseFloat(cum.toFixed(2)),
  };
});

// 10 recent activity events
const RECENT_ACTIVITY: ActivityEvent[] = [
  {
    id: "a1",
    type: "stake",
    address: "aeth1qz7xk4...m4k9",
    amount: 100000,
    timestamp: "2 min ago",
    txHash: "0xabc1...def2",
    detail: "Staked 100,000 AETHEL",
  },
  {
    id: "a2",
    type: "epoch",
    address: "system",
    amount: 52340,
    timestamp: "12 min ago",
    txHash: "0xbcd2...efg3",
    detail: "Epoch 247 completed",
  },
  {
    id: "a3",
    type: "claim",
    address: "aeth1rv3k8...p2j7",
    amount: 1240,
    timestamp: "18 min ago",
    txHash: "0xcde3...fgh4",
    detail: "Claimed 1,240 AETHEL rewards",
  },
  {
    id: "a4",
    type: "stake",
    address: "aeth1mn7cx...f4v1",
    amount: 125000,
    timestamp: "24 min ago",
    txHash: "0xdef4...ghi5",
    detail: "Staked 125,000 AETHEL",
  },
  {
    id: "a5",
    type: "unstake",
    address: "aeth1hd8m9...x9n2",
    amount: 32000,
    timestamp: "31 min ago",
    txHash: "0xefg5...hij6",
    detail: "Unstaked 32,000 stAETHEL",
  },
  {
    id: "a6",
    type: "validator",
    address: "aeth1j5nt2...k3w8",
    amount: 0,
    timestamp: "45 min ago",
    txHash: "0xfgh6...ijk7",
    detail: "New validator joined set",
  },
  {
    id: "a7",
    type: "stake",
    address: "aeth1bx2rp...g8h5",
    amount: 84000,
    timestamp: "1 hr ago",
    txHash: "0xghi7...jkl8",
    detail: "Staked 84,000 AETHEL",
  },
  {
    id: "a8",
    type: "claim",
    address: "aeth1yt4pq...d6s3",
    amount: 3200,
    timestamp: "1.5 hr ago",
    txHash: "0xhij8...klm9",
    detail: "Claimed 3,200 AETHEL rewards",
  },
  {
    id: "a9",
    type: "unstake",
    address: "aeth1kw9em...a1z6",
    amount: 15000,
    timestamp: "2 hr ago",
    txHash: "0xijk9...lmn0",
    detail: "Unstaked 15,000 stAETHEL",
  },
  {
    id: "a10",
    type: "stake",
    address: "aeth1fg3v7...b7m4",
    amount: 200000,
    timestamp: "3 hr ago",
    txHash: "0xjkl0...mno1",
    detail: "Staked 200,000 AETHEL",
  },
];

// 3 pending unstake requests
const PENDING_UNSTAKES: UnstakeRequest[] = [
  {
    id: "u1",
    amount: 12847.32,
    stAethelAmount: 11842.5,
    startDate: "Feb 22, 2026",
    completionDate: "Mar 15, 2026",
    status: "pending",
    daysRemaining: 8,
    totalDays: 21,
  },
  {
    id: "u2",
    amount: 5420.0,
    stAethelAmount: 4998.15,
    startDate: "Feb 28, 2026",
    completionDate: "Mar 21, 2026",
    status: "pending",
    daysRemaining: 14,
    totalDays: 21,
  },
  {
    id: "u3",
    amount: 3200.0,
    stAethelAmount: 2950.8,
    startDate: "Feb 10, 2026",
    completionDate: "Mar 3, 2026",
    status: "ready",
    daysRemaining: 0,
    totalDays: 21,
  },
];

// Top 10 stakers
const TOP_STAKERS: TopStaker[] = Array.from({ length: 10 }, (_, i) => {
  const seed = 6000 + i;
  const stakes = [
    18400000, 14200000, 12800000, 11500000, 10200000, 9100000, 8400000, 7800000,
    6500000, 5900000,
  ];
  const addrs = [
    "aeth1qz7xk4m9rv3p2j7hd8m",
    "aeth1rv3k8p2j7mn7cx4f4v1",
    "aeth1hd8m9x9n2j5nt2k3w8",
    "aeth1j5nt2k3w8bx2rpg8h5",
    "aeth1mn7cxf4v1yt4pqd6s3",
    "aeth1bx2rpg8h5kw9ema1z6",
    "aeth1yt4pqd6s3fg3v7b7m4",
    "aeth1kw9ema1z6zq8dc2n9",
    "aeth1fg3v7b7m4qz7xk4m9",
    "aeth1zq8dc2n9rv3k8p2j7",
  ];
  const dates = [
    "Jun 2025",
    "Jul 2025",
    "Aug 2025",
    "Jul 2025",
    "Sep 2025",
    "Aug 2025",
    "Oct 2025",
    "Sep 2025",
    "Nov 2025",
    "Oct 2025",
  ];
  return {
    rank: i + 1,
    address: addrs[i],
    staked: stakes[i],
    pctOfPool: parseFloat(((stakes[i] / 142570000) * 100).toFixed(2)),
    firstStake: dates[i],
  };
});

// Protocol revenue by epoch
const REVENUE_DATA = Array.from({ length: 30 }, (_, i) => ({
  date: generateDayLabel(29 - i),
  epoch: 218 + i,
  revenue: Math.round(25000 + sr(7000 + i, -5000, 10000)),
}));

// Stake/Unstake volume
const VOLUME_DATA = Array.from({ length: 30 }, (_, i) => ({
  date: generateDayLabel(29 - i),
  stakeVol: Math.round(sr(8000 + i, 800000, 3500000)),
  unstakeVol: Math.round(sr(8500 + i, 200000, 1200000)),
}));

// ============================================================================
// CONSTANTS
// ============================================================================

const EXCHANGE_RATE = 1.0847;
const CURRENT_APY = 8.42;
const TVL_TOTAL = 142_570_000;
const TOTAL_STAKERS = 38_421;
const VALIDATORS_BACKING = 47;
const TOTAL_VALIDATORS = 156;

// ============================================================================
// UTILITY COMPONENTS
// ============================================================================

function CopyBtn({ text, onCopy }: { text: string; onCopy?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        onCopy?.();
        setTimeout(() => setCopied(false), 2000);
      }}
      className="p-1 rounded hover:bg-slate-700 transition-colors"
      title="Copy"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-400" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-slate-500" />
      )}
    </button>
  );
}

function StatCard({
  label,
  value,
  sub,
  change,
  up,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  change?: string;
  up?: boolean;
  icon: React.ReactNode;
}) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 bg-red-500/10 rounded-xl text-red-400">{icon}</div>
        {change && (
          <div
            className={`flex items-center gap-1 text-xs font-medium ${up ? "text-emerald-400" : "text-red-400"}`}
          >
            {up ? (
              <ArrowUpRight className="w-3 h-3" />
            ) : (
              <ArrowDownRight className="w-3 h-3" />
            )}
            {change}
          </div>
        )}
      </div>
      <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </GlassCard>
  );
}

function CountdownTimer({ epoch }: { epoch: number }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const base = (epoch * 86400) % 86400;
    setSecs(Math.max(0, 86400 - base));
    const iv = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(iv);
  }, [epoch]);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return (
    <span className="tabular-nums font-mono text-lg font-bold text-white">
      {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:
      {String(s).padStart(2, "0")}
    </span>
  );
}

const chartTooltipStyle = {
  backgroundColor: "#1e293b",
  border: "1px solid rgba(100,116,139,0.4)",
  borderRadius: "12px",
  boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
  fontSize: "13px",
  color: "#e2e8f0",
};

function ExpandedActivity({
  item,
  onClose,
}: {
  item: ActivityEvent;
  onClose: () => void;
}) {
  return (
    <div className="bg-slate-700/50 rounded-xl p-4 mt-2 space-y-2 border border-slate-600/50">
      <div className="flex justify-between">
        <span className="text-xs text-slate-400">Transaction Hash</span>
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-300 font-mono">
            {item.txHash}
          </span>
          <CopyBtn text={item.txHash} />
        </div>
      </div>
      <div className="flex justify-between">
        <span className="text-xs text-slate-400">Address</span>
        <span className="text-xs text-slate-300 font-mono">{item.address}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-xs text-slate-400">Detail</span>
        <span className="text-xs text-slate-300">{item.detail}</span>
      </div>
      <button
        onClick={onClose}
        className="text-xs text-red-400 hover:text-red-300 mt-1"
      >
        Close
      </button>
    </div>
  );
}

// ============================================================================
// HERO SECTION
// ============================================================================

function HeroSection({
  controlPlane,
}: {
  controlPlane: ReconciliationControlPlaneSummary | null;
}) {
  const { wallet } = useApp();
  const vaultState = useVaultState();
  const snapshot = getLiveVaultSnapshot(vaultState);
  const epoch = snapshot.epoch ?? controlPlane?.epoch ?? null;

  const tvlDisplay =
    snapshot.tvl == null
      ? null
      : snapshot.tvl >= 1e6
        ? { value: snapshot.tvl / 1e6, suffix: "M" }
        : snapshot.tvl >= 1e3
          ? { value: snapshot.tvl / 1e3, suffix: "K" }
          : { value: snapshot.tvl, suffix: "" };

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-red-950/30" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(220,38,38,0.12)_0%,_transparent_60%)]" />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />
      <div className="relative max-w-[1400px] mx-auto px-6 py-12 lg:py-16">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Badge variant="brand">
                <ShieldCheck className="w-3 h-3 mr-1" />
                TEE-Verified
              </Badge>
              <Badge variant="success">
                <LiveDot />
                {snapshot.hasAuthoritativeState
                  ? "Live vault state"
                  : "Awaiting live state"}
              </Badge>
              <Badge variant="neutral">Epoch #{epoch ?? "n/a"}</Badge>
            </div>
            <h1 className="text-4xl lg:text-5xl font-bold text-white tracking-tight mb-2">
              AethelVault
            </h1>
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500 font-medium">
              Liquid Staking Protocol
            </p>
          </div>
          <div className="flex flex-wrap gap-8">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
                TVL
              </p>
              <p className="text-2xl font-bold text-white tabular-nums">
                {vaultState.isLoading ? (
                  "..."
                ) : !tvlDisplay ? (
                  "Unavailable"
                ) : (
                  <>
                    <AnimatedNumber value={tvlDisplay.value} decimals={2} />
                    {tvlDisplay.suffix}
                  </>
                )}
              </p>
              <p className="text-xs text-slate-500">AETHEL</p>
            </div>
            <div className="w-px bg-slate-700/50" />
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
                Current APY
              </p>
              <p className="text-2xl font-bold text-emerald-400 tabular-nums">
                {vaultState.isLoading ? (
                  "..."
                ) : snapshot.apy == null ? (
                  "Unavailable"
                ) : (
                  <>
                    <AnimatedNumber value={snapshot.apy} decimals={2} />%
                  </>
                )}
              </p>
              <p className="text-xs text-slate-500">
                {controlPlane
                  ? `Captured ${formatDateTime(controlPlane.captured_at)}`
                  : "Control plane not yet available"}
              </p>
            </div>
            <div className="w-px bg-slate-700/50" />
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
                Exchange Rate
              </p>
              <p className="text-2xl font-bold text-white tabular-nums">
                {vaultState.isLoading ? (
                  "..."
                ) : snapshot.exchangeRate == null ? (
                  "Unavailable"
                ) : (
                  <AnimatedNumber value={snapshot.exchangeRate} decimals={4} />
                )}
              </p>
              <p className="text-xs text-slate-500">AETHEL per stAETHEL</p>
            </div>
          </div>
        </div>
        <div className="mt-6 max-w-3xl">
          <VaultTruthNotice
            title="Truth-first vault surface"
            body={
              snapshot.hasAuthoritativeState
                ? "The vault hero only shows live contract-backed TVL, exchange rate, APY, and epoch. Historical or synthetic overlays stay hidden until indexed proofs are live."
                : "Live vault telemetry is incomplete, so Cruzible is failing closed instead of rendering invented TVL, APY, or exchange-rate numbers."
            }
            tone={snapshot.hasAuthoritativeState ? "neutral" : "warning"}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TAB 1: OVERVIEW
// ============================================================================

function OverviewTab({
  switchTab,
  controlPlane,
}: {
  switchTab: (t: VaultTab) => void;
  controlPlane: ReconciliationControlPlaneSummary | null;
}) {
  const { wallet, connectWallet, addNotification } = useApp();
  const vaultState = useVaultState();
  const { claimRewards } = useClaimRewards();
  const [showCalcModal, setShowCalcModal] = useState(false);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [claimConfirm, setClaimConfirm] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const snapshot = getLiveVaultSnapshot(vaultState);
  const liveRate = snapshot.exchangeRate;
  const liveApy = snapshot.apy;
  const protocolEpoch = snapshot.epoch ?? controlPlane?.epoch ?? null;
  const positionValue =
    wallet.connected && liveRate != null ? wallet.stBalance * liveRate : null;
  const annualizedRewards =
    positionValue != null && liveApy != null
      ? (positionValue * liveApy) / 100
      : null;

  const handleClaim = useCallback(async () => {
    if (!wallet.connected || !wallet.address) {
      addNotification(
        "warning",
        "Wallet Required",
        "Please connect your wallet to claim rewards.",
      );
      return;
    }

    setClaiming(true);
    addNotification(
      "info",
      "Claiming Rewards",
      "Fetching reward proof from API...",
    );

    try {
      const res = await fetch(
        getApiUrl(`/vault/reward-proof?address=${wallet.address}`),
      );
      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ message: "Reward proof endpoint not available" }));
        throw new Error(body.message || `API returned ${res.status}`);
      }

      const { epoch, amount, proof } = (await res.json()) as {
        epoch: string;
        amount: string;
        proof: `0x${string}`[];
      };

      await claimRewards({
        epoch: BigInt(epoch),
        amount: BigInt(amount),
        proof,
      });

      setClaimConfirm(false);
      setShowClaimModal(false);
    } catch (err: any) {
      addNotification(
        "error",
        "Claim Failed",
        err?.message ||
          "Could not fetch reward proof. The reward proof endpoint may not be deployed yet.",
      );
    } finally {
      setClaiming(false);
    }
  }, [wallet.connected, wallet.address, addNotification, claimRewards]);

  return (
    <div className="space-y-8">
      {/* Your Position */}
      <GlassCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Wallet className="w-5 h-5 text-red-400" />
            Your Position
          </h3>
          {wallet.connected && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 rounded-full border border-emerald-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-emerald-400 font-medium">
                Healthy
              </span>
            </div>
          )}
        </div>
        {wallet.connected ? (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-6">
            <div>
              <p className="text-xs text-slate-500 mb-1">Staked Balance</p>
              <p className="text-xl font-bold text-white tabular-nums">
                {fmtNum(wallet.balance, 2)}
              </p>
              <p className="text-xs text-slate-500">AETHEL</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">stAETHEL Balance</p>
              <p className="text-xl font-bold text-white tabular-nums">
                {fmtNum(wallet.stBalance, 2)}
              </p>
              <p className="text-xs text-slate-500">stAETHEL</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Current Value</p>
              <p className="text-xl font-bold text-emerald-400 tabular-nums">
                {positionValue == null
                  ? "Unavailable"
                  : fmtNum(positionValue, 2)}
              </p>
              <p className="text-xs text-slate-500">AETHEL</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Annualized Yield</p>
              <p className="text-xl font-bold text-white tabular-nums">
                {annualizedRewards == null
                  ? "Unavailable"
                  : `+${fmtNum(annualizedRewards, 2)}`}
              </p>
              <p className="text-xs text-slate-500">
                Derived from the live effective APY
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Proof Status</p>
              <p className="text-xl font-bold text-emerald-400 tabular-nums">
                {controlPlane ? "Live" : "Pending"}
              </p>
              <p className="text-xs text-slate-500">
                {controlPlane
                  ? `Captured ${formatDateTime(controlPlane.captured_at)}`
                  : "Waiting for the public control plane"}
              </p>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <Wallet className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 mb-4">
              Connect Wallet to view your position
            </p>
            <button
              onClick={connectWallet}
              className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-medium transition-colors"
            >
              Connect Wallet
            </button>
          </div>
        )}
      </GlassCard>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          onClick={() => switchTab("stake")}
          className="flex items-center gap-3 p-4 bg-red-600/10 border border-red-500/20 rounded-2xl hover:bg-red-600/20 transition-colors group"
        >
          <div className="p-2 bg-red-500/20 rounded-xl">
            <ArrowDown className="w-5 h-5 text-red-400" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-white">Stake AETHEL</p>
            <p className="text-xs text-slate-400">
              {liveApy == null
                ? "Live APY unavailable"
                : `Earn ${liveApy.toFixed(2)}% APY`}
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-500 ml-auto group-hover:text-red-400 transition-colors" />
        </button>
        <button
          onClick={() => switchTab("unstake")}
          className="flex items-center gap-3 p-4 bg-slate-700/30 border border-slate-600/30 rounded-2xl hover:bg-slate-700/50 transition-colors group"
        >
          <div className="p-2 bg-slate-600/30 rounded-xl">
            <ArrowUp className="w-5 h-5 text-slate-400" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-white">Unstake</p>
            <p className="text-xs text-slate-400">21-day cooldown</p>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-500 ml-auto group-hover:text-white transition-colors" />
        </button>
        <button
          onClick={() => setShowClaimModal(true)}
          className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl hover:bg-emerald-500/20 transition-colors group"
        >
          <div className="p-2 bg-emerald-500/20 rounded-xl">
            <Gift className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-white">Claim Rewards</p>
            <p className="text-xs text-slate-400">Fetch a live Merkle proof</p>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-500 ml-auto group-hover:text-emerald-400 transition-colors" />
        </button>
        <button
          onClick={() => setShowCalcModal(true)}
          className="flex items-center gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl hover:bg-blue-500/20 transition-colors group"
        >
          <div className="p-2 bg-blue-500/20 rounded-xl">
            <Calculator className="w-5 h-5 text-blue-400" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-white">Calculator</p>
            <p className="text-xs text-slate-400">Project earnings</p>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-500 ml-auto group-hover:text-blue-400 transition-colors" />
        </button>
      </div>

      {/* Protocol Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Live TVL"
          value={snapshot.tvl == null ? "Unavailable" : fmtNum(snapshot.tvl)}
          icon={<Lock className="w-5 h-5" />}
          sub="Contract-backed AETHEL"
        />
        <StatCard
          label="Effective APY"
          value={liveApy == null ? "Unavailable" : `${liveApy.toFixed(2)}%`}
          sub="Vault effective APY"
          icon={<TrendingUp className="w-5 h-5" />}
        />
        <StatCard
          label="Exchange Rate"
          value={liveRate == null ? "Unavailable" : liveRate.toFixed(6)}
          sub="AETHEL per stAETHEL"
          icon={<Activity className="w-5 h-5" />}
        />
        <StatCard
          label="Protocol Epoch"
          value={protocolEpoch == null ? "Unavailable" : String(protocolEpoch)}
          sub={
            controlPlane?.epoch_source?.includes("fallback")
              ? "Fallback source"
              : "Authoritative source"
          }
          icon={<Server className="w-5 h-5" />}
        />
        <GlassCard className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div className="p-2 bg-red-500/10 rounded-xl text-red-400">
              <Timer className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-slate-400 mb-1">Stake Snapshot</p>
          <p className="text-xl font-bold text-white">
            {controlPlane?.stake_snapshot_complete == null
              ? "Unavailable"
              : controlPlane.stake_snapshot_complete
                ? "Complete"
                : "Partial"}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Indexed solvency evidence for the public control plane
          </p>
        </GlassCard>
        <StatCard
          label="Control-Plane Warnings"
          value={String(controlPlane?.warning_count ?? 0)}
          sub="Warnings in the latest capture"
          icon={<AlertCircle className="w-5 h-5" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <GlassCard className="p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-white">
                Live Proof Surface
              </h3>
              <p className="text-sm text-slate-400 mt-1">
                Public trust anchors sourced from the reconciliation control
                plane and live vault contract reads.
              </p>
            </div>
            <button
              onClick={() => switchTab("analytics")}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-100 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/15"
            >
              Analytics
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <VaultTruthNotice
              title="Control-plane capture"
              body={
                controlPlane
                  ? `Captured ${formatDateTime(controlPlane.captured_at)} from ${controlPlane.epoch_source}.`
                  : "Public reconciliation capture is not yet available."
              }
              tone={
                controlPlane?.epoch_source?.includes("fallback")
                  ? "warning"
                  : "neutral"
              }
            />
            <VaultTruthNotice
              title="Validator universe"
              body={
                controlPlane
                  ? `${controlPlane.validator_count}/${controlPlane.total_eligible_validators} eligible validators are represented in the public snapshot.`
                  : "Validator-universe coverage will appear here once the control plane is reachable."
              }
            />
            <VaultTruthNotice
              title="Stake snapshot status"
              body={
                controlPlane?.stake_snapshot_complete == null
                  ? "Stake solvency coverage has not been published yet."
                  : controlPlane.stake_snapshot_complete
                    ? "Stake snapshot is complete for the current public capture."
                    : "Stake snapshot is partial, so solvency evidence should be treated as incomplete."
              }
              tone={
                controlPlane?.stake_snapshot_complete === false
                  ? "warning"
                  : "neutral"
              }
            />
            <VaultTruthNotice
              title="Warnings"
              body={
                controlPlane
                  ? controlPlane.warning_count === 0
                    ? "No public control-plane warnings are active in the latest snapshot."
                    : `${controlPlane.warning_count} warning(s) were emitted in the latest public snapshot.`
                  : "Warning posture will appear once the control plane is reachable."
              }
              tone={
                controlPlane && controlPlane.warning_count > 0
                  ? "warning"
                  : "neutral"
              }
            />
          </div>

          <div className="mt-6 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  Validator Universe Hash
                </p>
                <p className="mt-2 break-all font-mono text-xs text-cyan-100">
                  {controlPlane?.validator_universe_hash ?? "Unavailable"}
                </p>
              </div>
              {controlPlane?.validator_universe_hash ? (
                <CopyBtn text={controlPlane.validator_universe_hash} />
              ) : null}
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  Stake Snapshot Hash
                </p>
                <p className="mt-2 break-all font-mono text-xs text-cyan-100">
                  {controlPlane?.stake_snapshot_hash ?? "Unavailable"}
                </p>
              </div>
              {controlPlane?.stake_snapshot_hash ? (
                <CopyBtn text={controlPlane.stake_snapshot_hash} />
              ) : null}
            </div>
            {controlPlane?.warnings?.length ? (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber-200">
                  Latest Warnings
                </p>
                <div className="mt-3 space-y-2 text-sm text-amber-50">
                  {controlPlane.warnings.map((warning, index) => (
                    <p key={`${warning}-${index}`}>{warning}</p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </GlassCard>

        <div className="space-y-6">
          <GlassCard className="p-6">
            <h3 className="text-lg font-semibold text-white">
              Historical surfaces are gated
            </h3>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              Cruzible no longer renders seeded activity feeds, fake
              exchange-rate charts, or fabricated reward balances inside the
              vault. Those surfaces will return only after the indexed history
              pipeline is live and publicly defensible.
            </p>
            <div className="mt-5 space-y-3">
              <VaultTruthNotice
                title="What is live right now"
                body="TVL, effective APY, exchange rate, epoch, staking, unstaking, and live proof fetches."
              />
              <VaultTruthNotice
                title="What remains gated"
                body="Historical portfolio curves, recent protocol activity, reward-history ledgers, and leaderboard-style analytics."
                tone="warning"
              />
            </div>
          </GlassCard>

          <GlassCard className="p-6">
            <h3 className="text-lg font-semibold text-white">
              Next best actions
            </h3>
            <div className="mt-4 space-y-3">
              <button
                onClick={() => switchTab("stake")}
                className="flex w-full items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-left text-sm text-white transition-colors hover:border-slate-700"
              >
                Fund a live staking position
                <ArrowRight className="h-4 w-4 text-slate-500" />
              </button>
              <button
                onClick={() => switchTab("rewards")}
                className="flex w-full items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-left text-sm text-white transition-colors hover:border-slate-700"
              >
                Review live reward projections
                <ArrowRight className="h-4 w-4 text-slate-500" />
              </button>
              <Link
                href="/reconciliation"
                className="flex w-full items-center justify-between rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-left text-sm text-cyan-100 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/15"
              >
                Open the full reconciliation console
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </GlassCard>
        </div>
      </div>

      {/* Claim Modal */}
      {showClaimModal && (
        <Modal
          isOpen={showClaimModal}
          title="Claim Rewards"
          onClose={() => {
            setShowClaimModal(false);
            setClaimConfirm(false);
          }}
        >
          <div className="p-6">
            <h3 className="text-lg font-semibold text-white mb-4">
              Claim Rewards
            </h3>
            <div className="bg-slate-700/50 rounded-xl p-4 mb-4 space-y-2">
              <p className="text-sm leading-6 text-slate-300">
                Rewards are claimed only after Cruzible fetches a live Merkle
                proof from the backend. This modal does not pre-render a reward
                amount because the amount must come from the proof pipeline.
              </p>
            </div>
            {!claimConfirm ? (
              <button
                onClick={() => setClaimConfirm(true)}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium transition-colors"
              >
                Fetch Live Reward Proof
              </button>
            ) : claiming ? (
              <div className="flex items-center justify-center py-3 gap-2 text-white">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Processing...
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-300">
                  Confirm fetching the latest live reward proof and claiming the
                  amount returned by the backend?
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setClaimConfirm(false)}
                    className="flex-1 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleClaim}
                    className="flex-1 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
                  >
                    Confirm Claim
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Calculator Modal */}
      {showCalcModal && (
        <CalculatorModal onClose={() => setShowCalcModal(false)} />
      )}
    </div>
  );
}

// ============================================================================
// CALCULATOR MODAL (shared between Overview and Stake)
// ============================================================================

function CalculatorModal({
  onClose,
  isOpen = true,
}: {
  onClose: () => void;
  isOpen?: boolean;
}) {
  const vaultState = useVaultState();
  const snapshot = getLiveVaultSnapshot(vaultState);
  const effectiveApy = snapshot.apy ?? 0;
  const [calcAmount, setCalcAmount] = useState(10000);
  const [calcMonths, setCalcMonths] = useState(12);
  const [autoCompound, setAutoCompound] = useState(true);

  const projections = useMemo(() => {
    const periods = [1, 3, 6, 12, calcMonths];
    const unique = Array.from(new Set(periods)).sort((a, b) => a - b);
    return unique.map((m) => {
      const simple = calcAmount * (effectiveApy / 100) * (m / 12);
      const compound =
        calcAmount * Math.pow(1 + effectiveApy / 100 / 12, m) - calcAmount;
      return {
        label:
          m === 1
            ? "1 month"
            : m < 12
              ? `${m} months`
              : m === 12
                ? "1 year"
                : `${(m / 12).toFixed(1)} years`,
        months: m,
        simple: parseFloat(simple.toFixed(2)),
        compound: parseFloat(compound.toFixed(2)),
        earned: parseFloat((autoCompound ? compound : simple).toFixed(2)),
      };
    });
  }, [autoCompound, calcAmount, calcMonths, effectiveApy]);

  const chartData = useMemo(() => {
    return Array.from({ length: Math.min(calcMonths, 60) + 1 }, (_, i) => {
      const simple = calcAmount + calcAmount * (effectiveApy / 100) * (i / 12);
      const compound = calcAmount * Math.pow(1 + effectiveApy / 100 / 12, i);
      return {
        month: i,
        simple: parseFloat(simple.toFixed(2)),
        compound: parseFloat(compound.toFixed(2)),
      };
    });
  }, [calcAmount, calcMonths, effectiveApy]);

  return (
    <Modal isOpen={isOpen} title="Staking Calculator" onClose={onClose}>
      <div className="p-6 max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
          <Calculator className="w-5 h-5 text-red-400" />
          Staking Calculator
        </h3>
        <p className="mb-5 text-sm leading-6 text-slate-400">
          Projections use the current live effective APY when available.
          {snapshot.apy == null
            ? " Live APY is unavailable right now, so projections are currently conservative."
            : ` Current live APY: ${snapshot.apy.toFixed(2)}%.`}
        </p>
        <div className="space-y-5">
          <div>
            <label className="text-sm text-slate-400 mb-2 block">
              Amount to Stake (AETHEL)
            </label>
            <input
              type="number"
              value={calcAmount}
              onChange={(e) => setCalcAmount(Number(e.target.value) || 0)}
              className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white text-lg font-semibold tabular-nums focus:ring-2 focus:ring-red-500/30 focus:border-red-500 outline-none"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400 mb-2 block">
              Duration:{" "}
              {calcMonths < 12
                ? `${calcMonths} months`
                : `${(calcMonths / 12).toFixed(1)} years`}
            </label>
            <input
              type="range"
              min={1}
              max={60}
              value={calcMonths}
              onChange={(e) => setCalcMonths(Number(e.target.value))}
              className="w-full h-2 bg-slate-700 rounded-full appearance-none cursor-pointer accent-red-600"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>1 mo</span>
              <span>1 yr</span>
              <span>3 yr</span>
              <span>5 yr</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Auto-compound</span>
            <button
              onClick={() => setAutoCompound(!autoCompound)}
              className={`relative w-11 h-6 rounded-full transition-colors ${autoCompound ? "bg-red-600" : "bg-slate-600"}`}
            >
              <div
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${autoCompound ? "left-[22px]" : "left-0.5"}`}
              />
            </button>
          </div>
          <div className="bg-slate-700/30 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-600/30">
                  <th className="text-left text-slate-400 px-4 py-2 font-medium">
                    Period
                  </th>
                  <th className="text-right text-slate-400 px-4 py-2 font-medium">
                    Earned
                  </th>
                </tr>
              </thead>
              <tbody>
                {projections.map((p) => (
                  <tr key={p.months} className="border-b border-slate-700/20">
                    <td className="px-4 py-2.5 text-slate-300">{p.label}</td>
                    <td className="px-4 py-2.5 text-right text-emerald-400 font-semibold tabular-nums">
                      +{fmtNum(p.earned, 2)} AETHEL
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-2">
              Projected Growth: With vs Without Auto-compound
            </p>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(100,116,139,0.15)"
                  vertical={false}
                />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) =>
                    v % 12 === 0 ? `${v / 12}y` : ""
                  }
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                  width={55}
                  tickFormatter={(v: number) => fmtNum(v)}
                />
                <RTooltip contentStyle={chartTooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="compound"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                  name="Compound"
                />
                <Line
                  type="monotone"
                  dataKey="simple"
                  stroke="#64748b"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  name="Simple"
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// TAB 2: STAKE
// ============================================================================

function StakeTab() {
  const { wallet, connectWallet, addNotification } = useApp();
  const { stake, isPending: stakeIsPending } = useStake();
  const vaultState = useVaultState();
  const [amount, setAmount] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const snapshot = getLiveVaultSnapshot(vaultState);

  const numAmt = parseFloat(amount) || 0;
  const maxBalance = wallet.connected ? wallet.balance : 0;

  const liveRate = snapshot.exchangeRate;
  const liveApy = snapshot.apy;
  const receiveSt = liveRate != null && liveRate > 0 ? numAmt / liveRate : null;
  const fee = numAmt * 0.001;
  const projected30d = liveApy != null ? (numAmt * liveApy) / 100 / 12 : null;
  const isValid =
    wallet.connected &&
    !wallet.isWrongNetwork &&
    numAmt >= 1 &&
    numAmt <= maxBalance;
  const processing = stakeIsPending;

  const handleQuick = (pct: number) => {
    setAmount(((maxBalance * pct) / 100).toFixed(2));
  };

  const handleStake = useCallback(async () => {
    const hash = await stake(amount);
    if (hash) {
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setShowConfirm(false);
        setAmount("");
      }, 2500);
    } else {
      // Error or rejection — stake() already fires notification via useStake
      setShowConfirm(false);
    }
  }, [amount, stake]);

  return (
    <div className="grid lg:grid-cols-5 gap-8">
      {/* Staking Form */}
      <div className="lg:col-span-3">
        <GlassCard className="overflow-hidden">
          <div className="px-8 py-5 border-b border-slate-700/50">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <ArrowDown className="w-5 h-5 text-red-400" />
              Stake AETHEL <ArrowRight className="w-4 h-4 text-slate-500" />{" "}
              Receive stAETHEL
            </h3>
          </div>
          <div className="p-8">
            <div className="mb-6">
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-medium text-slate-300">
                  AETHEL Amount
                </label>
                <span className="text-xs text-slate-500">
                  Available:{" "}
                  <span className="font-medium text-slate-300 tabular-nums">
                    {wallet.connected ? fmtNum(maxBalance, 2) : "---"}
                  </span>{" "}
                  AETHEL
                </span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Enter amount (min: 1 AETHEL)"
                  className="w-full pl-5 pr-32 py-4 text-xl font-semibold text-white bg-slate-700/50 border border-slate-600/50 rounded-2xl focus:ring-2 focus:ring-red-500/30 focus:border-red-500 transition-all placeholder:text-slate-600 tabular-nums outline-none"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <button
                    onClick={() => handleQuick(100)}
                    className="px-3 py-1.5 text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors"
                  >
                    MAX
                  </button>
                  <span className="text-sm font-medium text-slate-500">
                    AETHEL
                  </span>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                {[25, 50, 75].map((pct) => (
                  <button
                    key={pct}
                    onClick={() => handleQuick(pct)}
                    className="flex-1 py-2 text-xs font-medium text-slate-400 bg-slate-700/30 hover:bg-slate-700/50 rounded-lg border border-slate-600/30 transition-colors"
                  >
                    {pct}%
                  </button>
                ))}
                <button
                  onClick={() => handleQuick(100)}
                  className="flex-1 py-2 text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg border border-red-500/20 transition-colors"
                >
                  MAX
                </button>
              </div>
            </div>

            {/* Preview Panel */}
            <div className="bg-slate-700/30 rounded-2xl p-5 mb-6 space-y-3 border border-slate-600/20">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">You will receive</span>
                <span className="font-semibold text-white tabular-nums">
                  {receiveSt == null
                    ? "Unavailable until live exchange rate loads"
                    : `~${numAmt > 0 ? receiveSt.toFixed(4) : "0.0000"} stAETHEL`}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Exchange rate</span>
                <span className="text-slate-300 tabular-nums">
                  {liveRate == null
                    ? "Unavailable"
                    : `1 AETHEL = ${(1 / liveRate).toFixed(4)} stAETHEL`}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Transaction fee</span>
                <span className="text-slate-300 tabular-nums">
                  {numAmt > 0 ? fee.toFixed(4) : "0.001"} AETHEL
                </span>
              </div>
              <div className="h-px bg-slate-600/30" />
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Estimated APY</span>
                <span className="font-medium text-emerald-400">
                  {liveApy == null ? "Unavailable" : `${liveApy.toFixed(2)}%`}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Projected earnings (30d)</span>
                <span className="font-medium text-emerald-400 tabular-nums">
                  {projected30d == null
                    ? "Unavailable"
                    : `+${numAmt > 0 ? projected30d.toFixed(2) : "0.00"} AETHEL`}
                </span>
              </div>
            </div>

            {!showConfirm ? (
              <button
                disabled={!isValid}
                onClick={() => setShowConfirm(true)}
                className={`w-full py-4 rounded-2xl font-semibold text-base transition-all ${
                  isValid
                    ? "bg-red-600 hover:bg-red-700 text-white shadow-lg hover:shadow-xl active:scale-[0.98]"
                    : "bg-slate-700 text-slate-500 cursor-not-allowed"
                }`}
              >
                {!wallet.connected
                  ? "Connect Wallet to Stake"
                  : numAmt < 1
                    ? "Minimum 1 AETHEL"
                    : numAmt > maxBalance
                      ? "Insufficient Balance"
                      : `Stake ${fmtNum(numAmt, 2)} AETHEL`}
              </button>
            ) : success ? (
              <div className="text-center py-4">
                <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-3 animate-bounce">
                  <CheckCircle className="w-8 h-8 text-emerald-400" />
                </div>
                <p className="text-lg font-semibold text-emerald-400">
                  Successfully staked {fmtNum(numAmt, 2)} AETHEL!
                </p>
                <p className="text-sm text-slate-400 mt-1">
                  {receiveSt == null
                    ? "The receive preview was unavailable at submission time."
                    : `You received ${receiveSt.toFixed(4)} stAETHEL`}
                </p>
              </div>
            ) : processing ? (
              <div className="flex items-center justify-center py-4 gap-3">
                <RefreshCw className="w-5 h-5 text-red-400 animate-spin" />
                <span className="text-white font-medium">
                  Processing transaction...
                </span>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                  <p className="text-sm text-amber-300">
                    Confirm staking{" "}
                    <span className="font-semibold">
                      {fmtNum(numAmt, 2)} AETHEL
                    </span>
                    ?
                  </p>
                  <p className="text-xs text-amber-300/70 mt-1">
                    {receiveSt == null
                      ? "Live exchange rate is unavailable, so the receive preview is withheld."
                      : `You will receive ${receiveSt.toFixed(4)} stAETHEL`}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowConfirm(false)}
                    className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleStake}
                    className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium transition-colors"
                  >
                    Confirm Stake
                  </button>
                </div>
              </div>
            )}

            {!wallet.connected && (
              <button
                onClick={connectWallet}
                className="w-full mt-3 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium transition-colors"
              >
                Connect Wallet
              </button>
            )}

            <div className="mt-4 flex items-start gap-2 p-3 bg-emerald-500/5 rounded-xl border border-emerald-500/10">
              <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-emerald-300/70 leading-relaxed">
                Protected by TEE-verified validator selection. Rewards are
                cryptographically proven via Merkle trees.
              </p>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Sidebar */}
      <div className="lg:col-span-2 space-y-6">
        {/* APY info */}
        <GlassCard className="p-6">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-red-400" />
            Current APY
          </h3>
          <p className="text-3xl font-bold text-emerald-400 mb-3">
            {liveApy == null ? "Unavailable" : `${liveApy.toFixed(2)}%`}
          </p>
          <p className="text-sm leading-6 text-slate-400">
            This staking preview only uses the live effective APY exposed by the
            vault contract. Historical APY charts remain hidden until indexed
            time-series data is live.
          </p>
        </GlassCard>

        {/* Staking Info */}
        <GlassCard className="p-6">
          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
            <Info className="w-4 h-4 text-red-400" />
            Staking Info
          </h3>
          <div className="space-y-3">
            {[
              { l: "Minimum stake", v: "1 AETHEL" },
              { l: "Unbonding period", v: "21 days" },
              {
                l: "Validator source",
                v: "Published in reconciliation and validator intelligence",
              },
              { l: "TEE Protection", v: "Hardware-verified" },
              { l: "Commission", v: "5% on rewards" },
            ].map((r, i) => (
              <div key={i} className="flex justify-between items-center">
                <span className="text-sm text-slate-400">{r.l}</span>
                <span className="text-sm font-medium text-slate-200">
                  {r.v}
                </span>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* How it works */}
        <GlassCard className="p-6">
          <h3 className="font-semibold text-white mb-4">How It Works</h3>
          <div className="space-y-4">
            {[
              {
                step: 1,
                icon: <ArrowDown className="w-4 h-4" />,
                title: "Stake",
                desc: "Deposit AETHEL tokens",
              },
              {
                step: 2,
                icon: <Server className="w-4 h-4" />,
                title: "Delegate",
                desc: "TEE-verified validator selection",
              },
              {
                step: 3,
                icon: <Gift className="w-4 h-4" />,
                title: "Earn",
                desc: "Receive staking rewards each epoch",
              },
            ].map((s, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-8 h-8 bg-red-500/10 rounded-lg flex items-center justify-center text-red-400 flex-shrink-0 mt-0.5">
                  {s.icon}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">
                    Step {s.step}: {s.title}
                  </p>
                  <p className="text-xs text-slate-400">{s.desc}</p>
                </div>
                {i < 2 && <div className="w-px h-4 bg-slate-700 ml-4 mt-8" />}
              </div>
            ))}
          </div>
        </GlassCard>

        <button
          onClick={() => setShowCalc(true)}
          className="w-full py-3 bg-slate-700/50 hover:bg-slate-700 text-white rounded-xl font-medium transition-colors border border-slate-600/30 flex items-center justify-center gap-2"
        >
          <Calculator className="w-4 h-4" />
          Open Calculator
        </button>
        {showCalc && <CalculatorModal onClose={() => setShowCalc(false)} />}
      </div>
    </div>
  );
}

// ============================================================================
// TAB 3: UNSTAKE
// ============================================================================

function UnstakeTab() {
  const { wallet, connectWallet, addNotification } = useApp();
  const { unstake, isPending: unstakeIsPending } = useUnstake();
  const { withdraw: claimWithdrawal, isPending: claimIsPending } =
    useWithdraw();
  const { withdrawals: onChainWithdrawals, refetch: refetchWithdrawals } =
    useUserWithdrawals();
  const vaultState = useVaultState();
  const [amount, setAmount] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [success, setSuccess] = useState(false);
  const snapshot = getLiveVaultSnapshot(vaultState);
  const [withdrawalClock, setWithdrawalClock] = useState(
    () => Date.now() / 1000,
  );

  const numAmt = parseFloat(amount) || 0;
  const maxBal = wallet.connected ? wallet.stBalance : 0;
  const liveRate = snapshot.exchangeRate;

  const receiveAethel = liveRate == null ? null : numAmt * liveRate;
  const earlyFee = receiveAethel == null ? null : receiveAethel * 0.005;
  const isValid =
    wallet.connected &&
    !wallet.isWrongNetwork &&
    numAmt > 0 &&
    numAmt <= maxBal;
  const processing = unstakeIsPending;

  const completionDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 21);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, []);

  useEffect(() => {
    setWithdrawalClock(Date.now() / 1000);
  }, [onChainWithdrawals]);

  // Merge on-chain withdrawals with mock fallback for display
  const requests: UnstakeRequest[] = useMemo(() => {
    return onChainWithdrawals.map((w) => {
      const completion = Number(w.completionTime);
      const start = Number(w.requestTime);
      const totalSecs = completion - start;
      const daysRemaining = Math.max(
        0,
        Math.ceil((completion - withdrawalClock) / 86400),
      );
      const totalDays = Math.ceil(totalSecs / 86400);
      return {
        id: `w${w.id.toString()}`,
        amount: parseFloat(formatEther(w.aethelAmount)),
        stAethelAmount: parseFloat(formatEther(w.shares)),
        startDate: new Date(start * 1000).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        completionDate: new Date(completion * 1000).toLocaleDateString(
          "en-US",
          { month: "short", day: "numeric", year: "numeric" },
        ),
        status: w.claimed
          ? ("claimed" as const)
          : daysRemaining === 0
            ? ("ready" as const)
            : ("pending" as const),
        daysRemaining,
        totalDays: Math.max(totalDays, 1),
      };
    });
  }, [onChainWithdrawals, withdrawalClock]);

  const handleQuick = (pct: number) =>
    setAmount(((maxBal * pct) / 100).toFixed(2));

  const handleUnstake = useCallback(async () => {
    const hash = await unstake(amount);
    if (hash) {
      setSuccess(true);
      refetchWithdrawals();
      setTimeout(() => {
        setSuccess(false);
        setShowConfirm(false);
        setAmount("");
      }, 2500);
    } else {
      setShowConfirm(false);
    }
  }, [amount, unstake, refetchWithdrawals]);

  const handleClaim = useCallback(
    async (id: string) => {
      const req = requests.find((r) => r.id === id);
      if (!req || req.status !== "ready") return;
      // Extract the on-chain withdrawal ID (bigint)
      const withdrawalId = BigInt(id.replace("w", ""));
      const hash = await claimWithdrawal(withdrawalId);
      if (hash) {
        refetchWithdrawals();
      }
    },
    [requests, claimWithdrawal, refetchWithdrawals],
  );

  return (
    <div className="space-y-8">
      <div className="grid lg:grid-cols-5 gap-8">
        {/* Unstaking Form */}
        <div className="lg:col-span-3">
          <GlassCard className="overflow-hidden">
            <div className="px-8 py-5 border-b border-slate-700/50">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <ArrowUp className="w-5 h-5 text-amber-400" />
                Unstake stAETHEL{" "}
                <ArrowRight className="w-4 h-4 text-slate-500" /> Receive AETHEL
              </h3>
            </div>
            <div className="p-8">
              <div className="mb-6">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium text-slate-300">
                    stAETHEL Amount
                  </label>
                  <span className="text-xs text-slate-500">
                    Balance:{" "}
                    <span className="font-medium text-slate-300 tabular-nums">
                      {wallet.connected ? fmtNum(maxBal, 2) : "---"}
                    </span>{" "}
                    stAETHEL
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Enter stAETHEL amount"
                    className="w-full pl-5 pr-36 py-4 text-xl font-semibold text-white bg-slate-700/50 border border-slate-600/50 rounded-2xl focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all placeholder:text-slate-600 tabular-nums outline-none"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    <button
                      onClick={() => handleQuick(100)}
                      className="px-3 py-1.5 text-xs font-semibold text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 rounded-lg transition-colors"
                    >
                      MAX
                    </button>
                    <span className="text-sm font-medium text-slate-500">
                      stAETHEL
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => handleQuick(pct)}
                      className="flex-1 py-2 text-xs font-medium text-slate-400 bg-slate-700/30 hover:bg-slate-700/50 rounded-lg border border-slate-600/30 transition-colors"
                    >
                      {pct === 100 ? "MAX" : `${pct}%`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-700/30 rounded-2xl p-5 mb-6 space-y-3 border border-slate-600/20">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">
                    You will receive (after cooldown)
                  </span>
                  <span className="font-semibold text-white tabular-nums">
                    {receiveAethel == null
                      ? "Unavailable until live exchange rate loads"
                      : `~${numAmt > 0 ? receiveAethel.toFixed(4) : "0.0000"} AETHEL`}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Exchange rate</span>
                  <span className="text-slate-300 tabular-nums">
                    {liveRate == null
                      ? "Unavailable"
                      : `1 stAETHEL = ${liveRate.toFixed(4)} AETHEL`}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Cooldown period</span>
                  <span className="text-amber-400 font-medium">21 days</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Expected completion</span>
                  <span className="text-slate-300">{completionDate}</span>
                </div>
                <div className="h-px bg-slate-600/30" />
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">
                    Early exit fee (if applicable)
                  </span>
                  <span className="text-amber-400 tabular-nums">
                    {earlyFee == null
                      ? "Unavailable"
                      : `0.5% (${numAmt > 0 ? earlyFee.toFixed(2) : "0.00"} AETHEL)`}
                  </span>
                </div>
              </div>

              {!showConfirm ? (
                <button
                  disabled={!isValid}
                  onClick={() => setShowConfirm(true)}
                  className={`w-full py-4 rounded-2xl font-semibold text-base transition-all ${isValid ? "bg-amber-600 hover:bg-amber-700 text-white shadow-lg" : "bg-slate-700 text-slate-500 cursor-not-allowed"}`}
                >
                  {!wallet.connected
                    ? "Connect Wallet"
                    : numAmt <= 0
                      ? "Enter amount"
                      : numAmt > maxBal
                        ? "Insufficient Balance"
                        : `Unstake ${fmtNum(numAmt, 2)} stAETHEL`}
                </button>
              ) : success ? (
                <div className="text-center py-4">
                  <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-2 animate-bounce" />
                  <p className="text-lg font-semibold text-emerald-400">
                    Unstake initiated!
                  </p>
                  <p className="text-sm text-slate-400 mt-1">
                    Your AETHEL will be available in 21 days
                  </p>
                </div>
              ) : processing ? (
                <div className="flex items-center justify-center py-4 gap-3">
                  <RefreshCw className="w-5 h-5 text-amber-400 animate-spin" />
                  <span className="text-white font-medium">Processing...</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                    <p className="text-sm text-amber-300">
                      Confirm unstaking{" "}
                      <span className="font-semibold">
                        {fmtNum(numAmt, 2)} stAETHEL
                      </span>
                      ?
                    </p>
                    <p className="text-xs text-amber-300/70 mt-1">
                      {receiveAethel == null
                        ? "Live exchange rate is unavailable, so the receive preview is withheld."
                        : `You will receive ${receiveAethel.toFixed(2)} AETHEL after 21-day cooldown`}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowConfirm(false)}
                      className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleUnstake}
                      className="flex-1 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-medium transition-colors"
                    >
                      Confirm Unstake
                    </button>
                  </div>
                </div>
              )}
            </div>
          </GlassCard>
        </div>

        {/* Info */}
        <div className="lg:col-span-2 space-y-6">
          <GlassCard className="p-6">
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              Unstaking Info
            </h3>
            <div className="space-y-4">
              <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-4">
                <p className="text-sm text-amber-300 font-medium mb-1">
                  21-Day Cooldown
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  The cooldown ensures network security by allowing validators
                  to complete their current duties and prevents sudden liquidity
                  shocks to the protocol.
                </p>
              </div>
              <div className="bg-slate-700/30 border border-slate-600/20 rounded-xl p-4">
                <p className="text-sm text-white font-medium mb-1">
                  Why the cooldown?
                </p>
                <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside">
                  <li>Validator rotation and delegation updates</li>
                  <li>Network security and slashing protection</li>
                  <li>Orderly withdrawal processing</li>
                </ul>
              </div>
              <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-4">
                <p className="text-sm text-red-300 font-medium mb-1">
                  Emergency Unstake
                </p>
                <p className="text-xs text-slate-400">
                  Skip cooldown with a 0.5% fee. Contact support for large
                  amounts.
                </p>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>

      {/* Active Unstaking Queue */}
      <GlassCard className="overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700/50">
          <h3 className="font-semibold text-white">Active Unstaking Queue</h3>
        </div>
        <div className="overflow-x-auto">
          {requests.length === 0 ? (
            <div className="px-6 py-8 text-sm text-slate-400">
              No live withdrawal requests were found for the connected wallet.
              Cruzible no longer seeds placeholder unstake rows.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/30">
                  <th className="text-left text-slate-400 px-6 py-3 font-medium">
                    Request ID
                  </th>
                  <th className="text-left text-slate-400 px-6 py-3 font-medium">
                    Amount
                  </th>
                  <th className="text-left text-slate-400 px-6 py-3 font-medium">
                    Start Date
                  </th>
                  <th className="text-left text-slate-400 px-6 py-3 font-medium">
                    Completion
                  </th>
                  <th className="text-left text-slate-400 px-6 py-3 font-medium">
                    Progress
                  </th>
                  <th className="text-left text-slate-400 px-6 py-3 font-medium">
                    Status
                  </th>
                  <th className="text-right text-slate-400 px-6 py-3 font-medium">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/20">
                {requests.map((req) => (
                  <tr
                    key={req.id}
                    className="hover:bg-slate-700/20 transition-colors"
                  >
                    <td className="px-6 py-4 text-slate-300 font-mono text-xs">
                      {req.id.toUpperCase()}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-white font-medium tabular-nums">
                        {fmtNum(req.amount, 2)} AETHEL
                      </p>
                      <p className="text-xs text-slate-500">
                        {fmtNum(req.stAethelAmount, 2)} stAETHEL
                      </p>
                    </td>
                    <td className="px-6 py-4 text-slate-300">
                      {req.startDate}
                    </td>
                    <td className="px-6 py-4 text-slate-300">
                      {req.completionDate}
                    </td>
                    <td className="px-6 py-4">
                      <div className="w-32">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-400">
                            {req.daysRemaining > 0
                              ? `${req.daysRemaining}d left`
                              : "Complete"}
                          </span>
                          <span className="text-slate-400">
                            {Math.round(
                              ((req.totalDays - req.daysRemaining) /
                                req.totalDays) *
                                100,
                            )}
                            %
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${req.status === "ready" ? "bg-emerald-500" : "bg-amber-500"}`}
                            style={{
                              width: `${((req.totalDays - req.daysRemaining) / req.totalDays) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                          req.status === "ready"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : req.status === "claimed"
                              ? "bg-slate-600/30 text-slate-400"
                              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                        }`}
                      >
                        {req.status === "ready" && (
                          <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                        )}
                        {req.status.charAt(0).toUpperCase() +
                          req.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {req.status === "ready" ? (
                        <button
                          onClick={() => handleClaim(req.id)}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition-colors animate-pulse"
                        >
                          Claim
                        </button>
                      ) : req.status === "claimed" ? (
                        <span className="text-xs text-slate-500">Claimed</span>
                      ) : (
                        <span className="text-xs text-slate-500">Waiting</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

// ============================================================================
// TAB 4: REWARDS
// ============================================================================

function RewardsTab({
  controlPlane,
}: {
  controlPlane: ReconciliationControlPlaneSummary | null;
}) {
  const { wallet, connectWallet, addNotification } = useApp();
  const vaultState = useVaultState();
  const { claimRewards } = useClaimRewards();
  const [autoCompound, setAutoCompound] = useState(true);
  const [claimProcessing, setClaimProcessing] = useState(false);
  const snapshot = getLiveVaultSnapshot(vaultState);
  const liveRate = snapshot.exchangeRate;
  const liveApy = snapshot.apy;
  const stakeValue =
    wallet.connected && liveRate != null ? wallet.stBalance * liveRate : null;

  const projectionRows = useMemo(() => {
    const principal = stakeValue ?? 0;
    const apy = liveApy ?? 0;
    return [7, 30, 90, 365].map((days) => {
      const years = days / 365;
      const simple = principal * (apy / 100) * years;
      const compound =
        principal * (Math.pow(1 + apy / 100 / 12, years * 12) - 1);
      return {
        period:
          days === 365 ? "1 year" : days === 30 ? "30 days" : `${days} days`,
        projected: parseFloat((autoCompound ? compound : simple).toFixed(2)),
      };
    });
  }, [autoCompound, liveApy, stakeValue]);

  const growthChartData = useMemo(() => {
    const principal = stakeValue ?? 0;
    const apy = liveApy ?? 0;
    return Array.from({ length: 13 }, (_, month) => {
      const simple = principal + principal * (apy / 100) * (month / 12);
      const compound = principal * Math.pow(1 + apy / 100 / 12, month);
      return {
        month: month === 0 ? "Now" : `M${month}`,
        simple: parseFloat(simple.toFixed(2)),
        compound: parseFloat(compound.toFixed(2)),
      };
    });
  }, [liveApy, stakeValue]);

  const handleClaimAll = useCallback(async () => {
    if (!wallet.connected || !wallet.address) {
      addNotification(
        "warning",
        "Wallet Required",
        "Please connect your wallet to claim rewards.",
      );
      return;
    }

    setClaimProcessing(true);
    addNotification(
      "info",
      "Claiming Rewards",
      "Fetching reward proof from API...",
    );

    try {
      const res = await fetch(
        getApiUrl(`/vault/reward-proof?address=${wallet.address}`),
      );
      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ message: "Reward proof endpoint not available" }));
        throw new Error(body.message || `API returned ${res.status}`);
      }

      const { epoch, amount, proof } = (await res.json()) as {
        epoch: string;
        amount: string;
        proof: `0x${string}`[];
      };

      await claimRewards({
        epoch: BigInt(epoch),
        amount: BigInt(amount),
        proof,
      });
    } catch (err: any) {
      addNotification(
        "error",
        "Claim Failed",
        err?.message ||
          "Could not fetch reward proof. The reward proof endpoint may not be deployed yet.",
      );
    } finally {
      setClaimProcessing(false);
    }
  }, [wallet.connected, wallet.address, addNotification, claimRewards]);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <GlassCard className="p-6">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
            Effective APY
          </p>
          <p className="text-2xl font-bold text-white tabular-nums">
            {liveApy == null ? "Unavailable" : `${liveApy.toFixed(2)}%`}
          </p>
          <p className="text-xs text-slate-400">
            Live effective APY from the vault contract
          </p>
        </GlassCard>
        <GlassCard className="p-6">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
            Staked Value
          </p>
          <p className="text-2xl font-bold text-emerald-400 tabular-nums">
            {stakeValue == null ? "Unavailable" : fmtNum(stakeValue, 2)}
          </p>
          <p className="text-xs text-emerald-400/70">AETHEL equivalent</p>
        </GlassCard>
        <GlassCard className="p-6">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
            Reward Projection
          </p>
          <p className="text-2xl font-bold text-white">
            {stakeValue == null || liveApy == null
              ? "Unavailable"
              : `+${fmtNum((stakeValue * liveApy) / 100, 2)}`}
          </p>
          <p className="text-xs text-slate-400">Annualized AETHEL rewards</p>
        </GlassCard>
        <GlassCard className="p-6 flex flex-col justify-between">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">
            Live Claim
          </p>
          <button
            onClick={handleClaimAll}
            disabled={claimProcessing}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
          >
            {claimProcessing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Claiming...
              </>
            ) : (
              <>
                <Gift className="w-4 h-4" />
                Fetch & Claim Proof
              </>
            )}
          </button>
        </GlassCard>
      </div>

      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-6">
        <GlassCard className="p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-white">
                Live reward projections
              </h3>
              <p className="text-sm text-slate-400 mt-1">
                Forward-looking curves derived from the live effective APY, not
                a seeded reward ledger.
              </p>
            </div>
            <button
              onClick={() => setAutoCompound((value) => !value)}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                autoCompound
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                  : "border-slate-700 bg-slate-900/80 text-slate-300"
              }`}
            >
              {autoCompound ? "Auto-compound on" : "Auto-compound off"}
            </button>
          </div>

          {stakeValue == null || liveApy == null ? (
            <div className="mt-6">
              <VaultTruthNotice
                title="Reward projections are gated"
                body="Projected rewards appear only when the wallet balance, live exchange rate, and live effective APY are all available."
                tone="warning"
              />
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={growthChartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(100,116,139,0.15)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    tickLine={false}
                    axisLine={false}
                    width={55}
                    tickFormatter={(value: number) => fmtNum(value)}
                  />
                  <RTooltip contentStyle={chartTooltipStyle} />
                  <Line
                    type="monotone"
                    dataKey="simple"
                    stroke="#64748b"
                    strokeWidth={1.5}
                    dot={false}
                    name="Simple"
                  />
                  <Line
                    type="monotone"
                    dataKey="compound"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                    name="Compound"
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                </LineChart>
              </ResponsiveContainer>

              <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/80">
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                        Horizon
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                        Projected Rewards
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {projectionRows.map((row) => (
                      <tr key={row.period}>
                        <td className="px-4 py-3 text-slate-300">
                          {row.period}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-emerald-400">
                          +{fmtNum(row.projected, 2)} AETHEL
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </GlassCard>

        <GlassCard className="p-6">
          <h3 className="text-lg font-semibold text-white mb-4">
            Proof and history posture
          </h3>
          <div className="space-y-3">
            <VaultTruthNotice
              title="Claim pipeline"
              body="Claims fetch a live reward proof from the backend right before submission. Cruzible no longer pre-renders a synthetic claimable balance."
            />
            <VaultTruthNotice
              title="Historical reward ledger"
              body="Reward history is withheld until the protocol publishes an indexed, user-addressable reward ledger with defensible provenance."
              tone="warning"
            />
            <VaultTruthNotice
              title="Control-plane capture"
              body={
                controlPlane
                  ? `Latest public capture: ${formatDateTime(controlPlane.captured_at)}. Warning count: ${controlPlane.warning_count}.`
                  : "Public control-plane capture is not available yet."
              }
            />
            {!wallet.connected ? (
              <button
                onClick={connectWallet}
                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium transition-colors"
              >
                Connect Wallet
              </button>
            ) : null}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ============================================================================
// TAB 5: ANALYTICS
// ============================================================================

function AnalyticsTab({
  controlPlane,
}: {
  controlPlane: ReconciliationControlPlaneSummary | null;
}) {
  const vaultState = useVaultState();
  const snapshot = getLiveVaultSnapshot(vaultState);
  const statusLabel =
    !controlPlane && !snapshot.hasAuthoritativeState
      ? "Unavailable"
      : controlPlane?.warning_count ||
          controlPlane?.epoch_source?.includes("fallback")
        ? "Attention"
        : "Healthy";

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Live TVL"
          value={snapshot.tvl == null ? "Unavailable" : fmtNum(snapshot.tvl)}
          sub="AETHEL"
          icon={<Lock className="w-5 h-5" />}
        />
        <StatCard
          label="Effective APY"
          value={
            snapshot.apy == null ? "Unavailable" : `${snapshot.apy.toFixed(2)}%`
          }
          sub="Vault contract"
          icon={<TrendingUp className="w-5 h-5" />}
        />
        <StatCard
          label="Exchange Rate"
          value={
            snapshot.exchangeRate == null
              ? "Unavailable"
              : snapshot.exchangeRate.toFixed(6)
          }
          sub="AETHEL / stAETHEL"
          icon={<Activity className="w-5 h-5" />}
        />
        <StatCard
          label="Control-Plane Status"
          value={statusLabel}
          sub={
            controlPlane
              ? `${controlPlane.warning_count} warning(s)`
              : "Awaiting public capture"
          }
          icon={<ShieldCheck className="w-5 h-5" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <GlassCard className="p-6">
          <h3 className="text-lg font-semibold text-white">
            Reconciliation scorecard
          </h3>
          <p className="mt-2 text-sm leading-7 text-slate-300">
            This analytics surface now prioritizes public trust evidence: latest
            epoch capture, warning posture, stake snapshot completeness, and
            hash lineage. Decorative charts stay hidden until indexed history
            becomes auditable.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <VaultTruthNotice
              title="Epoch source"
              body={
                controlPlane
                  ? `Epoch ${controlPlane.epoch} sourced from ${controlPlane.epoch_source}.`
                  : "The public control plane has not published an epoch yet."
              }
              tone={
                controlPlane?.epoch_source?.includes("fallback")
                  ? "warning"
                  : "neutral"
              }
            />
            <VaultTruthNotice
              title="Capture time"
              body={
                controlPlane
                  ? formatDateTime(controlPlane.captured_at)
                  : "Unavailable"
              }
            />
            <VaultTruthNotice
              title="Stake snapshot"
              body={
                controlPlane?.stake_snapshot_complete == null
                  ? "Unavailable"
                  : controlPlane.stake_snapshot_complete
                    ? "Complete"
                    : "Partial"
              }
              tone={
                controlPlane?.stake_snapshot_complete === false
                  ? "warning"
                  : "neutral"
              }
            />
            <VaultTruthNotice
              title="Validator set coverage"
              body={
                controlPlane
                  ? `${controlPlane.validator_count}/${controlPlane.total_eligible_validators} validators in public snapshot.`
                  : "Unavailable"
              }
            />
          </div>

          <div className="mt-6 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  Universe Hash
                </p>
                <p className="mt-2 break-all font-mono text-xs text-cyan-100">
                  {controlPlane?.validator_universe_hash ?? "Unavailable"}
                </p>
              </div>
              {controlPlane?.validator_universe_hash ? (
                <CopyBtn text={controlPlane.validator_universe_hash} />
              ) : null}
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  Stake Snapshot Hash
                </p>
                <p className="mt-2 break-all font-mono text-xs text-cyan-100">
                  {controlPlane?.stake_snapshot_hash ?? "Unavailable"}
                </p>
              </div>
              {controlPlane?.stake_snapshot_hash ? (
                <CopyBtn text={controlPlane.stake_snapshot_hash} />
              ) : null}
            </div>
            {controlPlane?.warnings?.length ? (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber-200">
                  Active warnings
                </p>
                <div className="mt-3 space-y-2 text-sm text-amber-50">
                  {controlPlane.warnings.map((warning, index) => (
                    <p key={`${warning}-${index}`}>{warning}</p>
                  ))}
                </div>
              </div>
            ) : (
              <VaultTruthNotice
                title="Warning posture"
                body="No public control-plane warnings are active in the latest snapshot."
              />
            )}
          </div>
        </GlassCard>

        <div className="space-y-6">
          <GlassCard className="p-6">
            <h3 className="text-lg font-semibold text-white">
              Historical analytics are gated
            </h3>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              TVL history, reward ledgers, revenue charts, flow charts, and
              staker leaderboards are withheld until Cruzible has a verifiable,
              indexed history pipeline for each of those claims.
            </p>
            <div className="mt-5 space-y-3">
              <VaultTruthNotice
                title="What we will not do"
                body="Render seeded charts or guessed rankings to make the page feel complete."
                tone="warning"
              />
              <VaultTruthNotice
                title="What comes next"
                body="Public reconciliation scorecards, proof coverage, and addressable historical analytics once the indexer can defend them."
              />
            </div>
          </GlassCard>

          <GlassCard className="p-6">
            <h3 className="text-lg font-semibold text-white">
              World-class moat direction
            </h3>
            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
              <p>
                Cruzible’s moat should be provable trust: public freshness,
                solvency evidence, validator-universe lineage, and downloadable
                audit trails.
              </p>
              <p>
                Once historical pipelines are live, they should inherit the same
                rule: every user-visible metric must map back to a testable,
                explainable backend source.
              </p>
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN PAGE COMPONENT
// ============================================================================

export default function VaultPage() {
  const [activeTab, setActiveTab] = useState<VaultTab>("overview");
  const controlPlaneQuery = useQuery({
    queryKey: ["vault-control-plane"],
    queryFn: fetchReconciliationControlPlane,
    refetchInterval: 30000,
  });
  const controlPlane = controlPlaneQuery.data ?? null;

  const tabs = [
    { id: "overview" as VaultTab, label: "Overview" },
    { id: "stake" as VaultTab, label: "Stake" },
    { id: "unstake" as VaultTab, label: "Unstake" },
    { id: "rewards" as VaultTab, label: "Rewards" },
    { id: "analytics" as VaultTab, label: "Analytics" },
  ];

  return (
    <>
      <SEOHead
        title="Vault"
        description="AethelVault liquid staking protocol. Stake AETHEL tokens, earn rewards, and receive liquid stAETHEL for DeFi composability."
        path="/vault"
      />

      <div className="min-h-screen bg-slate-950 text-white font-[Inter,system-ui,sans-serif]">
        <TopNav activePage="vault" />

        <HeroSection controlPlane={controlPlane} />

        {/* Tab Navigation */}
        <div className="sticky top-16 z-40 bg-slate-900/80 backdrop-blur-xl border-b border-slate-700/50">
          <div className="max-w-[1400px] mx-auto px-6">
            <nav className="flex gap-1 -mb-px overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-5 py-3.5 text-sm font-medium border-b-2 whitespace-nowrap transition-all ${
                    activeTab === tab.id
                      ? "border-red-600 text-red-400"
                      : "border-transparent text-slate-500 hover:text-slate-300 hover:border-slate-600"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        <main className="max-w-[1400px] mx-auto px-6 py-8">
          {activeTab === "overview" && (
            <OverviewTab switchTab={setActiveTab} controlPlane={controlPlane} />
          )}
          {activeTab === "stake" && <StakeTab />}
          {activeTab === "unstake" && <UnstakeTab />}
          {activeTab === "rewards" && (
            <RewardsTab controlPlane={controlPlane} />
          )}
          {activeTab === "analytics" && (
            <AnalyticsTab controlPlane={controlPlane} />
          )}
        </main>

        <Footer />
      </div>
    </>
  );
}
