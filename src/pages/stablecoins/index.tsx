/**
 * Stablecoins — Bridge & Balances Dashboard
 *
 * 3-tab layout: Bridge, Balances, History
 * Phase 1: USDC bridge-out via CCTP
 * Phase 1.5: USDT visible as read-only
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { SEOHead } from "@/components/SEOHead";
import {
  ArrowUpRight,
  Coins,
  History,
  Wallet,
  AlertTriangle,
  ChevronDown,
  Shield,
  Activity,
} from "lucide-react";
import { useApp } from "@/contexts/AppContext";
import { TopNav, Footer, LiveDot } from "@/components/SharedComponents";
import { GlassCard } from "@/components/PagePrimitives";
import {
  STABLECOIN_ASSETS,
  StablecoinPhase,
  CCTP_DOMAINS,
  getAllStablecoins,
  getEnabledStablecoins,
  isStablecoinEnabled,
  type CCTPDomainName,
} from "@/lib/constants";
import {
  useBridgeOut,
  useStablecoinConfig,
  useStablecoinAllowance,
} from "@/hooks/useStablecoinBridge";
import { formatUnits, parseUnits } from "viem";
import { needsTokenApproval } from "@/lib/allowance";
import {
  fetchStablecoinBridgeHistory,
  formatStablecoinAmount,
  shortStablecoinHash,
} from "@/lib/stablecoinHistory";
import { getPublicErrorMessage } from "@/lib/publicErrors";
import {
  buildBridgeReadinessSignals,
  STABLECOIN_BRIDGE_DISCLOSURES,
  STABLECOIN_BRIDGE_STEPS,
  type BridgeRiskSignal,
} from "@/lib/stablecoinBridgeRisk";
import { isStablecoinBridgeAvailable } from "@/lib/stablecoinAvailability";

// ============================================================================
// TYPES
// ============================================================================

type StablecoinTab = "bridge" | "balances" | "history";

const STABLECOIN_PHASE_GUIDE = [
  {
    title: "Active",
    body: "The asset can enter bridge flows only after live on-chain config, wallet, allowance, and limit checks pass.",
    className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
  },
  {
    title: "Read Only",
    body: "Balances and history can be displayed, but bridge writes stay unavailable until the asset is promoted.",
    className: "border-amber-500/25 bg-amber-500/10 text-amber-200",
  },
  {
    title: "Coming Soon",
    body: "The asset is visible for roadmap context only and must not expose balance, approval, or bridge actions.",
    className: "border-white/10 bg-white/[0.03] text-gray-300",
  },
] as const;

// ============================================================================
// PHASE BADGE
// ============================================================================

function PhaseBadge({ phase }: { phase: StablecoinPhase }) {
  switch (phase) {
    case StablecoinPhase.ACTIVE:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
          <LiveDot color="green" /> Active
        </span>
      );
    case StablecoinPhase.READ_ONLY:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
          Read Only
        </span>
      );
    case StablecoinPhase.COMING_SOON:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-500/20 text-gray-400 border border-gray-500/30">
          Coming Soon
        </span>
      );
  }
}

function bridgeToneClasses(tone: BridgeRiskSignal["tone"]): string {
  switch (tone) {
    case "healthy":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
    case "warning":
      return "border-amber-500/25 bg-amber-500/10 text-amber-200";
    case "blocked":
      return "border-red-500/30 bg-red-500/10 text-red-200";
  }
}

function bridgeToneDotClass(tone: BridgeRiskSignal["tone"]): string {
  switch (tone) {
    case "healthy":
      return "bg-emerald-400 shadow-emerald-400/40";
    case "warning":
      return "bg-amber-400 shadow-amber-400/40";
    case "blocked":
      return "bg-red-400 shadow-red-400/40";
  }
}

function formatBridgeCap(
  value: bigint,
  decimals: number | undefined,
  symbol: string,
): string {
  if (!decimals) {
    return "Unavailable";
  }

  if (value <= 0n) {
    return "No explicit cap reported";
  }

  return `${formatUnits(value, decimals)} ${symbol}`;
}

function BridgeRiskCard({ signal }: { signal: BridgeRiskSignal }) {
  return (
    <div className={`rounded-xl border p-4 ${bridgeToneClasses(signal.tone)}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] opacity-70">
            {signal.title}
          </p>
          <p className="mt-1 text-sm font-semibold">{signal.status}</p>
        </div>
        <span
          aria-hidden="true"
          className={`mt-1 h-2.5 w-2.5 rounded-full shadow-lg ${bridgeToneDotClass(
            signal.tone,
          )}`}
        />
      </div>
      <p className="mt-3 text-xs leading-relaxed opacity-80">{signal.detail}</p>
    </div>
  );
}

function BridgeEducationPanel({ signals }: { signals: BridgeRiskSignal[] }) {
  const blockers = signals.filter((signal) => signal.tone === "blocked").length;
  const warnings = signals.filter((signal) => signal.tone === "warning").length;
  const readinessSummary =
    blockers > 0
      ? `${blockers} blocker${blockers === 1 ? "" : "s"}`
      : warnings > 0
        ? `${warnings} review item${warnings === 1 ? "" : "s"}`
        : "Ready to simulate";

  return (
    <GlassCard>
      <div className="p-6 space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Shield className="w-5 h-5 text-red-400" />
              Bridge Readiness Check
            </h3>
            <p className="mt-1 text-sm text-gray-400">
              Live config, wallet state, allowance, limits, and destination
              domain are reviewed before a transaction can be signed.
            </p>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-gray-200">
            {readinessSummary}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {signals.map((signal) => (
            <BridgeRiskCard key={signal.id} signal={signal} />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-gray-500">
              Bridge lifecycle
            </p>
            <ol className="mt-4 space-y-3">
              {STABLECOIN_BRIDGE_STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-xs font-semibold text-red-200 ring-1 ring-red-500/30">
                    {index + 1}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white">
                      {step.title}
                    </span>
                    <span className="block text-xs leading-relaxed text-gray-400">
                      {step.body}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-gray-500">
              User protection notes
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {STABLECOIN_BRIDGE_DISCLOSURES.map((item) => (
                <div key={item.title}>
                  <p className="text-sm font-semibold text-white">
                    {item.title}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-400">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

function StablecoinPhaseGuide() {
  return (
    <GlassCard>
      <div className="p-5">
        <h3 className="text-sm font-semibold text-white">
          Stablecoin phase policy
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">
          Registry phase is a launch control, not marketing copy. The UI must
          keep write operations unavailable unless both registry phase and live
          contract state agree.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {STABLECOIN_PHASE_GUIDE.map((item) => (
            <div
              key={item.title}
              className={`rounded-xl border p-3 ${item.className}`}
            >
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="mt-1 text-xs leading-relaxed opacity-80">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}

function BridgeHistoryNotice() {
  return (
    <GlassCard>
      <div className="p-5">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Shield className="h-4 w-4 text-red-400" />
          Bridge history limitations
        </h3>
        <div className="mt-3 grid gap-3 text-xs leading-relaxed text-gray-400 md:grid-cols-3">
          <p>
            Events are indexed from the bridge contract and may lag source-chain
            finality or downstream destination execution.
          </p>
          <p>
            Empty history means no indexed event was returned for active assets,
            not proof that every external transfer path is inactive.
          </p>
          <p>
            Transaction hashes, senders, and timestamps are shortened for UI
            readability; settlement review should use the full explorer record.
          </p>
        </div>
      </div>
    </GlassCard>
  );
}

// ============================================================================
// BRIDGE TAB
// ============================================================================

function BridgeTab() {
  const { wallet } = useApp();
  const enabledAssets = getEnabledStablecoins();
  const [selectedSymbol, setSelectedSymbol] = useState(
    enabledAssets[0]?.symbol ?? "USDC",
  );
  const [amount, setAmount] = useState("");
  const [destDomain, setDestDomain] = useState<CCTPDomainName>("ETHEREUM");

  const asset = STABLECOIN_ASSETS[selectedSymbol];
  const balanceSnapshot = wallet.balanceSnapshots?.stablecoins[selectedSymbol];
  const balanceAvailable = balanceSnapshot?.status === "available";
  const balance = balanceAvailable ? (balanceSnapshot.value ?? 0) : null;
  const balanceUnits = balanceAvailable
    ? (balanceSnapshot.valueUnits ?? 0n)
    : 0n;
  const config = useStablecoinConfig(selectedSymbol);
  const { allowance, isLoading: allowanceLoading } =
    useStablecoinAllowance(selectedSymbol);
  const { bridgeOut, isPending } = useBridgeOut();
  const parsedAmount = useMemo(() => {
    if (!asset || !amount) {
      return 0n;
    }

    try {
      return parseUnits(amount, asset.decimals);
    } catch {
      return 0n;
    }
  }, [amount, asset]);
  const approvalRequired =
    parsedAmount > 0n && needsTokenApproval(allowance, parsedAmount);

  const onChainLoading = config.isLoading;
  const dailyLimitExceeded =
    parsedAmount > 0n &&
    config.dailyTxLimit > 0n &&
    parsedAmount > config.dailyTxLimit;
  const mintCeilingExceeded =
    parsedAmount > 0n &&
    config.mintCeilingPerEpoch > 0n &&
    parsedAmount > config.mintCeilingPerEpoch;
  const limitBlocked = dailyLimitExceeded || mintCeilingExceeded;
  const readinessSignals = useMemo(
    () =>
      buildBridgeReadinessSignals({
        assetSymbol: selectedSymbol,
        assetPhase: asset?.phase ?? null,
        configLoading: onChainLoading,
        configEnabled: onChainLoading ? null : config.enabled,
        mintPaused: onChainLoading ? null : config.mintPaused,
        dailyTxLimit: onChainLoading ? null : config.dailyTxLimit,
        mintCeilingPerEpoch: onChainLoading ? null : config.mintCeilingPerEpoch,
        walletConnected: wallet.connected,
        wrongNetwork: wallet.isWrongNetwork,
        allowanceLoading,
        approvalRequired,
        amountEntered: parsedAmount > 0n,
        parsedAmount,
        destinationDomain: CCTP_DOMAINS[destDomain],
      }),
    [
      selectedSymbol,
      asset?.phase,
      onChainLoading,
      config.enabled,
      config.mintPaused,
      config.dailyTxLimit,
      config.mintCeilingPerEpoch,
      wallet.connected,
      wallet.isWrongNetwork,
      allowanceLoading,
      approvalRequired,
      parsedAmount,
      destDomain,
    ],
  );

  const handleMaxClick = useCallback(() => {
    if (!asset || !balanceAvailable) return;

    setAmount(formatUnits(balanceUnits, asset.decimals));
  }, [asset, balanceAvailable, balanceUnits]);

  const handleBridge = useCallback(async () => {
    if (parsedAmount <= 0n) return;
    const txHash = await bridgeOut(
      selectedSymbol,
      amount,
      CCTP_DOMAINS[destDomain],
      config,
    );
    // Only clear the input on a successful bridge — undefined means the tx
    // failed, was rejected, or was blocked by an on-chain gate.
    if (txHash) {
      setAmount("");
    }
  }, [selectedSymbol, amount, parsedAmount, destDomain, bridgeOut, config]);

  // Disable submission until the live on-chain bridge config has loaded.
  const onChainBlocked =
    !onChainLoading && (config.enabled === false || config.mintPaused === true);
  const isDisabled =
    isPending ||
    onChainLoading ||
    !wallet.connected ||
    wallet.isWrongNetwork ||
    !balanceAvailable ||
    !amount ||
    parsedAmount <= 0n ||
    parsedAmount > balanceUnits ||
    limitBlocked ||
    onChainBlocked;
  const limitBlockMessage = dailyLimitExceeded
    ? `${selectedSymbol} amount exceeds the live daily bridge limit of ${formatBridgeCap(
        config.dailyTxLimit,
        asset?.decimals,
        selectedSymbol,
      )}.`
    : mintCeilingExceeded
      ? `${selectedSymbol} amount exceeds the live epoch mint ceiling of ${formatBridgeCap(
          config.mintCeilingPerEpoch,
          asset?.decimals,
          selectedSymbol,
        )}.`
      : null;

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      {onChainLoading && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Verifying live on-chain bridge configuration before enabling
            approvals.
          </span>
        </div>
      )}

      {onChainBlocked && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {config.mintPaused
              ? "Minting is currently paused on-chain. Bridge-out operations are unavailable."
              : "This stablecoin is not currently enabled on-chain. Bridge operations are unavailable."}
          </span>
        </div>
      )}

      {limitBlockMessage && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{limitBlockMessage}</span>
        </div>
      )}

      <BridgeEducationPanel signals={readinessSignals} />

      {/* Bridge Form */}
      <GlassCard>
        <div className="p-6 space-y-5">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <ArrowUpRight className="w-5 h-5 text-red-400" />
            Bridge Out via CCTP
          </h3>

          {/* Token Selector */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Token</label>
            <div className="relative">
              <select
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white appearance-none cursor-pointer focus:border-red-500/50 focus:outline-none"
              >
                {enabledAssets.map((a) => (
                  <option
                    key={a.symbol}
                    value={a.symbol}
                    className="bg-gray-900"
                  >
                    {a.symbol} — {a.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* Amount Input */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-sm text-gray-400">Amount</label>
              <button
                onClick={handleMaxClick}
                disabled={!balanceAvailable}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Balance:{" "}
                {balanceAvailable && balance != null
                  ? balance.toLocaleString()
                  : "Unavailable"}{" "}
                {selectedSymbol}
              </button>
            </div>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:border-red-500/50 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>

          {/* Destination Domain */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              Destination Chain
            </label>
            <div className="relative">
              <select
                value={destDomain}
                onChange={(e) =>
                  setDestDomain(e.target.value as CCTPDomainName)
                }
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white appearance-none cursor-pointer focus:border-red-500/50 focus:outline-none"
              >
                {(Object.keys(CCTP_DOMAINS) as CCTPDomainName[]).map((name) => (
                  <option key={name} value={name} className="bg-gray-900">
                    {name.charAt(0) + name.slice(1).toLowerCase()} (Domain{" "}
                    {CCTP_DOMAINS[name]})
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* Info Row */}
          <div className="flex justify-between text-sm text-gray-400 pt-2">
            <span>Decimals</span>
            <span>{asset?.decimals ?? "—"}</span>
          </div>
          <div className="flex justify-between text-sm text-gray-400">
            <span>Allowance precheck</span>
            <span className="text-right text-gray-300">
              {!wallet.connected
                ? "Connect wallet"
                : allowanceLoading
                  ? "Loading..."
                  : parsedAmount <= 0n
                    ? "Enter amount"
                    : approvalRequired
                      ? "Approval required"
                      : "Ready"}
            </span>
          </div>
          <div className="flex justify-between gap-4 text-sm text-gray-400">
            <span>Pre-sign simulation</span>
            <span className="text-right text-emerald-300">
              Approval and bridge checked before wallet opens
            </span>
          </div>
          <div className="flex justify-between gap-4 text-sm text-gray-400">
            <span>Daily bridge limit</span>
            <span className="text-right text-gray-300">
              {onChainLoading
                ? "Verifying..."
                : formatBridgeCap(
                    config.dailyTxLimit,
                    asset?.decimals,
                    selectedSymbol,
                  )}
            </span>
          </div>
          <div className="flex justify-between gap-4 text-sm text-gray-400">
            <span>Epoch mint ceiling</span>
            <span className="text-right text-gray-300">
              {onChainLoading
                ? "Verifying..."
                : formatBridgeCap(
                    config.mintCeilingPerEpoch,
                    asset?.decimals,
                    selectedSymbol,
                  )}
            </span>
          </div>

          {/* Submit */}
          <button
            onClick={handleBridge}
            disabled={isDisabled}
            className={`w-full py-3.5 rounded-lg font-semibold text-sm transition-all ${
              isDisabled
                ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                : "bg-gradient-to-r from-red-600 to-red-500 text-white hover:from-red-500 hover:to-red-400 shadow-lg shadow-red-500/20"
            }`}
          >
            {isPending
              ? "Processing..."
              : onChainLoading
                ? "Verifying Bridge Config..."
                : `Bridge ${selectedSymbol}`}
          </button>
        </div>
      </GlassCard>
    </div>
  );
}

// ============================================================================
// BALANCES TAB
// ============================================================================

function BalancesTab() {
  const { wallet } = useApp();
  const allAssets = getAllStablecoins();

  return (
    <div className="space-y-4">
      <StablecoinPhaseGuide />

      <GlassCard>
        <div className="p-6">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
            <Wallet className="w-5 h-5 text-red-400" />
            Stablecoin Balances
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 px-4 text-xs uppercase tracking-wider text-gray-500 font-medium">
                    Asset
                  </th>
                  <th className="text-right py-3 px-4 text-xs uppercase tracking-wider text-gray-500 font-medium">
                    Balance
                  </th>
                  <th className="text-right py-3 px-4 text-xs uppercase tracking-wider text-gray-500 font-medium">
                    Decimals
                  </th>
                  <th className="text-center py-3 px-4 text-xs uppercase tracking-wider text-gray-500 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {allAssets.map((asset) => {
                  const snapshot =
                    wallet.balanceSnapshots?.stablecoins[asset.symbol];
                  const bal =
                    snapshot?.status === "available" ? snapshot.value : null;
                  return (
                    <tr
                      key={asset.symbol}
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white">
                            {asset.symbol.slice(0, 2)}
                          </div>
                          <div>
                            <div className="text-white font-medium">
                              {asset.symbol}
                            </div>
                            <div className="text-xs text-gray-500">
                              {asset.name}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-right font-mono text-white">
                        {wallet.connected && bal != null
                          ? bal.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 6,
                            })
                          : wallet.connected
                            ? "Unavailable"
                            : "—"}
                      </td>
                      <td className="py-4 px-4 text-right text-gray-400 text-sm">
                        {asset.decimals}
                      </td>
                      <td className="py-4 px-4 text-center">
                        <PhaseBadge phase={asset.phase} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!wallet.connected && (
            <div className="text-center py-6 text-gray-500 text-sm">
              Connect your wallet to see balances.
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

// ============================================================================
// HISTORY TAB
// ============================================================================

function HistoryTab() {
  const activeAssets = useMemo(() => getEnabledStablecoins(), []);
  const {
    data: events = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: [
      "stablecoin-bridge-history",
      activeAssets.map((asset) => asset.assetId).join(","),
    ],
    queryFn: () => fetchStablecoinBridgeHistory(activeAssets),
    enabled: activeAssets.length > 0,
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-4">
      <BridgeHistoryNotice />

      <GlassCard>
        <div className="p-6">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
            <History className="w-5 h-5 text-red-400" />
            Bridge History
          </h3>

          {isLoading ? (
            <div className="text-center py-12 text-gray-500">
              <Activity className="w-10 h-10 mx-auto mb-3 text-gray-600 animate-pulse" />
              <p className="text-sm">Loading indexed bridge events...</p>
            </div>
          ) : isError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              {getPublicErrorMessage(error, "Unable to load bridge history.")}
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Activity className="w-10 h-10 mx-auto mb-3 text-gray-600" />
              <p className="text-sm">No indexed bridge events yet.</p>
              <p className="text-xs text-gray-600 mt-1">
                Events are synced from the InstitutionalStablecoinBridge
                contract.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-gray-500">
                    <th className="py-3 pr-4">Event</th>
                    <th className="py-3 px-4">Asset</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                    <th className="py-3 px-4">Sender</th>
                    <th className="py-3 px-4">Tx</th>
                    <th className="py-3 pl-4 text-right">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr
                      key={event.id}
                      className="border-b border-white/5 last:border-0"
                    >
                      <td className="py-4 pr-4 text-sm font-medium text-white">
                        {event.eventType}
                      </td>
                      <td className="py-4 px-4 text-sm text-gray-300">
                        {event.symbol}
                      </td>
                      <td className="py-4 px-4 text-right font-mono text-sm text-white">
                        {formatStablecoinAmount(event.amount, event.decimals)}
                      </td>
                      <td className="py-4 px-4 font-mono text-xs text-gray-400">
                        {shortStablecoinHash(event.sender)}
                      </td>
                      <td className="py-4 px-4 font-mono text-xs text-gray-400">
                        {shortStablecoinHash(event.txHash)}
                      </td>
                      <td className="py-4 pl-4 text-right text-xs text-gray-500">
                        {new Date(event.timestamp).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function StablecoinsPage() {
  const [activeTab, setActiveTab] = useState<StablecoinTab>("bridge");
  const bridgeAvailable = isStablecoinBridgeAvailable();

  const tabs: { id: StablecoinTab; label: string }[] = [
    { id: "bridge", label: "Bridge" },
    { id: "balances", label: "Balances" },
    { id: "history", label: "History" },
  ];

  return (
    <>
      <SEOHead
        title="Stablecoins | Cruzible by Aethelred"
        description={
          bridgeAvailable
            ? "Bridge stablecoins via CCTP. View balances and bridge history."
            : "Stablecoin bridge availability and release status."
        }
      />

      <div className="min-h-screen bg-gray-950 text-white">
        <TopNav activePage="stablecoins" />

        <main id="main-content" className="max-w-5xl mx-auto px-4 pt-24 pb-16">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-red-500 flex items-center justify-center">
                <Coins className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Stablecoins</h1>
                <p className="text-sm text-gray-400">
                  {bridgeAvailable
                    ? "Bridge stablecoins via CCTP"
                    : "Stablecoin bridge unavailable"}
                </p>
              </div>
            </div>
          </div>

          {!bridgeAvailable ? (
            <GlassCard className="border-amber-500/20 bg-amber-500/[0.04] p-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                <div>
                  <h2 className="font-semibold text-white">
                    Stablecoins unavailable
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
                    Cruzible has not released an end-to-end stablecoin route.
                    Source-chain burn, attestation and relaying, destination
                    mint, and recovery evidence must all pass the release gate
                    before bridge actions are exposed.
                  </p>
                </div>
              </div>
            </GlassCard>
          ) : (
            <>
              {/* Tabs */}
              <div className="flex gap-1 mb-6 p-1 bg-white/5 rounded-lg w-fit">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      activeTab === tab.id
                        ? "bg-red-600 text-white shadow-lg shadow-red-500/20"
                        : "text-gray-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              {activeTab === "bridge" && <BridgeTab />}
              {activeTab === "balances" && <BalancesTab />}
              {activeTab === "history" && <HistoryTab />}
            </>
          )}
        </main>

        <Footer />
      </div>
    </>
  );
}
