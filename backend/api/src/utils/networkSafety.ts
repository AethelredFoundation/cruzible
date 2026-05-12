import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/u, "$1");
}

function parseIpv4(address: string): number[] | null {
  if (isIP(address) !== 4) {
    return null;
  }

  const octets = address.split(".").map((octet) => Number(octet));
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet))
    ? octets
    : null;
}

function isPrivateOrReservedIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) {
    return false;
  }

  const [a, b, c] = octets;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function ipv6FirstHextet(address: string): number {
  const first = address.split(":")[0] || "0";
  const parsed = Number.parseInt(first, 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPrivateOrReservedIpv6(address: string): boolean {
  const normalized = normalizeHostname(address).split("%", 1)[0];
  if (isIP(normalized) !== 6) {
    return false;
  }

  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  if (normalized.startsWith("::ffff:")) {
    const mappedAddress = normalized.slice("::ffff:".length);
    return isPrivateOrLocalAddress(mappedAddress);
  }

  const firstHextet = ipv6FirstHextet(normalized);

  return (
    (firstHextet & 0xfe00) === 0xfc00 ||
    (firstHextet & 0xffc0) === 0xfe80 ||
    (firstHextet & 0xff00) === 0xff00 ||
    normalized.startsWith("2001:db8:")
  );
}

export function isPrivateOrLocalAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  return (
    isPrivateOrReservedIpv4(normalized) || isPrivateOrReservedIpv6(normalized)
  );
}

export function isPrivateOrLocalHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);

  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    isPrivateOrLocalAddress(normalized)
  );
}

export async function assertPublicHostnameResolution(
  hostname: string,
  label: string,
): Promise<void> {
  const normalized = normalizeHostname(hostname);

  if (isPrivateOrLocalHostname(normalized)) {
    throw new Error(`${label} resolves to a private or local address`);
  }

  const records = await lookup(normalized, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new Error(`${label} did not resolve to any addresses`);
  }

  const unsafeRecord = records.find((record) =>
    isPrivateOrLocalAddress(record.address),
  );
  if (unsafeRecord) {
    throw new Error(`${label} resolves to a private or local address`);
  }
}
