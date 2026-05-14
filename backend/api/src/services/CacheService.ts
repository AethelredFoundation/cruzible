import { singleton } from "tsyringe";
import Redis from "ioredis";

import { config } from "../config";
import { logger } from "../utils/logger";
import { errorContext } from "../utils/errorContext";

type CacheEntry = {
  expiresAt: number;
  value: unknown;
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
