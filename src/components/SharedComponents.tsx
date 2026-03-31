/**
 * SharedComponents — Shared UI primitives for the Aethelred Dashboard.
 *
 * Every component uses the dark-slate + brand-red design language, CSS-only
 * animations, and is fully SSR-safe (no window access outside useEffect).
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { WalletButton } from "@/components/WalletButton";
import {
  Search,
  X,
  ChevronDown,
  ExternalLink,
  Wallet,
  LogOut,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  Clock,
  Blocks,
  UserCheck,
  ArrowRight,
  Github,
  Twitter,
} from "lucide-react";
import { useApp } from "@/contexts/AppContext";

// ============================================================================
// Utility
// ============================================================================

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function truncateAddress(addr: string, start = 10, end = 4): string {
  if (addr.length <= start + end) return addr;
  return `${addr.slice(0, start)}...${addr.slice(-end)}`;
}

// ============================================================================
// LiveDot
// ============================================================================

export interface LiveDotProps {
  color?: "green" | "red" | "yellow";
  size?: "sm" | "md";
}

export function LiveDot({ color = "green", size = "sm" }: LiveDotProps) {
  const colorMap = {
    green: "bg-emerald-500",
    red: "bg-red-500",
    yellow: "bg-yellow-500",
  };
  const ringMap = {
    green: "bg-emerald-500/40",
    red: "bg-red-500/40",
    yellow: "bg-yellow-500/40",
  };
  const px = size === "sm" ? "h-2 w-2" : "h-3 w-3";
  const ringPx = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <span
      aria-hidden="true"
      className="relative inline-flex items-center justify-center"
    >
      <span
        className={`absolute inline-flex rounded-full ${ringMap[color]} ${ringPx}`}
        style={{ animation: "live-dot 2s ease-in-out infinite" }}
      />
      <span
        className={`relative inline-flex rounded-full ${colorMap[color]} ${px}`}
      />
    </span>
  );
}

// ============================================================================
// Badge
// ============================================================================

export interface BadgeProps {
  variant: "success" | "warning" | "error" | "info" | "neutral" | "brand";
  children: React.ReactNode;
}

export function Badge({ variant, children }: BadgeProps) {
  const styles: Record<string, string> = {
    success: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
    warning: "bg-yellow-500/10 text-yellow-400 ring-yellow-500/20",
    error: "bg-red-500/10 text-red-400 ring-red-500/20",
    info: "bg-blue-500/10 text-blue-400 ring-blue-500/20",
    neutral: "bg-slate-500/10 text-slate-400 ring-slate-500/20",
    brand: "bg-brand-600/10 text-brand-400 ring-brand-600/20",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[variant]}`}
    >
      {children}
    </span>
  );
}

// ============================================================================
// ProgressRing
// ============================================================================

export interface ProgressRingProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
}

export function ProgressRing({
  percentage,
  size = 48,
  strokeWidth = 4,
  color = "#dc2626",
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const [offset, setOffset] = useState(circumference);

  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(circumference - (percentage / 100) * circumference);
    }, 100);
    return () => clearTimeout(timer);
  }, [percentage, circumference]);

  return (
    <svg role="progressbar" width={size} height={size} className="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={strokeWidth}
        stroke="currentColor"
        className="text-slate-700"
        fill="none"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={strokeWidth}
        stroke={color}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.8s ease-in-out" }}
      />
    </svg>
  );
}

// ============================================================================
// AnimatedNumber
// ============================================================================

export interface AnimatedNumberProps {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  duration?: number;
}

export function AnimatedNumber({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  duration = 1000,
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const hasAnimated = useRef(false);
  const rafRef = useRef<number>();

  useEffect(() => {
    if (hasAnimated.current) {
      setDisplayValue(value);
      return;
    }
    hasAnimated.current = true;

    const startTime = performance.now();
    const startVal = 0;

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(startVal + (value - startVal) * eased);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  const formatted = displayValue.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span
      className="tabular-nums"
      style={{ animation: "countUp 0.4s ease-out" }}
    >
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

// ============================================================================
// Tabs
// ============================================================================

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
}

export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="flex gap-1 rounded-lg bg-slate-800/50 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`relative flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === tab.id
              ? "bg-slate-700 text-white shadow-sm"
              : "text-slate-400 hover:text-white"
          }`}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-xs ${
                activeTab === tab.id
                  ? "bg-brand-600/20 text-brand-400"
                  : "bg-slate-700 text-slate-500"
              }`}
            >
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// Modal
// ============================================================================

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  size?: "sm" | "md" | "lg" | "xl";
  children: React.ReactNode;
}

const MODAL_SIZES: Record<string, string> = {
  sm: "max-w-[28rem]",
  md: "max-w-[36rem]",
  lg: "max-w-[48rem]",
  xl: "max-w-[64rem]",
};

export function Modal({
  isOpen,
  onClose,
  title,
  size = "md",
  children,
}: ModalProps) {
  const [closing, setClosing] = useState(false);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 200);
  }, [onClose]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, handleClose]);

  // Prevent body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen && !closing) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        style={{
          animation: closing
            ? "modal-overlay-out 0.2s ease-in forwards"
            : "modal-overlay-in 0.2s ease-out forwards",
        }}
        onClick={handleClose}
      />

      {/* Content */}
      <div
        role="dialog"
        aria-modal="true"
        className={`relative w-full ${MODAL_SIZES[size]} rounded-2xl border border-slate-700/50 bg-slate-900 shadow-2xl`}
        style={{
          animation: closing
            ? "modal-content-out 0.2s ease-in forwards"
            : "modal-content-in 0.25s ease-out forwards",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/50 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

// ============================================================================
// ConfirmDialog
// ============================================================================

export interface ConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmText?: string;
  variant?: "danger" | "default";
}

export function ConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
  confirmText = "Confirm",
  variant = "default",
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          {variant === "danger" && (
            <div className="mt-0.5 rounded-full bg-red-500/10 p-2">
              <AlertTriangle size={20} className="text-red-400" />
            </div>
          )}
          <p className="text-sm text-slate-300">{message}</p>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${
              variant === "danger"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-brand-600 hover:bg-brand-700"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Drawer
// ============================================================================

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}

export function Drawer({
  isOpen,
  onClose,
  title,
  children,
  width = "max-w-lg",
}: DrawerProps) {
  const [closing, setClosing] = useState(false);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 250);
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, handleClose]);

  useEffect(() => {
    if (isOpen) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen && !closing) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex justify-end"
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        style={{
          animation: closing
            ? "modal-overlay-out 0.25s ease-in forwards"
            : "modal-overlay-in 0.2s ease-out forwards",
        }}
        onClick={handleClose}
      />

      {/* Panel */}
      <div
        className={`relative ${width} w-full border-l border-slate-700/50 bg-slate-900`}
        style={{
          animation: closing
            ? "drawer-out 0.25s ease-in forwards"
            : "drawer-in 0.25s ease-out forwards",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/50 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="h-[calc(100%-65px)] overflow-y-auto px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// ToastContainer
// ============================================================================

const TOAST_ICON: Record<string, React.ReactNode> = {
  success: <CheckCircle2 size={18} className="text-emerald-400" />,
  error: <AlertCircle size={18} className="text-red-400" />,
  warning: <AlertTriangle size={18} className="text-yellow-400" />,
  info: <Info size={18} className="text-blue-400" />,
};

const TOAST_BORDER: Record<string, string> = {
  success: "border-l-emerald-500",
  error: "border-l-red-500",
  warning: "border-l-yellow-500",
  info: "border-l-blue-500",
};

export function ToastContainer() {
  const { notifications, removeNotification } = useApp();

  if (notifications.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 top-20 z-[70] flex flex-col gap-3"
    >
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`w-80 rounded-lg border border-slate-700/50 border-l-4 ${TOAST_BORDER[n.type]} bg-slate-900/95 p-4 shadow-xl backdrop-blur-sm`}
          style={{ animation: "toast-in 0.3s ease-out forwards" }}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0">{TOAST_ICON[n.type]}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white">{n.title}</p>
              <p className="mt-0.5 text-xs text-slate-400">{n.message}</p>
            </div>
            <button
              onClick={() => removeNotification(n.id)}
              className="shrink-0 rounded p-0.5 text-slate-500 transition-colors hover:text-white"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// SearchOverlay
// ============================================================================

interface SearchResult {
  category: string;
  icon: React.ReactNode;
  items: { label: string; href: string }[];
}

const MOCK_VALIDATORS = [
  "Aethelred Foundation",
  "Paradigm Stake",
  "Polychain Capital",
  "Coinbase Cloud",
  "a16z Validator",
  "Figment Networks",
  "Chorus One",
  "Everstake",
];

function buildSearchResults(query: string): SearchResult[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  // Blocks
  if (/^\d+$/.test(q) || q.startsWith("block") || q.startsWith("#")) {
    const blockNum = q.replace(/\D/g, "") || "2847391";
    results.push({
      category: "Blocks",
      icon: <Blocks size={14} className="text-slate-500" />,
      items: [
        { label: `Block #${Number(blockNum).toLocaleString()}`, href: "/" },
        {
          label: `Block #${(Number(blockNum) + 1).toLocaleString()}`,
          href: "/",
        },
      ],
    });
  }

  // Transactions
  if (q.startsWith("0x") || q.includes("tx")) {
    const hash = q.startsWith("0x") ? q : "0x" + q.replace(/\s/g, "");
    results.push({
      category: "Transactions",
      icon: <ArrowRight size={14} className="text-slate-500" />,
      items: [
        {
          label: `${hash.slice(0, 10)}...${hash.slice(-6).padEnd(6, "0")}`,
          href: "/",
        },
      ],
    });
  }

  // Validators
  const matchedValidators = MOCK_VALIDATORS.filter((v) =>
    v.toLowerCase().includes(q),
  );
  if (matchedValidators.length > 0) {
    results.push({
      category: "Validators",
      icon: <UserCheck size={14} className="text-slate-500" />,
      items: matchedValidators.slice(0, 4).map((v) => ({
        label: v,
        href: "/validators",
      })),
    });
  }

  // Addresses
  if (q.startsWith("aeth") || q.length > 8) {
    const addr = q.startsWith("aeth") ? q : `aeth1${q}`;
    results.push({
      category: "Addresses",
      icon: <Wallet size={14} className="text-slate-500" />,
      items: [
        {
          label: `${addr.slice(0, 12)}...${addr.slice(-6).padEnd(6, "0")}`,
          href: "/",
        },
      ],
    });
  }

  // Fallback: search everywhere
  if (results.length === 0) {
    const matched = MOCK_VALIDATORS.filter((v) => v.toLowerCase().includes(q));
    if (matched.length > 0) {
      results.push({
        category: "Validators",
        icon: <UserCheck size={14} className="text-slate-500" />,
        items: matched.slice(0, 4).map((v) => ({
          label: v,
          href: "/validators",
        })),
      });
    }
  }

  return results;
}

export function SearchOverlay() {
  const { searchOpen, setSearchOpen } = useApp();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentSearches] = useState<string[]>([
    "Block #2847390",
    "aeth1qz7x...9n2",
    "Aethelred Foundation",
  ]);

  const results = useMemo(() => buildSearchResults(query), [query]);

  // Flatten results for keyboard nav
  const flatItems = useMemo(() => {
    return results.flatMap((r) => r.items);
  }, [results]);

  // Focus input on open
  useEffect(() => {
    if (searchOpen) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [searchOpen]);

  // Keyboard nav
  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSearchOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, flatItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && flatItems[activeIndex]) {
        setSearchOpen(false);
        router.push(flatItems[activeIndex].href);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searchOpen, setSearchOpen, flatItems, activeIndex, router]);

  // Prevent body scroll
  useEffect(() => {
    if (searchOpen) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [searchOpen]);

  if (!searchOpen) return null;

  let flatIdx = -1;

  return (
    <div
      role="search"
      aria-label="Site search"
      className="fixed inset-0 z-[80] flex items-start justify-center pt-[10vh]"
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        style={{ animation: "modal-overlay-in 0.15s ease-out forwards" }}
        onClick={() => setSearchOpen(false)}
      />

      {/* Search panel */}
      <div
        className="relative w-full max-w-2xl rounded-2xl border border-slate-700/50 bg-slate-900 shadow-2xl"
        style={{ animation: "modal-content-in 0.2s ease-out forwards" }}
      >
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-slate-700/50 px-5 py-4">
          <Search size={20} className="text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search blocks, transactions, validators, addresses..."
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
          />
          <kbd className="hidden rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-500 sm:inline-block">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {query.trim() && results.length > 0 ? (
            results.map((group) => (
              <div key={group.category} className="mb-2">
                <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                  {group.icon}
                  {group.category}
                </div>
                {group.items.map((item) => {
                  flatIdx += 1;
                  const idx = flatIdx;
                  return (
                    <button
                      key={`${group.category}-${item.label}`}
                      onClick={() => {
                        setSearchOpen(false);
                        router.push(item.href);
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                        idx === activeIndex
                          ? "bg-slate-800 text-white"
                          : "text-slate-300 hover:bg-slate-800/50"
                      }`}
                    >
                      <span className="flex-1 truncate text-left font-mono text-sm">
                        {item.label}
                      </span>
                      {idx === activeIndex && (
                        <ArrowRight size={14} className="text-slate-500" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          ) : query.trim() ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              No results found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <div className="px-3 py-2">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                Recent Searches
              </p>
              {recentSearches.map((s) => (
                <button
                  key={s}
                  onClick={() => setQuery(s)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-400 transition-colors hover:bg-slate-800/50 hover:text-white"
                >
                  <Clock size={14} className="text-slate-600" />
                  <span className="truncate">{s}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-700/50 px-5 py-3">
          <div className="flex gap-4 text-xs text-slate-600">
            <span>
              <kbd className="mr-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-slate-500">
                &uarr;&darr;
              </kbd>
              Navigate
            </span>
            <span>
              <kbd className="mr-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-slate-500">
                &crarr;
              </kbd>
              Select
            </span>
            <span>
              <kbd className="mr-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-slate-500">
                ESC
              </kbd>
              Close
            </span>
          </div>
          <p className="text-xs text-slate-600">
            Press{" "}
            <kbd className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-slate-500">
              &#8984;K
            </kbd>{" "}
            to search
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TopNav
// ============================================================================

export interface TopNavProps {
  activePage:
    | "explorer"
    | "vault"
    | "stablecoins"
    | "validators"
    | "governance"
    | "reconciliation";
}

const NAV_LINKS: {
  id: TopNavProps["activePage"];
  label: string;
  href: string;
}[] = [
  { id: "explorer", label: "EXPLORER", href: "/" },
  { id: "vault", label: "VAULT", href: "/vault" },
  { id: "stablecoins", label: "STABLECOINS", href: "/stablecoins" },
  { id: "validators", label: "VALIDATORS", href: "/validators" },
  { id: "governance", label: "GOVERNANCE", href: "/governance" },
  { id: "reconciliation", label: "RECONCILIATION", href: "/reconciliation" },
];

export function TopNav({ activePage }: TopNavProps) {
  const { realTime, setSearchOpen } = useApp();

  return (
    <nav
      aria-label="Main navigation"
      className="sticky top-0 z-50 border-b border-slate-800/50 bg-slate-950/95 backdrop-blur-xl"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left — Logo */}
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1e1b5e] shadow-lg shadow-indigo-900/25 p-1.5">
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <path
                d="M 62 83 L 25 79 L 25 21 L 68 21 L 46 48"
                stroke="white"
                strokeWidth="14"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </div>
          <span className="hidden text-base font-bold tracking-[0.25em] text-white sm:inline-block">
            CRUZIBLE
          </span>
        </Link>

        {/* Center — Nav links */}
        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.id}
              href={link.href}
              className={`relative px-4 py-2 text-sm font-medium tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${
                activePage === link.id
                  ? "text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {link.label}
              {activePage === link.id && (
                <span className="absolute bottom-0 left-4 right-4 h-0.5 rounded-full bg-brand-600" />
              )}
            </Link>
          ))}
        </div>

        {/* Right — Status + Search + Wallet */}
        <div className="flex items-center gap-3">
          {/* Block height */}
          <div className="hidden items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-1.5 lg:flex">
            <LiveDot color="green" size="sm" />
            <span className="text-xs font-medium tabular-nums text-slate-300">
              Block #{formatNumber(realTime.blockHeight)}
            </span>
          </div>

          {/* Search */}
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-1.5 text-slate-400 transition-colors hover:border-slate-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
          >
            <Search size={15} />
            <span className="hidden text-xs sm:inline-block">Search</span>
            <kbd className="hidden rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500 sm:inline-block">
              &#8984;K
            </kbd>
          </button>

          {/* Wallet — uses WalletButton for full wallet UX */}
          <WalletButton />
        </div>
      </div>

      {/* Mobile nav */}
      <div className="flex border-t border-slate-800/50 md:hidden">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.id}
            href={link.href}
            className={`flex-1 py-3 text-center text-xs font-medium tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${
              activePage === link.id
                ? "border-b-2 border-brand-600 text-white"
                : "text-slate-500"
            }`}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

// ============================================================================
// Footer
// ============================================================================

const FOOTER_LINKS = {
  Resources: [
    { label: "Documentation", href: "#" },
    { label: "Whitepaper", href: "#" },
    { label: "GitHub", href: "#" },
    { label: "Block Explorer", href: "#" },
  ],
  Developers: [
    { label: "API Reference", href: "#" },
    { label: "SDK", href: "#" },
    { label: "Smart Contracts", href: "#" },
    { label: "Faucet", href: "#" },
  ],
  Community: [
    { label: "Discord", href: "#" },
    { label: "Twitter", href: "#" },
    { label: "Telegram", href: "#" },
    { label: "Forum", href: "#" },
  ],
  Legal: [
    { label: "Terms", href: "#" },
    { label: "Privacy", href: "#" },
    { label: "Security", href: "#" },
    { label: "Bug Bounty", href: "#" },
  ],
};

export function Footer() {
  return (
    <footer
      aria-label="Site footer"
      className="border-t border-slate-800/50 bg-slate-950"
    >
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {/* Columns */}
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {Object.entries(FOOTER_LINKS).map(([heading, links]) => (
            <div key={heading}>
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white">
                {heading}
              </h3>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-slate-400 transition-colors hover:text-white"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-slate-800/50 pt-8 sm:flex-row">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#1e1b5e] p-1.5">
              <svg viewBox="0 0 100 100" className="w-full h-full">
                <path
                  d="M 62 83 L 25 79 L 25 21 L 68 21 L 46 48"
                  stroke="white"
                  strokeWidth="14"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            </div>
            <p className="text-sm text-slate-500">
              &copy; 2026 CRUZIBLE. All rights reserved.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <a
              href="#"
              className="text-slate-500 transition-colors hover:text-white"
              aria-label="GitHub"
            >
              <Github size={18} />
            </a>
            <a
              href="#"
              className="text-slate-500 transition-colors hover:text-white"
              aria-label="Twitter"
            >
              <Twitter size={18} />
            </a>
            <a
              href="#"
              className="text-slate-500 transition-colors hover:text-white"
              aria-label="External link"
            >
              <ExternalLink size={18} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
