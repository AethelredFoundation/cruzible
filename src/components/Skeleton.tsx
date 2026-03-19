import React from "react";

/**
 * Animated skeleton line placeholder.
 * Uses the .skeleton CSS class defined in globals.css.
 */
export function SkeletonLine({
  width = "100%",
  height = "1rem",
  className = "",
}: {
  width?: string;
  height?: string;
  className?: string;
}) {
  return (
    <div
      className={`skeleton rounded ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/**
 * Skeleton card placeholder matching GlassCard dimensions.
 */
export function SkeletonCard({
  height = "12rem",
  className = "",
}: {
  height?: string;
  className?: string;
}) {
  return (
    <div
      className={`skeleton rounded-2xl border border-slate-700/30 ${className}`}
      style={{ height }}
      aria-hidden="true"
    />
  );
}

/**
 * Skeleton table with configurable row count.
 */
export function SkeletonTable({
  rows = 5,
  columns = 4,
  className = "",
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-3 ${className}`} aria-hidden="true">
      {/* Header */}
      <div className="flex gap-4">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="skeleton rounded h-4 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex gap-4">
          {Array.from({ length: columns }).map((_, col) => (
            <div
              key={col}
              className="skeleton rounded h-8"
              style={{ flex: col === 0 ? 2 : 1, opacity: 1 - row * 0.1 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton chart placeholder.
 */
export function SkeletonChart({
  height = 200,
  className = "",
}: {
  height?: number;
  className?: string;
}) {
  return (
    <div
      className={`skeleton rounded-xl ${className}`}
      style={{ height }}
      aria-hidden="true"
    />
  );
}

/**
 * Skeleton stats row (for the 4-stat grid at top of pages).
 */
export function SkeletonStats({
  count = 4,
  className = "",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-2 md:grid-cols-${count} gap-4 ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="skeleton rounded-2xl h-28 border border-slate-700/30"
        />
      ))}
    </div>
  );
}
