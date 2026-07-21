#!/usr/bin/env node

import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const BENCHMARK_SCHEMA = "cruzible.api_benchmark_gate.v1";
const DEFAULT_CONFIG = {
  targetUrl: "http://127.0.0.1:4001/health/live",
  requests: 40,
  concurrency: 4,
  timeoutMs: 2_000,
  p95Ms: 250,
  meanMs: 125,
  maxMs: 750,
  minSuccessRate: 1,
};

export function parseBenchmarkArgs(
  argv = process.argv.slice(2),
  env = process.env,
) {
  const options = {
    mode: "live",
    targetUrl: env.API_BENCHMARK_URL || DEFAULT_CONFIG.targetUrl,
    requests: env.API_BENCHMARK_REQUESTS || DEFAULT_CONFIG.requests,
    concurrency: env.API_BENCHMARK_CONCURRENCY || DEFAULT_CONFIG.concurrency,
    timeoutMs: env.API_BENCHMARK_TIMEOUT_MS || DEFAULT_CONFIG.timeoutMs,
    p95Ms: env.API_BENCHMARK_P95_MS || DEFAULT_CONFIG.p95Ms,
    meanMs: env.API_BENCHMARK_MEAN_MS || DEFAULT_CONFIG.meanMs,
    maxMs: env.API_BENCHMARK_MAX_MS || DEFAULT_CONFIG.maxMs,
    minSuccessRate:
      env.API_BENCHMARK_MIN_SUCCESS_RATE || DEFAULT_CONFIG.minSuccessRate,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--check" || arg === "--dry-run") {
      options.mode = "check";
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--url") {
      options.targetUrl = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--url=")) {
      options.targetUrl = arg.slice("--url=".length);
      continue;
    }

    if (arg === "--requests") {
      options.requests = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--requests=")) {
      options.requests = arg.slice("--requests=".length);
      continue;
    }

    if (arg === "--concurrency") {
      options.concurrency = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--concurrency=")) {
      options.concurrency = arg.slice("--concurrency=".length);
      continue;
    }

    if (arg === "--timeout-ms") {
      options.timeoutMs = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = arg.slice("--timeout-ms=".length);
      continue;
    }

    if (arg === "--p95-ms") {
      options.p95Ms = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--p95-ms=")) {
      options.p95Ms = arg.slice("--p95-ms=".length);
      continue;
    }

    if (arg === "--mean-ms") {
      options.meanMs = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--mean-ms=")) {
      options.meanMs = arg.slice("--mean-ms=".length);
      continue;
    }

    if (arg === "--max-ms") {
      options.maxMs = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--max-ms=")) {
      options.maxMs = arg.slice("--max-ms=".length);
      continue;
    }

    if (arg === "--min-success-rate" || arg === "--success-rate") {
      options.minSuccessRate = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--min-success-rate=")) {
      options.minSuccessRate = arg.slice("--min-success-rate=".length);
      continue;
    }

    if (arg.startsWith("--success-rate=")) {
      options.minSuccessRate = arg.slice("--success-rate=".length);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return normalizeBenchmarkConfig(options);
}

export function summarizeSamples(samples) {
  const sortedSamples = [...samples].sort(
    (left, right) => left.index - right.index,
  );
  const successfulSamples = sortedSamples.filter((sample) => sample.ok);
  const latencies = successfulSamples
    .map((sample) => sample.durationMs)
    .sort((left, right) => left - right);
  const errorCounts = sortedSamples.reduce((counts, sample) => {
    if (sample.ok) {
      return counts;
    }

    const key = sample.error || `HTTP_${sample.status ?? "UNKNOWN"}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  return {
    requests: sortedSamples.length,
    successes: successfulSamples.length,
    failures: sortedSamples.length - successfulSamples.length,
    success_rate:
      sortedSamples.length === 0
        ? 0
        : successfulSamples.length / sortedSamples.length,
    latency_ms: {
      mean: average(latencies),
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.length === 0 ? null : Math.max(...latencies),
    },
    errors: errorCounts,
  };
}

export function evaluateSummary(summary, config) {
  const failures = [];

  if (summary.requests < config.requests) {
    failures.push(
      `expected ${config.requests} samples, collected ${summary.requests}`,
    );
  }

  if (summary.success_rate < config.minSuccessRate) {
    failures.push(
      `success rate ${formatNumber(summary.success_rate)} below ${formatNumber(
        config.minSuccessRate,
      )}`,
    );
  }

  if (summary.latency_ms.p95 === null) {
    failures.push("no successful samples were collected");
  } else {
    if (summary.latency_ms.p95 > config.p95Ms) {
      failures.push(
        `p95 ${formatNumber(summary.latency_ms.p95)}ms above ${config.p95Ms}ms`,
      );
    }

    if (
      summary.latency_ms.mean !== null &&
      summary.latency_ms.mean > config.meanMs
    ) {
      failures.push(
        `mean ${formatNumber(summary.latency_ms.mean)}ms above ${config.meanMs}ms`,
      );
    }

    if (
      summary.latency_ms.max !== null &&
      summary.latency_ms.max > config.maxMs
    ) {
      failures.push(
        `max ${formatNumber(summary.latency_ms.max)}ms above ${config.maxMs}ms`,
      );
    }
  }

  return {
    status: failures.length === 0 ? "passed" : "failed",
    failures,
  };
}

export async function runLiveBenchmark(config) {
  let nextIndex = 0;
  const samples = [];
  const workers = Array.from({ length: config.concurrency }, async () => {
    while (nextIndex < config.requests) {
      const sampleIndex = nextIndex;
      nextIndex += 1;
      samples.push(await sampleHealthEndpoint(config, sampleIndex));
    }
  });

  await Promise.all(workers);

  const summary = summarizeSamples(samples);
  return {
    schema: BENCHMARK_SCHEMA,
    mode: "live",
    generated_at: new Date().toISOString(),
    target: {
      url: config.targetUrl,
    },
    thresholds: buildThresholds(config),
    summary,
    result: evaluateSummary(summary, config),
  };
}

export function buildCheckEvidence(config) {
  return {
    schema: BENCHMARK_SCHEMA,
    mode: "check",
    generated_at: new Date().toISOString(),
    target: {
      url: config.targetUrl,
    },
    thresholds: buildThresholds(config),
    result: {
      status: "passed",
      failures: [],
    },
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  try {
    const config = parseBenchmarkArgs(argv, env);

    if (config.help) {
      printHelp();
      return undefined;
    }

    const evidence =
      config.mode === "check"
        ? buildCheckEvidence(config)
        : await runLiveBenchmark(config);

    console.log(`${JSON.stringify(evidence, null, 2)}\n`);

    if (evidence.result.status !== "passed") {
      process.exitCode = 1;
    }

    return evidence;
  } catch (error) {
    console.error(`API benchmark gate failed: ${error.message}`);
    process.exitCode = 1;
    return undefined;
  }
}

function normalizeBenchmarkConfig(options) {
  const targetUrl = normalizeTargetUrl(options.targetUrl);
  const config = {
    mode: options.mode,
    targetUrl,
    requests: parsePositiveInteger(options.requests, "requests"),
    concurrency: parsePositiveInteger(options.concurrency, "concurrency"),
    timeoutMs: parsePositiveInteger(options.timeoutMs, "timeout-ms"),
    p95Ms: parsePositiveInteger(options.p95Ms, "p95-ms"),
    meanMs: parsePositiveInteger(options.meanMs, "mean-ms"),
    maxMs: parsePositiveInteger(options.maxMs, "max-ms"),
    minSuccessRate: parseSuccessRate(options.minSuccessRate),
    help: options.help,
  };

  if (config.concurrency > config.requests) {
    throw new Error("concurrency must not exceed requests");
  }

  if (config.meanMs > config.p95Ms) {
    throw new Error("mean-ms must not exceed p95-ms");
  }

  if (config.p95Ms > config.maxMs) {
    throw new Error("p95-ms must not exceed max-ms");
  }

  return config;
}

function normalizeTargetUrl(value) {
  let parsed;

  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error("--url must be an absolute HTTP or HTTPS URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("--url must use http:// or https://");
  }

  if (parsed.username || parsed.password) {
    throw new Error("--url must not include credentials");
  }

  if (parsed.search || parsed.hash) {
    throw new Error("--url must not include query strings or fragments");
  }

  return parsed.toString();
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function parseSuccessRate(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    throw new Error("min-success-rate must be greater than 0 and at most 1");
  }

  return parsed;
}

async function sampleHealthEndpoint(config, index) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetch(config.targetUrl, {
      headers: {
        accept: "application/json",
      },
      redirect: "manual",
      signal: controller.signal,
    });
    await response.arrayBuffer();

    return {
      index,
      ok: response.ok,
      status: response.status,
      durationMs: performance.now() - startedAt,
    };
  } catch (error) {
    return {
      index,
      ok: false,
      status: null,
      durationMs: performance.now() - startedAt,
      error: error.name === "AbortError" ? "timeout" : "network_error",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildThresholds(config) {
  return {
    requests: config.requests,
    concurrency: config.concurrency,
    timeout_ms: config.timeoutMs,
    p95_ms: config.p95Ms,
    mean_ms: config.meanMs,
    max_ms: config.maxMs,
    min_success_rate: config.minSuccessRate,
  };
}

function percentile(values, ratio) {
  if (values.length === 0) {
    return null;
  }

  const index = Math.min(
    values.length - 1,
    Math.ceil(values.length * ratio) - 1,
  );
  return round(values[index]);
}

function average(values) {
  if (values.length === 0) {
    return null;
  }

  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function round(value) {
  return Number(value.toFixed(2));
}

function formatNumber(value) {
  return Number(value.toFixed(4)).toString();
}

function printHelp() {
  console.log(`Usage: npm run benchmark -- [options]

Runs an enforceable liveness latency gate against /health/live.

Options:
  --check                  Validate benchmark configuration without network I/O.
  --url URL                Target liveness URL. Default: ${DEFAULT_CONFIG.targetUrl}
  --requests N             Total requests. Default: ${DEFAULT_CONFIG.requests}
  --concurrency N          Concurrent workers. Default: ${DEFAULT_CONFIG.concurrency}
  --timeout-ms N           Per-request timeout. Default: ${DEFAULT_CONFIG.timeoutMs}
  --p95-ms N               Maximum passing p95 latency. Default: ${DEFAULT_CONFIG.p95Ms}
  --mean-ms N              Maximum passing mean latency. Default: ${DEFAULT_CONFIG.meanMs}
  --max-ms N               Maximum passing single request latency. Default: ${DEFAULT_CONFIG.maxMs}
  --min-success-rate N     Required success ratio in (0, 1]. Default: ${DEFAULT_CONFIG.minSuccessRate}
`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
