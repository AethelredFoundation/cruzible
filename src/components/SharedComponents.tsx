/**
 * SharedComponents — Premium UI primitives for Cruzible.
 *
 * Every component uses the premium dark + brand design language with
 * glass-morphism, gradient borders, CSS-only animations, and is fully
 * SSR-safe (no window access outside useEffect).
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { WalletButton } from '@/components/WalletButton';
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
  Globe,
  MessageCircle,
  Send,
  Shield,
  BookOpen,
  Code,
  Zap,
  Menu,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';

// ============================================================================
// Utility
// ============================================================================

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function truncateAddress(addr: string, start = 10, end = 4): string {
  if (addr.length <= start + end) return addr;
  return `${addr.slice(0, start)}...${addr.slice(-end)}`;
}

// ============================================================================
// CruzibleLogo — Reusable logo component using the actual logo image
// ============================================================================

interface CruzibleLogoProps {
  size?: number;
  showText?: boolean;
  textSize?: string;
}

export function CruzibleLogo({ size = 36, showText = true, textSize = 'text-base' }: CruzibleLogoProps) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="relative flex-shrink-0 rounded-xl overflow-hidden"
        style={{ width: size, height: size }}
      >
        <Image
          src="/cruzible-logo.png"
          alt="Cruzible"
          width={size}
          height={size}
          className="object-cover"
          priority
        />
        {/* Subtle glow behind logo */}
        <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10" />
      </div>
      {showText && (
        <span className={`${textSize} font-display font-bold tracking-[0.2em] text-white`}>
          CRUZIBLE
        </span>
      )}
    </div>
  );
}

// ============================================================================
// LiveDot
// ============================================================================

export interface LiveDotProps {
  color?: 'green' | 'red' | 'yellow' | 'emerald';
  size?: 'sm' | 'md';
}

export function LiveDot({ color = 'green', size = 'sm' }: LiveDotProps) {
  const colorMap: Record<string, string> = {
    green: 'bg-emerald-500',
    emerald: 'bg-emerald-500',
    red: 'bg-red-500',
    yellow: 'bg-yellow-500',
  };
  const ringMap: Record<string, string> = {
    green: 'bg-emerald-500/40',
    emerald: 'bg-emerald-500/40',
    red: 'bg-red-500/40',
    yellow: 'bg-yellow-500/40',
  };
  const glowMap: Record<string, string> = {
    green: 'shadow-[0_0_6px_rgba(16,185,129,0.4)]',
    emerald: 'shadow-[0_0_6px_rgba(16,185,129,0.4)]',
    red: 'shadow-[0_0_6px_rgba(239,68,68,0.4)]',
    yellow: 'shadow-[0_0_6px_rgba(234,179,8,0.4)]',
  };
  const px = size === 'sm' ? 'h-2 w-2' : 'h-3 w-3';
  const ringPx = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';

  return (
    <span aria-hidden="true" className="relative inline-flex items-center justify-center">
      <span
        className={`absolute inline-flex rounded-full ${ringMap[color]} ${ringPx}`}
        style={{ animation: 'live-dot 2s ease-in-out infinite' }}
      />
      <span className={`relative inline-flex rounded-full ${colorMap[color]} ${px} ${glowMap[color]}`} />
    </span>
  );
}

// ============================================================================
// Badge
// ============================================================================

export interface BadgeProps {
  variant: 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'brand';
  children: React.ReactNode;
}

export function Badge({ variant, children }: BadgeProps) {
  const styles: Record<string, string> = {
    success: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
    warning: 'bg-yellow-500/10 text-yellow-400 ring-yellow-500/20',
    error: 'bg-red-500/10 text-red-400 ring-red-500/20',
    info: 'bg-blue-500/10 text-blue-400 ring-blue-500/20',
    neutral: 'bg-slate-500/10 text-slate-400 ring-slate-500/20',
    brand: 'bg-brand-600/10 text-brand-400 ring-brand-600/20',
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
  color = '#dc2626',
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
        className="text-slate-800"
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
        style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.16,1,0.3,1)', filter: `drop-shadow(0 0 4px ${color}40)` }}
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
  prefix = '',
  suffix = '',
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

  const formatted = displayValue.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span className="tabular-nums" style={{ animation: 'countUp 0.4s ease-out' }}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

// ============================================================================
// Tabs (Premium)
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
    <div className="flex gap-1 rounded-xl bg-slate-900/60 backdrop-blur-sm border border-slate-800/50 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`relative flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-300 ${
            activeTab === tab.id
              ? 'bg-slate-800/80 text-white shadow-sm shadow-black/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/30'
          }`}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-xs ${
                activeTab === tab.id
                  ? 'bg-brand-600/20 text-brand-400'
                  : 'bg-slate-800 text-slate-500'
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
// Modal (Premium)
// ============================================================================

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: React.ReactNode;
}

const MODAL_SIZES: Record<string, string> = {
  sm: 'max-w-[28rem]',
  md: 'max-w-[36rem]',
  lg: 'max-w-[48rem]',
  xl: 'max-w-[64rem]',
};

export function Modal({
  isOpen,
  onClose,
  title,
  size = 'md',
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

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, handleClose]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen && !closing) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        style={{
          animation: closing
            ? 'modal-overlay-out 0.2s ease-in forwards'
            : 'modal-overlay-in 0.2s ease-out forwards',
        }}
        onClick={handleClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        className={`relative w-full ${MODAL_SIZES[size]} rounded-2xl border border-slate-700/30 bg-slate-900/95 backdrop-blur-xl shadow-premium-lg`}
        style={{
          animation: closing
            ? 'modal-content-out 0.2s ease-in forwards'
            : 'modal-content-in 0.25s ease-out forwards',
        }}
      >
        <div className="flex items-center justify-between border-b border-slate-700/30 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-slate-400 transition-all duration-200 hover:bg-slate-800 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

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
  variant?: 'danger' | 'default';
}

export function ConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
  confirmText = 'Confirm',
  variant = 'default',
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          {variant === 'danger' && (
            <div className="mt-0.5 rounded-full bg-red-500/10 p-2">
              <AlertTriangle size={20} className="text-red-400" />
            </div>
          )}
          <p className="text-sm text-slate-300">{message}</p>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-sm font-medium text-white transition-all duration-300 ${
              variant === 'danger'
                ? 'bg-red-600 hover:bg-red-700 shadow-[0_2px_8px_-2px_rgba(239,68,68,0.3)]'
                : 'btn-primary'
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
// Drawer (Premium)
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
  width = 'max-w-lg',
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
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, handleClose]);

  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen && !closing) return null;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[60] flex justify-end">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        style={{
          animation: closing
            ? 'modal-overlay-out 0.25s ease-in forwards'
            : 'modal-overlay-in 0.2s ease-out forwards',
        }}
        onClick={handleClose}
      />

      <div
        className={`relative ${width} w-full border-l border-slate-700/30 bg-slate-900/98 backdrop-blur-xl`}
        style={{
          animation: closing
            ? 'drawer-out 0.25s ease-in forwards'
            : 'drawer-in 0.25s ease-out forwards',
        }}
      >
        <div className="flex items-center justify-between border-b border-slate-700/30 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-slate-400 transition-all duration-200 hover:bg-slate-800 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="h-[calc(100%-65px)] overflow-y-auto px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// ToastContainer (Premium)
// ============================================================================

const TOAST_ICON: Record<string, React.ReactNode> = {
  success: <CheckCircle2 size={18} className="text-emerald-400" />,
  error: <AlertCircle size={18} className="text-red-400" />,
  warning: <AlertTriangle size={18} className="text-yellow-400" />,
  info: <Info size={18} className="text-blue-400" />,
};

const TOAST_BORDER: Record<string, string> = {
  success: 'border-l-emerald-500',
  error: 'border-l-red-500',
  warning: 'border-l-yellow-500',
  info: 'border-l-blue-500',
};

const TOAST_GLOW: Record<string, string> = {
  success: 'shadow-[0_0_20px_-4px_rgba(16,185,129,0.15)]',
  error: 'shadow-[0_0_20px_-4px_rgba(239,68,68,0.15)]',
  warning: 'shadow-[0_0_20px_-4px_rgba(234,179,8,0.15)]',
  info: 'shadow-[0_0_20px_-4px_rgba(59,130,246,0.15)]',
};

export function ToastContainer() {
  const { notifications, removeNotification } = useApp();

  if (notifications.length === 0) return null;

  return (
    <div role="status" aria-live="polite" className="fixed right-4 top-20 z-[70] flex flex-col gap-3">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`w-80 rounded-xl border border-slate-700/30 border-l-4 ${TOAST_BORDER[n.type]} bg-slate-900/95 backdrop-blur-xl p-4 ${TOAST_GLOW[n.type]}`}
          style={{ animation: 'toast-in 0.3s cubic-bezier(0.16,1,0.3,1) forwards' }}
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
// SearchOverlay (Premium)
// ============================================================================

interface SearchResultGroup {
  category: string;
  icon: React.ReactNode;
  items: { label: string; href: string }[];
}

const MOCK_VALIDATORS = [
  'Aethelred Foundation',
  'Paradigm Stake',
  'Polychain Capital',
  'Coinbase Cloud',
  'a16z Validator',
  'Figment Networks',
  'Chorus One',
  'Everstake',
];

function buildSearchResults(query: string): SearchResultGroup[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const results: SearchResultGroup[] = [];

  if (/^\d+$/.test(q) || q.startsWith('block') || q.startsWith('#')) {
    const blockNum = q.replace(/\D/g, '') || '2847391';
    results.push({
      category: 'Blocks',
      icon: <Blocks size={14} className="text-slate-500" />,
      items: [
        { label: `Block #${Number(blockNum).toLocaleString()}`, href: '/' },
        { label: `Block #${(Number(blockNum) + 1).toLocaleString()}`, href: '/' },
      ],
    });
  }

  if (q.startsWith('0x') || q.includes('tx')) {
    const hash = q.startsWith('0x') ? q : '0x' + q.replace(/\s/g, '');
    results.push({
      category: 'Transactions',
      icon: <ArrowRight size={14} className="text-slate-500" />,
      items: [
        { label: `${hash.slice(0, 10)}...${hash.slice(-6).padEnd(6, '0')}`, href: '/' },
      ],
    });
  }

  const matchedValidators = MOCK_VALIDATORS.filter((v) => v.toLowerCase().includes(q));
  if (matchedValidators.length > 0) {
    results.push({
      category: 'Validators',
      icon: <UserCheck size={14} className="text-slate-500" />,
      items: matchedValidators.slice(0, 4).map((v) => ({ label: v, href: '/validators' })),
    });
  }

  if (q.startsWith('aeth') || q.length > 8) {
    const addr = q.startsWith('aeth') ? q : `aeth1${q}`;
    results.push({
      category: 'Addresses',
      icon: <Wallet size={14} className="text-slate-500" />,
      items: [
        { label: `${addr.slice(0, 12)}...${addr.slice(-6).padEnd(6, '0')}`, href: '/' },
      ],
    });
  }

  if (results.length === 0) {
    const matched = MOCK_VALIDATORS.filter((v) => v.toLowerCase().includes(q));
    if (matched.length > 0) {
      results.push({
        category: 'Validators',
        icon: <UserCheck size={14} className="text-slate-500" />,
        items: matched.slice(0, 4).map((v) => ({ label: v, href: '/validators' })),
      });
    }
  }

  return results;
}

export function SearchOverlay() {
  const { searchOpen, setSearchOpen } = useApp();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentSearches] = useState<string[]>([
    'Block #2847390',
    'aeth1qz7x...9n2',
    'Aethelred Foundation',
  ]);

  const results = useMemo(() => buildSearchResults(query), [query]);
  const flatItems = useMemo(() => results.flatMap((r) => r.items), [results]);

  useEffect(() => {
    if (searchOpen) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, flatItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && flatItems[activeIndex]) {
        setSearchOpen(false);
        router.push(flatItems[activeIndex].href);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchOpen, setSearchOpen, flatItems, activeIndex, router]);

  useEffect(() => {
    if (searchOpen) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [searchOpen]);

  if (!searchOpen) return null;

  let flatIdx = -1;

  return (
    <div role="search" aria-label="Site search" className="fixed inset-0 z-[80] flex items-start justify-center pt-[10vh]">
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-md"
        style={{ animation: 'modal-overlay-in 0.15s ease-out forwards' }}
        onClick={() => setSearchOpen(false)}
      />

      <div
        className="relative w-full max-w-2xl rounded-2xl border border-slate-700/30 bg-slate-900/95 backdrop-blur-xl shadow-premium-lg"
        style={{ animation: 'modal-content-in 0.2s ease-out forwards' }}
      >
        <div className="flex items-center gap-3 border-b border-slate-700/30 px-5 py-4">
          <Search size={20} className="text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            placeholder="Search blocks, transactions, validators, addresses..."
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
          />
          <kbd className="hidden rounded-md border border-slate-700/50 bg-slate-800/50 px-2 py-0.5 text-xs text-slate-500 sm:inline-block">
            ESC
          </kbd>
        </div>

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
                      onClick={() => { setSearchOpen(false); router.push(item.href); }}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200 ${
                        idx === activeIndex
                          ? 'bg-slate-800/80 text-white'
                          : 'text-slate-300 hover:bg-slate-800/40'
                      }`}
                    >
                      <span className="flex-1 truncate text-left font-mono text-sm">{item.label}</span>
                      {idx === activeIndex && <ArrowRight size={14} className="text-slate-500" />}
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
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400 transition-all duration-200 hover:bg-slate-800/40 hover:text-white"
                >
                  <Clock size={14} className="text-slate-600" />
                  <span className="truncate">{s}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-700/30 px-5 py-3">
          <div className="flex gap-4 text-xs text-slate-600">
            <span>
              <kbd className="mr-1 rounded-md border border-slate-700/50 bg-slate-800/50 px-1.5 py-0.5 text-slate-500">&uarr;&darr;</kbd>
              Navigate
            </span>
            <span>
              <kbd className="mr-1 rounded-md border border-slate-700/50 bg-slate-800/50 px-1.5 py-0.5 text-slate-500">&crarr;</kbd>
              Select
            </span>
          </div>
          <p className="text-xs text-slate-600">
            <kbd className="rounded-md border border-slate-700/50 bg-slate-800/50 px-1.5 py-0.5 text-slate-500">&#8984;K</kbd>
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TopNav (Premium with Cruzible Logo)
// ============================================================================

export interface TopNavProps {
  activePage: 'explorer' | 'vault' | 'stablecoins' | 'validators' | 'governance' | 'reconciliation';
}

const NAV_LINKS: { id: TopNavProps['activePage']; label: string; href: string }[] = [
  { id: 'explorer', label: 'Explorer', href: '/' },
  { id: 'vault', label: 'Vault', href: '/vault' },
  { id: 'stablecoins', label: 'Stablecoins', href: '/stablecoins' },
  { id: 'validators', label: 'Validators', href: '/validators' },
  { id: 'governance', label: 'Governance', href: '/governance' },
];

export function TopNav({ activePage }: TopNavProps) {
  const { realTime, setSearchOpen } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav aria-label="Main navigation" className="sticky top-0 z-50 border-b border-slate-800/30 bg-[#050810]/90 backdrop-blur-2xl">
      {/* Subtle top accent line */}
      <div className="h-[1px] bg-gradient-to-r from-transparent via-brand-600/30 to-transparent" />

      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left - Logo */}
        <Link href="/" className="flex items-center gap-3 group">
          <CruzibleLogo size={34} showText={true} textSize="text-sm" />
        </Link>

        {/* Center - Nav links (desktop) */}
        <div className="hidden items-center gap-0.5 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.id}
              href={link.href}
              className={`nav-link ${
                activePage === link.id
                  ? 'nav-link-active text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Right - Status + Search + Wallet */}
        <div className="flex items-center gap-2.5">
          {/* Block height indicator */}
          <div className="hidden items-center gap-2 rounded-xl border border-slate-800/50 bg-slate-900/30 px-3 py-1.5 lg:flex">
            <LiveDot color="green" size="sm" />
            <span className="text-xs font-medium tabular-nums text-slate-300">
              #{formatNumber(realTime.blockHeight)}
            </span>
          </div>

          {/* Search trigger */}
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-slate-800/50 bg-slate-900/30 px-3 py-1.5 text-slate-400 transition-all duration-300 hover:border-slate-700/50 hover:text-white"
          >
            <Search size={15} />
            <span className="hidden text-xs sm:inline-block">Search</span>
            <kbd className="hidden rounded-md border border-slate-700/50 bg-slate-800/40 px-1.5 py-0.5 text-[10px] text-slate-500 sm:inline-block">
              &#8984;K
            </kbd>
          </button>

          {/* Wallet */}
          <WalletButton />

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="rounded-lg p-2 text-slate-400 hover:text-white md:hidden"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="border-t border-slate-800/30 bg-[#050810]/98 backdrop-blur-xl md:hidden">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.id}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={`block px-6 py-3.5 text-sm font-medium transition-colors ${
                activePage === link.id
                  ? 'text-white bg-slate-800/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/20'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}

// ============================================================================
// Footer (Premium with Cruzible Logo)
// ============================================================================

const FOOTER_LINKS = {
  Protocol: [
    { label: 'Documentation', href: '#', icon: BookOpen },
    { label: 'Whitepaper', href: '#', icon: Shield },
    { label: 'GitHub', href: '#', icon: Code },
    { label: 'Block Explorer', href: '#', icon: Globe },
  ],
  Developers: [
    { label: 'API Reference', href: '#', icon: Zap },
    { label: 'SDK', href: '#', icon: Code },
    { label: 'Smart Contracts', href: '#', icon: Shield },
    { label: 'Faucet', href: '#', icon: Zap },
  ],
  Community: [
    { label: 'Discord', href: '#', icon: MessageCircle },
    { label: 'Twitter', href: '#', icon: Twitter },
    { label: 'Telegram', href: '#', icon: Send },
    { label: 'Forum', href: '#', icon: Globe },
  ],
  Legal: [
    { label: 'Terms of Service', href: '#' },
    { label: 'Privacy Policy', href: '#' },
    { label: 'Security', href: '#' },
    { label: 'Bug Bounty', href: '#' },
  ],
};

export function Footer() {
  return (
    <footer aria-label="Site footer" className="relative border-t border-slate-800/30 bg-[#050810]">
      {/* Top accent */}
      <div className="h-[1px] bg-gradient-to-r from-transparent via-brand-600/20 to-transparent" />

      {/* Ambient background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="ambient-orb ambient-orb-navy w-96 h-96 -bottom-48 -left-48 opacity-10 animate-orb-drift" />
        <div className="ambient-orb ambient-orb-red w-64 h-64 -bottom-32 right-0 opacity-10 animate-orb-drift-2" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        {/* Top section - Logo + tagline */}
        <div className="mb-12 flex flex-col items-start gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CruzibleLogo size={40} showText={true} textSize="text-lg" />
            <p className="mt-3 max-w-md text-sm text-slate-500 leading-relaxed">
              The sovereign liquid staking protocol for the Aethelred AI verification network.
              TEE-verified, trustless, and built for scale.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a href="#" className="btn-secondary flex items-center gap-2 text-xs">
              <BookOpen size={14} />
              Read Docs
            </a>
            <a href="#" className="btn-primary flex items-center gap-2 text-xs">
              Launch App
              <ArrowRight size={14} />
            </a>
          </div>
        </div>

        {/* Link columns */}
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {Object.entries(FOOTER_LINKS).map(([heading, links]) => (
            <div key={heading}>
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                {heading}
              </h3>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="group flex items-center gap-2 text-sm text-slate-500 transition-colors hover:text-white"
                    >
                      {'icon' in link && link.icon && (
                        <link.icon size={13} className="text-slate-600 transition-colors group-hover:text-slate-400" />
                      )}
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-slate-800/30 pt-8 sm:flex-row">
          <div className="flex items-center gap-3">
            <CruzibleLogo size={24} showText={false} />
            <p className="text-xs text-slate-600">
              &copy; {new Date().getFullYear()} Cruzible. Built by the Aethelred Foundation.
            </p>
          </div>

          <div className="flex items-center gap-4">
            {[
              { icon: Github, label: 'GitHub', href: '#' },
              { icon: Twitter, label: 'Twitter', href: '#' },
              { icon: MessageCircle, label: 'Discord', href: '#' },
              { icon: Send, label: 'Telegram', href: '#' },
            ].map(({ icon: Icon, label, href }) => (
              <a
                key={label}
                href={href}
                className="rounded-lg p-2 text-slate-600 transition-all duration-300 hover:bg-slate-800/30 hover:text-white"
                aria-label={label}
              >
                <Icon size={16} />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
