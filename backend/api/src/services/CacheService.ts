import { injectable } from 'tsyringe';
import Redis from 'ioredis';

import { config } from '../config';
import { logger } from '../utils/logger';

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

type CacheEnvelope = {
  value: unknown;
};

const CACHE_KEY_PREFIX = 'cruzible:api:';

@injectable()
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

    redis.on('error', (error) => {
      logger.warn('Redis cache client error', {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    try {
      await redis.connect();
      await redis.ping();
      this.redis = redis;
      logger.info('Redis cache connected');
    } catch (error) {
      redis.disconnect();

      if (config.isProduction) {
        throw Object.assign(
          new Error(
            `Redis cache connection failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
          { cause: error },
        );
      }

      logger.warn('Redis cache unavailable; using in-memory fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
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
        if (cached === null) {
          return null;
        }

        return this.deserialize<T>(cached);
      } catch (error) {
        logger.warn('Redis cache read failed; using in-memory fallback', {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

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
          logger.warn('Redis cache delete failed', {
            key,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return;
    }

    this.cache.set(key, {
      value,
      expiresAt,
    });

    if (!this.redis) {
      return;
    }

    try {
      await this.redis.set(
        this.formatKey(key),
        this.serialize(value),
        'EX',
        ttl,
      );
    } catch (error) {
      logger.warn('Redis cache write failed; retained in-memory fallback', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
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
    if (!parsed || typeof parsed !== 'object' || !('value' in parsed)) {
      return null;
    }

    return parsed.value as T;
  }
}
