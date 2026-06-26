import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateSummary,
  parseBenchmarkArgs,
  summarizeSamples,
} from "../scripts/benchmark-health.mjs";

const apiRoot = process.cwd();

describe("API benchmark gate", () => {
  it("is exposed as backend API package commands", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(apiRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.benchmark).toBe(
      "node scripts/benchmark-health.mjs",
    );
    expect(packageJson.scripts["benchmark:check"]).toBe(
      "node scripts/benchmark-health.mjs --check",
    );
    expect(packageJson.scripts["format:check"]).toContain('"scripts/**/*.mjs"');
  });

  it("prints machine-readable evidence in check mode", () => {
    const stdout = execFileSync(
      process.execPath,
      [
        "scripts/benchmark-health.mjs",
        "--check",
        "--requests",
        "12",
        "--concurrency",
        "3",
        "--timeout-ms",
        "1500",
        "--p95-ms",
        "250",
        "--mean-ms",
        "125",
        "--max-ms",
        "750",
      ],
      {
        cwd: apiRoot,
        encoding: "utf8",
      },
    );
    const evidence = JSON.parse(stdout) as {
      schema: string;
      mode: string;
      target: { url: string };
      thresholds: {
        requests: number;
        concurrency: number;
        timeout_ms: number;
        p95_ms: number;
        mean_ms: number;
        max_ms: number;
      };
      result: { status: string; failures: string[] };
    };

    expect(evidence.schema).toBe("cruzible.api_benchmark_gate.v1");
    expect(evidence.mode).toBe("check");
    expect(evidence.target.url).toBe("http://127.0.0.1:3000/health/live");
    expect(evidence.thresholds).toMatchObject({
      requests: 12,
      concurrency: 3,
      timeout_ms: 1500,
      p95_ms: 250,
      mean_ms: 125,
      max_ms: 750,
    });
    expect(evidence.result).toEqual({ status: "passed", failures: [] });
  });

  it("summarizes samples and fails latency breaches", () => {
    const summary = summarizeSamples([
      { index: 0, ok: true, status: 200, durationMs: 20 },
      { index: 1, ok: true, status: 200, durationMs: 40 },
      { index: 2, ok: true, status: 200, durationMs: 420 },
      { index: 3, ok: false, status: 503, durationMs: 15 },
    ]);
    const result = evaluateSummary(summary, {
      requests: 4,
      p95Ms: 250,
      meanMs: 125,
      maxMs: 750,
      minSuccessRate: 0.75,
    });

    expect(summary.successes).toBe(3);
    expect(summary.failures).toBe(1);
    expect(summary.success_rate).toBe(0.75);
    expect(summary.latency_ms.p95).toBe(420);
    expect(result.status).toBe("failed");
    expect(result.failures).toContain("p95 420ms above 250ms");
  });

  it("rejects secret-bearing target URLs without leaking credentials", () => {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/benchmark-health.mjs",
        "--check",
        "--url",
        "https://operator:super-secret@example.com/health/live",
      ],
      {
        cwd: apiRoot,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--url must not include credentials");
    expect(result.stderr).not.toContain("operator");
    expect(result.stderr).not.toContain("super-secret");
  });

  it("accepts environment overrides but rejects invalid threshold shape", () => {
    const parsed = parseBenchmarkArgs(["--check"], {
      API_BENCHMARK_URL: "https://api.testnet.aethelred.org/health/live",
      API_BENCHMARK_REQUESTS: "20",
      API_BENCHMARK_CONCURRENCY: "5",
      API_BENCHMARK_TIMEOUT_MS: "1000",
      API_BENCHMARK_P95_MS: "250",
      API_BENCHMARK_MEAN_MS: "125",
      API_BENCHMARK_MAX_MS: "750",
      API_BENCHMARK_MIN_SUCCESS_RATE: "0.99",
    });

    expect(parsed).toMatchObject({
      mode: "check",
      targetUrl: "https://api.testnet.aethelred.org/health/live",
      requests: 20,
      concurrency: 5,
      timeoutMs: 1000,
      p95Ms: 250,
      meanMs: 125,
      maxMs: 750,
      minSuccessRate: 0.99,
    });
    expect(() =>
      parseBenchmarkArgs(["--check", "--mean-ms", "400", "--p95-ms", "250"]),
    ).toThrow("mean-ms must not exceed p95-ms");
  });
});
