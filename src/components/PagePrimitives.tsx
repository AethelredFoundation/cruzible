'use client';

import React, { useState, useEffect } from 'react';
import { Copy, Check, CheckCircle, XCircle, Clock } from 'lucide-react';
import { BRAND } from '@/lib/constants';
import { copyToClipboard, formatFullNumber } from '@/lib/utils';

// ============================================================
// GlassCard — Premium glass-morphism card container
// ============================================================

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
  variant?: 'default' | 'gradient' | 'elevated';
}

export function GlassCard({ children, className = '', hover = true, onClick, variant = 'default' }: GlassCardProps) {
  const baseStyles = {
    default: 'bg-slate-900/50 backdrop-blur-xl border border-slate-800/40',
    gradient: 'gradient-border-card backdrop-blur-xl',
    elevated: 'bg-slate-900/60 backdrop-blur-xl border border-slate-700/30 shadow-premium',
  };

  const hoverStyles = hover
    ? 'hover:border-slate-700/50 hover:bg-slate-900/70 hover:shadow-premium transition-all duration-400'
    : '';

  return (
    <div
      onClick={onClick}
      className={`rounded-2xl ${baseStyles[variant]} ${hoverStyles} ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

// ============================================================
// CopyButton — Clipboard copy with visual feedback
// ============================================================

interface CopyButtonProps {
  text: string;
  onCopied?: () => void;
  size?: 'sm' | 'md';
  stopPropagation?: boolean;
}

export function CopyButton({ text, onCopied, size = 'sm', stopPropagation = true }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  const handleCopy = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    copyToClipboard(text);
    setCopied(true);
    onCopied?.();
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded-lg hover:bg-slate-700/40 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      title="Copy to clipboard"
      aria-label={copied ? 'Copied' : 'Copy to clipboard'}
    >
      {copied ? (
        <Check className={`${iconSize} text-emerald-400`} />
      ) : (
        <Copy className={`${iconSize} text-slate-500 hover:text-slate-300`} />
      )}
    </button>
  );
}

// ============================================================
// SectionHeader — Premium section titles with optional action
// ============================================================

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  size?: 'sm' | 'lg';
}

export function SectionHeader({ title, subtitle, action, size = 'lg' }: SectionHeaderProps) {
  return (
    <div className={`flex items-end justify-between ${size === 'lg' ? 'mb-8' : 'mb-6'}`}>
      <div>
        <h2 className={`font-display font-bold text-white tracking-tight ${size === 'lg' ? 'text-2xl' : 'text-xl'}`}>
          {title}
        </h2>
        {subtitle && <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ============================================================
// Sparkline — Mini inline chart with hydration safety
// ============================================================

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
  showGradient?: boolean;
}

export function Sparkline({ data, color = BRAND.red, height = 32, width = 80, showGradient = false }: SparklineProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <svg width={width} height={height} aria-hidden="true" />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`)
    .join(' ');

  const gradientId = `sparkGrad-${color.replace('#', '')}`;

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      {showGradient && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
      )}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 3px ${color}40)` }}
      />
    </svg>
  );
}

// ============================================================
// ChartTooltip — Premium recharts custom tooltip
// ============================================================

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ color: string; name: string; value: number | string }>;
  label?: string;
  formatValue?: (value: number | string) => string;
}

export function ChartTooltip({ active, payload, label, formatValue }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const fmt = formatValue || ((v: number | string) => (typeof v === 'number' ? formatFullNumber(v) : v));
  return (
    <div className="bg-slate-900/95 backdrop-blur-xl text-white px-4 py-3 rounded-xl text-xs shadow-premium-lg border border-slate-700/30">
      {label && <p className="font-medium mb-1.5 text-slate-300">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color, boxShadow: `0 0 4px ${entry.color}40` }} />
          <span className="text-slate-400">{entry.name}:</span>
          <span className="font-medium text-white">{fmt(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

// ============================================================
// StatusBadge — Premium status indicator badge
// ============================================================

interface StatusBadgeProps {
  status: string;
  styles?: Record<string, { bg: string; text: string; dot: string }>;
}

const DEFAULT_STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  Success: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  Verified: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  Completed: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  Active: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  active: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  Voting: { bg: 'bg-blue-500/15', text: 'text-blue-400', dot: 'bg-blue-400' },
  Failed: { bg: 'bg-red-500/15', text: 'text-red-400', dot: 'bg-red-400' },
  Rejected: { bg: 'bg-red-500/15', text: 'text-red-400', dot: 'bg-red-400' },
  jailed: { bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-400' },
  Pending: { bg: 'bg-amber-500/15', text: 'text-amber-400', dot: 'bg-amber-400' },
  Processing: { bg: 'bg-amber-500/15', text: 'text-amber-400', dot: 'bg-amber-400' },
  inactive: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', dot: 'bg-yellow-400' },
  Queued: { bg: 'bg-purple-500/15', text: 'text-purple-400', dot: 'bg-purple-400' },
  Executed: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', dot: 'bg-cyan-400' },
};

export function StatusBadge({ status, styles }: StatusBadgeProps) {
  const styleMap = styles || DEFAULT_STATUS_STYLES;
  const s = styleMap[status] || { bg: 'bg-slate-700/40', text: 'text-slate-300', dot: 'bg-slate-400' };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ring-white/5 ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${
        status === 'active' || status === 'Active' || status === 'Processing'
          ? 'animate-pulse shadow-[0_0_4px_currentColor]'
          : ''
      }`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
