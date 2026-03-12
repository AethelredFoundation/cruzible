/**
 * Aethelred Explorer - Main Landing Page
 *
 * World-class blockchain explorer for the Aethelred sovereign AI verification
 * network. Features real-time block/transaction feeds, network statistics,
 * validator previews, AI verification jobs, protocol metrics, epoch timeline,
 * chain comparison, and protocol education sections.
 *
 * All real-time data flows from AppContext. Mock data uses seededRandom for
 * deterministic SSR hydration.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { SEOHead } from '@/components/SEOHead';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  Search, Activity, Blocks, Shield, Cpu, Users, TrendingUp, Clock,
  CheckCircle, ArrowUpRight, ArrowDownRight, ChevronRight, ExternalLink,
  Copy, Check, Zap, Lock, Server, Globe, Wallet, Eye,
  ShieldCheck, BarChart3, Layers, Award, RefreshCw, Hash,
  ArrowRight, Fingerprint, Brain, FileCheck, CircleDot, Box,
  Gauge, Timer, Flame, Database, Network, X, ChevronDown, ChevronUp,
  AlertCircle, Code, FileCode, Sparkles, Star, ArrowDown, Play,
  Radio, XCircle, Minus, Plus, MapPin, Link2,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { TopNav, Footer } from '@/components/SharedComponents';
import { seededRandom, seededHex, seededAddress, formatNumber, truncateAddress } from '@/lib/utils';
import { BRAND } from '@/lib/constants';
import { GlassCard, CopyButton, SectionHeader, Sparkline } from '@/components/PagePrimitives';


// =============================================================================
// CHART & LOCAL CONSTANTS
// =============================================================================

const CHART_COLORS = [
  '#DC2626', '#F87171', '#FCA5A5', '#FECACA', '#FEE2E2',
  '#10B981', '#3B82F6', '#8B5CF6', '#F59E0B',
];

const TX_TYPE_COLORS: Record<string, string> = {
  Transfer: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  Stake: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  Unstake: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  DeployContract: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  SubmitAIJob: 'bg-red-500/20 text-red-400 border-red-500/30',
  Vote: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  ClaimRewards: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
};

const TX_TYPE_DOT_COLORS: Record<string, string> = {
  Transfer: 'bg-blue-400',
  Stake: 'bg-emerald-400',
  Unstake: 'bg-amber-400',
  DeployContract: 'bg-purple-400',
  SubmitAIJob: 'bg-red-400',
  Vote: 'bg-cyan-400',
  ClaimRewards: 'bg-yellow-400',
};


// =============================================================================
// DATA GENERATORS
// =============================================================================

function generateSeededArray(baseSeed: number, length: number, min: number, max: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < length; i++) {
    result.push(min + seededRandom(baseSeed + i) * (max - min));
  }
  return result;
}

function truncateHash(hash: string, startLen = 8, endLen = 6): string {
  if (hash.length <= startLen + endLen + 3) return hash;
  return `${hash.slice(0, startLen)}...${hash.slice(-endLen)}`;
}


// =============================================================================
// MOCK DATA CONSTANTS
// =============================================================================

const VALIDATOR_NAMES = [
  'Aethelred Foundation', 'Paradigm Stake', 'a16z Validator',
  'Coinbase Cloud', 'Figment Networks', 'Chorus One',
  'P2P Validator', 'Everstake', 'Blockdaemon', 'Kiln Finance',
];

const TX_TYPES = ['Transfer', 'Stake', 'Unstake', 'DeployContract', 'SubmitAIJob', 'Vote', 'ClaimRewards'] as const;

const AI_MODELS = ['GPT-4 Turbo', 'Claude 3 Opus', 'Llama 3 70B', 'Gemini Ultra', 'Mistral Large'] as const;

const JOB_STATUSES = ['Verified', 'Processing', 'Failed'] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MockBlock {
  number: number;
  hash: string;
  parentHash: string;
  timestamp: number;
  validator: string;
  validatorAddr: string;
  txCount: number;
  gasUsed: number;
  gasLimit: number;
  reward: number;
  transactions: string[];
}

interface MockTransaction {
  hash: string;
  blockNumber: number;
  from: string;
  to: string;
  value: number;
  type: typeof TX_TYPES[number];
  status: 'Success' | 'Failed' | 'Pending';
  gasUsed: number;
  gasLimit: number;
  gasPrice: number;
  fee: number;
  nonce: number;
  method: string;
  timestamp: number;
  inputData: string;
  events: { name: string; args: Record<string, string> }[];
}

interface MockAIJob {
  id: string;
  model: string;
  status: typeof JOB_STATUSES[number];
  computeTime: string;
  cost: number;
  verificationScore: number;
  submitter: string;
  inputHash: string;
  outputHash: string;
  teeAttestation: string;
  verificationProof: string;
  cpuCycles: number;
  memoryUsed: number;
}


// ---------------------------------------------------------------------------
// Generate initial mock blocks
// ---------------------------------------------------------------------------

function generateMockBlock(blockNum: number, seed: number): MockBlock {
  const valIdx = Math.floor(seededRandom(seed + 1) * VALIDATOR_NAMES.length);
  const txCount = Math.floor(50 + seededRandom(seed + 2) * 180);
  const gasUsed = Math.floor(40 + seededRandom(seed + 3) * 55);
  const txHashes: string[] = [];
  for (let t = 0; t < Math.min(txCount, 8); t++) {
    txHashes.push(`0x${seededHex(seed + t * 100 + 10, 64)}`);
  }
  return {
    number: blockNum,
    hash: `0x${seededHex(seed + 4, 64)}`,
    parentHash: `0x${seededHex(seed + 5, 64)}`,
    timestamp: Date.now() - (20 - (blockNum % 20)) * 2500,
    validator: VALIDATOR_NAMES[valIdx],
    validatorAddr: seededAddress(seed + 6),
    txCount,
    gasUsed,
    gasLimit: 100,
    reward: 2.5,
    transactions: txHashes,
  };
}

function generateMockTx(seed: number, blockNum: number): MockTransaction {
  const typeIdx = Math.floor(seededRandom(seed + 1) * TX_TYPES.length);
  const type = TX_TYPES[typeIdx];
  const statusRoll = seededRandom(seed + 2);
  const status = statusRoll > 0.92 ? 'Failed' : statusRoll > 0.85 ? 'Pending' : 'Success';
  const value = parseFloat((seededRandom(seed + 3) * 50000).toFixed(2));
  const gasUsed = Math.floor(21000 + seededRandom(seed + 4) * 200000);
  const gasPrice = parseFloat((0.001 + seededRandom(seed + 5) * 0.004).toFixed(4));
  const methods: Record<string, string> = {
    Transfer: 'transfer(address,uint256)',
    Stake: 'stake(uint256)',
    Unstake: 'unstake(uint256)',
    DeployContract: 'constructor()',
    SubmitAIJob: 'submitJob(bytes32,bytes)',
    Vote: 'castVote(uint256,bool)',
    ClaimRewards: 'claimRewards()',
  };
  return {
    hash: `0x${seededHex(seed + 6, 64)}`,
    blockNumber: blockNum,
    from: seededAddress(seed + 7),
    to: type === 'DeployContract' ? `0x${seededHex(seed + 8, 40)}` : seededAddress(seed + 9),
    value,
    type,
    status: status as MockTransaction['status'],
    gasUsed,
    gasLimit: gasUsed + Math.floor(seededRandom(seed + 10) * 50000),
    gasPrice,
    fee: parseFloat((gasUsed * gasPrice * 0.000001).toFixed(6)),
    nonce: Math.floor(seededRandom(seed + 11) * 500),
    method: methods[type] || 'unknown()',
    timestamp: Date.now() - Math.floor(seededRandom(seed + 12) * 60000),
    inputData: `0x${seededHex(seed + 13, 128)}`,
    events: [
      { name: 'Transfer', args: { from: truncateAddress(seededAddress(seed + 14)), to: truncateAddress(seededAddress(seed + 15)), value: value.toFixed(2) } },
      { name: 'Approval', args: { owner: truncateAddress(seededAddress(seed + 16)), spender: truncateAddress(seededAddress(seed + 17)), value: '∞' } },
    ],
  };
}

function generateMockAIJob(seed: number): MockAIJob {
  const modelIdx = Math.floor(seededRandom(seed + 1) * AI_MODELS.length);
  const statusIdx = Math.floor(seededRandom(seed + 2) * 10);
  const status = statusIdx < 7 ? 'Verified' : statusIdx < 9 ? 'Processing' : 'Failed';
  const minutes = Math.floor(1 + seededRandom(seed + 3) * 15);
  const seconds = Math.floor(seededRandom(seed + 4) * 60);
  return {
    id: `JOB-${284700 + Math.floor(seededRandom(seed + 5) * 100)}`,
    model: AI_MODELS[modelIdx],
    status: status as MockAIJob['status'],
    computeTime: `${minutes}m ${seconds}s`,
    cost: parseFloat((50 + seededRandom(seed + 6) * 2000).toFixed(0)),
    verificationScore: parseFloat((85 + seededRandom(seed + 7) * 15).toFixed(1)),
    submitter: seededAddress(seed + 8),
    inputHash: `0x${seededHex(seed + 9, 64)}`,
    outputHash: `0x${seededHex(seed + 10, 64)}`,
    teeAttestation: `0x${seededHex(seed + 11, 128)}`,
    verificationProof: `0x${seededHex(seed + 12, 128)}`,
    cpuCycles: Math.floor(1e9 + seededRandom(seed + 13) * 9e9),
    memoryUsed: Math.floor(2 + seededRandom(seed + 14) * 30),
  };
}


// ---------------------------------------------------------------------------
// Generate initial datasets
// ---------------------------------------------------------------------------

const BASE_BLOCK = 2_847_391;

function generateInitialBlocks(count: number): MockBlock[] {
  const blocks: MockBlock[] = [];
  for (let i = 0; i < count; i++) {
    blocks.push(generateMockBlock(BASE_BLOCK - i, 1000 + i * 37));
  }
  return blocks;
}

function generateInitialTransactions(count: number): MockTransaction[] {
  const txs: MockTransaction[] = [];
  for (let i = 0; i < count; i++) {
    const blockNum = BASE_BLOCK - Math.floor(i / 3);
    txs.push(generateMockTx(2000 + i * 41, blockNum));
  }
  return txs;
}

function generateInitialAIJobs(): MockAIJob[] {
  const jobs: MockAIJob[] = [];
  for (let i = 0; i < 6; i++) {
    jobs.push(generateMockAIJob(3000 + i * 53));
  }
  return jobs;
}


// ---------------------------------------------------------------------------
// Chart data generators
// ---------------------------------------------------------------------------

function generateTPSHistory(): { time: string; tps: number }[] {
  const data: { time: string; tps: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const hour = (24 - i) % 24;
    const label = `${hour.toString().padStart(2, '0')}:00`;
    const baseTps = 2200 + seededRandom(i * 7 + 3) * 600;
    data.push({ time: label, tps: Math.round(baseTps) });
  }
  return data;
}

function generateDailyTxCount(): { date: string; count: number }[] {
  const data: { date: string; count: number }[] = [];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (let i = 6; i >= 0; i--) {
    const count = Math.round(95_000 + seededRandom(i * 13 + 7) * 30_000);
    data.push({ date: days[6 - i], count });
  }
  return data;
}

function generateGasUsage(): { time: string; gas: number; limit: number }[] {
  const data: { time: string; gas: number; limit: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const hour = (24 - i) % 24;
    const label = `${hour.toString().padStart(2, '0')}:00`;
    const gas = Math.round(60 + seededRandom(i * 17 + 11) * 35);
    data.push({ time: label, gas, limit: 100 });
  }
  return data;
}


// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function formatUSD(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function timeAgo(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < 1000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatFullDate(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}


// =============================================================================
// REUSABLE COMPONENTS (LOCAL)
// =============================================================================

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Success: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    Verified: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    Failed: 'bg-red-500/20 text-red-400 border border-red-500/30',
    Pending: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
    Processing: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
    Active: 'bg-red-500/20 text-red-400 border border-red-500/30',
    Completed: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-slate-700 text-slate-300'}`}>
      {status === 'Success' || status === 'Verified' || status === 'Completed' ? <CheckCircle className="w-3 h-3" /> : null}
      {status === 'Failed' ? <XCircle className="w-3 h-3" /> : null}
      {status === 'Pending' || status === 'Processing' ? <Clock className="w-3 h-3" /> : null}
      {status}
    </span>
  );
}

function ProgressBarLocal({ value, max = 100, color = 'red' }: { value: number; max?: number; color?: string }) {
  const pct = Math.min((value / max) * 100, 100);
  const colorMap: Record<string, string> = {
    red: 'bg-red-500',
    green: 'bg-emerald-500',
    blue: 'bg-blue-500',
    amber: 'bg-amber-500',
    purple: 'bg-purple-500',
  };
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${colorMap[color] || colorMap.red}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400 tabular-nums w-12 text-right">{pct.toFixed(1)}%</span>
    </div>
  );
}

function ProgressRingLocal({ value, size = 56, strokeWidth = 4, color = BRAND.red }: { value: number; size?: number; strokeWidth?: number; color?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(51,65,85,0.5)" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-700" />
    </svg>
  );
}


// =============================================================================
// MODAL COMPONENT
// =============================================================================

function ModalOverlay({ open, onClose, title, children, wide = false }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className={`relative bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-2xl'} w-full max-h-[85vh] overflow-hidden animate-fade-in`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(85vh-64px)] p-6">
          {children}
        </div>
      </div>
    </div>
  );
}


// =============================================================================
// TOP NAV (DARK)
// =============================================================================

/* TopNav is now imported from SharedComponents */


// =============================================================================
// HERO SECTION
// =============================================================================

interface SearchResult {
  type: 'block' | 'transaction' | 'address';
  label: string;
  value: string;
}

function HeroSection({ onBlockClick, onTxClick }: { onBlockClick: (block: MockBlock) => void; onTxClick: (tx: MockTransaction) => void }) {
  const { realTime } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Close search results on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Generate search results
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    const results: SearchResult[] = [];
    const q = searchQuery.trim().toLowerCase();

    // Number input -> block
    if (/^\d+$/.test(q)) {
      const num = parseInt(q, 10);
      results.push({ type: 'block', label: `Block #${num.toLocaleString()}`, value: q });
      if (num > 1000) {
        results.push({ type: 'block', label: `Block #${(num - 1).toLocaleString()}`, value: String(num - 1) });
      }
    }

    // 0x prefix -> transaction
    if (q.startsWith('0x')) {
      results.push({ type: 'transaction', label: `Transaction ${truncateHash(q, 10, 8)}`, value: q });
      results.push({ type: 'transaction', label: `Transaction 0x${seededHex(42, 64)}`, value: `0x${seededHex(42, 64)}` });
    }

    // 'aeth' -> address
    if (q.startsWith('aeth')) {
      results.push({ type: 'address', label: `Address ${truncateAddress(q, 12, 6)}`, value: q });
      results.push({ type: 'address', label: `Address ${truncateAddress(seededAddress(100), 12, 6)}`, value: seededAddress(100) });
      results.push({ type: 'address', label: `Address ${truncateAddress(seededAddress(200), 12, 6)}`, value: seededAddress(200) });
    }

    // General search - always suggest something
    if (results.length === 0 && q.length > 1) {
      results.push({ type: 'block', label: `Block #${realTime.blockHeight.toLocaleString()}`, value: String(realTime.blockHeight) });
      results.push({ type: 'transaction', label: `Transaction 0x${seededHex(77, 16)}...`, value: `0x${seededHex(77, 64)}` });
    }

    setSearchResults(results);
    setShowResults(results.length > 0);
  }, [searchQuery, realTime.blockHeight]);

  const handleResultClick = (result: SearchResult) => {
    setShowResults(false);
    setSearchQuery('');
    if (result.type === 'block') {
      const blockNum = parseInt(result.value, 10) || realTime.blockHeight;
      onBlockClick(generateMockBlock(blockNum, blockNum * 37));
    } else if (result.type === 'transaction') {
      onTxClick(generateMockTx(parseInt(result.value.slice(2, 6), 16) || 5555, realTime.blockHeight));
    }
    // Address could open a detail modal but we show it as block-like for now
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchResults.length > 0) {
      handleResultClick(searchResults[0]);
    }
  };

  return (
    <div className="relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-950 to-red-950/30" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(220,38,38,0.12)_0%,_transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_rgba(220,38,38,0.06)_0%,_transparent_50%)]" />
      <div className="absolute inset-0 opacity-[0.02]" style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)',
        backgroundSize: '64px 64px',
      }} />

      <div className="relative max-w-[1440px] mx-auto px-6 pt-16 pb-20">
        {/* Title area */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-5">
            <div className="flex items-center gap-1.5 px-3 py-1 bg-red-500/10 rounded-full border border-red-500/20">
              <ShieldCheck className="w-3.5 h-3.5 text-red-400" />
              <span className="text-xs font-medium text-red-300 tracking-wide">TEE-VERIFIED</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 rounded-full border border-emerald-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-medium text-emerald-300 tracking-wide">LIVE</span>
            </div>
          </div>
          <h1 className="text-4xl lg:text-5xl xl:text-6xl font-bold text-white tracking-tight mb-4">
            Sovereign AI Verification Network
          </h1>
          <p className="text-lg text-slate-400 leading-relaxed max-w-2xl mx-auto">
            Explore blocks, transactions, validators, and AI verification jobs on the
            <span className="text-white font-semibold"> AETHELRED </span>
            blockchain. Proof of Useful Work powers trustless computation at scale.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/reconciliation"
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-200 transition-colors hover:border-cyan-400 hover:bg-cyan-500/15"
            >
              <FileCheck className="w-4 h-4" />
              View Live Reconciliation
            </Link>
            <Link
              href="/devtools"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500"
            >
              Developer Tools
              <ExternalLink className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Search Bar */}
        <div className="max-w-2xl mx-auto mb-14" ref={searchRef}>
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowResults(true)}
              placeholder="Search by block number, transaction hash (0x...), or address (aeth1...)..."
              className="w-full pl-12 pr-28 py-4 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-500/40 transition-all"
            />
            <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-medium transition-colors">
              Search
            </button>
          </form>

          {/* Search Results Dropdown */}
          {showResults && searchResults.length > 0 && (
            <div className="absolute z-50 mt-2 w-full max-w-2xl bg-slate-900 border border-slate-700/50 rounded-xl shadow-2xl overflow-hidden">
              {searchResults.map((result, idx) => (
                <button
                  key={`${result.type}-${idx}`}
                  onClick={() => handleResultClick(result)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/50 transition-colors text-left"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    result.type === 'block' ? 'bg-red-500/10 text-red-400' :
                    result.type === 'transaction' ? 'bg-blue-500/10 text-blue-400' :
                    'bg-emerald-500/10 text-emerald-400'
                  }`}>
                    {result.type === 'block' ? <Blocks className="w-4 h-4" /> :
                     result.type === 'transaction' ? <Activity className="w-4 h-4" /> :
                     <Wallet className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="text-sm text-white font-medium">{result.label}</p>
                    <p className="text-xs text-slate-500 capitalize">{result.type}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-600 ml-auto" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 4 Animated Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 lg:gap-6">
          {[
            { label: 'BLOCK HEIGHT', value: realTime.blockHeight.toLocaleString(), icon: <Blocks className="w-4 h-4" />, live: true },
            { label: 'TOTAL TRANSACTIONS', value: formatNumber(15_247_832 + (realTime.blockHeight - BASE_BLOCK) * 127), icon: <Activity className="w-4 h-4" /> },
            { label: 'ACTIVE VALIDATORS', value: '156', icon: <Users className="w-4 h-4" /> },
            { label: 'AVERAGE TPS', value: realTime.tps.toLocaleString(), icon: <Zap className="w-4 h-4" />, live: true },
          ].map((stat) => (
            <div key={stat.label} className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-5 animate-fade-in-up">
              <div className="flex items-center gap-2 mb-3">
                <div className="text-red-400">{stat.icon}</div>
                <span className="text-[10px] text-slate-500 uppercase tracking-widest font-medium">{stat.label}</span>
                {stat.live && (
                  <div className="ml-auto flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[10px] text-emerald-400 font-medium">LIVE</span>
                  </div>
                )}
              </div>
              <p className="text-2xl lg:text-3xl font-bold text-white tabular-nums">{stat.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// =============================================================================
// BLOCK DETAIL MODAL
// =============================================================================

function BlockDetailModal({ block, open, onClose, onTxClick }: {
  block: MockBlock | null; open: boolean; onClose: () => void; onTxClick: (tx: MockTransaction) => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const { addNotification } = useApp();

  if (!block) return null;

  const rawData = {
    number: block.number,
    hash: block.hash,
    parentHash: block.parentHash,
    timestamp: block.timestamp,
    validator: block.validator,
    txCount: block.txCount,
    gasUsed: block.gasUsed,
    gasLimit: block.gasLimit,
    reward: block.reward,
  };

  return (
    <ModalOverlay open={open} onClose={onClose} title={`Block #${block.number.toLocaleString()}`}>
      <div className="space-y-5">
        {/* Block Hash */}
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Block Hash</p>
          <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2">
            <span className="text-sm font-mono text-slate-300 break-all">{block.hash}</span>
            <CopyButton text={block.hash} onCopied={() => addNotification('success', 'Copied!', 'Block hash copied to clipboard')} />
          </div>
        </div>

        {/* Grid info */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500 mb-1">Timestamp</p>
            <p className="text-sm text-white">{formatFullDate(block.timestamp)}</p>
            <p className="text-xs text-slate-500">{timeAgo(block.timestamp)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Validator</p>
            <p className="text-sm text-white">{block.validator}</p>
            <p className="text-xs text-slate-500 font-mono">{truncateAddress(block.validatorAddr)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Transaction Count</p>
            <p className="text-sm text-white font-medium tabular-nums">{block.txCount}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Block Reward</p>
            <p className="text-sm text-white font-medium">{block.reward} AETHEL</p>
          </div>
        </div>

        {/* Gas */}
        <div>
          <p className="text-xs text-slate-500 mb-2">Gas Used / Gas Limit</p>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <ProgressBarLocal value={block.gasUsed} max={block.gasLimit} color="red" />
            </div>
            <span className="text-xs text-slate-400 tabular-nums">{block.gasUsed}% / {block.gasLimit}%</span>
          </div>
        </div>

        {/* Parent Hash */}
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Parent Hash</p>
          <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2">
            <span className="text-sm font-mono text-slate-400 break-all">{block.parentHash}</span>
            <CopyButton text={block.parentHash} onCopied={() => addNotification('success', 'Copied!', 'Parent hash copied to clipboard')} />
          </div>
        </div>

        {/* Transactions in block */}
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Transactions in Block</p>
          <div className="space-y-1">
            {block.transactions.map((txHash, idx) => (
              <button
                key={txHash}
                onClick={() => {
                  const mockTx = generateMockTx(block.number * 10 + idx, block.number);
                  onTxClick(mockTx);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 bg-slate-800/30 rounded-lg hover:bg-slate-800/60 transition-colors text-left"
              >
                <Activity className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                <span className="text-xs font-mono text-blue-400 hover:text-blue-300 truncate">{truncateHash(txHash, 16, 12)}</span>
                <ArrowRight className="w-3 h-3 text-slate-600 ml-auto flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {/* View Raw toggle */}
        <div>
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <Code className="w-3.5 h-3.5" />
            {showRaw ? 'Hide Raw Data' : 'View Raw Data'}
            {showRaw ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showRaw && (
            <pre className="mt-2 p-4 bg-slate-800/50 rounded-lg text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(rawData, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}


// =============================================================================
// TRANSACTION DETAIL MODAL
// =============================================================================

function TransactionDetailModal({ tx, open, onClose }: {
  tx: MockTransaction | null; open: boolean; onClose: () => void;
}) {
  const [showInputData, setShowInputData] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const { addNotification, realTime } = useApp();

  if (!tx) return null;

  const usdValue = (tx.value * realTime.aethelPrice).toFixed(2);

  return (
    <ModalOverlay open={open} onClose={onClose} title="Transaction Detail" wide>
      <div className="space-y-5">
        {/* Tx Hash */}
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Transaction Hash</p>
          <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2">
            <span className="text-sm font-mono text-slate-300 break-all">{tx.hash}</span>
            <CopyButton text={tx.hash} onCopied={() => addNotification('success', 'Copied!', 'Transaction hash copied to clipboard')} />
          </div>
        </div>

        {/* Status + Block */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-slate-500 mb-1">Status</p>
            <StatusBadge status={tx.status} />
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Block Number</p>
            <p className="text-sm text-red-400 font-medium tabular-nums">#{tx.blockNumber.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Timestamp</p>
            <p className="text-sm text-white">{timeAgo(tx.timestamp)}</p>
          </div>
        </div>

        {/* From -> To */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">From</p>
            <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2">
              <span className="text-xs font-mono text-slate-300 break-all">{truncateAddress(tx.from, 14, 8)}</span>
              <CopyButton text={tx.from} onCopied={() => addNotification('success', 'Copied!', 'Address copied')} />
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">To</p>
            <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2">
              <span className="text-xs font-mono text-slate-300 break-all">{truncateAddress(tx.to, 14, 8)}</span>
              <CopyButton text={tx.to} onCopied={() => addNotification('success', 'Copied!', 'Address copied')} />
            </div>
          </div>
        </div>

        {/* Value */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500 mb-1">Value</p>
            <p className="text-lg text-white font-bold tabular-nums">{tx.value.toLocaleString()} AETHEL</p>
            <p className="text-xs text-slate-500">${usdValue}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Transaction Fee</p>
            <p className="text-sm text-white font-medium tabular-nums">{tx.fee} AETHEL</p>
          </div>
        </div>

        {/* Gas */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-slate-500 mb-1">Gas Used</p>
            <p className="text-sm text-white tabular-nums">{tx.gasUsed.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Gas Limit</p>
            <p className="text-sm text-white tabular-nums">{tx.gasLimit.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Gas Price</p>
            <p className="text-sm text-white tabular-nums">{tx.gasPrice} gwei</p>
          </div>
        </div>

        {/* Gas bar */}
        <ProgressBarLocal value={tx.gasUsed} max={tx.gasLimit} color="blue" />

        {/* Method + Nonce */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500 mb-1">Method / Function</p>
            <p className="text-sm font-mono text-purple-400">{tx.method}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Nonce</p>
            <p className="text-sm text-white tabular-nums">{tx.nonce}</p>
          </div>
        </div>

        {/* Input Data (collapsible) */}
        <div>
          <button
            onClick={() => setShowInputData(!showInputData)}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <Code className="w-3.5 h-3.5" />
            Input Data
            {showInputData ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showInputData && (
            <pre className="mt-2 p-4 bg-slate-800/50 rounded-lg text-xs text-slate-400 font-mono overflow-x-auto break-all">
              {tx.inputData}
            </pre>
          )}
        </div>

        {/* Event Logs (collapsible) */}
        <div>
          <button
            onClick={() => setShowEvents(!showEvents)}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <FileCode className="w-3.5 h-3.5" />
            Event Logs ({tx.events.length})
            {showEvents ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showEvents && (
            <div className="mt-2 space-y-2">
              {tx.events.map((event, idx) => (
                <div key={idx} className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/30">
                  <p className="text-xs font-medium text-purple-400 mb-1">{event.name}</p>
                  {Object.entries(event.args).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500">{key}:</span>
                      <span className="text-slate-300 font-mono">{val}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}


// =============================================================================
// AI JOB DETAIL MODAL
// =============================================================================

function AIJobDetailModal({ job, open, onClose }: {
  job: MockAIJob | null; open: boolean; onClose: () => void;
}) {
  if (!job) return null;

  return (
    <ModalOverlay open={open} onClose={onClose} title={`AI Job ${job.id}`} wide>
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-slate-500 mb-1">AI Model</p>
            <p className="text-sm text-white font-medium">{job.model}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Status</p>
            <StatusBadge status={job.status} />
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Verification Score</p>
            <p className="text-lg text-emerald-400 font-bold tabular-nums">{job.verificationScore}%</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-slate-500 mb-1">Compute Time</p>
            <p className="text-sm text-white">{job.computeTime}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Cost</p>
            <p className="text-sm text-white font-medium">{job.cost} AETHEL</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Submitter</p>
            <p className="text-xs text-slate-300 font-mono">{truncateAddress(job.submitter)}</p>
          </div>
        </div>

        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Input Hash</p>
          <div className="bg-slate-800/50 rounded-lg px-3 py-2">
            <span className="text-xs font-mono text-slate-400 break-all">{job.inputHash}</span>
          </div>
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Output Hash</p>
          <div className="bg-slate-800/50 rounded-lg px-3 py-2">
            <span className="text-xs font-mono text-slate-400 break-all">{job.outputHash}</span>
          </div>
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">TEE Attestation</p>
          <div className="bg-slate-800/50 rounded-lg px-3 py-2">
            <span className="text-xs font-mono text-slate-400 break-all">{truncateHash(job.teeAttestation, 32, 16)}</span>
          </div>
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Verification Proof</p>
          <div className="bg-slate-800/50 rounded-lg px-3 py-2">
            <span className="text-xs font-mono text-slate-400 break-all">{truncateHash(job.verificationProof, 32, 16)}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500 mb-1">CPU Cycles</p>
            <p className="text-sm text-white tabular-nums">{job.cpuCycles.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Memory Used</p>
            <p className="text-sm text-white">{job.memoryUsed} GB</p>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}


// =============================================================================
// LIVE NETWORK SECTION (BLOCK FEED + TRANSACTION STREAM)
// =============================================================================

function LiveNetworkSection({ onBlockClick, onTxClick }: {
  onBlockClick: (block: MockBlock) => void;
  onTxClick: (tx: MockTransaction) => void;
}) {
  const { realTime, addNotification } = useApp();
  const [blocks, setBlocks] = useState<MockBlock[]>(() => generateInitialBlocks(20));
  const [transactions, setTransactions] = useState<MockTransaction[]>(() => generateInitialTransactions(30));
  const prevBlockRef = useRef(realTime.blockHeight);
  const [newBlockKey, setNewBlockKey] = useState(0);

  // When blockHeight changes, add new blocks and transactions
  useEffect(() => {
    if (realTime.blockHeight !== prevBlockRef.current && prevBlockRef.current !== 0) {
      const diff = realTime.blockHeight - prevBlockRef.current;
      for (let d = 0; d < Math.min(diff, 3); d++) {
        const newBlockNum = realTime.blockHeight - d;
        const newBlock = generateMockBlock(newBlockNum, newBlockNum * 37 + Date.now() % 1000);
        setBlocks((prev) => [newBlock, ...prev.slice(0, 19)]);

        // Generate 2-4 new transactions per block
        const newTxCount = 2 + Math.floor(Math.random() * 3);
        const newTxs: MockTransaction[] = [];
        for (let t = 0; t < newTxCount; t++) {
          newTxs.push(generateMockTx(Date.now() + t * 100 + d * 1000, newBlockNum));
        }
        setTransactions((prev) => [...newTxs, ...prev.slice(0, 29 - newTxCount)]);

        if (d === 0) {
          addNotification('info', `Block #${newBlockNum.toLocaleString()}`, `Produced by ${newBlock.validator}`);
        }
      }
      setNewBlockKey((k) => k + 1);
    }
    prevBlockRef.current = realTime.blockHeight;
  }, [realTime.blockHeight, addNotification]);

  return (
    <section className="max-w-[1440px] mx-auto px-6 py-12">
      <SectionHeader
        title="Live Network"
        subtitle="Real-time block production and transaction stream"
        action={
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-emerald-400 font-medium">Auto-updating</span>
          </div>
        }
      />

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Left: Live Block Feed */}
        <GlassCard className="overflow-hidden" hover={false}>
          <div className="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Box className="w-4 h-4 text-red-400" />
              <h3 className="text-sm font-semibold text-white">Latest Blocks</h3>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-emerald-400 font-medium tracking-wider">LIVE</span>
            </div>
          </div>
          <div className="divide-y divide-slate-800/50 max-h-[500px] overflow-y-auto">
            {blocks.slice(0, 8).map((block, idx) => (
              <div
                key={`${block.number}-${newBlockKey}`}
                onClick={() => onBlockClick(block)}
                className={`px-5 py-3.5 hover:bg-slate-800/30 transition-all cursor-pointer ${idx === 0 ? 'animate-slide-up' : ''}`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center">
                      <Blocks className="w-4 h-4 text-red-400" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-red-400 tabular-nums">
                        #{block.number.toLocaleString()}
                      </p>
                      <p className="text-xs text-slate-500">{timeAgo(block.timestamp)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-300 tabular-nums">{block.txCount} txns</p>
                    <p className="text-xs text-slate-500">{block.gasUsed}% gas</p>
                  </div>
                </div>
                <div className="flex items-center justify-between pl-12">
                  <p className="text-xs text-slate-500">
                    <span className="text-slate-400">{block.validator}</span>
                  </p>
                  <p className="text-xs text-slate-600 font-mono">{truncateHash(block.hash, 10, 6)}</p>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Right: Live Transaction Stream */}
        <GlassCard className="overflow-hidden" hover={false}>
          <div className="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-red-400" />
              <h3 className="text-sm font-semibold text-white">Transaction Stream</h3>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-emerald-400 font-medium tracking-wider">LIVE</span>
            </div>
          </div>
          <div className="divide-y divide-slate-800/50 max-h-[500px] overflow-y-auto">
            {transactions.slice(0, 10).map((tx, idx) => (
              <div
                key={`${tx.hash}-${idx}`}
                onClick={() => onTxClick(tx)}
                className="px-5 py-3 hover:bg-slate-800/30 transition-all cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${TX_TYPE_DOT_COLORS[tx.type] || 'bg-slate-400'}`} />
                    <span className="text-sm font-mono text-blue-400">{truncateHash(tx.hash, 8, 6)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${TX_TYPE_COLORS[tx.type] || 'bg-slate-700 text-slate-300'}`}>
                      {tx.type}
                    </span>
                    <StatusBadge status={tx.status} />
                  </div>
                </div>
                <div className="flex items-center justify-between ml-5">
                  <p className="text-xs text-slate-500">
                    <span className="font-mono text-slate-400">{truncateAddress(tx.from, 8, 4)}</span>
                    <ArrowRight className="w-3 h-3 inline mx-1 text-slate-600" />
                    <span className="font-mono text-slate-400">{truncateAddress(tx.to, 8, 4)}</span>
                  </p>
                  <p className="text-xs font-medium text-white tabular-nums">{tx.value.toLocaleString()} AETHEL</p>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </section>
  );
}


// =============================================================================
// NETWORK STATISTICS SECTION (3 charts)
// =============================================================================

function NetworkStatisticsSection() {
  const txTypeData = useMemo(() => [
    { name: 'Transfer', value: 45, color: '#3B82F6' },
    { name: 'Staking', value: 20, color: '#10B981' },
    { name: 'AI Jobs', value: 15, color: '#DC2626' },
    { name: 'Smart Contract', value: 12, color: '#8B5CF6' },
    { name: 'Governance', value: 8, color: '#F59E0B' },
  ], []);

  const dailyTxData = useMemo(() => generateDailyTxCount(), []);
  const gasData = useMemo(() => generateGasUsage(), []);

  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);

  return (
    <section className="max-w-[1440px] mx-auto px-6 py-12">
      <SectionHeader
        title="Network Statistics"
        subtitle="Transaction distribution, daily volume, and gas usage trends"
      />

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Transaction Types PieChart */}
        <GlassCard className="p-5" hover={false}>
          <div className="flex items-center gap-2 mb-4">
            <Layers className="w-4 h-4 text-red-400" />
            <h3 className="text-sm font-semibold text-white">Transaction Types</h3>
          </div>
          <div className="flex flex-col items-center">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={txTypeData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                  strokeWidth={0}
                  activeIndex={activeIndex}
                  onMouseEnter={(_, idx) => setActiveIndex(idx)}
                  onMouseLeave={() => setActiveIndex(undefined)}
                >
                  {txTypeData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.color}
                      opacity={activeIndex === undefined || activeIndex === index ? 1 : 0.4}
                      className="transition-opacity duration-200"
                    />
                  ))}
                </Pie>
                <RechartsTooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', fontSize: '12px', color: '#e2e8f0' }}
                  formatter={(value: number) => [`${value}%`, 'Share']}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="w-full space-y-2 mt-2">
              {txTypeData.map((item, idx) => (
                <div
                  key={item.name}
                  className={`flex items-center justify-between px-2 py-1 rounded-lg cursor-pointer transition-all ${activeIndex === idx ? 'bg-slate-800/60' : 'hover:bg-slate-800/30'}`}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseLeave={() => setActiveIndex(undefined)}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-xs text-slate-400">{item.name}</span>
                  </div>
                  <span className="text-xs font-semibold text-white tabular-nums">{item.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>

        {/* Daily Transactions BarChart */}
        <GlassCard className="p-5" hover={false}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-red-400" />
              <h3 className="text-sm font-semibold text-white">Daily Transactions (7d)</h3>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dailyTxData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BRAND.red} stopOpacity={1} />
                  <stop offset="100%" stopColor={BRAND.red} stopOpacity={0.4} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
              <RechartsTooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', fontSize: '12px', color: '#e2e8f0' }}
                formatter={(value: number) => [value.toLocaleString(), 'Transactions']}
              />
              <Bar dataKey="count" fill="url(#barGradient)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </GlassCard>

        {/* Gas Usage AreaChart */}
        <GlassCard className="p-5" hover={false}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-red-400" />
              <h3 className="text-sm font-semibold text-white">Gas Usage Trend (24h)</h3>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={gasData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gasGradientDark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} interval={3} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} domain={[0, 100]} />
              <RechartsTooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', fontSize: '12px', color: '#e2e8f0' }}
                formatter={(value: number) => [`${value}%`, 'Gas Used']}
              />
              <Area type="monotone" dataKey="gas" stroke="#F59E0B" fill="url(#gasGradientDark)" strokeWidth={2} />
              <Line type="monotone" dataKey="limit" stroke="#334155" strokeWidth={1} strokeDasharray="4 4" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </GlassCard>
      </div>
    </section>
  );
}


// =============================================================================
// NETWORK HEALTH DASHBOARD
// =============================================================================

function NetworkHealthDashboard() {
  const { realTime } = useApp();
  const tpsSparkData = useMemo(() => generateSeededArray(101, 20, 1800, 2800), []);
  const blockTimeSparkData = useMemo(() => generateSeededArray(202, 20, 1.0, 1.6), []);

  return (
    <section className="max-w-[1440px] mx-auto px-6 py-12">
      <SectionHeader
        title="Network Health"
        subtitle="Real-time performance and infrastructure metrics"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* TPS */}
        <GlassCard className="p-5" hover={false}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-red-400" />
              <span className="text-xs text-slate-500 uppercase tracking-wider">TPS</span>
            </div>
            <Sparkline data={tpsSparkData} color={BRAND.red} height={24} width={60} />
          </div>
          <p className="text-3xl font-bold text-white tabular-nums">{realTime.tps.toLocaleString()}</p>
          <div className="flex items-center gap-1 mt-1">
            <ArrowUpRight className="w-3 h-3 text-emerald-400" />
            <span className="text-xs text-emerald-400">+5.2% vs avg</span>
          </div>
        </GlassCard>

        {/* Block Time */}
        <GlassCard className="p-5" hover={false}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Timer className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-slate-500 uppercase tracking-wider">Block Time</span>
            </div>
            <Sparkline data={blockTimeSparkData} color="#3B82F6" height={24} width={60} />
          </div>
          <p className="text-3xl font-bold text-white tabular-nums">1.2s</p>
          <div className="flex items-center gap-1 mt-1">
            <CheckCircle className="w-3 h-3 text-emerald-400" />
            <span className="text-xs text-emerald-400">Consistent</span>
          </div>
        </GlassCard>

        {/* Network Load */}
        <GlassCard className="p-5" hover={false}>
          <div className="flex items-center gap-2 mb-3">
            <Gauge className="w-4 h-4 text-amber-400" />
            <span className="text-xs text-slate-500 uppercase tracking-wider">Network Load</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative">
              <ProgressRingLocal value={realTime.networkLoad} size={64} strokeWidth={5} color="#F59E0B" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-bold text-white tabular-nums">{realTime.networkLoad}%</span>
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-400">
                {realTime.networkLoad < 70 ? 'Normal Load' : realTime.networkLoad < 85 ? 'Moderate Load' : 'High Load'}
              </p>
            </div>
          </div>
        </GlassCard>

        {/* Peer Count */}
        <GlassCard className="p-5" hover={false}>
          <div className="flex items-center gap-2 mb-3">
            <Globe className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-slate-500 uppercase tracking-wider">Peer Count</span>
          </div>
          <p className="text-3xl font-bold text-white tabular-nums">847</p>
          {/* Simplified world map dots */}
          <div className="flex items-center gap-1 mt-2">
            {[...Array(12)].map((_, i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  backgroundColor: seededRandom(i * 7) > 0.3 ? '#10B981' : '#334155',
                  opacity: 0.4 + seededRandom(i * 11) * 0.6,
                }}
              />
            ))}
            <span className="text-xs text-slate-500 ml-2">42 regions</span>
          </div>
        </GlassCard>
      </div>
    </section>
  );
}


// =============================================================================
// TOP VALIDATORS PREVIEW
// =============================================================================

const TOP_VALIDATORS = [
  { rank: 1, name: 'Aethelred Foundation', votingPower: 11.8, commission: 5.0, uptime: 99.98, status: 'Active', address: 'aeth1qz7xm4k9f3h2d6' },
  { rank: 2, name: 'Paradigm Stake', votingPower: 9.1, commission: 8.0, uptime: 99.95, status: 'Active', address: 'aeth1rv3kp2j7g8n5m1' },
  { rank: 3, name: 'a16z Validator', votingPower: 8.2, commission: 7.5, uptime: 99.97, status: 'Active', address: 'aeth1hd8mx9n2k4p6r3' },
  { rank: 4, name: 'Coinbase Cloud', votingPower: 7.4, commission: 10.0, uptime: 99.92, status: 'Active', address: 'aeth1j5ntk3w8f7q2v9' },
  { rank: 5, name: 'Figment Networks', votingPower: 6.5, commission: 6.5, uptime: 99.90, status: 'Active', address: 'aeth1mn7cf4v1h8s3b6' },
];

function TopValidatorsPreview() {
  return (
    <section className="max-w-[1440px] mx-auto px-6 py-12">
      <SectionHeader
        title="Top Validators"
        subtitle="Leading validators by voting power and performance"
        action={
          <Link href="/validators" className="flex items-center gap-1.5 text-sm font-medium text-red-400 hover:text-red-300 transition-colors">
            View All Validators <ArrowRight className="w-4 h-4" />
          </Link>
        }
      />

      <GlassCard className="overflow-hidden" hover={false}>
        {/* Header */}
        <div className="grid grid-cols-12 gap-4 px-5 py-3 border-b border-slate-700/50 bg-slate-800/30">
          <div className="col-span-1 text-[10px] font-medium text-slate-500 uppercase tracking-wider">Rank</div>
          <div className="col-span-3 text-[10px] font-medium text-slate-500 uppercase tracking-wider">Validator</div>
          <div className="col-span-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider">Voting Power</div>
          <div className="col-span-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider">Commission</div>
          <div className="col-span-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider">Uptime</div>
          <div className="col-span-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider text-center">Status</div>
        </div>
        {/* Rows */}
        {TOP_VALIDATORS.map((v) => (
          <Link
            key={v.rank}
            href="/validators"
            className="grid grid-cols-12 gap-4 px-5 py-4 border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors items-center last:border-0"
          >
            <div className="col-span-1">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
                v.rank === 1 ? 'bg-amber-500/20 text-amber-400' :
                v.rank === 2 ? 'bg-slate-600/30 text-slate-300' :
                v.rank === 3 ? 'bg-orange-500/20 text-orange-400' :
                'bg-slate-800/50 text-slate-500'
              }`}>
                {v.rank}
              </div>
            </div>
            <div className="col-span-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center">
                  <span className="text-white text-[10px] font-bold">{v.name.charAt(0)}{v.name.split(' ')[1]?.charAt(0) || ''}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{v.name}</p>
                  <p className="text-[10px] text-slate-500 font-mono">{v.address}</p>
                </div>
              </div>
            </div>
            <div className="col-span-2">
              <p className="text-sm font-semibold text-white tabular-nums">{v.votingPower}%</p>
              <div className="w-full h-1 bg-slate-700/50 rounded-full mt-1 overflow-hidden">
                <div className="h-full rounded-full bg-red-500" style={{ width: `${(v.votingPower / 12) * 100}%` }} />
              </div>
            </div>
            <div className="col-span-2">
              <p className="text-sm text-slate-300 tabular-nums">{v.commission}%</p>
            </div>
            <div className="col-span-2">
              <ProgressBarLocal value={v.uptime} color="green" />
            </div>
            <div className="col-span-2 flex justify-center">
              <div className="flex items-center gap-1 px-2 py-1 bg-emerald-500/10 rounded-full border border-emerald-500/20">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span className="text-[10px] font-medium text-emerald-400">TEE</span>
              </div>
            </div>
          </Link>
        ))}
      </GlassCard>
    </section>
  );
}


// =============================================================================
// RECENT AI VERIFICATION JOBS
// =============================================================================

function RecentAIJobsSection({ onJobClick }: { onJobClick: (job: MockAIJob) => void }) {
  const jobs = useMemo(() => generateInitialAIJobs(), []);

  return (
    <section className="max-w-[1440px] mx-auto px-6 py-12">
      <SectionHeader
        title="Recent AI Verification Jobs"
        subtitle="Latest computational workloads verified by the network"
        action={
          <Link href="/jobs" className="flex items-center gap-1.5 text-sm font-medium text-red-400 hover:text-red-300 transition-colors">
            View All Jobs <ArrowRight className="w-4 h-4" />
          </Link>
        }
      />

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {jobs.map((job) => (
          <GlassCard
            key={job.id}
            className="p-5 group"
            onClick={() => onJobClick(job)}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono text-red-400 font-semibold">{job.id}</span>
              <StatusBadge status={job.status} />
            </div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Brain className="w-4 h-4 text-purple-400" />
              </div>
              <p className="text-sm text-white font-medium">{job.model}</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] text-slate-500 uppercase">Compute</p>
                <p className="text-xs text-slate-300">{job.computeTime}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase">Cost</p>
                <p className="text-xs text-white font-medium">{job.cost} AE</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase">Score</p>
                <p className={`text-xs font-medium ${job.verificationScore >= 90 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {job.verificationScore}%
                </p>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>
    </section>
  );
}


// =============================================================================
// PROTOCOL METRICS
// =============================================================================

const PROTOCOL_METRICS = {
  tvl: 142_573_000,
  dailyRevenue: 847_200,
  uniqueAddresses: 1_284_000,
  smartContracts: 12_847,
  aiJobsCompleted: 1_284_721,
  avgBlockReward: 2.5,
  inflationRate: 3.2,
  stakingRatio: 42.5,
  nakamotoCoefficient: 23,
  networkAge: '247 days',
};

function ProtocolMetricsSection() {
  const tvlSparkData = useMemo(() => generateSeededArray(42, 12, 130, 145), []);
  const revenueSparkData = useMemo(() => generateSeededArray(55, 12, 700, 900), []);
  const addressSparkData = useMemo(() => generateSeededArray(77, 12, 1100, 1300), []);
  const contractSparkData = useMemo(() => generateSeededArray(88, 12, 11000, 13000), []);
  const jobsSparkData = useMemo(() => generateSeededArray(99, 12, 1200, 1300), []);
  const rewardSparkData = useMemo(() => generateSeededArray(111, 12, 2.3, 2.7), []);

  return (
    <section className="max-w-[1440px] mx-auto px-6 py-12">
      <SectionHeader
        title="Protocol Metrics"
        subtitle="Key economic indicators and protocol performance"
      />

      {/* Primary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        {[
          { label: 'Total Value Locked', value: formatUSD(PROTOCOL_METRICS.tvl), change: '+4.2%', up: true, icon: <Lock className="w-5 h-5" />, sparkData: tvlSparkData, sparkColor: BRAND.red },
          { label: 'Daily Revenue', value: formatUSD(PROTOCOL_METRICS.dailyRevenue), change: '+12.1%', up: true, icon: <TrendingUp className="w-5 h-5" />, sparkData: revenueSparkData, sparkColor: '#10B981' },
          { label: 'Unique Addresses', value: formatNumber(PROTOCOL_METRICS.uniqueAddresses), change: '+1.8%', up: true, icon: <Users className="w-5 h-5" />, sparkData: addressSparkData, sparkColor: '#3B82F6' },
          { label: 'Smart Contracts', value: formatNumber(PROTOCOL_METRICS.smartContracts), change: '+2.4%', up: true, icon: <FileCode className="w-5 h-5" />, sparkData: contractSparkData, sparkColor: '#8B5CF6' },
          { label: 'AI Jobs Completed', value: formatNumber(PROTOCOL_METRICS.aiJobsCompleted), change: '+6.7%', up: true, icon: <Brain className="w-5 h-5" />, sparkData: jobsSparkData, sparkColor: '#F59E0B' },
          { label: 'Avg Block Reward', value: `${PROTOCOL_METRICS.avgBlockReward} AETHEL`, icon: <Award className="w-5 h-5" />, sparkData: rewardSparkData, sparkColor: '#EC4899' },
        ].map((stat) => (
          <GlassCard key={stat.label} className="p-5" hover={false}>
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-red-400">
                {stat.icon}
              </div>
              {stat.sparkData && <Sparkline data={stat.sparkData} color={stat.sparkColor} height={28} />}
            </div>
            <p className="text-2xl font-bold text-white tabular-nums">{stat.value}</p>
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-slate-500">{stat.label}</p>
              {stat.change && (
                <div className={`flex items-center gap-0.5 text-xs font-medium ${stat.up ? 'text-emerald-400' : 'text-red-400'}`}>
                  {stat.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {stat.change}
                </div>
              )}
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Inflation Rate', value: `${PROTOCOL_METRICS.inflationRate}%`, icon: <TrendingUp className="w-4 h-4" />, sub: 'Annualized' },
          { label: 'Staking Ratio', value: `${PROTOCOL_METRICS.stakingRatio}%`, icon: <Award className="w-4 h-4" />, sub: 'of circulating supply' },
          { label: 'Nakamoto Coefficient', value: PROTOCOL_METRICS.nakamotoCoefficient.toString(), icon: <Shield className="w-4 h-4" />, sub: 'validators for 33%' },
          { label: 'Network Age', value: PROTOCOL_METRICS.networkAge, icon: <Clock className="w-4 h-4" />, sub: 'since genesis' },
        ].map((item) => (
          <GlassCard key={item.label} className="p-4" hover={false}>
            <div className="flex items-center gap-2 mb-2">
              <div className="text-red-400">{item.icon}</div>
              <span className="text-xs text-slate-500">{item.label}</span>
            </div>
            <p className="text-lg font-bold text-white tabular-nums">{item.value}</p>
            <p className="text-xs text-slate-500">{item.sub}</p>
          </GlassCard>
        ))}
      </div>
    </section>
  );
}


// =============================================================================
// RECONCILIATION SECTION
// =============================================================================

function ReconciliationSection() {
  const checkpoints = [
    {
      label: 'Validator Universe',
      value: 'Eligible validator set hash',
      sub: 'Detects drift between live chain selection inputs and attested universe state.',
      icon: <ShieldCheck className="w-5 h-5" />,
    },
    {
      label: 'Stake Snapshot',
      value: 'Live share topology snapshot',
      sub: 'Surfaces whether indexed vault shares and included staker rows are complete or partial.',
      icon: <Database className="w-5 h-5" />,
    },
    {
      label: 'Delegation Roots',
      value: 'Delegation and registry roots',
      sub: 'Shows whether delegation topology can be derived cleanly enough for root verification.',
      icon: <FileCheck className="w-5 h-5" />,
    },
  ];

  return (
    <section className="max-w-[1440px] mx-auto px-6 py-12">
      <SectionHeader
        title="Live Reconciliation"
        subtitle="Trace live chain and indexed state through the same protocol hash surfaces used by Cruzible"
        action={
          <Link
            href="/reconciliation"
            className="flex items-center gap-1.5 text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
          >
            Open Report <ArrowRight className="w-4 h-4" />
          </Link>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <GlassCard className="p-6" hover={false}>
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-cyan-300">
                <FileCheck className="w-3.5 h-3.5" />
                Live Integrity Surface
              </div>
              <h3 className="text-xl font-semibold text-white">Audit the current protocol snapshot, not just fixtures</h3>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
                Cruzible now exposes a live reconciliation report that compares validator-universe
                and stake or delegation snapshot inputs against the canonical hash and root formats
                used by the protocol SDKs.
              </p>
            </div>
            <AlertCircle className="hidden h-5 w-5 shrink-0 text-cyan-300 md:block" />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {checkpoints.map((checkpoint) => (
              <div
                key={checkpoint.label}
                className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
                  {checkpoint.icon}
                </div>
                <p className="text-xs uppercase tracking-wide text-slate-500">{checkpoint.label}</p>
                <p className="mt-1 text-sm font-semibold text-white">{checkpoint.value}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">{checkpoint.sub}</p>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-6" hover={false}>
          <div className="mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-red-400" />
            <h3 className="text-base font-semibold text-white">Operational Use</h3>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Primary View</div>
              <div className="text-sm font-medium text-white">Live snapshot report</div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Use the dedicated reconciliation page to inspect the current epoch, observed hashes,
                snapshot completeness, live warnings, and exportable JSON or Markdown.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Secondary View</div>
              <div className="text-sm font-medium text-white">Developer tools panel</div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                The devtools dashboard keeps a compact, auto-refreshing reconciliation summary
                beside the static protocol codec preview so you can compare live state and vectors.
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/reconciliation"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
            >
              View Live Report
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/devtools"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500"
            >
              Open Devtools
              <ExternalLink className="w-4 h-4" />
            </Link>
          </div>
        </GlassCard>
      </div>
    </section>
  );
}


// =============================================================================
// EPOCH TIMELINE
// =============================================================================

const EPOCH_DATA = [
  { epoch: 247, status: 'Active', startBlock: 2_846_800, endBlock: 2_848_000, validators: 156, rewards: '52,340 AETHEL', progress: 62 },
  { epoch: 246, status: 'Completed', startBlock: 2_845_600, endBlock: 2_846_799, validators: 154, rewards: '51,890 AETHEL', progress: 100 },
  { epoch: 245, status: 'Completed', startBlock: 2_844_400, endBlock: 2_845_599, validators: 153, rewards: '53,120 AETHEL', progress: 100 },
  { epoch: 244, status: 'Completed', startBlock: 2_843_200, endBlock: 2_844_399, validators: 151, rewards: '50,440 AETHEL', progress: 100 },
  { epoch: 243, status: 'Completed', startBlock: 2_842_000, endBlock: 2_843_199, validators: 150, rewards: '52,780 AETHEL', progress: 100 },
];

function EpochTimeline() {
  return (
    <section className="max-w-[1440px] mx-auto px-6 py-12">
      <SectionHeader
        title="Epoch Timeline"
        subtitle="Recent epoch history and validator reward distribution"
      />

      {/* Horizontal timeline */}
      <div className="relative">
        {/* Timeline line */}
        <div className="absolute top-6 left-0 right-0 h-0.5 bg-slate-800" />

        <div className="grid grid-cols-5 gap-4">
          {EPOCH_DATA.map((epoch) => (
            <GlassCard
              key={epoch.epoch}
              className={`p-4 relative ${epoch.status === 'Active' ? 'border-red-500/30 bg-red-500/5' : ''}`}
              hover={false}
            >
              {/* Dot on timeline */}
              <div className={`absolute -top-[5px] left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 ${
                epoch.status === 'Active' ? 'bg-red-500 border-red-400' : 'bg-slate-700 border-slate-600'
              }`} />

              <div className="text-center mt-4">
                <div className="flex items-center justify-center gap-1 mb-2">
                  <span className="text-sm font-bold text-white">Epoch {epoch.epoch}</span>
                  {epoch.status === 'Active' && (
                    <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                  )}
                </div>
                <StatusBadge status={epoch.status} />
              </div>

              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Blocks</span>
                  <span className="text-[10px] text-slate-400 font-mono tabular-nums">
                    {(epoch.startBlock / 1000).toFixed(1)}K - {(epoch.endBlock / 1000).toFixed(1)}K
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Validators</span>
                  <span className="text-[10px] text-white font-medium">{epoch.validators}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Rewards</span>
                  <span className="text-[10px] text-white font-medium">{epoch.rewards}</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-3">
                <div className="w-full h-1 bg-slate-700/50 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${epoch.status === 'Active' ? 'bg-red-500' : 'bg-emerald-500'}`}
                    style={{ width: `${epoch.progress}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-500 text-center mt-1">{epoch.progress}%</p>
              </div>
            </GlassCard>
          ))}
        </div>
      </div>
    </section>
  );
}


// =============================================================================
// FEATURES SECTION
// =============================================================================

function FeaturesSection() {
  const features = [
    {
      icon: <Cpu className="w-7 h-7" />,
      title: 'Proof of Useful Work',
      description: 'Validators perform real AI computation instead of wasteful hash puzzles. Every block contributes to model training and inference verification.',
      link: '#',
    },
    {
      icon: <ShieldCheck className="w-7 h-7" />,
      title: 'TEE Security',
      description: 'All AI workloads execute inside Trusted Execution Environments. Hardware attestations prove computation integrity without revealing model weights.',
      link: '#',
    },
    {
      icon: <Brain className="w-7 h-7" />,
      title: 'Verifiable AI',
      description: 'Zero-knowledge proofs enable anyone to verify AI model outputs without revealing the model itself. Privacy-preserving ML at scale.',
      link: '#',
    },
    {
      icon: <Link2 className="w-7 h-7" />,
      title: 'Cross-Chain',
      description: 'IBC-enabled interoperability with Cosmos ecosystem. Bridge verified AI proofs and digital seals across chains seamlessly.',
      link: '#',
    },
  ];

  return (
    <section className="max-w-[1440px] mx-auto px-6 py-16">
      <div className="text-center mb-12">
        <div className="flex items-center justify-center gap-2 mb-4">
          <div className="h-px w-12 bg-red-800" />
          <span className="text-xs font-medium text-red-400 uppercase tracking-widest">PROTOCOL FEATURES</span>
          <div className="h-px w-12 bg-red-800" />
        </div>
        <h2 className="text-3xl font-bold text-white tracking-tight mb-3">
          Built for Verifiable AI
        </h2>
        <p className="text-base text-slate-400 max-w-2xl mx-auto">
          Purpose-built infrastructure to solve the trust problem in AI computation.
        </p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
        {features.map((feature) => (
          <GlassCard key={feature.title} className="p-6 group">
            <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center text-red-400 mb-5 group-hover:bg-red-500/20 transition-colors">
              {feature.icon}
            </div>
            <h3 className="text-base font-semibold text-white mb-2">{feature.title}</h3>
            <p className="text-sm text-slate-400 leading-relaxed mb-4">{feature.description}</p>
            <a href={feature.link} className="flex items-center gap-1.5 text-sm font-medium text-red-400 hover:text-red-300 transition-colors">
              Learn More <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </GlassCard>
        ))}
      </div>
    </section>
  );
}


// =============================================================================
// CHAIN COMPARISON
// =============================================================================

function ChainComparisonSection() {
  const chains = [
    { name: 'AETHELRED', tps: '2,450+', finality: '1.2s', consensus: 'Proof of Useful Work', aiNative: true, teeSecurity: true, stakingAPY: '8.5%', highlight: true },
    { name: 'Ethereum', tps: '15-30', finality: '~12 min', consensus: 'Proof of Stake', aiNative: false, teeSecurity: false, stakingAPY: '3.5%', highlight: false },
    { name: 'Solana', tps: '2,000+', finality: '~0.4s', consensus: 'Proof of History', aiNative: false, teeSecurity: false, stakingAPY: '7.0%', highlight: false },
    { name: 'Cosmos Hub', tps: '1,000+', finality: '~6s', consensus: 'Tendermint BFT', aiNative: false, teeSecurity: false, stakingAPY: '6.5%', highlight: false },
    { name: 'Avalanche', tps: '4,500+', finality: '~1s', consensus: 'Snow Protocol', aiNative: false, teeSecurity: false, stakingAPY: '8.0%', highlight: false },
  ];

  const metrics = ['TPS', 'Finality', 'Consensus', 'AI Native', 'TEE Security', 'Staking APY'];

  return (
    <section className="max-w-[1440px] mx-auto px-6 py-12">
      <SectionHeader
        title="Chain Comparison"
        subtitle="How Aethelred compares to other Layer 1 blockchains"
      />

      <GlassCard className="overflow-hidden overflow-x-auto" hover={false}>
        <table className="w-full min-w-[800px]">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th className="text-left px-5 py-3 text-[10px] font-medium text-slate-500 uppercase tracking-wider w-32">Chain</th>
              {metrics.map((m) => (
                <th key={m} className="text-left px-4 py-3 text-[10px] font-medium text-slate-500 uppercase tracking-wider">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chains.map((chain, idx) => (
              <tr
                key={chain.name}
                className={`border-b border-slate-800/50 last:border-0 ${chain.highlight ? 'bg-red-500/5' : 'hover:bg-slate-800/20'} transition-colors`}
              >
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    {chain.highlight && (
                      <div className="w-6 h-6 rounded bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center">
                        <span className="text-white text-[8px] font-bold">AV</span>
                      </div>
                    )}
                    <span className={`text-sm font-medium ${chain.highlight ? 'text-red-400' : 'text-slate-300'}`}>{chain.name}</span>
                  </div>
                </td>
                <td className={`px-4 py-3.5 text-sm tabular-nums ${chain.highlight ? 'text-white font-medium' : 'text-slate-400'}`}>{chain.tps}</td>
                <td className={`px-4 py-3.5 text-sm tabular-nums ${chain.highlight ? 'text-white font-medium' : 'text-slate-400'}`}>{chain.finality}</td>
                <td className={`px-4 py-3.5 text-sm ${chain.highlight ? 'text-white font-medium' : 'text-slate-400'}`}>{chain.consensus}</td>
                <td className="px-4 py-3.5">
                  {chain.aiNative ? (
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-slate-600" />
                  )}
                </td>
                <td className="px-4 py-3.5">
                  {chain.teeSecurity ? (
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-slate-600" />
                  )}
                </td>
                <td className={`px-4 py-3.5 text-sm tabular-nums ${chain.highlight ? 'text-white font-medium' : 'text-slate-400'}`}>{chain.stakingAPY}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </GlassCard>
    </section>
  );
}


// =============================================================================
// FOOTER (DARK)
// =============================================================================

/* Footer is now imported from SharedComponents */


// =============================================================================
// MAIN PAGE COMPONENT
// =============================================================================

export default function ExplorerPage() {
  // Modal states
  const [selectedBlock, setSelectedBlock] = useState<MockBlock | null>(null);
  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<MockTransaction | null>(null);
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<MockAIJob | null>(null);
  const [jobModalOpen, setJobModalOpen] = useState(false);

  const handleBlockClick = useCallback((block: MockBlock) => {
    setSelectedBlock(block);
    setBlockModalOpen(true);
  }, []);

  const handleTxClick = useCallback((tx: MockTransaction) => {
    setSelectedTx(tx);
    setTxModalOpen(true);
  }, []);

  const handleJobClick = useCallback((job: MockAIJob) => {
    setSelectedJob(job);
    setJobModalOpen(true);
  }, []);

  // Handle tx click from within block modal
  const handleTxFromBlockModal = useCallback((tx: MockTransaction) => {
    setBlockModalOpen(false);
    setTimeout(() => {
      setSelectedTx(tx);
      setTxModalOpen(true);
    }, 200);
  }, []);

  return (
    <>
      <SEOHead
        title="Explorer"
        description="Real-time blockchain explorer for the Aethelred network. View blocks, transactions, validators, and AI verification jobs."
        path="/"
      />

      <div className="min-h-screen bg-slate-950 text-white">
        {/* 1. TopNav */}
        <TopNav activePage="explorer" />

        <main id="main-content">
        {/* 2. Hero Section */}
        <HeroSection onBlockClick={handleBlockClick} onTxClick={handleTxClick} />

        {/* 3. Live Network Section */}
        <LiveNetworkSection onBlockClick={handleBlockClick} onTxClick={handleTxClick} />

        {/* 6. Network Statistics */}
        <NetworkStatisticsSection />

        {/* 7. Network Health Dashboard */}
        <NetworkHealthDashboard />

        {/* 8. Top Validators Preview */}
        <TopValidatorsPreview />

        {/* 9. Recent AI Verification Jobs */}
        <RecentAIJobsSection onJobClick={handleJobClick} />

        {/* 10. Protocol Metrics */}
        <ProtocolMetricsSection />

        {/* 11. Reconciliation */}
        <ReconciliationSection />

        {/* 12. Epoch Timeline */}
        <EpochTimeline />

        {/* 13. Features Section */}
        <FeaturesSection />

        {/* 14. Chain Comparison */}
        <ChainComparisonSection />
        </main>

        {/* 15. Footer */}
        <Footer />

        {/* 4. Block Detail Modal */}
        <BlockDetailModal
          block={selectedBlock}
          open={blockModalOpen}
          onClose={() => setBlockModalOpen(false)}
          onTxClick={handleTxFromBlockModal}
        />

        {/* 5. Transaction Detail Modal */}
        <TransactionDetailModal
          tx={selectedTx}
          open={txModalOpen}
          onClose={() => setTxModalOpen(false)}
        />

        {/* AI Job Detail Modal */}
        <AIJobDetailModal
          job={selectedJob}
          open={jobModalOpen}
          onClose={() => setJobModalOpen(false)}
        />
      </div>
    </>
  );
}
