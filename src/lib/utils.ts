// ============================================================
// AethelVault Shared Utilities
// Consolidated from duplicated implementations across pages
// ============================================================

/**
 * Deterministic pseudo-random number generator using sine function.
 * Used for generating consistent mock data across SSR and client.
 */
export function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * Generate a random float in [min, max) range from a seed.
 */
export function seededRange(seed: number, min: number, max: number): number {
  return min + seededRandom(seed) * (max - min);
}

/**
 * Generate a random integer in [min, max] range from a seed.
 */
export function seededInt(seed: number, min: number, max: number): number {
  return Math.floor(seededRange(seed, min, max + 1));
}

/**
 * Generate a hexadecimal string of given length from a seed.
 */
export function seededHex(seed: number, length: number): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(seededRandom(seed + i * 7 + 3) * chars.length)];
  }
  return result;
}

/**
 * Generate an Aethelred-style address from a seed.
 */
export function seededAddress(seed: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let addr = 'aeth1';
  for (let i = 0; i < 38; i++) {
    addr += chars[Math.floor(seededRandom(seed + i + 1) * chars.length)];
  }
  return addr;
}

/**
 * Format a number with compact notation (K, M, B suffixes).
 * @param n - The number to format
 * @param decimals - Number of decimal places (defaults: B=2, M=1, K=1, else=0)
 */
export function formatNumber(n: number, decimals = 0): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals > 0 ? decimals : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(decimals > 0 ? decimals : 1)}K`;
  return n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format a number using locale-aware full formatting (e.g., 1,234,567).
 */
export function formatFullNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Truncate a long address/hash for display.
 * @param addr - The full address string
 * @param startLen - Characters to show at the start (default: 10)
 * @param endLen - Characters to show at the end (default: 6)
 */
export function truncateAddress(addr: string, startLen = 10, endLen = 6): string {
  if (addr.length <= startLen + endLen + 3) return addr;
  return `${addr.slice(0, startLen)}...${addr.slice(-endLen)}`;
}

/**
 * Copy text to clipboard with error suppression.
 */
export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text).catch(() => {});
}
