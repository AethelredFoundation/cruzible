import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertIndexerWorkerHeartbeatFresh,
  indexerHeartbeatFileFromEnvironment,
  indexerHeartbeatMaxAgeFromEnvironment,
  startIndexerWorkerHeartbeat,
  writeIndexerWorkerHeartbeat,
} from "../src/lib/indexerWorkerHeartbeat";

const directories: string[] = [];

function heartbeatPath() {
  const directory = mkdtempSync(join(tmpdir(), "cruzible-heartbeat-"));
  directories.push(directory);
  return join(directory, "indexer.json");
}

afterEach(() => {
  vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("indexer worker heartbeat", () => {
  it("writes an atomic process-bound heartbeat and accepts it while fresh", async () => {
    const filePath = heartbeatPath();
    await writeIndexerWorkerHeartbeat({
      filePath,
      nowMs: 1_000_000,
      pid: process.pid,
    });

    await expect(
      assertIndexerWorkerHeartbeatFresh({
        filePath,
        maxAgeMs: 45_000,
        nowMs: 1_030_000,
      }),
    ).resolves.toMatchObject({
      version: 1,
      pid: process.pid,
      updatedAtMs: 1_000_000,
    });
  });

  it("rejects missing, malformed, stale, future, and dead-process heartbeats", async () => {
    const filePath = heartbeatPath();
    await expect(
      assertIndexerWorkerHeartbeatFresh({
        filePath,
        maxAgeMs: 45_000,
        nowMs: 1_000_000,
      }),
    ).rejects.toThrow("missing or unreadable");

    writeFileSync(filePath, "{}\n");
    await expect(
      assertIndexerWorkerHeartbeatFresh({
        filePath,
        maxAgeMs: 45_000,
        nowMs: 1_000_000,
      }),
    ).rejects.toThrow("payload is invalid");

    await writeIndexerWorkerHeartbeat({
      filePath,
      nowMs: 900_000,
      pid: process.pid,
    });
    await expect(
      assertIndexerWorkerHeartbeatFresh({
        filePath,
        maxAgeMs: 45_000,
        nowMs: 1_000_000,
      }),
    ).rejects.toThrow("is stale");

    await writeIndexerWorkerHeartbeat({
      filePath,
      nowMs: 1_010_000,
      pid: process.pid,
    });
    await expect(
      assertIndexerWorkerHeartbeatFresh({
        filePath,
        maxAgeMs: 45_000,
        nowMs: 1_000_000,
      }),
    ).rejects.toThrow("in the future");

    await writeIndexerWorkerHeartbeat({
      filePath,
      nowMs: 1_000_000,
      pid: 2_147_483_647,
    });
    await expect(
      assertIndexerWorkerHeartbeatFresh({
        filePath,
        maxAgeMs: 45_000,
        nowMs: 1_000_000,
      }),
    ).rejects.toThrow("process is not running");
  });

  it("starts immediately, refreshes on schedule, and removes the file on stop", async () => {
    vi.useFakeTimers();
    const filePath = heartbeatPath();
    const controller = await startIndexerWorkerHeartbeat({
      filePath,
      intervalMs: 1_000,
    });
    const first = JSON.parse(readFileSync(filePath, "utf8")) as {
      updatedAtMs: number;
    };

    await vi.advanceTimersByTimeAsync(1_000);
    const second = JSON.parse(readFileSync(filePath, "utf8")) as {
      updatedAtMs: number;
    };
    expect(second.updatedAtMs).toBeGreaterThanOrEqual(first.updatedAtMs);

    await controller.stop();
    await expect(
      assertIndexerWorkerHeartbeatFresh({
        filePath,
        maxAgeMs: 45_000,
      }),
    ).rejects.toThrow("missing or unreadable");
  });

  it("validates probe environment paths and age bounds", () => {
    expect(
      indexerHeartbeatFileFromEnvironment({
        INDEXER_HEARTBEAT_FILE: "/tmp/custom-indexer-heartbeat.json",
      }),
    ).toBe("/tmp/custom-indexer-heartbeat.json");
    expect(() =>
      indexerHeartbeatFileFromEnvironment({
        INDEXER_HEARTBEAT_FILE: "/var/run/indexer.json",
      }),
    ).toThrow("absolute /tmp path");
    expect(
      indexerHeartbeatMaxAgeFromEnvironment({
        INDEXER_HEARTBEAT_MAX_AGE_MS: "45000",
      }),
    ).toBe(45_000);
    expect(() =>
      indexerHeartbeatMaxAgeFromEnvironment({
        INDEXER_HEARTBEAT_MAX_AGE_MS: "1000",
      }),
    ).toThrow("between 20000 and 300000");
  });
});
