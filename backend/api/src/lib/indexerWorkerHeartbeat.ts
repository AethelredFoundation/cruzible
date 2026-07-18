import { readFile, rename, unlink, writeFile } from "node:fs/promises";

export const DEFAULT_INDEXER_HEARTBEAT_FILE =
  "/tmp/cruzible-indexer-heartbeat.json";
export const DEFAULT_INDEXER_HEARTBEAT_INTERVAL_MS = 10_000;
export const DEFAULT_INDEXER_HEARTBEAT_MAX_AGE_MS = 45_000;

interface HeartbeatPayload {
  version: 1;
  pid: number;
  updatedAtMs: number;
}

export interface IndexerHeartbeatController {
  filePath: string;
  stop(): Promise<void>;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("indexer heartbeat timing must be a positive integer");
  }
  return parsed;
}

export function indexerHeartbeatFileFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const filePath =
    env.INDEXER_HEARTBEAT_FILE?.trim() || DEFAULT_INDEXER_HEARTBEAT_FILE;
  if (!filePath.startsWith("/tmp/") || filePath.includes("\0")) {
    throw new Error("INDEXER_HEARTBEAT_FILE must be an absolute /tmp path");
  }
  return filePath;
}

export function indexerHeartbeatMaxAgeFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const maxAgeMs = parsePositiveInteger(
    env.INDEXER_HEARTBEAT_MAX_AGE_MS,
    DEFAULT_INDEXER_HEARTBEAT_MAX_AGE_MS,
  );
  if (maxAgeMs < 20_000 || maxAgeMs > 300_000) {
    throw new Error(
      "INDEXER_HEARTBEAT_MAX_AGE_MS must be between 20000 and 300000",
    );
  }
  return maxAgeMs;
}

export async function writeIndexerWorkerHeartbeat({
  filePath,
  nowMs = Date.now(),
  pid = process.pid,
}: {
  filePath: string;
  nowMs?: number;
  pid?: number;
}): Promise<void> {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw new Error("indexer heartbeat timestamp is invalid");
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("indexer heartbeat process ID is invalid");
  }
  const payload: HeartbeatPayload = { version: 1, pid, updatedAtMs: nowMs };
  const temporaryPath = `${filePath}.${pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
}

export async function assertIndexerWorkerHeartbeatFresh({
  filePath,
  maxAgeMs,
  nowMs = Date.now(),
  verifyProcess = true,
}: {
  filePath: string;
  maxAgeMs: number;
  nowMs?: number;
  verifyProcess?: boolean;
}): Promise<HeartbeatPayload> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("indexer worker heartbeat is missing or unreadable");
  }
  const heartbeat = parsed as Partial<HeartbeatPayload>;
  if (
    heartbeat.version !== 1 ||
    !Number.isSafeInteger(heartbeat.pid) ||
    Number(heartbeat.pid) <= 0 ||
    !Number.isSafeInteger(heartbeat.updatedAtMs) ||
    Number(heartbeat.updatedAtMs) <= 0
  ) {
    throw new Error("indexer worker heartbeat payload is invalid");
  }

  const updatedAtMs = Number(heartbeat.updatedAtMs);
  if (updatedAtMs > nowMs + 5_000) {
    throw new Error("indexer worker heartbeat timestamp is in the future");
  }
  if (nowMs - updatedAtMs > maxAgeMs) {
    throw new Error("indexer worker heartbeat is stale");
  }
  if (verifyProcess) {
    try {
      process.kill(Number(heartbeat.pid), 0);
    } catch {
      throw new Error("indexer worker heartbeat process is not running");
    }
  }

  return heartbeat as HeartbeatPayload;
}

export async function startIndexerWorkerHeartbeat({
  filePath = indexerHeartbeatFileFromEnvironment(),
  intervalMs = DEFAULT_INDEXER_HEARTBEAT_INTERVAL_MS,
  onError = () => undefined,
}: {
  filePath?: string;
  intervalMs?: number;
  onError?: (error: unknown) => void;
} = {}): Promise<IndexerHeartbeatController> {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error("indexer heartbeat interval must be a positive integer");
  }

  await writeIndexerWorkerHeartbeat({ filePath });
  let active = true;
  let pendingWrite: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (!active || pendingWrite) return;
    pendingWrite = writeIndexerWorkerHeartbeat({ filePath })
      .catch(onError)
      .finally(() => {
        pendingWrite = null;
      });
  }, intervalMs);
  timer.unref();

  return {
    filePath,
    async stop() {
      if (!active) return;
      active = false;
      clearInterval(timer);
      await pendingWrite;
      try {
        await unlink(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}
