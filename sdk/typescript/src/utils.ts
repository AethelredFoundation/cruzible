import { createHash } from "node:crypto";

import type { IntegerLike } from "./types";

export function stripHexPrefix(value: string): string {
  return value.startsWith("0x") || value.startsWith("0X")
    ? value.slice(2)
    : value;
}

export function bytesToHex(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = stripHexPrefix(hex).toLowerCase();
  if (normalized.length === 0) {
    return new Uint8Array();
  }
  if (normalized.length % 2 !== 0 || !/^[0-9a-f]+$/.test(normalized)) {
    throw new Error(`invalid hex: ${hex}`);
  }
  return Uint8Array.from(Buffer.from(normalized, "hex"));
}

export function sha256Bytes(data: Uint8Array): Uint8Array {
  return Uint8Array.from(createHash("sha256").update(data).digest());
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function utf8Bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "utf8"));
}

export function bigintFrom(value: IntegerLike): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`expected integer-like number, got ${value}`);
    }
    return BigInt(value);
  }
  return BigInt(value);
}

export function encodeUint256(value: IntegerLike): Uint8Array {
  const bigint = bigintFrom(value);
  if (bigint < 0n) {
    throw new Error("uint256 cannot be negative");
  }
  const out = new Uint8Array(32);
  let current = bigint;
  for (let i = 31; i >= 0 && current > 0n; i -= 1) {
    out[i] = Number(current & 0xffn);
    current >>= 8n;
  }
  if (current !== 0n) {
    throw new Error("integer exceeds 32-byte uint256");
  }
  return out;
}

export function encodeU64Word(value: IntegerLike): Uint8Array {
  const out = new Uint8Array(32);
  const bigint = bigintFrom(value);
  if (bigint < 0n || bigint > 0xffff_ffff_ffff_ffffn) {
    throw new Error("value exceeds uint64");
  }
  let current = bigint;
  for (let i = 31; i >= 24 && current > 0n; i -= 1) {
    out[i] = Number(current & 0xffn);
    current >>= 8n;
  }
  return out;
}

export function encodeFloat64BE(value: number): Uint8Array {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, false);
  return new Uint8Array(buffer);
}

export function padBytes32(hex: string): Uint8Array {
  const bytes = hexToBytes(hex);
  if (bytes.length > 32) {
    throw new Error(`value exceeds bytes32: ${hex}`);
  }
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
}

export function padAddressish32(value: string): Uint8Array {
  const normalized = stripHexPrefix(value);
  let addressBytes: Uint8Array;
  if (/^[0-9a-fA-F]+$/.test(normalized) && normalized.length % 2 === 0) {
    const parsed = Uint8Array.from(Buffer.from(normalized, "hex"));
    if (parsed.length <= 32) {
      addressBytes = parsed;
    } else {
      addressBytes = sha256Bytes(utf8Bytes(value)).slice(0, 20);
    }
  } else {
    addressBytes = sha256Bytes(utf8Bytes(value)).slice(0, 20);
  }
  const out = new Uint8Array(32);
  out.set(addressBytes.slice(0, 32), 32 - Math.min(addressBytes.length, 32));
  return out;
}

export function teePublicKeyBytes32(value: string): Uint8Array {
  const normalized = stripHexPrefix(value);
  const out = new Uint8Array(32);
  if (!/^[0-9a-fA-F]*$/.test(normalized) || normalized.length % 2 !== 0) {
    return out;
  }
  const bytes = Uint8Array.from(Buffer.from(normalized, "hex"));
  out.set(bytes.slice(0, 32), 0);
  return out;
}

export function parseAddressBytes20(value: string): Uint8Array {
  const normalized = stripHexPrefix(value).toLowerCase();
  if (!/^[0-9a-f]*$/.test(normalized) || normalized.length % 2 !== 0) {
    return new Uint8Array(20);
  }
  const bytes = Uint8Array.from(Buffer.from(normalized, "hex"));
  if (bytes.length === 20) {
    return bytes;
  }
  if (bytes.length < 20) {
    const out = new Uint8Array(20);
    out.set(bytes, 20 - bytes.length);
    return out;
  }
  return new Uint8Array(20);
}

export function xorBytes32(into: Uint8Array, chunk: Uint8Array): void {
  if (into.length !== 32 || chunk.length !== 32) {
    throw new Error("xorBytes32 requires two 32-byte arrays");
  }
  for (let index = 0; index < 32; index += 1) {
    into[index] ^= chunk[index];
  }
}
