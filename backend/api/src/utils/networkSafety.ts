import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/u, "$1");
}

function isReservedTestHostname(hostname: string): boolean {
  return (
    hostname === "example" ||
    hostname.endsWith(".example") ||
    hostname === "invalid" ||
    hostname.endsWith(".invalid") ||
    hostname === "test" ||
    hostname.endsWith(".test")
  );
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
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function ipv4ToHextets(address: string): [number, number] | null {
  const octets = parseIpv4(address);
  if (!octets) {
    return null;
  }

  return [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
}

function parseHextet(value: string): number | null {
  if (!/^[0-9a-f]{1,4}$/iu.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 16);
  return Number.isFinite(parsed) ? parsed : null;
}

function expandIpv6Hextets(address: string): number[] | null {
  let normalized = normalizeHostname(address).split("%", 1)[0];
  const ipv4Tail = normalized.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/u);
  const convertedIpv4Tail = ipv4Tail ? ipv4ToHextets(ipv4Tail[2]) : null;

  if (ipv4Tail) {
    if (!convertedIpv4Tail) {
      return null;
    }

    normalized = `${ipv4Tail[1]}${convertedIpv4Tail
      .map((hextet) => hextet.toString(16))
      .join(":")}`;
  }

  const compressionParts = normalized.split("::");
  if (compressionParts.length > 2) {
    return null;
  }

  const left =
    compressionParts[0] === "" ? [] : compressionParts[0].split(":");
  const right =
    compressionParts.length === 1 || compressionParts[1] === ""
      ? []
      : compressionParts[1].split(":");

  const missing =
    compressionParts.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0) {
    return null;
  }

  const parts =
    compressionParts.length === 2
      ? [...left, ...Array<string>(missing).fill("0"), ...right]
      : left;

  if (parts.length !== 8) {
    return null;
  }

  const hextets = parts.map(parseHextet);
  return hextets.every((hextet): hextet is number => hextet !== null)
    ? hextets
    : null;
}

function ipv4FromMappedIpv6(hextets: number[]): string | null {
  const isMapped =
    hextets.slice(0, 5).every((hextet) => hextet === 0) &&
    hextets[5] === 0xffff;

  if (!isMapped) {
    return null;
  }

  return [
    hextets[6] >> 8,
    hextets[6] & 0xff,
    hextets[7] >> 8,
    hextets[7] & 0xff,
  ].join(".");
}

function isPrivateOrReservedIpv6(address: string): boolean {
  const normalized = normalizeHostname(address).split("%", 1)[0];
  if (isIP(normalized) !== 6) {
    return false;
  }

  const hextets = expandIpv6Hextets(normalized);
  if (!hextets) {
    return false;
  }

  const [firstHextet, secondHextet, thirdHextet] = hextets;
  const isUnspecified = hextets.every((hextet) => hextet === 0);
  const isLoopback =
    hextets.slice(0, 7).every((hextet) => hextet === 0) && hextets[7] === 1;

  if (isUnspecified || isLoopback) {
    return true;
  }

  const mappedAddress = ipv4FromMappedIpv6(hextets);
  if (mappedAddress) {
    return isPrivateOrLocalAddress(mappedAddress);
  }

  return (
    (firstHextet === 0x0100 &&
      hextets.slice(1, 4).every((hextet) => hextet === 0)) ||
    (firstHextet === 0x0064 &&
      secondHextet === 0xff9b &&
      hextets.slice(2, 6).every((hextet) => hextet === 0)) ||
    (firstHextet & 0xfe00) === 0xfc00 ||
    (firstHextet & 0xffc0) === 0xfe80 ||
    (firstHextet & 0xff00) === 0xff00 ||
    (firstHextet === 0x2001 && secondHextet < 0x0200) ||
    (firstHextet === 0x2001 && secondHextet === 0x0db8) ||
    firstHextet === 0x2002 ||
    (firstHextet === 0x64 &&
      secondHextet === 0xff9b &&
      thirdHextet === 0x0001)
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
    isReservedTestHostname(normalized) ||
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
