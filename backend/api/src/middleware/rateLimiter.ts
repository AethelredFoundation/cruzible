import Redis from "ioredis";
import rateLimit, { type Store } from "express-rate-limit";
import { config } from "../config";
import { logger } from "../utils/logger";
import { errorContext } from "../utils/errorContext";

const sharedRateLimitRedisClients = new Map<string, Redis>();

function getRedisRateLimitClient(redisUrl: string): Redis {
  let client = sharedRateLimitRedisClients.get(redisUrl);
  if (!client) {
    client = new Redis(redisUrl, {
      connectTimeout: 1000,
      maxRetriesPerRequest: 1,
    });
    client.on("error", (error) => {
      logger.warn("Redis rate-limit store error", errorContext(error));
    });
    sharedRateLimitRedisClients.set(redisUrl, client);
  }

  return client;
}

export function createRedisRateLimitStore(options: {
  prefix: string;
  windowMs: number;
  redisUrl?: string;
}): Store | undefined {
  if (!options.redisUrl) {
    return undefined;
  }

  const redisUrl = options.redisUrl;
  const namespace = `cruzible:api:ratelimit:${options.prefix}`;

  return {
    prefix: namespace,
    async increment(key: string) {
      const redisKey = `${namespace}:${key}`;
      const [totalHits, ttlMs] = (await getRedisRateLimitClient(redisUrl).eval(
        `
local hits = redis.call("INCR", KEYS[1])
if hits == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { hits, ttl }
        `,
        1,
        redisKey,
        String(options.windowMs),
      )) as [number | string, number | string];

      const ttlNumber = Number(ttlMs);
      const resetInMs = ttlNumber > 0 ? ttlNumber : options.windowMs;

      return {
        totalHits: Number(totalHits),
        resetTime: new Date(Date.now() + resetInMs),
      };
    },
    async decrement(key: string) {
      const redisKey = `${namespace}:${key}`;
      await getRedisRateLimitClient(redisUrl).eval(
        `
local hits = redis.call("DECR", KEYS[1])
if hits <= 0 then
  redis.call("DEL", KEYS[1])
end
return hits
        `,
        1,
        redisKey,
      );
    },
    async resetKey(key: string) {
      await getRedisRateLimitClient(redisUrl).del(`${namespace}:${key}`);
    },
  };
}

export function getRateLimitRedisClientCount(): number {
  return sharedRateLimitRedisClients.size;
}

export async function shutdownRateLimitStores(): Promise<void> {
  const clients = [...sharedRateLimitRedisClients.values()];
  sharedRateLimitRedisClients.clear();

  await Promise.all(
    clients.map(async (client) => {
      try {
        await client.quit();
      } catch (error) {
        logger.warn(
          "Redis rate-limit store quit failed; disconnecting socket",
          errorContext(error),
        );
        client.disconnect();
      }
    }),
  );
}

export const rateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisRateLimitStore({
    prefix: "global",
    windowMs: config.rateLimitWindowMs,
    redisUrl: config.redisUrl,
  }),
  passOnStoreError: false,
  // Liveness is intentionally process-local and cheap for orchestrator probes.
  // Readiness performs dependency checks, so it remains rate limited.
  skip: (req) => req.path === "/health/live",
  handler: (req, res) => {
    res.status(429).json({
      error: "TooManyRequests",
      message: "Rate limit exceeded",
      requestId: req.requestId,
    });
  },
});

function namedRateLimiter(options: {
  prefix: string;
  windowMs: number;
  max: number;
  message: string;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisRateLimitStore({
      prefix: options.prefix,
      windowMs: options.windowMs,
      redisUrl: config.redisUrl,
    }),
    passOnStoreError: false,
    handler: (req, res) => {
      res.status(429).json({
        error: "TooManyRequests",
        message: options.message,
        requestId: req.requestId,
      });
    },
  });
}

export const authRateLimiter = namedRateLimiter({
  prefix: "auth",
  windowMs: config.authRateLimitWindowMs,
  max: config.authRateLimitMax,
  message: "Authentication rate limit exceeded",
});

export const opsRateLimiter = namedRateLimiter({
  prefix: "ops",
  windowMs: config.opsRateLimitWindowMs,
  max: config.opsRateLimitMax,
  message: "Operations rate limit exceeded",
});

export const publicExpensiveRateLimiter = namedRateLimiter({
  prefix: "public-expensive",
  windowMs: config.publicExpensiveRateLimitWindowMs,
  max: config.publicExpensiveRateLimitMax,
  message: "Public expensive endpoint rate limit exceeded",
});
