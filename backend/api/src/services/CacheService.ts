import { singleton } from "tsyringe";
import Redis from "ioredis";

import { config } from "../config";
import { logger } from "../utils/logger";
import { errorContext } from "../utils/errorContext";

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

type MemoryLease = {
  expiresAt: number;
  owner: string;
};

type CacheEnvelope = {
  value: unknown;
};
type CacheKeyPart = string | number | boolean | null | undefined;

const CACHE_KEY_PREFIX = "cruzible:api:";
const MAX_MEMORY_CACHE_ENTRIES = 1_000;

export function buildCacheKey(...parts: readonly CacheKeyPart[]): string {
  return parts
    .map((part) =>
      encodeURIComponent(
        part === null || part === undefined ? "null" : String(part),
      ),
    )
    .join(":");
}

@singleton()
export class CacheService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly leases = new Map<string, MemoryLease>();
  private readonly actionClaims = new Map<string, number>();
  private redis: Redis | null = null;

  async connect(): Promise<void> {
    if (!config.redisUrl || this.redis) {
      return;
    }

    const redis = new Redis(config.redisUrl, {
      enableReadyCheck: true,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });

    redis.on("error", (error) => {
      logger.warn("Redis cache client error", errorContext(error));
    });

    try {
      await redis.connect();
      await redis.ping();
      this.redis = redis;
      logger.info("Redis cache connected");
    } catch (error) {
      redis.disconnect();

      if (config.isProduction) {
        throw Object.assign(new Error("Redis cache connection failed"), {
          cause: error,
        });
      }

      logger.warn(
        "Redis cache unavailable; using in-memory fallback",
        errorContext(error),
      );
    }
  }

  async disconnect(): Promise<void> {
    this.cache.clear();
    this.leases.clear();
    this.actionClaims.clear();

    if (!this.redis) {
      return;
    }

    const redis = this.redis;
    this.redis = null;

    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.redis) {
      try {
        const cached = await this.redis.get(this.formatKey(key));
        if (cached !== null) {
          return this.deserialize<T>(cached);
        }
      } catch (error) {
        logger.warn("Redis cache read failed; using in-memory fallback", {
          key,
          ...errorContext(error),
        });
      }
    }

    return this.getMemoryEntry<T>(key);
  }

  private getMemoryEntry<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const ttl = Math.floor(ttlSeconds);
    const expiresAt = Date.now() + ttl * 1000;

    if (ttl <= 0) {
      this.cache.delete(key);

      if (this.redis) {
        try {
          await this.redis.del(this.formatKey(key));
        } catch (error) {
          logger.warn("Redis cache delete failed", {
            key,
            ...errorContext(error),
          });
        }
      }

      return;
    }

    if (this.redis) {
      try {
        await this.redis.set(
          this.formatKey(key),
          this.serialize(value),
          "EX",
          ttl,
        );
        this.cache.delete(key);
        return;
      } catch (error) {
        logger.warn(
          "Redis cache write failed; retained bounded in-memory fallback",
          {
            key,
            ...errorContext(error),
          },
        );
      }
    }

    this.setMemoryEntry(key, value, expiresAt);
  }

  /**
   * Acquire a process-fencing lease. Unlike ordinary cache writes, lease
   * operations never fall back to process-local memory after a connected
   * Redis client errors: doing so could create two leaders during a network
   * partition. Memory leases are used only when Redis was never configured,
   * which is forbidden by production configuration validation.
   */
  async tryAcquireLease(
    key: string,
    owner: string,
    ttlMs: number,
  ): Promise<boolean> {
    this.assertValidLeaseInput(key, owner, ttlMs);
    const redisKey = this.formatKey(`lease:${key}`);

    if (this.redis) {
      try {
        const result = await this.redis.set(
          redisKey,
          owner,
          "PX",
          Math.floor(ttlMs),
          "NX",
        );
        return result === "OK";
      } catch (error) {
        logger.error("Redis lease acquisition failed closed", {
          key,
          ...errorContext(error),
        });
        return false;
      }
    }

    if (config.isProduction) {
      logger.error("Redis lease backend is unavailable in production", {
        key,
      });
      return false;
    }

    const now = Date.now();
    const current = this.leases.get(key);
    if (current && current.expiresAt > now) {
      return false;
    }

    this.leases.set(key, {
      owner,
      expiresAt: now + Math.floor(ttlMs),
    });
    return true;
  }

  async renewLease(
    key: string,
    owner: string,
    ttlMs: number,
  ): Promise<boolean> {
    this.assertValidLeaseInput(key, owner, ttlMs);
    const redisKey = this.formatKey(`lease:${key}`);

    if (this.redis) {
      try {
        const result = await this.redis.eval(
          `if redis.call("GET", KEYS[1]) == ARGV[1] then
             return redis.call("PEXPIRE", KEYS[1], ARGV[2])
           end
           return 0`,
          1,
          redisKey,
          owner,
          String(Math.floor(ttlMs)),
        );
        return Number(result) === 1;
      } catch (error) {
        logger.error("Redis lease renewal failed closed", {
          key,
          ...errorContext(error),
        });
        return false;
      }
    }

    if (config.isProduction) {
      return false;
    }

    const now = Date.now();
    const current = this.leases.get(key);
    if (!current) {
      return false;
    }
    if (current.expiresAt <= now) {
      this.leases.delete(key);
      return false;
    }
    if (current.owner !== owner) {
      return false;
    }

    current.expiresAt = now + Math.floor(ttlMs);
    return true;
  }

  async releaseLease(key: string, owner: string): Promise<boolean> {
    if (!key || !owner) {
      throw new Error("Lease key and owner must be non-empty");
    }
    const redisKey = this.formatKey(`lease:${key}`);

    if (this.redis) {
      try {
        const result = await this.redis.eval(
          `if redis.call("GET", KEYS[1]) == ARGV[1] then
             return redis.call("DEL", KEYS[1])
           end
           return 0`,
          1,
          redisKey,
          owner,
        );
        return Number(result) === 1;
      } catch (error) {
        logger.error("Redis lease release failed closed", {
          key,
          ...errorContext(error),
        });
        return false;
      }
    }

    if (config.isProduction) {
      return false;
    }

    const current = this.leases.get(key);
    if (!current || current.owner !== owner) {
      return false;
    }

    this.leases.delete(key);
    return true;
  }

  async isLeaseOwner(key: string, owner: string): Promise<boolean> {
    if (!key || !owner) {
      throw new Error("Lease key and owner must be non-empty");
    }
    const redisKey = this.formatKey(`lease:${key}`);

    if (this.redis) {
      try {
        return (await this.redis.get(redisKey)) === owner;
      } catch (error) {
        logger.error("Redis lease ownership check failed closed", {
          key,
          ...errorContext(error),
        });
        return false;
      }
    }

    if (config.isProduction) {
      return false;
    }

    const current = this.leases.get(key);
    if (!current) return false;
    if (current.expiresAt <= Date.now()) {
      this.leases.delete(key);
      return false;
    }
    return current.owner === owner;
  }

  /** Atomically publish shared state only while `owner` still holds `leaseKey`. */
  async publishWhileLeaseOwner(
    leaseKey: string,
    owner: string,
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<boolean> {
    const ttl = Math.floor(ttlSeconds);
    if (!leaseKey || !owner || !key || ttl <= 0) {
      throw new Error(
        "Lease key, owner, publication key, and a positive TTL are required",
      );
    }

    const formattedLeaseKey = this.formatKey(`lease:${leaseKey}`);
    const formattedValueKey = this.formatKey(key);
    const serialized = this.serialize(value);

    if (this.redis) {
      try {
        const result = await this.redis.eval(
          `if redis.call("GET", KEYS[1]) ~= ARGV[1] then
             return 0
           end
           redis.call("SET", KEYS[2], ARGV[2], "EX", ARGV[3])
           return 1`,
          2,
          formattedLeaseKey,
          formattedValueKey,
          owner,
          serialized,
          String(ttl),
        );
        return Number(result) === 1;
      } catch (error) {
        logger.error("Redis fenced publication failed closed", {
          key,
          ...errorContext(error),
        });
        return false;
      }
    }

    if (config.isProduction || !(await this.isLeaseOwner(leaseKey, owner))) {
      return false;
    }

    this.setMemoryEntry(key, value, Date.now() + ttl * 1000);
    return true;
  }

  /**
   * Atomically claim an idempotent side effect while a lease is still held.
   * A successful claim may be delivered after lease expiry, but no replacement
   * leader can claim the same generation/action a second time.
   */
  async claimLeaseAction(
    leaseKey: string,
    owner: string,
    actionKey: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const ttl = Math.floor(ttlSeconds);
    if (!leaseKey || !owner || !actionKey || ttl <= 0) {
      throw new Error(
        "Lease key, owner, action key, and a positive TTL are required",
      );
    }

    const formattedLeaseKey = this.formatKey(`lease:${leaseKey}`);
    const formattedActionKey = this.formatKey(`action:${actionKey}`);
    if (this.redis) {
      try {
        const result = await this.redis.eval(
          `if redis.call("GET", KEYS[1]) ~= ARGV[1] then
             return 0
           end
           local claimed = redis.call("SET", KEYS[2], ARGV[1], "EX", ARGV[2], "NX")
           if claimed then return 1 end
           return 0`,
          2,
          formattedLeaseKey,
          formattedActionKey,
          owner,
          String(ttl),
        );
        return Number(result) === 1;
      } catch (error) {
        logger.error("Redis fenced action claim failed closed", {
          actionKey,
          ...errorContext(error),
        });
        return false;
      }
    }

    if (config.isProduction || !(await this.isLeaseOwner(leaseKey, owner))) {
      return false;
    }

    const now = Date.now();
    const existingExpiry = this.actionClaims.get(actionKey);
    if (existingExpiry && existingExpiry > now) return false;
    this.actionClaims.set(actionKey, now + ttl * 1000);
    return true;
  }

  private setMemoryEntry(key: string, value: unknown, expiresAt: number): void {
    this.cache.delete(key);
    this.cache.set(key, {
      value,
      expiresAt,
    });
    this.sweepMemoryCache();
  }

  private sweepMemoryCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }

    while (this.cache.size > MAX_MEMORY_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) {
        return;
      }
      this.cache.delete(oldestKey);
    }
  }

  private assertValidLeaseInput(
    key: string,
    owner: string,
    ttlMs: number,
  ): void {
    if (!key || !owner || !Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new Error(
        "Lease key and owner must be non-empty and ttlMs must be a positive safe integer",
      );
    }
  }

  private formatKey(key: string): string {
    return `${CACHE_KEY_PREFIX}${key}`;
  }

  private serialize(value: unknown): string {
    return JSON.stringify({ value } satisfies CacheEnvelope);
  }

  private deserialize<T>(serialized: string): T | null {
    const parsed = JSON.parse(serialized) as CacheEnvelope;
    if (!parsed || typeof parsed !== "object" || !("value" in parsed)) {
      return null;
    }

    return parsed.value as T;
  }
}
