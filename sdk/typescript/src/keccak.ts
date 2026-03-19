const MASK_64 = (1n << 64n) - 1n;
const RATE_BYTES = 136;

const ROUND_CONSTANTS = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
] as const;

const ROTATION_OFFSETS = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18,
  2, 61, 56, 14,
] as const;

function rotl64(value: bigint, shift: number): bigint {
  if (shift === 0) {
    return value & MASK_64;
  }
  const amount = BigInt(shift);
  return ((value << amount) | (value >> (64n - amount))) & MASK_64;
}

function readLaneLE(bytes: Uint8Array, offset: number): bigint {
  let lane = 0n;
  for (let index = 0; index < 8; index += 1) {
    lane |= BigInt(bytes[offset + index] ?? 0) << (8n * BigInt(index));
  }
  return lane;
}

function writeLaneLE(lane: bigint, out: Uint8Array, offset: number): void {
  let value = lane & MASK_64;
  for (let index = 0; index < 8; index += 1) {
    out[offset + index] = Number(value & 0xffn);
    value >>= 8n;
  }
}

function keccakF1600(state: bigint[]): void {
  for (const roundConstant of ROUND_CONSTANTS) {
    const c = new Array<bigint>(5);
    const d = new Array<bigint>(5);

    for (let x = 0; x < 5; x += 1) {
      c[x] =
        state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }

    for (let x = 0; x < 5; x += 1) {
      d[x] = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
    }

    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        state[x + 5 * y] ^= d[x];
      }
    }

    const b = new Array<bigint>(25).fill(0n);
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const index = x + 5 * y;
        const newX = y;
        const newY = (2 * x + 3 * y) % 5;
        b[newX + 5 * newY] = rotl64(state[index], ROTATION_OFFSETS[index]);
      }
    }

    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        state[x + 5 * y] =
          b[x + 5 * y] ^
          (~b[((x + 1) % 5) + 5 * y] & MASK_64 & b[((x + 2) % 5) + 5 * y]);
      }
    }

    state[0] ^= roundConstant;
  }
}

export function keccak256(data: Uint8Array): Uint8Array {
  const state = new Array<bigint>(25).fill(0n);
  const padded = new Uint8Array(
    data.length +
      1 +
      ((RATE_BYTES - ((data.length + 1) % RATE_BYTES)) % RATE_BYTES),
  );
  padded.set(data, 0);
  padded[data.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  for (let offset = 0; offset < padded.length; offset += RATE_BYTES) {
    for (let lane = 0; lane < RATE_BYTES / 8; lane += 1) {
      state[lane] ^= readLaneLE(padded, offset + lane * 8);
    }
    keccakF1600(state);
  }

  const output = new Uint8Array(32);
  for (let lane = 0; lane < 4; lane += 1) {
    writeLaneLE(state[lane], output, lane * 8);
  }
  return output;
}
