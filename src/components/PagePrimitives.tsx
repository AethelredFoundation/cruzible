"use client";

import React, { useState, useEffect } from "react";
import { Copy, Check, CheckCircle, XCircle, Clock } from "lucide-react";
import { BRAND } from "@/lib/constants";
import { copyToClipboard, formatFullNumber } from "@/lib/utils";

// ============================================================
// GlassCard — Shared glass-morphism card container
// ============================================================

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  hover?: boolean;
}

export function GlassCard({
  children,
  className = "",
  hover = true,
  onClick,
  ...props
}: GlassCardProps) {
  return (
    <div
      onClick={onClick}
      {...props}
      className={`bg-slate-900/60 backdrop-blur-xl border border-slate-700/50 rounded-2xl ${
        hover
          ? "hover:border-slate-600/60 hover:bg-slate-900/70 transition-all duration-300"
          : ""
      } ${onClick ? "cursor-pointer" : ""} ${className}`}
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
  size?: "sm" | "md";
  stopPropagation?: boolean;
}

export function CopyButton({
  text,
  onCopied,
  size = "sm",
  stopPropagation = true,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";

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
      className="p-1 rounded hover:bg-slate-700/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      title="Copy to clipboard"
      aria-label={copied ? "Copied" : "Copy to clipboard"}
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
// SectionHeader — Consistent section titles with optional action
// ============================================================

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  size?: "sm" | "lg";
}

export function SectionHeader({
  title,
  subtitle,
  action,
  size = "lg",
}: SectionHeaderProps) {
  return (
    <div
      className={`flex items-end justify-between ${size === "lg" ? "mb-8" : "mb-6"}`}
    >
      <div>
        <h2
          className={`font-bold text-white tracking-tight ${size === "lg" ? "text-2xl" : "text-xl"}`}
        >
          {title}
        </h2>
        {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
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

export function Sparkline({
  data,
  color = BRAND.red,
  height = 32,
  width = 80,
  showGradient = false,
}: SparklineProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <svg width={width} height={height} aria-hidden="true" />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map(
      (v, i) =>
        `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`,
    )
    .join(" ");

  const gradientId = `sparkGrad-${color.replace("#", "")}`;

  return (
    <svg
      width={width}
      height={height}
      className="overflow-visible"
      aria-hidden="true"
    >
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
      />
    </svg>
  );
}

// ============================================================
// ChartTooltip — Shared recharts custom tooltip
// ============================================================

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ color: string; name: string; value: number | string }>;
  label?: string;
  formatValue?: (value: number | string) => string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const fmt =
    formatValue ||
    ((v: number | string) => (typeof v === "number" ? formatFullNumber(v) : v));
  return (
    <div className="bg-slate-800 text-white px-3 py-2 rounded-lg text-xs shadow-xl border border-slate-700">
      {label && <p className="font-medium mb-1">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          {entry.name}: {fmt(entry.value)}
        </p>
      ))}
    </div>
  );
}

// ============================================================
// StatusBadge — Generic status indicator badge
// ============================================================

interface StatusBadgeProps {
  status: string;
  styles?: Record<string, { bg: string; text: string; dot: string }>;
}

const DEFAULT_STATUS_STYLES: Record<
  string,
  { bg: string; text: string; dot: string }
> = {
  Success: {
    bg: "bg-emerald-500/20",
    text: "text-emerald-400",
    dot: "bg-emerald-400",
  },
  Verified: {
    bg: "bg-emerald-500/20",
    text: "text-emerald-400",
    dot: "bg-emerald-400",
  },
  Completed: {
    bg: "bg-emerald-500/20",
    text: "text-emerald-400",
    dot: "bg-emerald-400",
  },
  Active: {
    bg: "bg-emerald-500/20",
    text: "text-emerald-400",
    dot: "bg-emerald-400",
  },
  active: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    dot: "bg-emerald-400",
  },
  Voting: { bg: "bg-blue-500/20", text: "text-blue-400", dot: "bg-blue-400" },
  Failed: { bg: "bg-red-500/20", text: "text-red-400", dot: "bg-red-400" },
  Rejected: { bg: "bg-red-500/20", text: "text-red-400", dot: "bg-red-400" },
  jailed: { bg: "bg-red-500/10", text: "text-red-400", dot: "bg-red-400" },
  Pending: {
    bg: "bg-amber-500/20",
    text: "text-amber-400",
    dot: "bg-amber-400",
  },
  Processing: {
    bg: "bg-amber-500/20",
    text: "text-amber-400",
    dot: "bg-amber-400",
  },
  inactive: {
    bg: "bg-yellow-500/10",
    text: "text-yellow-400",
    dot: "bg-yellow-400",
  },
  Queued: {
    bg: "bg-purple-500/20",
    text: "text-purple-400",
    dot: "bg-purple-400",
  },
  Executed: { bg: "bg-cyan-500/20", text: "text-cyan-400", dot: "bg-cyan-400" },
};

export function StatusBadge({ status, styles }: StatusBadgeProps) {
  const styleMap = styles || DEFAULT_STATUS_STYLES;
  const s = styleMap[status] || {
    bg: "bg-slate-700/50",
    text: "text-slate-300",
    dot: "bg-slate-400",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ring-white/10 ${s.bg} ${s.text}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${s.dot} ${status === "active" || status === "Active" ? "animate-pulse" : ""}`}
      />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
