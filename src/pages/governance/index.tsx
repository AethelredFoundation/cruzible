/**
 * Aethelred Governance Dashboard
 *
 * World-class decentralized protocol governance for the Aethelred sovereign L1.
 * Proposal lifecycle, treasury management, voting analytics, delegation, and more.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { SEOHead } from "@/components/SEOHead";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Users,
  Zap,
  ArrowUpRight,
  ChevronRight,
  ExternalLink,
  Clock,
  Activity,
  ShieldCheck,
  Eye,
  Search,
  Wallet,
  FileText,
  Vote,
  CheckCircle,
  AlertTriangle,
  Minus,
  Target,
  ThumbsUp,
  ThumbsDown,
  Scale,
  Landmark,
  PenTool,
  Timer,
  Gavel,
  BookOpen,
  CircleDollarSign,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  MessageSquare,
  TrendingUp,
  Award,
  Send,
  Plus,
  X,
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
import { seededRandom, formatNumber, formatFullNumber } from "@/lib/utils";
import { BRAND } from "@/lib/constants";
import {
  GlassCard,
  CopyButton,
  SectionHeader,
  ChartTooltip,
} from "@/components/PagePrimitives";

// =============================================================================
// CONSTANTS
// =============================================================================

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> =
  {
    Voting: {
      bg: "bg-amber-500/10 ring-amber-500/20",
      text: "text-amber-400",
      dot: "bg-amber-400",
    },
    Passed: {
      bg: "bg-emerald-500/10 ring-emerald-500/20",
      text: "text-emerald-400",
      dot: "bg-emerald-400",
    },
    Rejected: {
      bg: "bg-red-500/10 ring-red-500/20",
      text: "text-red-400",
      dot: "bg-red-400",
    },
    Executed: {
      bg: "bg-purple-500/10 ring-purple-500/20",
      text: "text-purple-400",
      dot: "bg-purple-400",
    },
  };

const CATEGORY_STYLES: Record<string, string> = {
  "Parameter Change": "bg-teal-500/10 text-teal-400 ring-teal-500/20",
  "Community Spend": "bg-amber-500/10 text-amber-400 ring-amber-500/20",
  "Text Proposal": "bg-blue-500/10 text-blue-400 ring-blue-500/20",
  "Software Upgrade": "bg-indigo-500/10 text-indigo-400 ring-indigo-500/20",
};

// =============================================================================
// TYPES
// =============================================================================

type ProposalStatus = "Voting" | "Passed" | "Rejected" | "Executed";
type ProposalCategory =
  | "Parameter Change"
  | "Community Spend"
  | "Text Proposal"
  | "Software Upgrade";
type VoteChoice = "For" | "Against" | "Abstain";

interface Proposal {
  aip: number;
  title: string;
  status: ProposalStatus;
  category: ProposalCategory;
  proposer: string;
  proposerAddress: string;
  description: string;
  fullDescription: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  quorumPct: number;
  startDate: string;
  endDate: string;
  daysRemaining?: number;
  deposit: number;
  turnout: number;
}

interface TreasuryDisbursement {
  recipient: string;
  amount: number;
  purpose: string;
  date: string;
  proposalLink: string;
}

interface DelegateInfo {
  rank: number;
  name: string;
  address: string;
  votingPower: number;
  delegators: number;
  participationRate: number;
  lastVote: string;
}

interface GovernanceEvent {
  id: string;
  type: "vote" | "proposal" | "quorum" | "execution" | "delegation";
  description: string;
  timeAgo: string;
  color: string;
}

interface DiscussionComment {
  address: string;
  text: string;
  time: string;
  upvotes: number;
}

interface TopVoter {
  address: string;
  power: number;
  choice: VoteChoice;
}

// =============================================================================
// MOCK DATA
// =============================================================================

const PROPOSALS: Proposal[] = [
  {
    aip: 47,
    title: "Increase Validator Set to 200",
    status: "Voting",
    category: "Parameter Change",
    proposer: "Aethelred Foundation",
    proposerAddress: "aeth1qz7xk...m4k9",
    description:
      "Expand the active validator set from 150 to 200 to further decentralize the network and improve censorship resistance.",
    fullDescription:
      "This proposal aims to expand the active validator set from 150 to 200 validators. The primary motivation is to further decentralize block production and improve the network's censorship resistance properties.\n\nBy increasing the validator set, we reduce the minimum coalition size required to censor transactions from 51 validators to 68 validators (at 33.4% threshold). This makes Aethelred one of the most decentralized Proof-of-Useful-Work networks in production.\n\nThe implementation requires adjustments to the delegation curve and minimum stake requirements. Specifically, the minimum self-delegation will be increased from 75,000 AETHEL to 100,000 AETHEL to accommodate the expanded set without concentrating stake among fewer large validators.",
    votesFor: 8_420_000,
    votesAgainst: 2_770_000,
    votesAbstain: 1_340_000,
    quorumPct: 82,
    startDate: "Mar 4, 2026",
    endDate: "Mar 18, 2026",
    daysRemaining: 3,
    deposit: 1000,
    turnout: 68.4,
  },
  {
    aip: 46,
    title: "TEE Attestation Frequency Reduction",
    status: "Voting",
    category: "Software Upgrade",
    proposer: "Quantum Validators",
    proposerAddress: "aeth1rv3k...p2j7",
    description:
      "Reduce TEE attestation frequency from every block to every 10th block for non-critical workloads, reducing validator overhead by ~40%.",
    fullDescription:
      "This proposal suggests reducing the TEE attestation frequency from every block to every 10th block for non-critical AI inference workloads. Critical workloads (financial, medical, legal) would continue to require per-block attestation.\n\nCurrent measurements show that TEE attestation accounts for approximately 40% of validator computational overhead. By batching attestations for non-critical workloads, we can significantly reduce operating costs while maintaining security guarantees where they matter most.\n\nThe implementation introduces a workload classification system with three tiers: Critical (per-block attestation), Standard (every 5th block), and Batch (every 10th block). Validators would be required to support all three tiers.",
    votesFor: 6_180_000,
    votesAgainst: 4_390_000,
    votesAbstain: 710_000,
    quorumPct: 71,
    startDate: "Mar 2, 2026",
    endDate: "Mar 16, 2026",
    daysRemaining: 5,
    deposit: 1000,
    turnout: 61.2,
  },
  {
    aip: 45,
    title: "Community Grant Program Season 3",
    status: "Voting",
    category: "Community Spend",
    proposer: "Sovereign Stake",
    proposerAddress: "aeth1hd8m...x9n2",
    description:
      "Allocate 500,000 AETHEL from the community treasury for Season 3 of the developer grant program over 6 months.",
    fullDescription:
      "This proposal requests the allocation of 500,000 AETHEL from the community treasury for Season 3 of the Aethelred Developer Grant Program. The program has been instrumental in growing the ecosystem, with Season 1 and 2 funding 47 projects across infrastructure tooling, SDK development, and educational content.\n\nSeason 3 will focus on four key areas: (1) AI model verification tooling - 150,000 AETHEL, (2) Cross-chain bridge integrations - 120,000 AETHEL, (3) Developer education and onboarding - 100,000 AETHEL, (4) Ecosystem DApp development - 130,000 AETHEL.\n\nA grants committee of 5 elected community members will oversee fund distribution, with monthly transparency reports published on-chain. Each grant recipient must deliver quarterly milestones to continue receiving funding.",
    votesFor: 9_140_000,
    votesAgainst: 1_390_000,
    votesAbstain: 710_000,
    quorumPct: 63,
    startDate: "Feb 28, 2026",
    endDate: "Mar 14, 2026",
    daysRemaining: 7,
    deposit: 1000,
    turnout: 58.7,
  },
  {
    aip: 44,
    title: "Increase Minimum Stake to 100K AETHEL",
    status: "Passed",
    category: "Parameter Change",
    proposer: "CryptoSentinel",
    proposerAddress: "aeth1mn7c...f4v1",
    description:
      "Increase the minimum validator self-delegation from 75,000 to 100,000 AETHEL to strengthen validator commitments.",
    fullDescription: "",
    votesFor: 9_840_000,
    votesAgainst: 1_560_000,
    votesAbstain: 720_000,
    quorumPct: 84,
    startDate: "Feb 10, 2026",
    endDate: "Feb 24, 2026",
    deposit: 1000,
    turnout: 72.1,
  },
  {
    aip: 43,
    title: "Cross-Chain Bridge Security Audit Fund",
    status: "Passed",
    category: "Community Spend",
    proposer: "TEE Guard",
    proposerAddress: "aeth1j5nt...k3w8",
    description:
      "Allocate 750,000 AETHEL for comprehensive security audits of the Aethelred bridge contracts by Trail of Bits and Zellic.",
    fullDescription: "",
    votesFor: 11_200_000,
    votesAgainst: 820_000,
    votesAbstain: 450_000,
    quorumPct: 91,
    startDate: "Feb 1, 2026",
    endDate: "Feb 15, 2026",
    deposit: 1000,
    turnout: 78.4,
  },
  {
    aip: 42,
    title: "AI Job Verification Parameter Update",
    status: "Executed",
    category: "Parameter Change",
    proposer: "Aethelred Foundation",
    proposerAddress: "aeth1qz7xk...m4k9",
    description:
      "Update verification parameters for AI job submissions to improve throughput while maintaining security guarantees.",
    fullDescription: "",
    votesFor: 10_500_000,
    votesAgainst: 600_000,
    votesAbstain: 320_000,
    quorumPct: 87,
    startDate: "Jan 20, 2026",
    endDate: "Feb 3, 2026",
    deposit: 1000,
    turnout: 74.8,
  },
  {
    aip: 41,
    title: "Treasury Diversification Strategy",
    status: "Passed",
    category: "Community Spend",
    proposer: "Nakamoto Labs",
    proposerAddress: "aeth1bx2r...g8h5",
    description:
      "Convert 2M AETHEL from the treasury into a diversified stablecoin basket to provide operational runway.",
    fullDescription: "",
    votesFor: 7_200_000,
    votesAgainst: 4_100_000,
    votesAbstain: 1_800_000,
    quorumPct: 76,
    startDate: "Jan 12, 2026",
    endDate: "Jan 26, 2026",
    deposit: 1000,
    turnout: 69.3,
  },
  {
    aip: 40,
    title: "Slash Penalty Adjustment",
    status: "Rejected",
    category: "Parameter Change",
    proposer: "ChainFlow",
    proposerAddress: "aeth1yt4p...d6s3",
    description:
      "Reduce double-sign slash penalty from 5% to 3% and increase downtime tolerance window from 500 to 1000 blocks.",
    fullDescription: "",
    votesFor: 3_800_000,
    votesAgainst: 7_600_000,
    votesAbstain: 2_100_000,
    quorumPct: 79,
    startDate: "Jan 5, 2026",
    endDate: "Jan 19, 2026",
    deposit: 1000,
    turnout: 71.2,
  },
  {
    aip: 39,
    title: "Developer Incentive Program",
    status: "Executed",
    category: "Community Spend",
    proposer: "VerifiNode",
    proposerAddress: "aeth1kw9e...a1z6",
    description:
      "Launch a 12-month developer incentive program with bounties, hackathons, and retroactive public goods funding.",
    fullDescription: "",
    votesFor: 10_100_000,
    votesAgainst: 900_000,
    votesAbstain: 520_000,
    quorumPct: 83,
    startDate: "Dec 22, 2025",
    endDate: "Jan 5, 2026",
    deposit: 1000,
    turnout: 73.6,
  },
  {
    aip: 38,
    title: "Network Upgrade v2.1 Proposal",
    status: "Executed",
    category: "Software Upgrade",
    proposer: "Aethelred Foundation",
    proposerAddress: "aeth1qz7xk...m4k9",
    description:
      "Coordinated network upgrade to v2.1 introducing parallel transaction processing and improved state sync.",
    fullDescription: "",
    votesFor: 12_400_000,
    votesAgainst: 310_000,
    votesAbstain: 190_000,
    quorumPct: 94,
    startDate: "Dec 10, 2025",
    endDate: "Dec 24, 2025",
    deposit: 1000,
    turnout: 82.1,
  },
  {
    aip: 37,
    title: "Governance Quorum Reduction",
    status: "Rejected",
    category: "Parameter Change",
    proposer: "Digital Forge",
    proposerAddress: "aeth1fg3v...b7m4",
    description:
      "Reduce governance quorum from 33.4% to 25% to make it easier for proposals to reach the participation threshold.",
    fullDescription: "",
    votesFor: 4_600_000,
    votesAgainst: 6_800_000,
    votesAbstain: 1_900_000,
    quorumPct: 77,
    startDate: "Dec 1, 2025",
    endDate: "Dec 15, 2025",
    deposit: 1000,
    turnout: 70.4,
  },
  {
    aip: 36,
    title: "MEV Protection Enhancement",
    status: "Passed",
    category: "Software Upgrade",
    proposer: "Proof Protocol",
    proposerAddress: "aeth1zq8d...c2n9",
    description:
      "Implement threshold encryption for transaction ordering to eliminate front-running and sandwich attacks.",
    fullDescription: "",
    votesFor: 10_800_000,
    votesAgainst: 1_100_000,
    votesAbstain: 600_000,
    quorumPct: 88,
    startDate: "Nov 20, 2025",
    endDate: "Dec 4, 2025",
    deposit: 1000,
    turnout: 76.3,
  },
  {
    aip: 35,
    title: "Staking Reward Curve Adjustment",
    status: "Passed",
    category: "Parameter Change",
    proposer: "CryptoSentinel",
    proposerAddress: "aeth1mn7c...f4v1",
    description:
      "Modify the staking reward curve to increase base APY from 6.2% to 6.85% with a performance multiplier.",
    fullDescription: "",
    votesFor: 9_200_000,
    votesAgainst: 2_400_000,
    votesAbstain: 800_000,
    quorumPct: 81,
    startDate: "Nov 10, 2025",
    endDate: "Nov 24, 2025",
    deposit: 1000,
    turnout: 71.8,
  },
  {
    aip: 34,
    title: "Bug Bounty Program Expansion",
    status: "Executed",
    category: "Community Spend",
    proposer: "TEE Guard",
    proposerAddress: "aeth1j5nt...k3w8",
    description:
      "Expand the bug bounty program with increased payouts up to 500K AETHEL for critical vulnerabilities.",
    fullDescription: "",
    votesFor: 11_600_000,
    votesAgainst: 400_000,
    votesAbstain: 280_000,
    quorumPct: 90,
    startDate: "Nov 1, 2025",
    endDate: "Nov 15, 2025",
    deposit: 1000,
    turnout: 79.2,
  },
  {
    aip: 33,
    title: "Protocol Fee Structure Update",
    status: "Passed",
    category: "Parameter Change",
    proposer: "Nakamoto Labs",
    proposerAddress: "aeth1bx2r...g8h5",
    description:
      "Restructure protocol fees to allocate 70% to stakers, 20% to treasury, and 10% to validators.",
    fullDescription: "",
    votesFor: 8_700_000,
    votesAgainst: 3_200_000,
    votesAbstain: 1_100_000,
    quorumPct: 78,
    startDate: "Oct 20, 2025",
    endDate: "Nov 3, 2025",
    deposit: 1000,
    turnout: 68.9,
  },
];

const TREASURY_DISBURSEMENTS: TreasuryDisbursement[] = [
  {
    recipient: "Trail of Bits",
    amount: 450_000,
    purpose: "Bridge Security Audit Phase 1",
    date: "Feb 18, 2026",
    proposalLink: "AIP-043",
  },
  {
    recipient: "Zellic",
    amount: 300_000,
    purpose: "Bridge Security Audit Phase 2",
    date: "Feb 18, 2026",
    proposalLink: "AIP-043",
  },
  {
    recipient: "DevRel Team",
    amount: 150_000,
    purpose: "Developer Incentive Q1 Payout",
    date: "Jan 15, 2026",
    proposalLink: "AIP-039",
  },
  {
    recipient: "Ecosystem Fund",
    amount: 500_000,
    purpose: "Grant Program Season 2 Final",
    date: "Dec 20, 2025",
    proposalLink: "AIP-034",
  },
  {
    recipient: "Immunefi",
    amount: 100_000,
    purpose: "Bug Bounty Platform Fee",
    date: "Nov 22, 2025",
    proposalLink: "AIP-034",
  },
];

const DELEGATES: DelegateInfo[] = [
  {
    rank: 1,
    name: "Aethelred Foundation",
    address: "aeth1qz7x...m4k9",
    votingPower: 18_400_000,
    delegators: 342,
    participationRate: 100,
    lastVote: "AIP-047",
  },
  {
    rank: 2,
    name: "Quantum Validators",
    address: "aeth1rv3k...p2j7",
    votingPower: 14_200_000,
    delegators: 218,
    participationRate: 97.9,
    lastVote: "AIP-047",
  },
  {
    rank: 3,
    name: "Sovereign Stake",
    address: "aeth1hd8m...x9n2",
    votingPower: 12_800_000,
    delegators: 185,
    participationRate: 95.7,
    lastVote: "AIP-045",
  },
  {
    rank: 4,
    name: "TEE Guard",
    address: "aeth1j5nt...k3w8",
    votingPower: 11_500_000,
    delegators: 156,
    participationRate: 93.6,
    lastVote: "AIP-046",
  },
  {
    rank: 5,
    name: "CryptoSentinel",
    address: "aeth1mn7c...f4v1",
    votingPower: 10_200_000,
    delegators: 134,
    participationRate: 91.5,
    lastVote: "AIP-046",
  },
  {
    rank: 6,
    name: "Nakamoto Labs",
    address: "aeth1bx2r...g8h5",
    votingPower: 9_100_000,
    delegators: 112,
    participationRate: 89.4,
    lastVote: "AIP-047",
  },
  {
    rank: 7,
    name: "ChainFlow",
    address: "aeth1yt4p...d6s3",
    votingPower: 8_400_000,
    delegators: 98,
    participationRate: 87.2,
    lastVote: "AIP-045",
  },
  {
    rank: 8,
    name: "VerifiNode",
    address: "aeth1kw9e...a1z6",
    votingPower: 7_800_000,
    delegators: 87,
    participationRate: 85.1,
    lastVote: "AIP-046",
  },
  {
    rank: 9,
    name: "Digital Forge",
    address: "aeth1fg3v...b7m4",
    votingPower: 6_900_000,
    delegators: 72,
    participationRate: 83.0,
    lastVote: "AIP-047",
  },
  {
    rank: 10,
    name: "Proof Protocol",
    address: "aeth1zq8d...c2n9",
    votingPower: 5_600_000,
    delegators: 54,
    participationRate: 80.9,
    lastVote: "AIP-045",
  },
];

const ACTIVITY_FEED: GovernanceEvent[] = [
  {
    id: "1",
    type: "vote",
    description: "aeth1x7k... voted FOR on AIP-047 with 125,000 AETHEL",
    timeAgo: "3 min ago",
    color: "text-emerald-400",
  },
  {
    id: "2",
    type: "quorum",
    description: "AIP-047 reached 82% quorum",
    timeAgo: "12 min ago",
    color: "text-amber-400",
  },
  {
    id: "3",
    type: "vote",
    description: "aeth1rv3k... voted AGAINST on AIP-046 with 320,000 AETHEL",
    timeAgo: "28 min ago",
    color: "text-red-400",
  },
  {
    id: "4",
    type: "delegation",
    description: "aeth1hd8m... delegated 50,000 AETHEL to Sovereign Stake",
    timeAgo: "45 min ago",
    color: "text-blue-400",
  },
  {
    id: "5",
    type: "vote",
    description: "aeth1j5nt... voted FOR on AIP-045 with 210,000 AETHEL",
    timeAgo: "1h ago",
    color: "text-emerald-400",
  },
  {
    id: "6",
    type: "proposal",
    description: "New proposal AIP-047 submitted by Aethelred Foundation",
    timeAgo: "2h ago",
    color: "text-purple-400",
  },
  {
    id: "7",
    type: "execution",
    description:
      "AIP-042 executed on-chain: AI verification parameters updated",
    timeAgo: "4h ago",
    color: "text-cyan-400",
  },
  {
    id: "8",
    type: "vote",
    description: "aeth1mn7c... voted FOR on AIP-047 with 180,000 AETHEL",
    timeAgo: "5h ago",
    color: "text-emerald-400",
  },
  {
    id: "9",
    type: "vote",
    description: "aeth1bx2r... voted ABSTAIN on AIP-046 with 95,000 AETHEL",
    timeAgo: "6h ago",
    color: "text-slate-400",
  },
  {
    id: "10",
    type: "quorum",
    description: "AIP-046 reached 71% quorum",
    timeAgo: "8h ago",
    color: "text-amber-400",
  },
];

const TREASURY_ALLOCATION = [
  { name: "Development", value: 35, color: "#DC2626" },
  { name: "Community Grants", value: 25, color: "#F87171" },
  { name: "Security", value: 20, color: "#EF4444" },
  { name: "Marketing", value: 10, color: "#FCA5A5" },
  { name: "Reserve", value: 10, color: "#FECACA" },
];

const MONTHLY_SPENDING = [
  { month: "Sep", amount: 420_000 },
  { month: "Oct", amount: 680_000 },
  { month: "Nov", amount: 750_000 },
  { month: "Dec", amount: 1_050_000 },
  { month: "Jan", amount: 560_000 },
  { month: "Feb", amount: 890_000 },
  { month: "Mar", amount: 320_000 },
];

function generateParticipationTrend() {
  const data = [];
  for (let i = 0; i < 20; i++) {
    data.push({
      proposal: `AIP-${String(28 + i).padStart(3, "0")}`,
      participation: Math.round(52 + seededRandom(i * 7) * 38),
    });
  }
  return data;
}

function generateTurnoutByType() {
  return [
    { type: "Param Change", turnout: 71, proposals: 6 },
    { type: "Comm. Spend", turnout: 68, proposals: 5 },
    { type: "SW Upgrade", turnout: 78, proposals: 3 },
    { type: "Text", turnout: 54, proposals: 1 },
  ];
}

function generateVoteDistHistory() {
  const data = [];
  for (let i = 0; i < 15; i++) {
    const f = 55 + seededRandom(i * 3) * 30;
    const a = 10 + seededRandom(i * 5) * 25;
    const ab = 100 - f - a;
    data.push({
      proposal: `AIP-${String(33 + i).padStart(3, "0")}`,
      For: Math.round(f),
      Against: Math.round(a),
      Abstain: Math.max(0, Math.round(ab)),
    });
  }
  return data;
}

function generateVotingTimeline() {
  const data = [];
  for (let i = 0; i <= 14; i++) {
    data.push({
      day: `Day ${i}`,
      cumulative: Math.round(seededRandom(i * 11) * 2_000_000 + i * 800_000),
    });
  }
  return data;
}

const PARTICIPATION_TREND = generateParticipationTrend();
const TURNOUT_BY_TYPE = generateTurnoutByType();
const VOTE_DIST_HISTORY = generateVoteDistHistory();
const VOTING_TIMELINE = generateVotingTimeline();

const OUTCOME_DONUT = [
  { name: "Passed", value: 31, color: "#10B981" },
  { name: "Rejected", value: 8, color: "#EF4444" },
  { name: "Executed", value: 5, color: "#8B5CF6" },
  { name: "Active", value: 3, color: "#F59E0B" },
];

// =============================================================================
// LOCAL SUB-COMPONENTS
// =============================================================================

function StatusBadge({ status }: { status: ProposalStatus }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.Voting;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset ${s.bg} ${s.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

function CategoryBadge({ category }: { category: ProposalCategory }) {
  const style =
    CATEGORY_STYLES[category] ||
    "bg-slate-500/10 text-slate-400 ring-slate-500/20";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${style}`}
    >
      {category}
    </span>
  );
}

// =============================================================================
// HERO SECTION
// =============================================================================

function HeroSection() {
  const stats = [
    {
      label: "Total Proposals",
      value: 47,
      suffix: "",
      decimals: 0,
      sub: "AIPs submitted",
    },
    {
      label: "Active Proposals",
      value: 3,
      suffix: "",
      decimals: 0,
      sub: "Currently in voting",
    },
    {
      label: "Voter Participation",
      value: 72.4,
      suffix: "%",
      decimals: 1,
      sub: "+3.1% vs last epoch",
    },
    {
      label: "Treasury Balance",
      value: 12.5,
      suffix: "M AETHEL",
      decimals: 1,
      sub: "$30.9M USD",
    },
  ];

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-red-950/40" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(220,38,38,0.15)_0%,_transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_rgba(220,38,38,0.08)_0%,_transparent_50%)]" />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      <div className="relative max-w-[1400px] mx-auto px-6 py-12 lg:py-16">
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <Badge variant="brand">On-Chain Governance</Badge>
            <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 rounded-full ring-1 ring-inset ring-emerald-500/20">
              <LiveDot color="green" size="sm" />
              <span className="text-xs font-medium text-emerald-400">Live</span>
            </div>
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold text-white tracking-tight mb-2">
            Governance
            <span className="text-red-500 ml-3 text-lg lg:text-xl font-semibold align-middle tracking-widest">
              AETHELRED
            </span>
          </h1>
          <p className="text-lg text-slate-400 leading-relaxed max-w-2xl mt-4">
            Shape the future of Aethelred through decentralized protocol
            governance. Submit proposals, vote on critical upgrades, and manage
            the community treasury with full on-chain transparency.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-5"
            >
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">
                {stat.label}
              </p>
              <p className="text-2xl lg:text-3xl font-bold text-white tabular-nums">
                <AnimatedNumber
                  value={stat.value}
                  suffix={stat.suffix}
                  decimals={stat.decimals}
                />
              </p>
              <p className="text-xs text-slate-500 mt-1">{stat.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// YOUR GOVERNANCE POWER CARD
// =============================================================================

function GovernancePowerCard({
  onDelegateClick,
}: {
  onDelegateClick: () => void;
}) {
  const { wallet, connectWallet } = useApp();

  if (!wallet.connected) {
    return (
      <section className="mb-12">
        <GlassCard className="p-8 text-center">
          <Wallet className="w-10 h-10 text-slate-500 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-white mb-2">
            Connect Wallet to Participate
          </h3>
          <p className="text-sm text-slate-400 mb-5 max-w-md mx-auto">
            Connect your wallet to view your voting power, delegate to
            representatives, and vote on active proposals.
          </p>
          <button
            onClick={connectWallet}
            className="inline-flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium text-sm transition-colors shadow-lg shadow-red-900/30"
          >
            <Wallet className="w-4 h-4" />
            Connect Wallet
          </button>
        </GlassCard>
      </section>
    );
  }

  const votingPower = wallet.stBalance;
  const totalVotingPower = 120_000_000;
  const powerPct = ((votingPower / totalVotingPower) * 100).toFixed(4);

  return (
    <section className="mb-12">
      <SectionHeader
        title="Your Governance Power"
        subtitle="Voting power and delegation status"
        size="sm"
      />
      <GlassCard className="p-6">
        <div className="grid md:grid-cols-4 gap-6">
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
            <p className="text-xs text-red-400 uppercase tracking-wider mb-1">
              Voting Power
            </p>
            <p className="text-2xl font-bold text-white tabular-nums">
              {formatFullNumber(votingPower)}
            </p>
            <p className="text-xs text-red-400/70 mt-0.5">
              stAETHEL ({powerPct}% of total)
            </p>
          </div>
          <div className="p-4 rounded-xl bg-slate-700/30 border border-slate-600/30">
            <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">
              Delegation Status
            </p>
            <p className="text-lg font-semibold text-white">Self-delegated</p>
            <p className="text-xs text-slate-500 mt-0.5">
              You vote with your own power
            </p>
          </div>
          <div className="p-4 rounded-xl bg-slate-700/30 border border-slate-600/30">
            <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">
              Proposals Voted
            </p>
            <p className="text-lg font-semibold text-white">23 / 47</p>
            <p className="text-xs text-slate-500 mt-0.5">
              48.9% participation rate
            </p>
          </div>
          <div className="flex items-center justify-center">
            <button
              onClick={onDelegateClick}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-medium text-sm transition-colors border border-slate-600"
            >
              <Users className="w-4 h-4" />
              Delegate Power
            </button>
          </div>
        </div>
      </GlassCard>
    </section>
  );
}

// =============================================================================
// ACTIVE PROPOSALS (FEATURED)
// =============================================================================

function ActiveProposalCard({
  proposal,
  userVote,
  onVote,
  onCardClick,
}: {
  proposal: Proposal;
  userVote: VoteChoice | null;
  onVote: (aip: number, choice: VoteChoice) => void;
  onCardClick: (proposal: Proposal) => void;
}) {
  const totalVotes =
    proposal.votesFor + proposal.votesAgainst + proposal.votesAbstain;
  const forPct = totalVotes > 0 ? (proposal.votesFor / totalVotes) * 100 : 0;
  const againstPct =
    totalVotes > 0 ? (proposal.votesAgainst / totalVotes) * 100 : 0;
  const abstainPct =
    totalVotes > 0 ? (proposal.votesAbstain / totalVotes) * 100 : 0;

  return (
    <GlassCard className="p-6 lg:p-8">
      <div className="cursor-pointer" onClick={() => onCardClick(proposal)}>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono text-slate-500">
              AIP-{String(proposal.aip).padStart(3, "0")}
            </span>
            <StatusBadge status={proposal.status} />
            <CategoryBadge category={proposal.category} />
          </div>
          {proposal.daysRemaining !== undefined && (
            <div className="flex items-center gap-1.5 text-sm text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full ring-1 ring-inset ring-amber-500/20">
              <Timer className="w-3.5 h-3.5" />
              <span className="font-medium">
                {proposal.daysRemaining} days remaining
              </span>
            </div>
          )}
        </div>

        <h3 className="text-xl font-semibold text-white mb-2 hover:text-red-400 transition-colors">
          {proposal.title}
        </h3>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm text-slate-500">Proposed by</span>
          <span className="text-sm font-medium text-slate-300">
            {proposal.proposer}
          </span>
        </div>
        <p className="text-sm text-slate-400 leading-relaxed mb-6">
          {proposal.description}
        </p>

        {/* Voting Progress Bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>Voting Results</span>
            <span>{formatFullNumber(totalVotes)} votes cast</span>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-slate-700">
            <div
              className="bg-emerald-500 transition-all duration-500"
              style={{ width: `${forPct}%` }}
            />
            <div
              className="bg-red-500 transition-all duration-500"
              style={{ width: `${againstPct}%` }}
            />
            <div
              className="bg-slate-500 transition-all duration-500"
              style={{ width: `${abstainPct}%` }}
            />
          </div>
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span className="text-xs text-slate-400">
                For {forPct.toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <span className="text-xs text-slate-400">
                Against {againstPct.toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-slate-500" />
              <span className="text-xs text-slate-400">
                Abstain {abstainPct.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* Quorum */}
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
            <span>Quorum Progress</span>
            <span>{proposal.quorumPct}% / 33.4% required</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-slate-700 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${proposal.quorumPct >= 33.4 ? "bg-emerald-500" : "bg-amber-500"}`}
                style={{ width: `${Math.min(proposal.quorumPct, 100)}%` }}
              />
            </div>
            <ProgressRing
              percentage={proposal.quorumPct}
              size={36}
              strokeWidth={3}
              color={proposal.quorumPct >= 33.4 ? "#10B981" : "#F59E0B"}
            />
          </div>
        </div>
      </div>

      {/* User vote status / Vote Buttons */}
      {userVote ? (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span className="text-sm text-emerald-400 font-medium">
            You voted: {userVote}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onVote(proposal.aip, "For");
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
          >
            <ThumbsUp className="w-4 h-4" /> FOR
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onVote(proposal.aip, "Against");
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
          >
            <ThumbsDown className="w-4 h-4" /> AGAINST
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onVote(proposal.aip, "Abstain");
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-slate-600 hover:bg-slate-500 text-white transition-colors"
          >
            <Minus className="w-4 h-4" /> ABSTAIN
          </button>
        </div>
      )}
    </GlassCard>
  );
}

// =============================================================================
// PROPOSAL DETAIL MODAL
// =============================================================================

function ProposalDetailModal({
  proposal,
  isOpen,
  onClose,
  userVote,
  onVote,
}: {
  proposal: Proposal | null;
  isOpen: boolean;
  onClose: () => void;
  userVote: VoteChoice | null;
  onVote: (aip: number, choice: VoteChoice) => void;
}) {
  if (!proposal) return null;

  const totalVotes =
    proposal.votesFor + proposal.votesAgainst + proposal.votesAbstain;
  const forPct = totalVotes > 0 ? (proposal.votesFor / totalVotes) * 100 : 0;
  const againstPct =
    totalVotes > 0 ? (proposal.votesAgainst / totalVotes) * 100 : 0;
  const abstainPct =
    totalVotes > 0 ? (proposal.votesAbstain / totalVotes) * 100 : 0;

  const topVoters: TopVoter[] = [
    { address: "aeth1qz7x...m4k9", power: 2_400_000, choice: "For" },
    { address: "aeth1rv3k...p2j7", power: 1_800_000, choice: "For" },
    { address: "aeth1hd8m...x9n2", power: 1_200_000, choice: "Against" },
    { address: "aeth1j5nt...k3w8", power: 950_000, choice: "For" },
    { address: "aeth1mn7c...f4v1", power: 720_000, choice: "Abstain" },
  ];

  const comments: DiscussionComment[] = [
    {
      address: "aeth1rv3k...p2j7",
      text: "Strong support for this proposal. Increasing the validator set is critical for long-term network security and decentralization.",
      time: "2 days ago",
      upvotes: 24,
    },
    {
      address: "aeth1hd8m...x9n2",
      text: "I have concerns about the impact on block finality time. Has anyone benchmarked this with 200 validators?",
      time: "1 day ago",
      upvotes: 18,
    },
    {
      address: "aeth1j5nt...k3w8",
      text: "We ran tests on devnet with 250 validators. Block time increased by only 120ms on average, well within acceptable parameters.",
      time: "18 hours ago",
      upvotes: 31,
    },
    {
      address: "aeth1mn7c...f4v1",
      text: "The reduced minimum stake is a great addition. This will significantly lower the barrier to entry for new validators.",
      time: "6 hours ago",
      upvotes: 12,
    },
  ];

  const pieData = [
    { name: "For", value: proposal.votesFor, color: "#10B981" },
    { name: "Against", value: proposal.votesAgainst, color: "#EF4444" },
    { name: "Abstain", value: proposal.votesAbstain, color: "#64748B" },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`AIP-${String(proposal.aip).padStart(3, "0")}: ${proposal.title}`}
      size="xl"
    >
      <div className="space-y-6">
        {/* Header info */}
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={proposal.status} />
          <CategoryBadge category={proposal.category} />
          <span className="text-xs text-slate-500">
            Created {proposal.startDate}
          </span>
          <span className="text-xs text-slate-500">
            Voting ends {proposal.endDate}
          </span>
          {proposal.daysRemaining !== undefined && (
            <span className="text-xs text-amber-400 font-medium">
              {proposal.daysRemaining} days remaining
            </span>
          )}
        </div>

        {/* Proposer */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Proposer:</span>
          <span className="text-white font-medium">{proposal.proposer}</span>
          <span className="text-slate-500 font-mono text-xs">
            ({proposal.proposerAddress})
          </span>
          <CopyButton text={proposal.proposerAddress} />
        </div>

        {/* Description */}
        <div>
          <h4 className="text-sm font-semibold text-white mb-2">Description</h4>
          <div className="text-sm text-slate-400 leading-relaxed whitespace-pre-line">
            {proposal.fullDescription || proposal.description}
          </div>
        </div>

        {/* Voting Stats */}
        <div>
          <h4 className="text-sm font-semibold text-white mb-3">
            Voting Statistics
          </h4>
          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <p className="text-xs text-emerald-400 mb-1">For</p>
              <p className="text-lg font-bold text-emerald-400">
                {forPct.toFixed(1)}%
              </p>
              <p className="text-xs text-emerald-400/60">
                {formatFullNumber(proposal.votesFor)} AETHEL
              </p>
            </div>
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <p className="text-xs text-red-400 mb-1">Against</p>
              <p className="text-lg font-bold text-red-400">
                {againstPct.toFixed(1)}%
              </p>
              <p className="text-xs text-red-400/60">
                {formatFullNumber(proposal.votesAgainst)} AETHEL
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-700/50 border border-slate-600/30">
              <p className="text-xs text-slate-400 mb-1">Abstain</p>
              <p className="text-lg font-bold text-slate-300">
                {abstainPct.toFixed(1)}%
              </p>
              <p className="text-xs text-slate-500">
                {formatFullNumber(proposal.votesAbstain)} AETHEL
              </p>
            </div>
          </div>

          {/* Quorum */}
          <div className="p-3 rounded-xl bg-slate-700/30 border border-slate-600/30 mb-4">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
              <span>Quorum: {proposal.quorumPct}% reached</span>
              <span>33.4% required to pass</span>
            </div>
            <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
              <div
                className={`h-full rounded-full ${proposal.quorumPct >= 33.4 ? "bg-emerald-500" : "bg-amber-500"}`}
                style={{ width: `${Math.min(proposal.quorumPct, 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Charts row */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Pie chart */}
          <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50">
            <h5 className="text-xs font-semibold text-white mb-3">
              Vote Distribution
            </h5>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={60}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Voting timeline */}
          <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50">
            <h5 className="text-xs font-semibold text-white mb-3">
              Voting Timeline
            </h5>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={VOTING_TIMELINE}
                  margin={{ top: 5, right: 10, left: -15, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 9, fill: "#64748b" }}
                    interval={2}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: "#64748b" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => formatNumber(v)}
                  />
                  <RechartsTooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="cumulative"
                    stroke={BRAND.red}
                    strokeWidth={2}
                    dot={false}
                    name="Cumulative Votes"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Top Voters */}
        <div>
          <h4 className="text-sm font-semibold text-white mb-3">Top Voters</h4>
          <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-2">
                    Address
                  </th>
                  <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-2">
                    Power
                  </th>
                  <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-2">
                    Vote
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {topVoters.map((v, i) => (
                  <tr key={i} className="hover:bg-slate-700/20">
                    <td className="px-4 py-2 text-sm text-slate-300 font-mono">
                      {v.address}
                    </td>
                    <td className="px-4 py-2 text-sm text-right text-slate-300">
                      {formatNumber(v.power)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          v.choice === "For"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : v.choice === "Against"
                              ? "bg-red-500/10 text-red-400"
                              : "bg-slate-600/30 text-slate-400"
                        }`}
                      >
                        {v.choice}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Discussion */}
        <div>
          <h4 className="text-sm font-semibold text-white mb-3">Discussion</h4>
          <div className="space-y-3">
            {comments.map((c, i) => (
              <div
                key={i}
                className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/50"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-slate-400">
                    {c.address}
                  </span>
                  <span className="text-xs text-slate-500">{c.time}</span>
                </div>
                <p className="text-sm text-slate-300 leading-relaxed mb-2">
                  {c.text}
                </p>
                <div className="flex items-center gap-1 text-xs text-slate-500">
                  <ThumbsUp className="w-3 h-3" />
                  <span>{c.upvotes}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Your Vote / Proposal Params */}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <h4 className="text-sm font-semibold text-white mb-3">Your Vote</h4>
            {userVote ? (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span className="text-sm text-emerald-400 font-medium">
                  You voted: {userVote}
                </span>
              </div>
            ) : proposal.status === "Voting" ? (
              <div className="flex gap-2">
                <button
                  onClick={() => onVote(proposal.aip, "For")}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                >
                  <ThumbsUp className="w-3.5 h-3.5" /> For
                </button>
                <button
                  onClick={() => onVote(proposal.aip, "Against")}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
                >
                  <ThumbsDown className="w-3.5 h-3.5" /> Against
                </button>
                <button
                  onClick={() => onVote(proposal.aip, "Abstain")}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-slate-600 hover:bg-slate-500 text-white transition-colors"
                >
                  <Minus className="w-3.5 h-3.5" /> Abstain
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                Voting has ended for this proposal.
              </p>
            )}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white mb-3">
              Proposal Parameters
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded-lg bg-slate-800/50">
                <span className="text-slate-500">Type:</span>{" "}
                <span className="text-slate-300">{proposal.category}</span>
              </div>
              <div className="p-2 rounded-lg bg-slate-800/50">
                <span className="text-slate-500">Deposit:</span>{" "}
                <span className="text-slate-300">
                  {formatFullNumber(proposal.deposit)} AETHEL
                </span>
              </div>
              <div className="p-2 rounded-lg bg-slate-800/50">
                <span className="text-slate-500">Threshold:</span>{" "}
                <span className="text-slate-300">50% to pass</span>
              </div>
              <div className="p-2 rounded-lg bg-slate-800/50">
                <span className="text-slate-500">Turnout:</span>{" "}
                <span className="text-slate-300">{proposal.turnout}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// =============================================================================
// PROPOSAL LIST SECTION
// =============================================================================

function ProposalListSection({
  userVotes,
  onProposalClick,
}: {
  userVotes: Record<number, VoteChoice>;
  onProposalClick: (proposal: Proposal) => void;
}) {
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "turnout" | "aip">("aip");

  const tabs = [
    { id: "all", label: "All", count: 47 },
    { id: "active", label: "Active", count: 3 },
    { id: "passed", label: "Passed", count: 31 },
    { id: "rejected", label: "Rejected", count: 8 },
    { id: "executed", label: "Executed", count: 5 },
  ];

  const filteredProposals = useMemo(() => {
    let filtered = [...PROPOSALS];

    if (activeTab === "active")
      filtered = filtered.filter((p) => p.status === "Voting");
    else if (activeTab === "passed")
      filtered = filtered.filter((p) => p.status === "Passed");
    else if (activeTab === "rejected")
      filtered = filtered.filter((p) => p.status === "Rejected");
    else if (activeTab === "executed")
      filtered = filtered.filter((p) => p.status === "Executed");

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.proposer.toLowerCase().includes(q) ||
          `aip-${p.aip}`.includes(q),
      );
    }

    if (sortBy === "turnout") filtered.sort((a, b) => b.turnout - a.turnout);
    else if (sortBy === "aip") filtered.sort((a, b) => b.aip - a.aip);

    return filtered;
  }, [activeTab, searchQuery, sortBy]);

  return (
    <section className="mb-12">
      <SectionHeader
        title="All Proposals"
        subtitle="Complete history of Aethelred Improvement Proposals"
        size="sm"
      />

      <GlassCard className="overflow-hidden">
        {/* Filter Bar */}
        <div className="p-4 border-b border-slate-700/50">
          <div className="flex flex-wrap items-center gap-4">
            <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search proposals..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-red-500/30 focus:border-red-500/50 outline-none transition-all"
                />
              </div>
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-2 text-sm bg-slate-800/50 border border-slate-700 rounded-lg text-slate-300 outline-none"
            >
              <option value="aip">Sort: AIP Number</option>
              <option value="date">Sort: Date</option>
              <option value="turnout">Sort: Turnout</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">
                  AIP
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">
                  Title
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">
                  Type
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">
                  Status
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">
                  Result
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">
                  Date
                </th>
                <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">
                  Turnout
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {filteredProposals.map((proposal) => {
                const totalVotes =
                  proposal.votesFor +
                  proposal.votesAgainst +
                  proposal.votesAbstain;
                const forPct =
                  totalVotes > 0 ? (proposal.votesFor / totalVotes) * 100 : 0;
                const againstPct =
                  totalVotes > 0
                    ? (proposal.votesAgainst / totalVotes) * 100
                    : 0;

                return (
                  <tr
                    key={proposal.aip}
                    onClick={() => onProposalClick(proposal)}
                    className="hover:bg-slate-700/20 transition-colors cursor-pointer group"
                  >
                    <td className="px-4 py-3.5">
                      <span className="text-sm font-mono font-medium text-red-400">
                        {String(proposal.aip).padStart(3, "0")}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-sm font-medium text-slate-200 group-hover:text-red-400 transition-colors">
                        {proposal.title}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <CategoryBadge category={proposal.category} />
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={proposal.status} />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2 min-w-[100px]">
                        <div className="flex h-1.5 flex-1 rounded-full overflow-hidden bg-slate-700">
                          <div
                            className="bg-emerald-500"
                            style={{ width: `${forPct}%` }}
                          />
                          <div
                            className="bg-red-500"
                            style={{ width: `${againstPct}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-400 whitespace-nowrap">
                          {forPct.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-sm text-slate-400">
                        {proposal.startDate}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className="text-sm text-slate-400">
                        {proposal.turnout}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredProposals.length === 0 && (
          <div className="text-center py-12">
            <FileText className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">
              No proposals match your search criteria.
            </p>
          </div>
        )}
      </GlassCard>
    </section>
  );
}

// =============================================================================
// CREATE PROPOSAL MODAL
// =============================================================================

function CreateProposalModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { wallet, connectWallet, addNotification } = useApp();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ProposalCategory>("Parameter Change");
  const [description, setDescription] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim().length > 5 && description.trim().length > 20;

  const handleSubmit = () => {
    if (!wallet.connected) {
      addNotification(
        "warning",
        "Wallet Required",
        "Please connect your wallet to submit a proposal.",
      );
      return;
    }
    if (wallet.balance < 1000) {
      addNotification(
        "error",
        "Insufficient Balance",
        "You need at least 1,000 AETHEL to submit a proposal.",
      );
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirm = () => {
    setShowConfirm(false);
    // Governance contract is not yet deployed — prevent simulated success.
    addNotification(
      "warning",
      "Not Yet Available",
      "On-chain governance is under development. Proposal submission will be enabled once the governance contract is deployed.",
    );
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Create New Proposal"
        size="lg"
      >
        <div className="space-y-5">
          <div>
            <label className="text-sm font-medium text-slate-300 mb-1.5 block">
              Proposal Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Increase Validator Set to 200"
              className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:ring-2 focus:ring-red-500/30 focus:border-red-500/50 outline-none"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-300 mb-1.5 block">
              Proposal Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ProposalCategory)}
              className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-white text-sm outline-none"
            >
              <option value="Parameter Change">Parameter Change</option>
              <option value="Community Spend">Community Spend</option>
              <option value="Text Proposal">Text Proposal</option>
              <option value="Software Upgrade">Software Upgrade</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-300 mb-1.5 block">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your proposal in detail..."
              rows={8}
              className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:ring-2 focus:ring-red-500/30 focus:border-red-500/50 outline-none resize-none"
            />
          </div>
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-center gap-2 mb-1">
              <CircleDollarSign className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-medium text-amber-400">
                Deposit Required
              </span>
            </div>
            <p className="text-2xl font-bold text-amber-300">1,000 AETHEL</p>
            <p className="text-xs text-amber-400/60 mt-0.5">
              Refunded if proposal passes or is not vetoed
            </p>
          </div>

          {title && description && (
            <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">
                Preview
              </p>
              <p className="text-sm font-semibold text-white mb-1">{title}</p>
              <CategoryBadge category={type} />
              <p className="text-xs text-slate-400 mt-2 line-clamp-3">
                {description}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl font-medium text-sm transition-colors"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{" "}
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" /> Submit Proposal
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={showConfirm}
        onConfirm={handleConfirm}
        onCancel={() => setShowConfirm(false)}
        title="Confirm Proposal Submission"
        message={`You are about to submit "${title}" as a ${type} proposal. This will require a deposit of 1,000 AETHEL from your wallet.`}
        confirmText="Submit Proposal"
      />
    </>
  );
}

// =============================================================================
// GOVERNANCE ACTIVITY FEED
// =============================================================================

function ActivityFeedSection() {
  const eventIcons: Record<
    string,
    { icon: React.ComponentType<{ className?: string }>; bg: string }
  > = {
    vote: { icon: Vote, bg: "bg-blue-500/10" },
    proposal: { icon: FileText, bg: "bg-purple-500/10" },
    quorum: { icon: Target, bg: "bg-amber-500/10" },
    execution: { icon: Zap, bg: "bg-emerald-500/10" },
    delegation: { icon: Users, bg: "bg-indigo-500/10" },
  };

  return (
    <section className="mb-12">
      <SectionHeader
        title="Governance Activity Feed"
        subtitle="Real-time governance events across the network"
        size="sm"
      />
      <GlassCard className="overflow-hidden">
        <div className="divide-y divide-slate-700/30">
          {ACTIVITY_FEED.map((event) => {
            const config = eventIcons[event.type] || eventIcons.vote;
            const Icon = config.icon;
            return (
              <div
                key={event.id}
                className="flex items-center gap-4 p-4 hover:bg-slate-700/20 transition-colors"
              >
                <div className={`p-2 rounded-xl ${config.bg} shrink-0`}>
                  <Icon className={`w-4 h-4 ${event.color}`} />
                </div>
                <p className="flex-1 text-sm text-slate-300">
                  {event.description}
                </p>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Clock className="w-3 h-3 text-slate-600" />
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    {event.timeAgo}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>
    </section>
  );
}

// =============================================================================
// TREASURY SECTION
// =============================================================================

function TreasurySection() {
  return (
    <section className="mb-12">
      <SectionHeader
        title="Community Treasury"
        subtitle="On-chain treasury managed by AETHEL token holders"
        size="sm"
      />

      <div className="grid lg:grid-cols-3 gap-6 mb-6">
        {/* Balance Card */}
        <GlassCard className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 bg-red-500/10 rounded-xl">
              <Landmark className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                Treasury Balance
              </h3>
              <p className="text-xs text-slate-500">Current holdings</p>
            </div>
          </div>
          <p className="text-3xl font-bold text-white tabular-nums">
            12,500,000
          </p>
          <p className="text-sm text-slate-400 mt-0.5">AETHEL</p>
          <p className="text-lg text-slate-500 mt-1">$30,900,000 USD</p>
          <div className="flex items-center gap-1.5 mt-2">
            <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs text-emerald-400 font-medium">
              +4.2% this month
            </span>
          </div>
        </GlassCard>

        {/* Allocation Pie */}
        <GlassCard className="p-6">
          <h3 className="text-sm font-semibold text-white mb-1">
            Allocation Breakdown
          </h3>
          <p className="text-xs text-slate-500 mb-3">By spending category</p>
          <div className="h-44 flex items-center">
            <div className="w-1/2 h-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={TREASURY_ALLOCATION}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={60}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {TREASURY_ALLOCATION.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-1/2 space-y-2">
              {TREASURY_ALLOCATION.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-xs text-slate-400">{item.name}</span>
                  </div>
                  <span className="text-xs font-semibold text-slate-300">
                    {item.value}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>

        {/* Monthly Spending */}
        <GlassCard className="p-6">
          <h3 className="text-sm font-semibold text-white mb-1">
            Monthly Disbursements
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            Treasury spending history
          </p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={MONTHLY_SPENDING}
                margin={{ top: 0, right: 0, left: -15, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatNumber(v)}
                />
                <RechartsTooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="amount"
                  name="Spending"
                  fill={BRAND.red}
                  radius={[3, 3, 0, 0]}
                  barSize={20}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>
      </div>

      {/* Recent Disbursements */}
      <GlassCard className="overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700/50">
          <h3 className="text-sm font-semibold text-white">
            Recent Disbursements
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">
                  Recipient
                </th>
                <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">
                  Amount
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">
                  Purpose
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">
                  Date
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">
                  Proposal
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {TREASURY_DISBURSEMENTS.map((item, i) => (
                <tr key={i} className="hover:bg-slate-700/20 transition-colors">
                  <td className="px-6 py-3 text-sm text-slate-300">
                    {item.recipient}
                  </td>
                  <td className="px-6 py-3 text-right text-sm font-medium text-white tabular-nums">
                    {formatFullNumber(item.amount)} AETHEL
                  </td>
                  <td className="px-6 py-3 text-sm text-slate-400">
                    {item.purpose}
                  </td>
                  <td className="px-6 py-3 text-sm text-slate-500">
                    {item.date}
                  </td>
                  <td className="px-6 py-3">
                    <span className="text-sm font-mono text-red-400">
                      {item.proposalLink}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </section>
  );
}

// =============================================================================
// DELEGATE LEADERBOARD
// =============================================================================

function DelegateLeaderboard({
  onDelegateSelect,
}: {
  onDelegateSelect: (address: string) => void;
}) {
  const totalPower = DELEGATES.reduce((s, d) => s + d.votingPower, 0);

  return (
    <section className="mb-12">
      <SectionHeader
        title="Delegate Leaderboard"
        subtitle="Top 10 delegates by voting power"
        size="sm"
      />
      <GlassCard className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">
                  Rank
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">
                  Delegate
                </th>
                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">
                  Voting Power
                </th>
                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">
                  Delegators
                </th>
                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">
                  Participation
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">
                  Last Vote
                </th>
                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {DELEGATES.map((d) => (
                <tr
                  key={d.rank}
                  className="hover:bg-slate-700/20 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center text-white text-xs font-bold">
                      {d.rank}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-white">{d.name}</p>
                    <p className="text-xs font-mono text-slate-500">
                      {d.address}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <p className="text-sm font-medium text-white">
                      {formatNumber(d.votingPower)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {((d.votingPower / totalPower) * 100).toFixed(1)}%
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-slate-300">
                    {d.delegators}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`text-sm font-medium ${d.participationRate >= 90 ? "text-emerald-400" : "text-amber-400"}`}
                    >
                      {d.participationRate}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-red-400">
                    {d.lastVote}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => onDelegateSelect(d.address)}
                      className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
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
    </section>
  );
}

// =============================================================================
// GOVERNANCE ANALYTICS (2x2)
// =============================================================================

function GovernanceAnalytics() {
  return (
    <section className="mb-12">
      <SectionHeader
        title="Governance Analytics"
        subtitle="Voting trends, turnout analysis, and proposal outcomes"
        size="sm"
      />
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Participation Trend */}
        <GlassCard className="p-6">
          <h3 className="text-sm font-semibold text-white mb-1">
            Participation Trend
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            Voter participation over last 20 proposals
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={PARTICIPATION_TREND}
                margin={{ top: 5, right: 10, left: -15, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="partGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={BRAND.red} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={BRAND.red} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="proposal"
                  tick={{ fontSize: 9, fill: "#64748b" }}
                  interval={3}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  unit="%"
                  domain={[0, 100]}
                />
                <RechartsTooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="participation"
                  stroke={BRAND.red}
                  strokeWidth={2}
                  fill="url(#partGrad)"
                  name="Participation %"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        {/* Turnout by Type */}
        <GlassCard className="p-6">
          <h3 className="text-sm font-semibold text-white mb-1">
            Turnout by Proposal Type
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            Average participation by category
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={TURNOUT_BY_TYPE}
                margin={{ top: 5, right: 10, left: -15, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="type"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  unit="%"
                  domain={[0, 100]}
                />
                <RechartsTooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="turnout"
                  name="Avg Turnout %"
                  fill={BRAND.red}
                  radius={[4, 4, 0, 0]}
                  barSize={30}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        {/* Vote Distribution History */}
        <GlassCard className="p-6">
          <h3 className="text-sm font-semibold text-white mb-1">
            Vote Distribution History
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            For / Against / Abstain over proposals
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={VOTE_DIST_HISTORY}
                margin={{ top: 5, right: 10, left: -15, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="proposal"
                  tick={{ fontSize: 9, fill: "#64748b" }}
                  interval={2}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  unit="%"
                />
                <RechartsTooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="For"
                  stackId="1"
                  stroke="#10B981"
                  fill="#10B981"
                  fillOpacity={0.3}
                />
                <Area
                  type="monotone"
                  dataKey="Against"
                  stackId="1"
                  stroke="#EF4444"
                  fill="#EF4444"
                  fillOpacity={0.3}
                />
                <Area
                  type="monotone"
                  dataKey="Abstain"
                  stackId="1"
                  stroke="#64748B"
                  fill="#64748B"
                  fillOpacity={0.3}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        {/* Proposal Success Rate Donut */}
        <GlassCard className="p-6">
          <h3 className="text-sm font-semibold text-white mb-1">
            Proposal Success Rate
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            All-time proposal outcomes
          </p>
          <div className="h-56 flex items-center">
            <div className="w-1/2 h-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={OUTCOME_DONUT}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {OUTCOME_DONUT.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-1/2 space-y-3">
              {OUTCOME_DONUT.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-sm text-slate-400">{item.name}</span>
                  </div>
                  <span className="text-sm font-semibold text-white">
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>
      </div>
    </section>
  );
}

// =============================================================================
// GOVERNANCE HEALTH INDICATORS
// =============================================================================

function GovernanceHealth() {
  const metrics = [
    { label: "Voter Participation", value: 72.4, color: "#10B981" },
    { label: "Proposal Success Rate", value: 79.6, color: "#DC2626" },
    { label: "Quorum Achievement", value: 89.4, color: "#F59E0B" },
    { label: "Decentralization Index", value: 76.8, color: "#8B5CF6" },
  ];

  return (
    <section className="mb-12">
      <SectionHeader
        title="Governance Health Indicators"
        subtitle="Key metrics measuring governance effectiveness"
        size="sm"
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <GlassCard key={m.label} className="p-5 text-center">
            <div className="flex justify-center mb-3">
              <ProgressRing
                percentage={m.value}
                size={72}
                strokeWidth={5}
                color={m.color}
              />
            </div>
            <p className="text-2xl font-bold text-white tabular-nums">
              {m.value}%
            </p>
            <p className="text-xs text-slate-400 mt-1">{m.label}</p>
          </GlassCard>
        ))}
      </div>
    </section>
  );
}

// =============================================================================
// GOVERNANCE PARAMETERS
// =============================================================================

function GovernanceParameters() {
  const params = [
    { label: "Voting Period", value: "14 days", icon: Clock },
    { label: "Quorum Threshold", value: "33.4%", icon: Target },
    { label: "Pass Threshold", value: "50%", icon: CheckCircle },
    { label: "Veto Threshold", value: "33.4%", icon: ShieldCheck },
    { label: "Minimum Deposit", value: "1,000 AETHEL", icon: CircleDollarSign },
    { label: "Max Active Proposals", value: "10", icon: FileText },
    { label: "Proposal Cooldown", value: "7 days", icon: Timer },
    { label: "Emergency Threshold", value: "67%", icon: AlertTriangle },
  ];

  return (
    <section className="mb-12">
      <SectionHeader
        title="Governance Parameters"
        subtitle="Current on-chain governance configuration"
        size="sm"
      />
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        {params.map((p) => (
          <GlassCard key={p.label} className="p-5">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-500/10 rounded-lg shrink-0">
                <p.icon className="w-4 h-4 text-red-400" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">{p.label}</p>
                <p className="text-lg font-bold text-white">{p.value}</p>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>
    </section>
  );
}

// =============================================================================
// DELEGATION MODAL
// =============================================================================

function DelegationModal({
  isOpen,
  onClose,
  prefillAddress,
}: {
  isOpen: boolean;
  onClose: () => void;
  prefillAddress: string;
}) {
  const { wallet, addNotification } = useApp();
  const [delegateAddr, setDelegateAddr] = useState(prefillAddress);
  const [showConfirm, setShowConfirm] = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    setDelegateAddr(prefillAddress);
  }, [prefillAddress]);

  const handleConfirm = () => {
    setShowConfirm(false);
    // Governance contract is not yet deployed — prevent simulated delegation.
    addNotification(
      "warning",
      "Not Yet Available",
      "On-chain delegation is under development. Voting power delegation will be enabled once the governance contract is deployed.",
    );
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Delegate Voting Power"
        size="md"
      >
        <div className="space-y-5">
          <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50">
            <p className="text-xs text-slate-500 mb-1">Your Voting Power</p>
            <p className="text-xl font-bold text-white">
              {formatFullNumber(wallet.stBalance)} stAETHEL
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-300 mb-1.5 block">
              Delegate Address
            </label>
            <input
              type="text"
              value={delegateAddr}
              onChange={(e) => setDelegateAddr(e.target.value)}
              placeholder="aeth1..."
              className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm font-mono focus:ring-2 focus:ring-red-500/30 focus:border-red-500/50 outline-none"
            />
          </div>

          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">
              Or select from top delegates
            </p>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {DELEGATES.slice(0, 5).map((d) => (
                <button
                  key={d.rank}
                  onClick={() => setDelegateAddr(d.address)}
                  className={`w-full flex items-center justify-between p-3 rounded-xl border transition-colors ${
                    delegateAddr === d.address
                      ? "bg-red-500/10 border-red-500/30"
                      : "bg-slate-800/30 border-slate-700/50 hover:bg-slate-700/30"
                  }`}
                >
                  <div className="text-left">
                    <p className="text-sm font-medium text-white">{d.name}</p>
                    <p className="text-xs font-mono text-slate-500">
                      {d.address}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-400">
                      {formatNumber(d.votingPower)} AETHEL
                    </p>
                    <p className="text-xs text-emerald-400">
                      {d.participationRate}% participation
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {delegateAddr && (
            <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <p className="text-xs text-blue-400">
                Delegating{" "}
                <span className="font-bold">
                  {formatFullNumber(wallet.stBalance)}
                </span>{" "}
                voting power to{" "}
                <span className="font-mono">
                  {delegateAddr.slice(0, 16)}...
                </span>
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!delegateAddr || processing}
              className="flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl font-medium text-sm transition-colors"
            >
              {processing ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Users className="w-4 h-4" />
              )}
              {processing ? "Processing..." : "Delegate"}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={showConfirm}
        onConfirm={handleConfirm}
        onCancel={() => setShowConfirm(false)}
        title="Confirm Delegation"
        message={`You are about to delegate ${formatFullNumber(wallet.stBalance)} stAETHEL voting power to ${delegateAddr}. You can redelegate or undelegate at any time.`}
        confirmText="Confirm Delegation"
      />
    </>
  );
}

// =============================================================================
// HOW GOVERNANCE WORKS
// =============================================================================

function HowGovernanceWorks() {
  const steps = [
    {
      num: "01",
      title: "Submit Proposal",
      desc: "Deposit 1,000 AETHEL and submit your AIP on-chain for community review.",
      icon: PenTool,
      color: "from-red-500 to-red-600",
    },
    {
      num: "02",
      title: "Deposit Period",
      desc: "7 days for the community to review and reach the minimum deposit threshold.",
      icon: CircleDollarSign,
      color: "from-red-600 to-red-700",
    },
    {
      num: "03",
      title: "Voting Period",
      desc: "14 days for token holders to vote For, Against, or Abstain.",
      icon: Vote,
      color: "from-red-700 to-red-800",
    },
    {
      num: "04",
      title: "Execution",
      desc: "If passed, the proposal is automatically executed on-chain after timelock.",
      icon: Zap,
      color: "from-red-800 to-red-900",
    },
  ];

  return (
    <section className="mb-12">
      <SectionHeader
        title="How Governance Works"
        subtitle="The lifecycle of an Aethelred Improvement Proposal"
        size="sm"
      />
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
        {steps.map((step, idx) => (
          <GlassCard key={step.num} className="p-6 relative overflow-hidden">
            <div className="absolute -top-2 -right-2 text-7xl font-black text-slate-800/50 select-none pointer-events-none">
              {step.num}
            </div>
            <div className="relative">
              <div
                className={`w-10 h-10 rounded-xl bg-gradient-to-br ${step.color} flex items-center justify-center mb-4`}
              >
                <step.icon className="w-5 h-5 text-white" />
              </div>
              <h3 className="text-sm font-semibold text-white mb-2">
                {step.title}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {step.desc}
              </p>
            </div>
            {idx < steps.length - 1 && (
              <div className="hidden lg:block absolute top-1/2 -right-3 z-10">
                <ChevronRight className="w-5 h-5 text-slate-600" />
              </div>
            )}
          </GlassCard>
        ))}
      </div>
    </section>
  );
}

// =============================================================================
// MAIN PAGE COMPONENT
// =============================================================================

export default function GovernancePage() {
  const { wallet, connectWallet, addNotification } = useApp();

  // -- State --
  const [userVotes, setUserVotes] = useState<Record<number, VoteChoice>>({});
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(
    null,
  );
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [delegationModalOpen, setDelegationModalOpen] = useState(false);
  const [delegationPrefill, setDelegationPrefill] = useState("");
  const [voteConfirm, setVoteConfirm] = useState<{
    aip: number;
    choice: VoteChoice;
  } | null>(null);
  const [voteProcessing, setVoteProcessing] = useState(false);

  const activeProposals = PROPOSALS.filter((p) => p.status === "Voting");

  // -- Vote Flow --
  const initiateVote = useCallback(
    (aip: number, choice: VoteChoice) => {
      if (!wallet.connected) {
        addNotification(
          "warning",
          "Wallet Required",
          "Connect your wallet to vote on proposals.",
        );
        return;
      }
      setVoteConfirm({ aip, choice });
    },
    [wallet.connected, addNotification],
  );

  const confirmVote = useCallback(() => {
    if (!voteConfirm) return;
    // Governance contract is not yet deployed — prevent simulated vote.
    addNotification(
      "warning",
      "Not Yet Available",
      "On-chain voting is under development. Votes will be enabled once the governance contract is deployed.",
    );
    setVoteConfirm(null);
  }, [voteConfirm, addNotification]);

  // -- Delegation --
  const openDelegation = useCallback((prefill = "") => {
    setDelegationPrefill(prefill);
    setDelegationModalOpen(true);
  }, []);

  // -- Proposal Detail --
  const openProposalDetail = useCallback((proposal: Proposal) => {
    setSelectedProposal(proposal);
    setDetailModalOpen(true);
  }, []);

  return (
    <>
      <SEOHead
        title="Governance"
        description="Shape the future of Aethelred through decentralized protocol governance. Submit proposals, vote, and manage the community treasury."
        path="/governance"
      />

      <div className="min-h-screen bg-slate-950 text-white">
        <TopNav activePage="governance" />
        <HeroSection />

        <main className="max-w-[1400px] mx-auto px-6 py-10">
          {/* Your Governance Power */}
          <GovernancePowerCard onDelegateClick={() => openDelegation("")} />

          {/* Active Proposals */}
          <section className="mb-12">
            <SectionHeader
              title="Active Proposals"
              subtitle={`${activeProposals.length} proposals currently in voting`}
              size="sm"
              action={
                <button
                  onClick={() => setCreateModalOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium text-sm transition-colors"
                >
                  <Plus className="w-4 h-4" /> Create Proposal
                </button>
              }
            />
            <div className="space-y-6">
              {activeProposals.map((p) => (
                <ActiveProposalCard
                  key={p.aip}
                  proposal={p}
                  userVote={userVotes[p.aip] || null}
                  onVote={initiateVote}
                  onCardClick={openProposalDetail}
                />
              ))}
            </div>
          </section>

          {/* All Proposals */}
          <ProposalListSection
            userVotes={userVotes}
            onProposalClick={openProposalDetail}
          />

          {/* Activity Feed */}
          <ActivityFeedSection />

          {/* Treasury */}
          <TreasurySection />

          {/* Delegate Leaderboard */}
          <DelegateLeaderboard
            onDelegateSelect={(addr) => openDelegation(addr)}
          />

          {/* Analytics */}
          <GovernanceAnalytics />

          {/* Health Indicators */}
          <GovernanceHealth />

          {/* Parameters */}
          <GovernanceParameters />

          {/* How It Works */}
          <HowGovernanceWorks />
        </main>

        <Footer />
      </div>

      {/* Modals */}
      <ProposalDetailModal
        proposal={selectedProposal}
        isOpen={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        userVote={
          selectedProposal ? userVotes[selectedProposal.aip] || null : null
        }
        onVote={initiateVote}
      />

      <CreateProposalModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
      />

      <DelegationModal
        isOpen={delegationModalOpen}
        onClose={() => setDelegationModalOpen(false)}
        prefillAddress={delegationPrefill}
      />

      {/* Vote Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!voteConfirm && !voteProcessing}
        onConfirm={confirmVote}
        onCancel={() => setVoteConfirm(null)}
        title={`Confirm Your Vote on AIP-${voteConfirm ? String(voteConfirm.aip).padStart(3, "0") : ""}`}
        message={
          voteConfirm
            ? `You are voting ${voteConfirm.choice.toUpperCase()} on AIP-${String(voteConfirm.aip).padStart(3, "0")}. Your voting power: ${formatFullNumber(wallet.stBalance)} stAETHEL. This action will be recorded on-chain.`
            : ""
        }
        confirmText={voteConfirm ? `Vote ${voteConfirm.choice}` : "Confirm"}
      />

      {/* Vote Processing Overlay */}
      {voteProcessing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 rounded-2xl border border-slate-700/50 p-8 text-center shadow-2xl">
            <div className="w-12 h-12 border-3 border-red-500/30 border-t-red-500 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white font-medium">Processing your vote...</p>
            <p className="text-sm text-slate-400 mt-1">
              Submitting transaction to the network
            </p>
          </div>
        </div>
      )}
    </>
  );
}
