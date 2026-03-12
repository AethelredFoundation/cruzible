/**
 * Aethelred Dashboard -- Validators Explorer (v2)
 *
 * World-class validator network explorer with comprehensive analytics,
 * delegation flows, validator comparison, decentralization metrics,
 * staking economics, performance insights, and slashing monitoring
 * for the Aethelred PoUW consensus network.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { SEOHead } from '@/components/SEOHead';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend,
} from 'recharts';
import {
  Shield, TrendingUp, Users, Zap, ArrowUpRight, ChevronRight, ExternalLink,
  AlertCircle, Clock, BarChart3, Activity, Award,
  ShieldCheck, Search, ChevronDown, ChevronUp,
  Wallet, Globe, Server, Cpu, ArrowRight, Info, Star,
  CheckCircle, Flame, Sparkles, CircleDot,
  LayoutGrid, List, Filter, MapPin, Lock, Eye, Hash, Layers,
  AlertTriangle, BookOpen, Terminal, HardDrive, Gauge, Target,
  X, Minus, ArrowDown,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import {
  TopNav, Footer, Modal, Drawer, AnimatedNumber, Tabs, Badge, LiveDot,
  ConfirmDialog, ProgressRing,
} from '@/components/SharedComponents';
import { seededRandom, seededRange, seededInt, formatNumber } from '@/lib/utils';
import { BRAND } from '@/lib/constants';
import { GlassCard, CopyButton, SectionHeader, Sparkline } from '@/components/PagePrimitives';


// =============================================================================
// TYPES
// =============================================================================

type ValidatorStatus = 'active' | 'inactive' | 'jailed';
type ViewMode = 'grid' | 'list';
type SortKey = 'votingPower' | 'commission' | 'uptime' | 'name' | 'apy';

interface ValidatorInfo {
  rank: number;
  name: string;
  address: string;
  status: ValidatorStatus;
  votingPower: number;
  selfStake: number;
  commission: number;
  uptime: number;
  apy: number;
  delegators: number;
  blocksProduced: number;
  aiJobsCompleted: number;
  aiJobsFailed: number;
  teeAttestation: boolean;
  joinedEpoch: number;
  performanceScore: number;
  securityScore: number;
  stakeWeight: number;
  jobCompletionRate: number;
  logoColor: string;
  initials: string;
  sparklineData: number[];
  radarData: { metric: string; value: number }[];
  uptimeHistory: { epoch: string; uptime: number }[];
  blocksPerEpoch: { epoch: string; blocks: number }[];
  delegatorBreakdown: { name: string; amount: number; color: string }[];
  recentBlocks: { number: number; time: string; txs: number; reward: number }[];
  commissionHistory: { date: string; from: number; to: number }[];
  lastAttestationTime: string;
  attestationChain: string;
  avgLatency: number;
}

interface SlashingEvent {
  validator: string;
  reason: string;
  amount: number;
  epoch: number;
  date: string;
}


// =============================================================================
// CONSTANTS
// =============================================================================

const CHART_COLORS = [
  '#DC2626', '#F87171', '#FCA5A5', '#FECACA', '#FEE2E2',
  '#3B82F6', '#60A5FA', '#93C5FD', '#10B981', '#F59E0B',
];

const DELEGATOR_COLORS = ['#DC2626', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#64748B'];

const LOGO_COLORS = [
  '#DC2626', '#2563EB', '#059669', '#D97706', '#7C3AED',
  '#0891B2', '#DB2777', '#4F46E5', '#0D9488', '#EA580C',
  '#6D28D9', '#0284C7', '#B91C1C', '#065F46', '#92400E',
  '#5B21B6', '#155E75', '#9D174D', '#3730A3', '#134E4A',
];


// =============================================================================
// MOCK DATA -- 20 VALIDATORS
// =============================================================================

const VALIDATOR_NAMES = [
  'Aethelred Foundation', 'Paradigm Stake', 'a16z Validator', 'Coinbase Cloud',
  'Figment Networks', 'Chorus One', 'Everstake', 'Allnodes',
  'P2P Validator', 'Staked.us', 'Blockdaemon', 'HashQuark',
  'InfStones', 'Kiln Finance', 'Luganodes', 'Nodefleet',
  'Polychain Labs', 'RockX', 'Stakely', 'Swiss Staking',
];

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function generateValidators(): ValidatorInfo[] {
  const baseVotingPowers = [
    12_400_000, 10_800_000, 9_200_000, 8_500_000, 7_800_000,
    7_100_000, 6_400_000, 5_900_000, 5_300_000, 4_800_000,
    4_200_000, 3_700_000, 3_200_000, 2_800_000, 2_400_000,
    2_000_000, 1_600_000, 1_300_000, 1_000_000, 800_000,
  ];

  return VALIDATOR_NAMES.map((name, i) => {
    const seed = (i + 1) * 7919;
    const votingPower = baseVotingPowers[i] + seededInt(seed, -200000, 200000);
    const commission = Number((3 + seededRange(seed + 1, 0, 12)).toFixed(1));
    const uptime = Number((99.0 + seededRange(seed + 2, 0, 1.0)).toFixed(2));
    const apy = Number((6.5 + seededRange(seed + 3, 0, 3.0)).toFixed(2));
    const delegators = seededInt(seed + 4, 100, 5000);
    const selfStake = seededInt(seed + 5, 100000, 2000000);
    const blocksProduced = seededInt(seed + 6, 18000, 95000);
    const aiJobsCompleted = seededInt(seed + 7, 2400, 14000);
    const aiJobsFailed = seededInt(seed + 8, 5, 80);
    const joinedEpoch = seededInt(seed + 9, 1, 220);
    const performanceScore = Number((85 + seededRange(seed + 10, 0, 14)).toFixed(1));
    const securityScore = Number((88 + seededRange(seed + 11, 0, 12)).toFixed(1));
    const avgLatency = seededInt(seed + 12, 12, 85);

    const status: ValidatorStatus =
      i === 18 ? 'inactive' : i === 19 ? 'jailed' : 'active';

    const sparklineData = Array.from({ length: 7 }, (_, j) =>
      Number(seededRange(seed + 20 + j, performanceScore - 5, performanceScore + 2).toFixed(1))
    );

    const jobCompletionRate = Number(
      ((aiJobsCompleted / (aiJobsCompleted + aiJobsFailed)) * 100).toFixed(1)
    );

    const totalStakeForWeight = baseVotingPowers.reduce((a, b) => a + b, 0);
    const stakeWeight = Number(((votingPower / totalStakeForWeight) * 100).toFixed(1));

    const radarData = [
      { metric: 'Performance', value: Math.round(performanceScore) },
      { metric: 'Uptime', value: Math.round(uptime) },
      { metric: 'Stake Weight', value: Math.min(Math.round(stakeWeight * 10), 100) },
      { metric: 'Job Completion', value: Math.round(jobCompletionRate) },
      { metric: 'Security Score', value: Math.round(securityScore) },
    ];

    const uptimeHistory = Array.from({ length: 30 }, (_, j) => ({
      epoch: `E${217 + j}`,
      uptime: Number((98.5 + seededRange(seed + 50 + j, 0, 1.5)).toFixed(2)),
    }));

    const blocksPerEpoch = Array.from({ length: 10 }, (_, j) => ({
      epoch: `E${237 + j}`,
      blocks: seededInt(seed + 80 + j, 800, 3000),
    }));

    const delegatorBreakdown = [
      { name: `aeth1${seededInt(seed + 90, 1000, 9999)}...a1`, amount: seededInt(seed + 91, 500000, 2000000), color: DELEGATOR_COLORS[0] },
      { name: `aeth1${seededInt(seed + 92, 1000, 9999)}...b2`, amount: seededInt(seed + 93, 300000, 800000), color: DELEGATOR_COLORS[1] },
      { name: `aeth1${seededInt(seed + 94, 1000, 9999)}...c3`, amount: seededInt(seed + 95, 200000, 500000), color: DELEGATOR_COLORS[2] },
      { name: `aeth1${seededInt(seed + 96, 1000, 9999)}...d4`, amount: seededInt(seed + 97, 100000, 300000), color: DELEGATOR_COLORS[3] },
      { name: `aeth1${seededInt(seed + 98, 1000, 9999)}...e5`, amount: seededInt(seed + 99, 50000, 150000), color: DELEGATOR_COLORS[4] },
      { name: 'Others', amount: votingPower - seededInt(seed + 100, 1200000, 3500000), color: DELEGATOR_COLORS[5] },
    ];

    const recentBlocks = Array.from({ length: 5 }, (_, j) => ({
      number: 2847391 - j * seededInt(seed + 110 + j, 10, 50),
      time: `${seededInt(seed + 115 + j, 1, 30)} min ago`,
      txs: seededInt(seed + 120 + j, 50, 200),
      reward: Number((2.0 + seededRange(seed + 125 + j, 0, 1.5)).toFixed(2)),
    }));

    const commissionHistory = [
      { date: 'Jan 15, 2026', from: commission + 1, to: commission },
    ];
    if (seededRandom(seed + 130) > 0.6) {
      commissionHistory.push({
        date: 'Nov 02, 2025',
        from: commission + 2.5,
        to: commission + 1,
      });
    }

    return {
      rank: i + 1,
      name,
      address: `aeth1${Array.from({ length: 6 }, (_, j) =>
        '0123456789abcdef'[seededInt(seed + 140 + j, 0, 15)]
      ).join('')}...${Array.from({ length: 4 }, (_, j) =>
        '0123456789abcdef'[seededInt(seed + 150 + j, 0, 15)]
      ).join('')}`,
      status,
      votingPower,
      selfStake,
      commission,
      uptime,
      apy,
      delegators,
      blocksProduced,
      aiJobsCompleted,
      aiJobsFailed,
      teeAttestation: seededRandom(seed + 160) > 0.1,
      joinedEpoch,
      performanceScore,
      securityScore,
      stakeWeight,
      jobCompletionRate,
      logoColor: LOGO_COLORS[i % LOGO_COLORS.length],
      initials: getInitials(name),
      sparklineData,
      radarData,
      uptimeHistory,
      blocksPerEpoch,
      delegatorBreakdown,
      recentBlocks,
      commissionHistory,
      lastAttestationTime: `${seededInt(seed + 170, 1, 12)}h ${seededInt(seed + 171, 0, 59)}m ago`,
      attestationChain: `SGX-${seededInt(seed + 172, 1000, 9999)}-${seededInt(seed + 173, 100, 999)}`,
      avgLatency,
    };
  }).sort((a, b) => b.votingPower - a.votingPower).map((v, i) => ({ ...v, rank: i + 1 }));
}

const VALIDATORS = generateValidators();
const TOTAL_STAKED = VALIDATORS.reduce((s, v) => s + v.votingPower, 0);


// =============================================================================
// DATA GENERATORS
// =============================================================================

function generateAPYTrend(): { epoch: string; apy: number }[] {
  return Array.from({ length: 30 }, (_, i) => ({
    epoch: `E${217 + i}`,
    apy: Number((6.5 + seededRange(i * 31, 0, 2.5)).toFixed(2)),
  }));
}

function generateCommissionDistribution(): { range: string; count: number }[] {
  return [
    { range: '3-5%', count: seededInt(401, 4, 6) },
    { range: '5-7%', count: seededInt(402, 5, 8) },
    { range: '7-10%', count: seededInt(403, 3, 5) },
    { range: '10-12%', count: seededInt(404, 2, 4) },
    { range: '12-15%', count: seededInt(405, 1, 3) },
  ];
}

function generateStakeGrowth(): { day: string; totalStake: number }[] {
  return Array.from({ length: 90 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (89 - i));
    return {
      day: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      totalStake: Number((75 + seededRange(i * 37, 0, 14.4) + (i * 0.15)).toFixed(1)),
    };
  });
}

function generateVotingPowerCumulative(): { rank: number; name: string; cumulative: number }[] {
  const sorted = [...VALIDATORS].filter(v => v.status === 'active').sort((a, b) => b.votingPower - a.votingPower);
  let cumulative = 0;
  return sorted.map((v, i) => {
    cumulative += (v.votingPower / TOTAL_STAKED) * 100;
    return { rank: i + 1, name: v.name, cumulative: Number(cumulative.toFixed(1)) };
  });
}

const REGION_DISTRIBUTION = [
  { name: 'United States', value: 28, color: '#DC2626' },
  { name: 'Europe', value: 24, color: '#F87171' },
  { name: 'Asia', value: 22, color: '#FCA5A5' },
  { name: 'South America', value: 10, color: '#3B82F6' },
  { name: 'Oceania', value: 8, color: '#60A5FA' },
  { name: 'Africa', value: 5, color: '#10B981' },
  { name: 'Middle East', value: 3, color: '#F59E0B' },
];

const SLASHING_EVENTS: SlashingEvent[] = [
  { validator: 'Swiss Staking', reason: 'Double signing', amount: 45000, epoch: 189, date: 'Jan 28, 2026' },
  { validator: 'Stakely', reason: 'Extended downtime (>48h)', amount: 12000, epoch: 203, date: 'Feb 8, 2026' },
  { validator: 'Nodefleet', reason: 'Invalid TEE attestation', amount: 8500, epoch: 218, date: 'Feb 18, 2026' },
  { validator: 'RockX', reason: 'Missed blocks (>100)', amount: 5200, epoch: 231, date: 'Feb 27, 2026' },
  { validator: 'InfStones', reason: 'Downtime during epoch transition', amount: 3100, epoch: 240, date: 'Mar 4, 2026' },
];

const REWARD_FLOW = [
  { name: 'Validator Rewards', value: 65, color: '#DC2626' },
  { name: 'Delegator Rewards', value: 25, color: '#F87171' },
  { name: 'Protocol Treasury', value: 7, color: '#3B82F6' },
  { name: 'Insurance Fund', value: 3, color: '#10B981' },
];


// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function formatStake(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}


// =============================================================================
// SMALL REUSABLE COMPONENTS
// =============================================================================

function StatusBadge({ status }: { status: ValidatorStatus }) {
  const config = {
    active: { label: 'Active', bg: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'ring-emerald-500/20', dot: 'bg-emerald-400' },
    inactive: { label: 'Inactive', bg: 'bg-yellow-500/10', text: 'text-yellow-400', ring: 'ring-yellow-500/20', dot: 'bg-yellow-400' },
    jailed: { label: 'Jailed', bg: 'bg-red-500/10', text: 'text-red-400', ring: 'ring-red-500/20', dot: 'bg-red-400' },
  };
  const c = config[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${c.bg} ${c.text} ${c.ring}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot} ${status === 'active' ? 'animate-pulse' : ''}`} />
      {c.label}
    </span>
  );
}

function ValidatorLogo({ name, color, initials, size = 'md' }: {
  name: string;
  color: string;
  initials: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-lg',
  };
  return (
    <div
      className={`${sizeClasses[size]} rounded-xl flex items-center justify-center text-white font-bold shadow-sm flex-shrink-0`}
      style={{ backgroundColor: color }}
      title={name}
    >
      {initials}
    </div>
  );
}

function ScoreBar({ score, max = 100, color = BRAND.red }: { score: number; max?: number; color?: string }) {
  const pct = (score / max) * 100;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-slate-400 tabular-nums w-10 text-right">{score.toFixed(1)}</span>
    </div>
  );
}


// =============================================================================
// SECTION 1: HERO
// =============================================================================

function HeroSection() {
  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-red-950/40" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(220,38,38,0.15)_0%,_transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_rgba(220,38,38,0.08)_0%,_transparent_50%)]" />
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)',
        backgroundSize: '64px 64px',
      }} />

      <div className="relative max-w-[1400px] mx-auto px-6 py-12 lg:py-16">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Badge variant="brand">
              <ShieldCheck className="w-3 h-3 mr-1" />
              PoUW Consensus
            </Badge>
            <Badge variant="success">
              <LiveDot color="green" size="sm" />
              <span className="ml-1">Epoch #247</span>
            </Badge>
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold text-white tracking-tight mb-3">
            Validator Network
          </h1>
          <p className="text-lg text-slate-400 leading-relaxed max-w-2xl">
            Explore the Aethelred validator set securing the network through Proof-of-Useful-Work
            consensus. TEE-verified computation, geographic diversity, and hardware-attested security.
          </p>
        </div>

        {/* Hero Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {[
            { label: 'Total Validators', value: 156, suffix: '', decimals: 0, sub: '+8 this epoch', icon: <Users className="w-5 h-5" />, trend: true },
            { label: 'Total Staked', value: 89.4, suffix: 'M', decimals: 1, sub: 'AETHEL', icon: <Lock className="w-5 h-5" />, trend: false },
            { label: 'Average Uptime', value: 99.7, suffix: '%', decimals: 1, sub: 'Last 30 epochs', icon: <Activity className="w-5 h-5" />, trend: false },
            { label: 'Network Security Score', value: 98.2, suffix: '/100', decimals: 1, sub: 'Composite metric', icon: <Shield className="w-5 h-5" />, trend: false },
          ].map((stat, i) => (
            <div key={i} className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 rounded-lg bg-red-500/10 text-red-400">{stat.icon}</div>
                <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">{stat.label}</span>
              </div>
              <p className="text-2xl lg:text-3xl font-bold text-white tabular-nums">
                <AnimatedNumber value={stat.value} suffix={stat.suffix} decimals={stat.decimals} />
              </p>
              <div className="flex items-center gap-1 mt-1">
                {stat.trend && <ArrowUpRight className="w-3 h-3 text-emerald-400" />}
                <span className={`text-xs ${stat.trend ? 'text-emerald-400' : 'text-slate-500'}`}>{stat.sub}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// =============================================================================
// SECTION 2: TOP 3 VALIDATOR SHOWCASE
// =============================================================================

function TopValidatorShowcase({ onSelectValidator, onDelegate }: {
  onSelectValidator: (v: ValidatorInfo) => void;
  onDelegate: (v: ValidatorInfo) => void;
}) {
  const top3 = VALIDATORS.filter(v => v.status === 'active').slice(0, 3);
  const rankColors = ['from-yellow-400 to-amber-500', 'from-slate-300 to-slate-400', 'from-amber-600 to-amber-700'];
  const rankLabels = ['#1', '#2', '#3'];

  return (
    <section className="mb-12">
      <SectionHeader
        title="Top Validators"
        subtitle="Highest-ranked validators by voting power and composite performance"
        size="sm"
      />
      <div className="grid lg:grid-cols-3 gap-5">
        {top3.map((v, i) => (
          <GlassCard key={v.name} className="p-6 relative overflow-hidden" onClick={() => onSelectValidator(v)}>
            {/* Rank badge */}
            <div className={`absolute top-4 right-4 w-10 h-10 rounded-full bg-gradient-to-br ${rankColors[i]} flex items-center justify-center shadow-md`}>
              <span className="text-white font-bold text-sm">{rankLabels[i]}</span>
            </div>

            {/* Validator info */}
            <div className="flex items-center gap-3 mb-4">
              <ValidatorLogo name={v.name} color={v.logoColor} initials={v.initials} size="lg" />
              <div>
                <h3 className="font-semibold text-white text-base">{v.name}</h3>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500 font-mono">{v.address}</span>
                  <CopyButton text={v.address} />
                </div>
              </div>
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-slate-900/50 rounded-xl p-3">
                <p className="text-xs text-slate-500 mb-0.5">Voting Power</p>
                <p className="text-lg font-bold text-white tabular-nums">{formatStake(v.votingPower)}</p>
              </div>
              <div className="bg-slate-900/50 rounded-xl p-3">
                <p className="text-xs text-slate-500 mb-0.5">Commission</p>
                <p className="text-lg font-bold text-white tabular-nums">{v.commission}%</p>
              </div>
              <div className="bg-slate-900/50 rounded-xl p-3">
                <p className="text-xs text-slate-500 mb-0.5">Uptime</p>
                <p className="text-lg font-bold text-emerald-400 tabular-nums">{v.uptime}%</p>
              </div>
              <div className="bg-slate-900/50 rounded-xl p-3">
                <p className="text-xs text-slate-500 mb-0.5">APY</p>
                <p className="text-lg font-bold text-emerald-400 tabular-nums">{v.apy}%</p>
              </div>
            </div>

            {/* Radar chart */}
            <div className="h-[180px] mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={v.radarData} cx="50%" cy="50%" outerRadius="70%">
                  <PolarGrid stroke="#334155" />
                  <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
                  <Radar dataKey="value" stroke={BRAND.red} fill={BRAND.red} fillOpacity={0.15} strokeWidth={2} />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {/* Delegate button */}
            <button
              onClick={(e) => { e.stopPropagation(); onDelegate(v); }}
              className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-medium transition-colors"
            >
              Delegate
            </button>
          </GlassCard>
        ))}
      </div>
    </section>
  );
}


// =============================================================================
// SECTION 3: VALIDATOR TABLE + GRID (with controls)
// =============================================================================

function ValidatorTableSection({
  onSelectValidator,
  onDelegate,
  compareSelected,
  setCompareSelected,
}: {
  onSelectValidator: (v: ValidatorInfo) => void;
  onDelegate: (v: ValidatorInfo) => void;
  compareSelected: number[];
  setCompareSelected: React.Dispatch<React.SetStateAction<number[]>>;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ValidatorStatus>('all');
  const [sortBy, setSortBy] = useState<SortKey>('votingPower');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const filteredValidators = useMemo(() => {
    let result = [...VALIDATORS];

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(v => v.status === statusFilter);
    }

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(v =>
        v.name.toLowerCase().includes(q) ||
        v.address.toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case 'votingPower': return b.votingPower - a.votingPower;
        case 'commission': return a.commission - b.commission;
        case 'uptime': return b.uptime - a.uptime;
        case 'name': return a.name.localeCompare(b.name);
        case 'apy': return b.apy - a.apy;
        default: return 0;
      }
    });

    return result;
  }, [searchQuery, statusFilter, sortBy]);

  const toggleCompare = (rank: number) => {
    setCompareSelected(prev => {
      if (prev.includes(rank)) return prev.filter(r => r !== rank);
      if (prev.length >= 3) return prev;
      return [...prev, rank];
    });
  };

  return (
    <section className="mb-12">
      <SectionHeader
        title="Validator Set"
        subtitle={`${VALIDATORS.length} validators securing the network`}
        size="sm"
        action={
          compareSelected.length >= 2 ? (
            <button
              onClick={() => {}} // handled by parent
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-xl transition-colors"
            >
              Compare Selected ({compareSelected.length})
            </button>
          ) : undefined
        }
      />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Search */}
        <div className="flex-1 min-w-[260px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search validators by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-800/50 border border-slate-700/30 rounded-xl text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-red-500/30 focus:border-red-500/50 transition-all outline-none"
            />
          </div>
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="border border-slate-700/30 rounded-xl px-3 py-2.5 text-sm bg-slate-800/50 text-white focus:ring-2 focus:ring-red-500/30 focus:border-red-500/50 transition-all outline-none"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="jailed">Jailed</option>
        </select>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="border border-slate-700/30 rounded-xl px-3 py-2.5 text-sm bg-slate-800/50 text-white focus:ring-2 focus:ring-red-500/30 focus:border-red-500/50 transition-all outline-none"
        >
          <option value="votingPower">Sort: Voting Power</option>
          <option value="commission">Sort: Commission</option>
          <option value="uptime">Sort: Uptime</option>
          <option value="name">Sort: Name</option>
          <option value="apy">Sort: APY</option>
        </select>

        {/* View toggle */}
        <div className="flex items-center bg-slate-800/50 rounded-xl p-1 border border-slate-700/30">
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
            title="List view"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
            title="Grid view"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Results */}
      {filteredValidators.length === 0 ? (
        <div className="text-center py-16">
          <Search className="w-8 h-8 mx-auto mb-3 text-slate-600" />
          <p className="text-sm text-slate-500">No validators found matching your criteria</p>
        </div>
      ) : viewMode === 'list' ? (
        <GlassCard className="overflow-hidden" hover={false}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/30">
                  <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 text-left w-10"></th>
                  <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 text-left">Rank</th>
                  <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 text-left">Validator</th>
                  <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 text-left">Status</th>
                  <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 text-left">Voting Power</th>
                  <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 text-left">Commission</th>
                  <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 text-left">Uptime</th>
                  <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 text-left">APY</th>
                  <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 text-left">Delegators</th>
                  <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 text-left">Trend</th>
                  <th className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 text-left"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {filteredValidators.map((v) => (
                  <tr
                    key={v.rank}
                    className="hover:bg-slate-700/20 transition-colors cursor-pointer group"
                    onClick={() => onSelectValidator(v)}
                  >
                    {/* Checkbox */}
                    <td className="px-4 py-3.5">
                      <input
                        type="checkbox"
                        checked={compareSelected.includes(v.rank)}
                        onChange={(e) => { e.stopPropagation(); toggleCompare(v.rank); }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-red-600 focus:ring-red-500/30 focus:ring-offset-0"
                      />
                    </td>

                    {/* Rank */}
                    <td className="px-4 py-3.5">
                      <span className={`text-sm font-bold tabular-nums ${v.rank <= 3 ? 'text-red-400' : 'text-slate-500'}`}>#{v.rank}</span>
                    </td>

                    {/* Validator */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <ValidatorLogo name={v.name} color={v.logoColor} initials={v.initials} size="sm" />
                        <div>
                          <p className="text-sm font-semibold text-white group-hover:text-red-400 transition-colors">{v.name}</p>
                          <p className="text-xs text-slate-500 font-mono">{v.address}</p>
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3.5">
                      <StatusBadge status={v.status} />
                    </td>

                    {/* Voting Power */}
                    <td className="px-4 py-3.5">
                      <p className="text-sm font-semibold text-white tabular-nums">{formatStake(v.votingPower)}</p>
                      <p className="text-xs text-slate-500 tabular-nums">{((v.votingPower / TOTAL_STAKED) * 100).toFixed(1)}%</p>
                    </td>

                    {/* Commission */}
                    <td className="px-4 py-3.5">
                      <span className="text-sm font-medium text-slate-300 tabular-nums">{v.commission}%</span>
                    </td>

                    {/* Uptime */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${v.uptime}%` }} />
                        </div>
                        <span className="text-sm font-medium text-slate-300 tabular-nums">{v.uptime}%</span>
                      </div>
                    </td>

                    {/* APY */}
                    <td className="px-4 py-3.5">
                      <span className="text-sm font-semibold text-emerald-400 tabular-nums">{v.apy}%</span>
                    </td>

                    {/* Delegators */}
                    <td className="px-4 py-3.5">
                      <span className="text-sm text-slate-300 tabular-nums">{formatNumber(v.delegators)}</span>
                    </td>

                    {/* Sparkline */}
                    <td className="px-4 py-3.5">
                      <Sparkline
                        data={v.sparklineData}
                        color={v.performanceScore >= 95 ? '#10B981' : v.performanceScore >= 90 ? '#F59E0B' : '#EF4444'}
                        height={20}
                        width={60}
                      />
                    </td>

                    {/* Delegate button */}
                    <td className="px-4 py-3.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelegate(v); }}
                        className="px-3 py-1.5 bg-red-600/10 hover:bg-red-600 text-red-400 hover:text-white text-xs font-medium rounded-lg transition-colors border border-red-500/20 hover:border-red-600"
                      >
                        Delegate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      ) : (
        /* Grid View */
        <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredValidators.map((v) => (
            <GlassCard key={v.rank} className="p-5" onClick={() => onSelectValidator(v)}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <ValidatorLogo name={v.name} color={v.logoColor} initials={v.initials} size="md" />
                  <div>
                    <p className="text-sm font-semibold text-white">{v.name}</p>
                    <p className="text-xs text-slate-500 font-mono">{v.address}</p>
                  </div>
                </div>
                <span className={`text-sm font-bold tabular-nums ${v.rank <= 3 ? 'text-red-400' : 'text-slate-500'}`}>#{v.rank}</span>
              </div>

              <StatusBadge status={v.status} />

              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="bg-slate-900/50 rounded-lg p-2">
                  <p className="text-xs text-slate-500">Voting Power</p>
                  <p className="text-sm font-bold text-white tabular-nums">{formatStake(v.votingPower)}</p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-2">
                  <p className="text-xs text-slate-500">APY</p>
                  <p className="text-sm font-bold text-emerald-400 tabular-nums">{v.apy}%</p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-2">
                  <p className="text-xs text-slate-500">Commission</p>
                  <p className="text-sm font-bold text-white tabular-nums">{v.commission}%</p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-2">
                  <p className="text-xs text-slate-500">Uptime</p>
                  <p className="text-sm font-bold text-white tabular-nums">{v.uptime}%</p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <Sparkline data={v.sparklineData} color={v.performanceScore >= 95 ? '#10B981' : '#F59E0B'} height={20} width={60} />
                <span className="text-xs text-slate-500">{formatNumber(v.delegators)} delegators</span>
              </div>

              <button
                onClick={(e) => { e.stopPropagation(); onDelegate(v); }}
                className="w-full mt-3 py-2 bg-red-600/10 hover:bg-red-600 text-red-400 hover:text-white text-sm font-medium rounded-xl transition-colors border border-red-500/20 hover:border-red-600"
              >
                Delegate
              </button>
            </GlassCard>
          ))}
        </div>
      )}
    </section>
  );
}


// =============================================================================
// SECTION 4: VALIDATOR DETAIL DRAWER
// =============================================================================

function ValidatorDetailDrawer({ validator, isOpen, onClose, onDelegate }: {
  validator: ValidatorInfo | null;
  isOpen: boolean;
  onClose: () => void;
  onDelegate: (v: ValidatorInfo) => void;
}) {
  if (!validator) return null;

  const v = validator;
  const jobSuccessRate = v.jobCompletionRate;

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Validator Details" width="max-w-2xl">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <ValidatorLogo name={v.name} color={v.logoColor} initials={v.initials} size="lg" />
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-bold text-white">{v.name}</h3>
              <StatusBadge status={v.status} />
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-slate-500 font-mono">{v.address}</span>
              <CopyButton text={v.address} />
              <span className="text-xs text-slate-600">Rank #{v.rank}</span>
            </div>
          </div>
        </div>

        {/* Key Stats Grid */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Voting Power', value: formatStake(v.votingPower), sub: `${((v.votingPower / TOTAL_STAKED) * 100).toFixed(2)}% of total` },
            { label: 'Commission', value: `${v.commission}%`, sub: 'Fee rate' },
            { label: 'Uptime', value: `${v.uptime}%`, sub: 'Last 30 epochs' },
            { label: 'Delegators', value: formatNumber(v.delegators), sub: 'Total count' },
            { label: 'Self-Stake', value: formatStake(v.selfStake), sub: `${((v.selfStake / v.votingPower) * 100).toFixed(1)}% ratio` },
            { label: 'APY', value: `${v.apy}%`, sub: 'Current yield' },
          ].map((s, i) => (
            <div key={i} className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/30">
              <p className="text-xs text-slate-500 mb-0.5">{s.label}</p>
              <p className="text-sm font-bold text-white tabular-nums">{s.value}</p>
              <p className="text-xs text-slate-600">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Performance History Chart */}
        <div>
          <h4 className="text-sm font-semibold text-white mb-3">Performance History (30 Epochs)</h4>
          <div className="h-[200px] bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={v.uptimeHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="epoch" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} interval={5} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={35} domain={[98, 100]} tickFormatter={(val) => `${val}%`} />
                <RechartsTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #334155', background: '#1e293b', fontSize: '12px', color: '#e2e8f0' }} formatter={(val: number) => [`${val}%`, 'Uptime']} />
                <Line type="monotone" dataKey="uptime" stroke="#10B981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Block Production Chart */}
        <div>
          <h4 className="text-sm font-semibold text-white mb-3">Block Production (Last 10 Epochs)</h4>
          <div className="h-[180px] bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={v.blocksPerEpoch}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="epoch" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={35} />
                <RechartsTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #334155', background: '#1e293b', fontSize: '12px', color: '#e2e8f0' }} formatter={(val: number) => [`${val} blocks`, 'Produced']} />
                <Bar dataKey="blocks" fill={BRAND.red} radius={[4, 4, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Delegator Breakdown */}
        <div>
          <h4 className="text-sm font-semibold text-white mb-3">Delegator Breakdown</h4>
          <div className="flex items-center gap-6">
            <div className="h-[160px] w-[160px] flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={v.delegatorBreakdown} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2} dataKey="amount">
                    {v.delegatorBreakdown.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #334155', background: '#1e293b', fontSize: '12px', color: '#e2e8f0' }} formatter={(val: number) => [formatStake(val), 'Staked']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-2">
              {v.delegatorBreakdown.map((d, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: d.color }} />
                    <span className="text-slate-400 font-mono text-xs">{d.name}</span>
                  </div>
                  <span className="text-slate-300 tabular-nums text-xs">{formatStake(d.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* AI Job Completion */}
        <div>
          <h4 className="text-sm font-semibold text-white mb-3">AI Job Completion</h4>
          <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-400">Success Rate</span>
              <span className="text-lg font-bold text-white tabular-nums">{jobSuccessRate}%</span>
            </div>
            <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${jobSuccessRate}%` }} />
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-slate-500">{formatNumber(v.aiJobsCompleted)} completed</span>
              <span className="text-xs text-slate-500">{formatNumber(v.aiJobsFailed)} failed</span>
            </div>
          </div>
        </div>

        {/* TEE Attestation */}
        <div>
          <h4 className="text-sm font-semibold text-white mb-3">TEE Attestation</h4>
          <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/30 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Status</span>
              <div className="flex items-center gap-1.5">
                {v.teeAttestation ? (
                  <>
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-medium text-emerald-400">Verified</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    <span className="text-sm font-medium text-red-400">Unverified</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Last Attestation</span>
              <span className="text-sm text-slate-300">{v.lastAttestationTime}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Attestation Chain</span>
              <span className="text-sm text-slate-300 font-mono">{v.attestationChain}</span>
            </div>
          </div>
        </div>

        {/* Recent Blocks */}
        <div>
          <h4 className="text-sm font-semibold text-white mb-3">Recent Blocks Produced</h4>
          <div className="space-y-2">
            {v.recentBlocks.map((block, idx) => (
              <div key={idx} className="flex items-center justify-between bg-slate-800/30 rounded-lg p-3 border border-slate-700/30">
                <div className="flex items-center gap-3">
                  <Hash className="w-4 h-4 text-slate-500" />
                  <div>
                    <span className="text-sm font-medium text-white tabular-nums">#{formatNumber(block.number)}</span>
                    <span className="text-xs text-slate-500 ml-2">{block.time}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-slate-400">{block.txs} txs</span>
                  <span className="text-xs font-medium text-emerald-400 tabular-nums">{block.reward} AETHEL</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Commission History */}
        <div>
          <h4 className="text-sm font-semibold text-white mb-3">Commission History</h4>
          <div className="space-y-2">
            {v.commissionHistory.map((ch, idx) => (
              <div key={idx} className="flex items-center justify-between bg-slate-800/30 rounded-lg p-3 border border-slate-700/30">
                <span className="text-sm text-slate-400">{ch.date}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-500 tabular-nums">{ch.from.toFixed(1)}%</span>
                  <ArrowRight className="w-3 h-3 text-slate-600" />
                  <span className="text-sm font-medium text-white tabular-nums">{ch.to.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Delegate CTA */}
        <button
          onClick={() => onDelegate(v)}
          className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition-colors"
        >
          Delegate to {v.name}
        </button>
      </div>
    </Drawer>
  );
}


// =============================================================================
// SECTION 5: DELEGATION MODAL
// =============================================================================

function DelegationModal({ validator, isOpen, onClose }: {
  validator: ValidatorInfo | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { wallet, connectWallet, addNotification } = useApp();
  const [amount, setAmount] = useState('');
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);

  const balance = wallet.connected ? wallet.balance : 0;
  const amountNum = parseFloat(amount) || 0;
  const estimatedMonthlyReward = validator ? amountNum * (validator.apy / 100 / 12) : 0;
  const commissionFee = validator ? estimatedMonthlyReward * (validator.commission / 100) : 0;
  const netMonthlyReward = estimatedMonthlyReward - commissionFee;

  const handleQuickAmount = (pct: number) => {
    if (pct === 100) {
      setAmount(balance.toFixed(2));
    } else {
      setAmount((balance * pct / 100).toFixed(2));
    }
  };

  const handleDelegate = () => {
    if (!validator || amountNum <= 0 || amountNum > balance) return;
    // Native staking module delegation is not yet available via the frontend.
    // Prevent simulated success that would mislead users into thinking
    // their delegation was submitted on-chain.
    addNotification(
      'warning',
      'Not Yet Available',
      'Validator delegation via the UI is under development. Please use the CLI or a native wallet to delegate directly.',
    );
  };

  const handleClose = () => {
    setAmount('');
    setProcessing(false);
    setSuccess(false);
    onClose();
  };

  if (!validator) return null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`Delegate to ${validator.name}`} size="md">
      {!wallet.connected ? (
        <div className="text-center py-8">
          <Wallet className="w-12 h-12 mx-auto mb-4 text-slate-500" />
          <p className="text-sm text-slate-400 mb-4">Connect your wallet to delegate tokens</p>
          <button
            onClick={connectWallet}
            className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-medium transition-colors"
          >
            Connect Wallet
          </button>
        </div>
      ) : success ? (
        <div className="text-center py-8">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Delegation Successful</h3>
          <p className="text-sm text-slate-400">
            {formatNumber(amountNum)} AETHEL delegated to {validator.name}
          </p>
        </div>
      ) : processing ? (
        <div className="text-center py-8">
          <div className="w-16 h-16 rounded-full border-4 border-slate-700 border-t-red-500 animate-spin mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">Processing Delegation</h3>
          <p className="text-sm text-slate-400">Submitting transaction to the network...</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Validator info */}
          <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl border border-slate-700/30">
            <ValidatorLogo name={validator.name} color={validator.logoColor} initials={validator.initials} size="md" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-white">{validator.name}</p>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs text-slate-500">Commission: {validator.commission}%</span>
                <span className="text-xs text-slate-500">APY: {validator.apy}%</span>
                <span className="text-xs text-slate-500">Uptime: {validator.uptime}%</span>
              </div>
            </div>
          </div>

          {/* Amount input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-white">Amount</label>
              <span className="text-xs text-slate-500">Balance: {formatNumber(balance, 2)} AETHEL</span>
            </div>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700/30 rounded-xl text-white text-lg font-semibold tabular-nums placeholder-slate-600 focus:ring-2 focus:ring-red-500/30 focus:border-red-500/50 transition-all outline-none"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-500 font-medium">AETHEL</span>
            </div>
          </div>

          {/* Quick amounts */}
          <div className="flex gap-2">
            {[25, 50, 75].map(pct => (
              <button
                key={pct}
                onClick={() => handleQuickAmount(pct)}
                className="flex-1 py-2 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/30 rounded-lg text-sm text-slate-400 hover:text-white transition-colors"
              >
                {pct}%
              </button>
            ))}
            <button
              onClick={() => handleQuickAmount(100)}
              className="flex-1 py-2 bg-red-600/10 hover:bg-red-600/20 border border-red-500/20 rounded-lg text-sm text-red-400 hover:text-red-300 transition-colors font-medium"
            >
              MAX
            </button>
          </div>

          {/* Preview */}
          {amountNum > 0 && (
            <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/30 space-y-2">
              <h4 className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">Delegation Preview</h4>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Amount to Delegate</span>
                <span className="text-sm font-semibold text-white tabular-nums">{formatNumber(amountNum, 2)} AETHEL</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Expected APY</span>
                <span className="text-sm font-semibold text-emerald-400 tabular-nums">{validator.apy}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Est. Monthly Rewards</span>
                <span className="text-sm font-semibold text-white tabular-nums">{formatNumber(netMonthlyReward, 2)} AETHEL</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Commission Fee</span>
                <span className="text-sm text-slate-500 tabular-nums">-{formatNumber(commissionFee, 2)} AETHEL</span>
              </div>
            </div>
          )}

          {/* Confirm button */}
          <button
            onClick={handleDelegate}
            disabled={amountNum <= 0 || amountNum > balance}
            className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl text-sm font-semibold transition-colors disabled:cursor-not-allowed"
          >
            Confirm Delegation
          </button>
        </div>
      )}
    </Modal>
  );
}


// =============================================================================
// SECTION 6: COMPARISON MODAL
// =============================================================================

function ComparisonModal({ selectedRanks, isOpen, onClose }: {
  selectedRanks: number[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const selected = selectedRanks.map(rank => VALIDATORS.find(v => v.rank === rank)).filter(Boolean) as ValidatorInfo[];

  if (selected.length < 2) return null;

  // Merge radar data for overlay
  const mergedRadarData = selected[0].radarData.map((item, idx) => {
    const merged: Record<string, string | number> = { metric: item.metric };
    selected.forEach((v, vi) => {
      merged[`v${vi}`] = v.radarData[idx]?.value || 0;
    });
    return merged;
  });

  const radarColors = ['#DC2626', '#3B82F6', '#10B981'];

  // Determine recommendation
  const scores = selected.map(v => ({
    name: v.name,
    score: v.performanceScore * 0.3 + v.uptime * 0.25 + (100 - v.commission * 3) * 0.2 + v.apy * 5 * 0.15 + v.jobCompletionRate * 0.1,
  }));
  const best = scores.reduce((a, b) => a.score > b.score ? a : b);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Validator Comparison" size="xl">
      <div className="space-y-6">
        {/* Names row */}
        <div className="grid" style={{ gridTemplateColumns: `200px repeat(${selected.length}, 1fr)` }}>
          <div />
          {selected.map((v, i) => (
            <div key={v.rank} className="text-center px-4">
              <ValidatorLogo name={v.name} color={v.logoColor} initials={v.initials} size="md" />
              <p className="text-sm font-semibold text-white mt-2">{v.name}</p>
              <p className="text-xs text-slate-500">Rank #{v.rank}</p>
            </div>
          ))}
        </div>

        {/* Metrics rows */}
        <div className="divide-y divide-slate-700/30">
          {[
            { label: 'Voting Power', getValue: (v: ValidatorInfo) => formatStake(v.votingPower) },
            { label: 'Commission', getValue: (v: ValidatorInfo) => `${v.commission}%` },
            { label: 'Uptime', getValue: (v: ValidatorInfo) => `${v.uptime}%` },
            { label: 'APY', getValue: (v: ValidatorInfo) => `${v.apy}%` },
            { label: 'Delegators', getValue: (v: ValidatorInfo) => formatNumber(v.delegators) },
            { label: 'Self-Stake', getValue: (v: ValidatorInfo) => formatStake(v.selfStake) },
            { label: 'Performance', getValue: (v: ValidatorInfo) => `${v.performanceScore}` },
            { label: 'Security Score', getValue: (v: ValidatorInfo) => `${v.securityScore}` },
            { label: 'Job Success Rate', getValue: (v: ValidatorInfo) => `${v.jobCompletionRate}%` },
            { label: 'TEE Attestation', getValue: (v: ValidatorInfo) => v.teeAttestation ? 'Verified' : 'Unverified' },
            { label: 'Avg Latency', getValue: (v: ValidatorInfo) => `${v.avgLatency}ms` },
            { label: 'Blocks Produced', getValue: (v: ValidatorInfo) => formatNumber(v.blocksProduced) },
          ].map((metric) => (
            <div key={metric.label} className="grid py-2.5" style={{ gridTemplateColumns: `200px repeat(${selected.length}, 1fr)` }}>
              <span className="text-sm text-slate-400 self-center">{metric.label}</span>
              {selected.map(v => (
                <span key={v.rank} className="text-sm font-medium text-white text-center tabular-nums">{metric.getValue(v)}</span>
              ))}
            </div>
          ))}
        </div>

        {/* Radar overlay */}
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={mergedRadarData} cx="50%" cy="50%" outerRadius="70%">
              <PolarGrid stroke="#334155" />
              <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
              {selected.map((v, i) => (
                <Radar key={v.rank} dataKey={`v${i}`} name={v.name} stroke={radarColors[i]} fill={radarColors[i]} fillOpacity={0.08} strokeWidth={2} />
              ))}
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Recommendation */}
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Star className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-semibold text-emerald-400">Recommendation</span>
          </div>
          <p className="text-sm text-slate-300">
            Based on a balanced weighting of performance, uptime, commission, APY, and job completion rate,{' '}
            <span className="font-semibold text-white">{best.name}</span> offers the best overall balance for delegators seeking reliable returns with minimal risk.
          </p>
        </div>
      </div>
    </Modal>
  );
}


// =============================================================================
// SECTION 7: NETWORK DECENTRALIZATION
// =============================================================================

function DecentralizationSection() {
  const votingPowerData = useMemo(() => generateVotingPowerCumulative(), []);

  return (
    <section className="mb-12">
      <SectionHeader
        title="Network Decentralization"
        subtitle="Geographic distribution, stake concentration, and decentralization metrics"
        size="sm"
      />

      <div className="grid lg:grid-cols-4 gap-5 mb-6">
        {/* Nakamoto Coefficient */}
        <GlassCard className="p-6" hover={false}>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shadow-lg">
              <span className="text-2xl font-bold text-white">7</span>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Nakamoto Coefficient</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Min validators to compromise the network
              </p>
            </div>
          </div>
        </GlassCard>

        {/* Decentralization Score */}
        <GlassCard className="p-6" hover={false}>
          <div className="flex items-center gap-4">
            <ProgressRing percentage={78} size={64} strokeWidth={5} color="#DC2626" />
            <div>
              <h3 className="text-sm font-semibold text-white">Decentralization Score</h3>
              <p className="text-2xl font-bold text-white tabular-nums">78<span className="text-sm text-slate-500">/100</span></p>
            </div>
          </div>
        </GlassCard>

        {/* Active / Total */}
        <GlassCard className="p-6" hover={false}>
          <div className="flex items-center gap-3 mb-2">
            <Users className="w-5 h-5 text-emerald-400" />
            <span className="text-sm font-semibold text-white">Active Set</span>
          </div>
          <p className="text-2xl font-bold text-white tabular-nums">
            {VALIDATORS.filter(v => v.status === 'active').length}
            <span className="text-sm text-slate-500 font-normal"> / {VALIDATORS.length}</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">validators active this epoch</p>
        </GlassCard>

        {/* Gini */}
        <GlassCard className="p-6" hover={false}>
          <div className="flex items-center gap-3 mb-2">
            <Target className="w-5 h-5 text-blue-400" />
            <span className="text-sm font-semibold text-white">Gini Coefficient</span>
          </div>
          <p className="text-2xl font-bold text-white tabular-nums">0.42</p>
          <p className="text-xs text-emerald-400 mt-1">Good stake distribution</p>
        </GlassCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Geographic Distribution Pie */}
        <GlassCard className="p-6" hover={false}>
          <h3 className="font-semibold text-white mb-4">Geographic Distribution</h3>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={REGION_DISTRIBUTION} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value">
                  {REGION_DISTRIBUTION.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #334155', background: '#1e293b', fontSize: '13px', color: '#e2e8f0' }} formatter={(value: number, name: string) => [`${value}%`, name]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2 mt-2">
            {REGION_DISTRIBUTION.map((r) => (
              <div key={r.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: r.color }} />
                  <span className="text-slate-400">{r.name}</span>
                </div>
                <span className="font-medium text-white tabular-nums">{r.value}%</span>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Stake Distribution / Lorenz Curve */}
        <GlassCard className="p-6" hover={false}>
          <h3 className="font-semibold text-white mb-1">Stake Distribution</h3>
          <p className="text-xs text-slate-500 mb-4">Cumulative voting power by validator rank (Lorenz curve)</p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={votingPowerData}>
                <defs>
                  <linearGradient id="vpGradDark" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={BRAND.red} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={BRAND.red} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="rank" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} label={{ value: 'Validator Rank', position: 'insideBottom', offset: -5, fontSize: 10, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                <RechartsTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #334155', background: '#1e293b', fontSize: '13px', color: '#e2e8f0' }} formatter={(value: number) => [`${value}%`, 'Cumulative Power']} labelFormatter={(label) => `Rank #${label}`} />
                <Area type="monotone" dataKey="cumulative" stroke={BRAND.red} strokeWidth={2} fill="url(#vpGradDark)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>
      </div>
    </section>
  );
}


// =============================================================================
// SECTION 8: STAKING ECONOMICS
// =============================================================================

function StakingEconomicsSection() {
  const apyTrend = useMemo(() => generateAPYTrend(), []);
  const commissionDist = useMemo(() => generateCommissionDistribution(), []);
  const stakeGrowth = useMemo(() => generateStakeGrowth(), []);

  return (
    <section className="mb-12">
      <SectionHeader
        title="Staking Economics"
        subtitle="APY trends, commission distribution, reward allocation, and total stake growth"
        size="sm"
      />

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        {/* APY Trend */}
        <GlassCard className="p-6" hover={false}>
          <h3 className="font-semibold text-white mb-1">APY Trend</h3>
          <p className="text-xs text-slate-500 mb-4">Staking yield over the last 30 epochs</p>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={apyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="epoch" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} interval={5} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v}%`} domain={['dataMin - 0.5', 'dataMax + 0.5']} />
                <RechartsTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #334155', background: '#1e293b', fontSize: '13px', color: '#e2e8f0' }} formatter={(value: number) => [`${value}%`, 'APY']} />
                <Line type="monotone" dataKey="apy" stroke={BRAND.red} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        {/* Commission Distribution */}
        <GlassCard className="p-6" hover={false}>
          <h3 className="font-semibold text-white mb-1">Commission Distribution</h3>
          <p className="text-xs text-slate-500 mb-4">Number of validators by commission rate</p>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={commissionDist}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="range" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={30} />
                <RechartsTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #334155', background: '#1e293b', fontSize: '13px', color: '#e2e8f0' }} formatter={(value: number) => [`${value} validators`, 'Count']} />
                <Bar dataKey="count" fill={BRAND.red} radius={[6, 6, 0, 0]} barSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Reward Distribution */}
        <GlassCard className="p-6" hover={false}>
          <h3 className="font-semibold text-white mb-4">Reward Distribution Flow</h3>
          <div className="flex items-center gap-8">
            <div className="h-[200px] w-[200px] flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={REWARD_FLOW} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value">
                    {REWARD_FLOW.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #334155', background: '#1e293b', fontSize: '13px', color: '#e2e8f0' }} formatter={(value: number) => [`${value}%`]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3 flex-1">
              {REWARD_FLOW.map((r) => (
                <div key={r.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: r.color }} />
                    <span className="text-sm text-slate-400">{r.name}</span>
                  </div>
                  <span className="text-sm font-semibold text-white tabular-nums">{r.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>

        {/* Total Stake Growth */}
        <GlassCard className="p-6" hover={false}>
          <h3 className="font-semibold text-white mb-1">Total Stake Growth</h3>
          <p className="text-xs text-slate-500 mb-4">Network-wide staked AETHEL over 90 days (in millions)</p>
          <div className="h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stakeGrowth}>
                <defs>
                  <linearGradient id="stakeGrowthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} interval={14} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={35} tickFormatter={(v) => `${v}M`} />
                <RechartsTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #334155', background: '#1e293b', fontSize: '13px', color: '#e2e8f0' }} formatter={(value: number) => [`${value}M AETHEL`, 'Total Staked']} />
                <Area type="monotone" dataKey="totalStake" stroke="#10B981" strokeWidth={2} fill="url(#stakeGrowthGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>
      </div>
    </section>
  );
}


// =============================================================================
// SECTION 9: PERFORMANCE ANALYTICS
// =============================================================================

function PerformanceAnalyticsSection() {
  const top10 = VALIDATORS.filter(v => v.status === 'active').slice(0, 10);

  const blockProductionData = top10.map(v => ({
    name: v.name.length > 12 ? v.name.slice(0, 10) + '..' : v.name,
    blocks: v.blocksProduced,
  })).sort((a, b) => b.blocks - a.blocks);

  const jobCompletionData = top10.map(v => ({
    name: v.name.length > 12 ? v.name.slice(0, 10) + '..' : v.name,
    rate: v.jobCompletionRate,
  })).sort((a, b) => b.rate - a.rate);

  const latencyData = Array.from({ length: 30 }, (_, i) => ({
    epoch: `E${217 + i}`,
    p50: seededInt(i * 41, 15, 25),
    p95: seededInt(i * 43, 35, 55),
    p99: seededInt(i * 47, 60, 90),
  }));

  const avgTeeRate = Number(
    (top10.reduce((s, v) => s + (v.teeAttestation ? 99.8 : 95.0), 0) / top10.length).toFixed(1)
  );

  return (
    <section className="mb-12">
      <SectionHeader
        title="Performance Analytics"
        subtitle="Block production, job completion, response latency, and TEE attestation metrics"
        size="sm"
      />

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Block Production Rate */}
        <GlassCard className="p-6" hover={false}>
          <h3 className="font-semibold text-white mb-1">Block Production Rate</h3>
          <p className="text-xs text-slate-500 mb-4">Total blocks produced, top 10 validators</p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={blockProductionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={45} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                <RechartsTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #334155', background: '#1e293b', fontSize: '13px', color: '#e2e8f0' }} formatter={(value: number) => [`${formatNumber(value)} blocks`, 'Produced']} />
                <Bar dataKey="blocks" fill={BRAND.red} radius={[6, 6, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        {/* Job Completion Rate */}
        <GlassCard className="p-6" hover={false}>
          <h3 className="font-semibold text-white mb-1">Job Completion Rate</h3>
          <p className="text-xs text-slate-500 mb-4">PoUW job success rate, top 10 validators</p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={jobCompletionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={40} domain={[95, 100]} tickFormatter={(v) => `${v}%`} />
                <RechartsTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #334155', background: '#1e293b', fontSize: '13px', color: '#e2e8f0' }} formatter={(value: number) => [`${value}%`, 'Success Rate']} />
                <Bar dataKey="rate" radius={[6, 6, 0, 0]} barSize={28}>
                  {jobCompletionData.map((entry, index) => (
                    <Cell key={index} fill={entry.rate >= 99 ? '#10B981' : entry.rate >= 98 ? '#3B82F6' : '#F59E0B'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        {/* Response Latency */}
        <GlassCard className="p-6" hover={false}>
          <h3 className="font-semibold text-white mb-1">Response Latency</h3>
          <p className="text-xs text-slate-500 mb-4">Network p50/p95/p99 latency over 30 epochs</p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={latencyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="epoch" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} interval={5} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={35} tickFormatter={(v) => `${v}ms`} />
                <RechartsTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #334155', background: '#1e293b', fontSize: '13px', color: '#e2e8f0' }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }} />
                <Line type="monotone" dataKey="p50" name="p50" stroke="#10B981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="p95" name="p95" stroke="#F59E0B" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="p99" name="p99" stroke="#EF4444" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        {/* TEE Attestation Success Gauge */}
        <GlassCard className="p-6" hover={false}>
          <h3 className="font-semibold text-white mb-1">TEE Attestation Success</h3>
          <p className="text-xs text-slate-500 mb-6">Network-wide hardware attestation verification rate</p>
          <div className="flex flex-col items-center justify-center">
            <div className="relative">
              <ProgressRing percentage={avgTeeRate} size={160} strokeWidth={10} color="#10B981" />
              <div className="absolute inset-0 flex items-center justify-center flex-col">
                <span className="text-3xl font-bold text-white tabular-nums">{avgTeeRate}%</span>
                <span className="text-xs text-slate-500">success rate</span>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-4 w-full">
              <div className="text-center">
                <p className="text-lg font-bold text-white tabular-nums">{VALIDATORS.filter(v => v.teeAttestation).length}</p>
                <p className="text-xs text-slate-500">Verified</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-white tabular-nums">{VALIDATORS.filter(v => !v.teeAttestation).length}</p>
                <p className="text-xs text-slate-500">Unverified</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-emerald-400 tabular-nums">100%</p>
                <p className="text-xs text-slate-500">TEE Required</p>
              </div>
            </div>
          </div>
        </GlassCard>
      </div>
    </section>
  );
}


// =============================================================================
// SECTION 10: SLASHING MONITOR
// =============================================================================

function SlashingMonitorSection() {
  return (
    <section className="mb-12">
      <SectionHeader
        title="Slashing Monitor"
        subtitle="Recent slashing events and network integrity timeline"
        size="sm"
      />

      <GlassCard className="p-6" hover={false}>
        <div className="space-y-4">
          {SLASHING_EVENTS.map((event, i) => (
            <div key={i} className="flex items-start gap-4 p-4 bg-red-500/5 rounded-xl border border-red-500/10">
              <div className="p-2 bg-red-500/10 rounded-lg text-red-400 mt-0.5 flex-shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-white">{event.validator}</h4>
                  <Badge variant="error">Epoch #{event.epoch}</Badge>
                </div>
                <p className="text-sm text-red-400 mt-1">{event.reason}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-slate-500">{event.date}</span>
                  <span className="text-sm font-semibold text-red-400 tabular-nums">-{formatNumber(event.amount)} AETHEL</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 p-3 bg-emerald-500/5 rounded-xl border border-emerald-500/10">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <p className="text-xs text-emerald-400">
              90% of validators have zero slashing events. Network maintains strong operational integrity.
            </p>
          </div>
        </div>
      </GlassCard>
    </section>
  );
}


// =============================================================================
// SECTION 11: BECOME A VALIDATOR CTA
// =============================================================================

function BecomeValidatorSection() {
  return (
    <section className="mb-12">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-red-950/60 border border-slate-700/30">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(220,38,38,0.2)_0%,_transparent_60%)]" />
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }} />

        <div className="relative px-8 py-12 lg:px-12 lg:py-16">
          <div className="grid lg:grid-cols-2 gap-10 items-center">
            {/* Left -- CTA */}
            <div>
              <Badge variant="brand">
                <Zap className="w-3 h-3 mr-1" />
                Join the Network
              </Badge>
              <h2 className="text-3xl lg:text-4xl font-bold text-white tracking-tight mt-4 mb-4">
                Become a Validator
              </h2>
              <p className="text-lg text-slate-400 leading-relaxed mb-8">
                Secure the Aethelred network while earning rewards through Proof-of-Useful-Work.
                Run verifiable AI computation inside hardware-attested enclaves.
              </p>

              {/* Requirements list */}
              <div className="space-y-4">
                {[
                  { icon: <Lock className="w-5 h-5" />, title: '100K AETHEL Minimum Stake', desc: 'Bond the required minimum to register as a validator candidate' },
                  { icon: <Cpu className="w-5 h-5" />, title: 'TEE Hardware Required', desc: 'Intel SGX/TDX or AMD SEV capable processors' },
                  { icon: <Activity className="w-5 h-5" />, title: '99.5% Uptime SLA', desc: 'Maintain consistent uptime or face slashing penalties' },
                ].map((req, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-red-500/10 text-red-400 flex-shrink-0">{req.icon}</div>
                    <div>
                      <p className="text-sm font-semibold text-white">{req.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{req.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right -- Hardware specs card */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6 lg:p-8">
              <h3 className="text-lg font-semibold text-white mb-6">Hardware Specifications</h3>
              <div className="space-y-5">
                {[
                  { icon: <Cpu className="w-5 h-5" />, label: 'CPU', value: '16+ cores, TEE-enabled', sub: 'Intel Xeon w/ SGX or AMD EPYC w/ SEV' },
                  { icon: <HardDrive className="w-5 h-5" />, label: 'Memory', value: '128 GB RAM minimum', sub: 'ECC recommended for production' },
                  { icon: <Server className="w-5 h-5" />, label: 'GPU', value: 'NVIDIA A100 / H100', sub: '40GB+ VRAM for AI workloads' },
                  { icon: <Globe className="w-5 h-5" />, label: 'Network', value: '1 Gbps symmetric', sub: 'Low-latency, < 50ms to peers' },
                ].map((spec, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-red-500/10 text-red-400 flex-shrink-0">{spec.icon}</div>
                    <div className="flex-1">
                      <span className="text-xs text-slate-500 uppercase tracking-wider">{spec.label}</span>
                      <p className="text-sm font-semibold text-white">{spec.value}</p>
                      <p className="text-xs text-slate-500">{spec.sub}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <button className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors">
                  Apply to Validate
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}


// =============================================================================
// MAIN PAGE
// =============================================================================

export default function ValidatorsPage() {
  const { addNotification } = useApp();

  // Validator detail drawer state
  const [selectedValidator, setSelectedValidator] = useState<ValidatorInfo | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Delegation modal state
  const [delegationValidator, setDelegationValidator] = useState<ValidatorInfo | null>(null);
  const [delegationOpen, setDelegationOpen] = useState(false);

  // Comparison state
  const [compareSelected, setCompareSelected] = useState<number[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const handleSelectValidator = useCallback((v: ValidatorInfo) => {
    setSelectedValidator(v);
    setDrawerOpen(true);
  }, []);

  const handleDelegate = useCallback((v: ValidatorInfo) => {
    setDelegationValidator(v);
    setDelegationOpen(true);
  }, []);

  const handleCopyAddress = useCallback((address: string) => {
    addNotification('info', 'Address Copied', `${address} copied to clipboard`);
  }, [addNotification]);

  // Open comparison when 2+ selected and button is clicked
  useEffect(() => {
    // Only open compare modal via explicit user action, not automatically
  }, []);

  return (
    <>
      <SEOHead
        title="Validators"
        description="Explore the Aethelred validator network. TEE-verified computation, geographic diversity, and hardware-attested security."
        path="/validators"
      />

      <div className="min-h-screen bg-[#050810]">
        <TopNav activePage="validators" />
        <HeroSection />

        <main className="max-w-[1400px] mx-auto px-6 py-10">
          {/* Top 3 Showcase */}
          <TopValidatorShowcase
            onSelectValidator={handleSelectValidator}
            onDelegate={handleDelegate}
          />

          {/* Compare button */}
          {compareSelected.length >= 2 && (
            <div className="mb-6 flex items-center gap-3 p-3 bg-red-500/5 border border-red-500/10 rounded-xl">
              <Info className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="text-sm text-slate-400 flex-1">
                {compareSelected.length} validators selected for comparison
              </span>
              <button
                onClick={() => setCompareOpen(true)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Compare Selected
              </button>
              <button
                onClick={() => setCompareSelected([])}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 text-sm rounded-lg transition-colors"
              >
                Clear
              </button>
            </div>
          )}

          {/* Validator Table */}
          <ValidatorTableSection
            onSelectValidator={handleSelectValidator}
            onDelegate={handleDelegate}
            compareSelected={compareSelected}
            setCompareSelected={setCompareSelected}
          />

          {/* Network Decentralization */}
          <DecentralizationSection />

          {/* Staking Economics */}
          <StakingEconomicsSection />

          {/* Performance Analytics */}
          <PerformanceAnalyticsSection />

          {/* Slashing Monitor */}
          <SlashingMonitorSection />

          {/* Become a Validator */}
          <BecomeValidatorSection />
        </main>

        <Footer />
      </div>

      {/* Validator Detail Drawer */}
      <ValidatorDetailDrawer
        validator={selectedValidator}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onDelegate={handleDelegate}
      />

      {/* Delegation Modal */}
      <DelegationModal
        validator={delegationValidator}
        isOpen={delegationOpen}
        onClose={() => setDelegationOpen(false)}
      />

      {/* Comparison Modal */}
      <ComparisonModal
        selectedRanks={compareSelected}
        isOpen={compareOpen}
        onClose={() => setCompareOpen(false)}
      />
    </>
  );
}
