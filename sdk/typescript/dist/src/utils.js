"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripHexPrefix = stripHexPrefix;
exports.bytesToHex = bytesToHex;
exports.hexToBytes = hexToBytes;
exports.sha256Bytes = sha256Bytes;
exports.concatBytes = concatBytes;
exports.utf8Bytes = utf8Bytes;
exports.bigintFrom = bigintFrom;
exports.encodeUint256 = encodeUint256;
exports.encodeU64Word = encodeU64Word;
exports.encodeFloat64BE = encodeFloat64BE;
exports.padBytes32 = padBytes32;
exports.padAddressish32 = padAddressish32;
exports.teePublicKeyBytes32 = teePublicKeyBytes32;
exports.parseAddressBytes20 = parseAddressBytes20;
exports.xorBytes32 = xorBytes32;
const node_crypto_1 = require("node:crypto");
function stripHexPrefix(value) {
    return value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
}
function bytesToHex(bytes) {
    return `0x${Buffer.from(bytes).toString("hex")}`;
}
function hexToBytes(hex) {
    const normalized = stripHexPrefix(hex).toLowerCase();
    if (normalized.length === 0) {
        return new Uint8Array();
    }
    if (normalized.length % 2 !== 0 || !/^[0-9a-f]+$/.test(normalized)) {
        throw new Error(`invalid hex: ${hex}`);
    }
    return Uint8Array.from(Buffer.from(normalized, "hex"));
}
function sha256Bytes(data) {
    return Uint8Array.from((0, node_crypto_1.createHash)("sha256").update(data).digest());
}
function concatBytes(...chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}
function utf8Bytes(value) {
    return Uint8Array.from(Buffer.from(value, "utf8"));
}
function bigintFrom(value) {
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
function encodeUint256(value) {
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
function encodeU64Word(value) {
    const out = new Uint8Array(32);
    const bigint = bigintFrom(value);
    if (bigint < 0n || bigint > 0xffffffffffffffffn) {
        throw new Error("value exceeds uint64");
    }
    let current = bigint;
    for (let i = 31; i >= 24 && current > 0n; i -= 1) {
        out[i] = Number(current & 0xffn);
        current >>= 8n;
    }
    return out;
}
function encodeFloat64BE(value) {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value, false);
    return new Uint8Array(buffer);
}
function padBytes32(hex) {
    const bytes = hexToBytes(hex);
    if (bytes.length > 32) {
        throw new Error(`value exceeds bytes32: ${hex}`);
    }
    const out = new Uint8Array(32);
    out.set(bytes, 32 - bytes.length);
    return out;
}
function padAddressish32(value) {
    const normalized = stripHexPrefix(value);
    let addressBytes;
    if (/^[0-9a-fA-F]+$/.test(normalized) && normalized.length % 2 === 0) {
        const parsed = Uint8Array.from(Buffer.from(normalized, "hex"));
        if (parsed.length <= 32) {
            addressBytes = parsed;
        }
        else {
            addressBytes = sha256Bytes(utf8Bytes(value)).slice(0, 20);
        }
    }
    else {
        addressBytes = sha256Bytes(utf8Bytes(value)).slice(0, 20);
    }
    const out = new Uint8Array(32);
    out.set(addressBytes.slice(0, 32), 32 - Math.min(addressBytes.length, 32));
    return out;
}
function teePublicKeyBytes32(value) {
    const normalized = stripHexPrefix(value);
    const out = new Uint8Array(32);
    if (!/^[0-9a-fA-F]*$/.test(normalized) || normalized.length % 2 !== 0) {
        return out;
    }
    const bytes = Uint8Array.from(Buffer.from(normalized, "hex"));
    out.set(bytes.slice(0, 32), 0);
    return out;
}
function parseAddressBytes20(value) {
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
function xorBytes32(into, chunk) {
    if (into.length !== 32 || chunk.length !== 32) {
        throw new Error("xorBytes32 requires two 32-byte arrays");
    }
    for (let index = 0; index < 32; index += 1) {
        into[index] ^= chunk[index];
    }
}
