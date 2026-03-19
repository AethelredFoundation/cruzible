import { injectable } from "tsyringe";

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

@injectable()
export class CacheService {
  private readonly cache = new Map<string, CacheEntry>();

  async connect(): Promise<void> {
    return;
  }

  async disconnect(): Promise<void> {
    this.cache.clear();
  }

  async get<T>(key: string): Promise<T | null> {
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
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }
}
