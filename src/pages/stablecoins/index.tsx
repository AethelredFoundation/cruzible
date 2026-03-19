/**
 * Stablecoins — Bridge & Balances Dashboard
 *
 * 3-tab layout: Bridge, Balances, History
 * Phase 1: USDC bridge-out via CCTP
 * Phase 1.5: USDT visible as read-only
 */

import { useState, useMemo, useCallback } from "react";
import { SEOHead } from "@/components/SEOHead";
import {
  ArrowUpRight,
  Coins,
  History,
  Wallet,
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  Shield,
  Activity,
} from "lucide-react";
import { useApp } from "@/contexts/AppContext";
import {
  TopNav,
  Footer,
  Tabs,
  Badge,
  LiveDot,
} from "@/components/SharedComponents";
import { GlassCard } from "@/components/PagePrimitives";
import { BRAND, STATUS_STYLES } from "@/lib/constants";
import {
  STABLECOIN_ASSETS,
  StablecoinPhase,
  CCTP_DOMAINS,
  getAllStablecoins,
  getEnabledStablecoins,
  isStablecoinEnabled,
  type StablecoinAsset,
  type CCTPDomainName,
} from "@/lib/constants";
import {
  useBridgeOut,
  useStablecoinConfig,
  useStablecoinAllowance,
} from "@/hooks/useStablecoinBridge";
import { formatUnits } from "viem";

// ============================================================================
// TYPES
// ============================================================================

type StablecoinTab = "bridge" | "balances" | "history";

// ============================================================================
// PHASE BADGE
// ============================================================================

function PhaseBadge({ phase }: { phase: StablecoinPhase }) {
  switch (phase) {
    case StablecoinPhase.ACTIVE:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
          <LiveDot color="emerald" /> Active
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
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-500/20 text-slate-400 border border-slate-500/30">
          Coming Soon
        </span>
      );
  }
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
  const balance = wallet.stablecoinBalances[selectedSymbol] ?? 0;
  const config = useStablecoinConfig(selectedSymbol);
  const { bridgeOut, isPending } = useBridgeOut();

  const handleMaxClick = useCallback(() => {
    setAmount(balance.toString());
  }, [balance]);

  const handleBridge = useCallback(async () => {
    if (!amount || parseFloat(amount) <= 0) return;
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
  }, [selectedSymbol, amount, destDomain, bridgeOut, config]);

  // Disable submission when on-chain config says asset is disabled or paused
  const onChainBlocked =
    !config.isLoading &&
    (config.enabled === false || config.mintPaused === true);
  const isDisabled =
    isPending ||
    !wallet.connected ||
    !amount ||
    parseFloat(amount) <= 0 ||
    parseFloat(amount) > balance ||
    onChainBlocked;

  return (
    <div className="space-y-6">
      {/* Status Banner */}
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

      {/* Bridge Form */}
      <GlassCard>
        <div className="p-6 space-y-5">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <ArrowUpRight className="w-5 h-5 text-red-400" />
            Bridge Out via CCTP
          </h3>

          {/* Token Selector */}
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Token</label>
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
                    className="bg-slate-900"
                  >
                    {a.symbol} — {a.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {/* Amount Input */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-sm text-slate-400">Amount</label>
              <button
                onClick={handleMaxClick}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Balance: {balance.toLocaleString()} {selectedSymbol}
              </button>
            </div>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:border-red-500/50 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>

          {/* Destination Domain */}
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">
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
                  <option key={name} value={name} className="bg-slate-900">
                    {name.charAt(0) + name.slice(1).toLowerCase()} (Domain{" "}
                    {CCTP_DOMAINS[name]})
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {/* Info Row */}
          <div className="flex justify-between text-sm text-slate-400 pt-2">
            <span>Decimals</span>
            <span>{asset?.decimals ?? "—"}</span>
          </div>

          {/* Submit */}
          <button
            onClick={handleBridge}
            disabled={isDisabled}
            className={`w-full py-3.5 rounded-lg font-semibold text-sm transition-all ${
              isDisabled
                ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                : "bg-gradient-to-r from-red-600 to-red-500 text-white hover:from-red-500 hover:to-red-400 shadow-lg shadow-red-500/20"
            }`}
          >
            {isPending ? "Processing..." : `Bridge ${selectedSymbol}`}
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
                  <th className="text-left py-3 px-4 text-xs uppercase tracking-wider text-slate-500 font-medium">
                    Asset
                  </th>
                  <th className="text-right py-3 px-4 text-xs uppercase tracking-wider text-slate-500 font-medium">
                    Balance
                  </th>
                  <th className="text-right py-3 px-4 text-xs uppercase tracking-wider text-slate-500 font-medium">
                    Decimals
                  </th>
                  <th className="text-center py-3 px-4 text-xs uppercase tracking-wider text-slate-500 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {allAssets.map((asset) => {
                  const bal = wallet.stablecoinBalances[asset.symbol] ?? 0;
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
                            <div className="text-xs text-slate-500">
                              {asset.name}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-right font-mono text-white">
                        {wallet.connected
                          ? bal.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 6,
                            })
                          : "—"}
                      </td>
                      <td className="py-4 px-4 text-right text-slate-400 text-sm">
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
            <div className="text-center py-6 text-slate-500 text-sm">
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
  // Placeholder — will be connected to backend API via React Query
  return (
    <div className="space-y-4">
      <GlassCard>
        <div className="p-6">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
            <History className="w-5 h-5 text-red-400" />
            Bridge History
          </h3>

          <div className="text-center py-12 text-slate-500">
            <Activity className="w-10 h-10 mx-auto mb-3 text-slate-600" />
            <p className="text-sm">
              Bridge event history will appear here once events are indexed.
            </p>
            <p className="text-xs text-slate-600 mt-1">
              Events are synced from the InstitutionalStablecoinBridge contract.
            </p>
          </div>
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

  const tabs: { id: StablecoinTab; label: string }[] = [
    { id: "bridge", label: "Bridge" },
    { id: "balances", label: "Balances" },
    { id: "history", label: "History" },
  ];

  return (
    <>
      <SEOHead
        title="Stablecoins | Cruzible by Aethelred"
        description="Bridge stablecoins via CCTP. View balances and bridge history."
      />

      <div className="min-h-screen bg-[#050810] text-white">
        <TopNav activePage="stablecoins" />

        <main className="max-w-5xl mx-auto px-4 pt-24 pb-16">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-red-500 flex items-center justify-center">
                <Coins className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Stablecoins</h1>
                <p className="text-sm text-slate-400">
                  Bridge stablecoins via CCTP
                </p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-6 p-1 bg-white/5 rounded-lg w-fit">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? "bg-red-600 text-white shadow-lg shadow-red-500/20"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
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
        </main>

        <Footer />
      </div>
    </>
  );
}
