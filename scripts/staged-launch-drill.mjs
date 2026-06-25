#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_OPERATIONAL_TOKEN_ENV = "OPERATIONAL_ENDPOINTS_TOKEN";
const DEFAULT_OPERATOR_TOKEN_ENV = "STAGING_OPERATOR_BEARER_TOKEN";

const REQUIRED_REPOSITORY_EVIDENCE = [
  "docs/ops/runbook.md",
  "docs/ops/environment-reference.md",
  "docs/architecture/12-public-readiness.md",
  "docs/architecture/13-production-gap-register.md",
  "backend/infra/docker-compose.yml",
  "k8s/base/kustomization.yaml",
  "k8s/base/network-policy.yaml",
  "backend/contracts/deployments/release-manifest.example.json",
  "scripts/validate-deployment-manifests.mjs",
  "scripts/check-frontend-bundle-budget.mjs",
];

const CHECK_DEFINITIONS = [
  {
    id: "frontend-health",
    target: "frontend",
    path: "/api/health",
    required: true,
    description:
      "Frontend health endpoint returns the Cruzible frontend ok body.",
  },
  {
    id: "frontend-landing",
    target: "frontend",
    path: "/",
    required: true,
    description: "Public landing page renders from the staged frontend.",
  },
  {
    id: "frontend-vault",
    target: "frontend",
    path: "/vault",
    required: true,
    description: "Vault surface renders from the staged frontend.",
  },
  {
    id: "frontend-reconciliation",
    target: "frontend",
    path: "/reconciliation",
    required: true,
    description:
      "Public reconciliation surface renders from the staged frontend.",
  },
  {
    id: "frontend-governance-gate",
    target: "frontend",
    path: "/governance",
    required: true,
    description: "Governance remains launch-gated on the staged frontend.",
  },
  {
    id: "api-live",
    target: "api",
    path: "/health/live",
    required: true,
    description: "API liveness probe is reachable.",
  },
  {
    id: "api-ready",
    target: "api",
    path: "/health/ready",
    required: true,
    description: "API readiness probe reports ready.",
  },
  {
    id: "api-full-health-rejects-anonymous",
    target: "api",
    path: "/health",
    required: true,
    anonymous: true,
    description: "Full health report rejects anonymous operational access.",
  },
  {
    id: "api-full-health-with-operational-token",
    target: "api",
    path: "/health",
    required: true,
    operationalToken: true,
    description: "Full health report accepts the staging operational token.",
  },
  {
    id: "api-metrics-rejects-anonymous",
    target: "api",
    path: "/metrics",
    required: true,
    anonymous: true,
    description: "Metrics endpoint is not anonymously readable.",
  },
  {
    id: "api-docs-rejects-anonymous",
    target: "api",
    path: "/docs",
    required: true,
    anonymous: true,
    description: "API docs endpoint is not anonymously readable when enabled.",
  },
  {
    id: "api-public-reconciliation",
    target: "api",
    path: "/v1/reconciliation/live?validator_limit=50",
    required: true,
    description: "Public reconciliation document is reachable.",
  },
  {
    id: "api-reconciliation-status-rejects-anonymous",
    target: "api",
    path: "/v1/reconciliation/status",
    required: true,
    anonymous: true,
    description: "Protected reconciliation status rejects anonymous access.",
  },
  {
    id: "api-reconciliation-status-with-operator-token",
    target: "api",
    path: "/v1/reconciliation/status",
    required: false,
    operatorToken: true,
    description:
      "Protected reconciliation status accepts the staging operator JWT.",
  },
  {
    id: "api-alert-summary-with-operator-token",
    target: "api",
    path: "/v1/alerts/summary",
    required: false,
    operatorToken: true,
    description: "Protected alert summary accepts the staging operator JWT.",
  },
];

function usage() {
  return `Usage: node scripts/staged-launch-drill.mjs [options]

Options:
  --dry-run                         Build the drill plan without network calls.
  --frontend-url <url>              Staging frontend origin. Defaults to STAGING_FRONTEND_URL.
  --api-url <url>                   Staging API origin. Defaults to STAGING_API_URL.
  --operational-token-env <name>    Env var holding the operational token. Defaults to OPERATIONAL_ENDPOINTS_TOKEN.
  --operator-token-env <name>       Env var holding an operator/admin JWT. Defaults to STAGING_OPERATOR_BEARER_TOKEN.
  --timeout-ms <ms>                 Per-request timeout. Defaults to ${DEFAULT_TIMEOUT_MS}.
  --evidence-file <path>            Optional JSON evidence output path.
  --help                            Show this help text.

Live mode requires --frontend-url, --api-url, and the operational-token env var.
Do not pass token values as CLI arguments; use environment variables only.`;
}

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flagName} requires a value.`);
  }
  return value;
}

export function parseStagedLaunchDrillArgs(argv = process.argv.slice(2)) {
  const options = {
    apiUrl: process.env.STAGING_API_URL ?? "",
    dryRun: false,
    evidenceFile: "",
    frontendUrl: process.env.STAGING_FRONTEND_URL ?? "",
    operationalTokenEnv: DEFAULT_OPERATIONAL_TOKEN_ENV,
    operatorTokenEnv: DEFAULT_OPERATOR_TOKEN_ENV,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--frontend-url":
        options.frontendUrl = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case "--api-url":
        options.apiUrl = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case "--operational-token-env":
        options.operationalTokenEnv = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case "--operator-token-env":
        options.operatorTokenEnv = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case "--timeout-ms": {
        const value = Number(readFlagValue(argv, index, arg));
        if (!Number.isInteger(value) || value < 1_000 || value > 120_000) {
          throw new Error(
            "--timeout-ms must be an integer between 1000 and 120000.",
          );
        }
        options.timeoutMs = value;
        index += 1;
        break;
      }
      case "--evidence-file":
        options.evidenceFile = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function getCommitSha(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function normalizeOrigin(
  rawValue,
  label,
  errors,
  { disallowApiVersionPath = false } = {},
) {
  const value = String(rawValue ?? "").trim();
  if (!value) {
    errors.push(`${label} is required in live mode.`);
    return "";
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    errors.push(`${label} must be a valid http(s) URL.`);
    return "";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    errors.push(`${label} must use http:// or https://.`);
  }

  if (parsed.username || parsed.password) {
    errors.push(`${label} must not include credentials.`);
  }

  if (parsed.search || parsed.hash) {
    errors.push(
      `${label} must be an origin/base URL without query or fragment.`,
    );
  }

  const path = parsed.pathname.replace(/\/+$/u, "");
  if (disallowApiVersionPath && path.endsWith("/v1")) {
    errors.push(
      `${label} should point at the API origin, not the /v1 route prefix.`,
    );
  }

  return `${parsed.origin}${path}`;
}

function repositoryEvidence(cwd) {
  return REQUIRED_REPOSITORY_EVIDENCE.map((filePath) => ({
    path: filePath,
    present: existsSync(resolve(cwd, filePath)),
  }));
}

export function buildStagedLaunchDrillPlan({
  cwd = process.cwd(),
  env = process.env,
  options = {},
} = {}) {
  const planOptions = {
    dryRun: false,
    evidenceFile: "",
    frontendUrl: "",
    apiUrl: "",
    operationalTokenEnv: DEFAULT_OPERATIONAL_TOKEN_ENV,
    operatorTokenEnv: DEFAULT_OPERATOR_TOKEN_ENV,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    ...options,
  };
  const errors = [];
  const missingInputs = [];
  const frontendUrl = planOptions.frontendUrl
    ? normalizeOrigin(planOptions.frontendUrl, "frontend URL", errors)
    : "";
  const apiUrl = planOptions.apiUrl
    ? normalizeOrigin(planOptions.apiUrl, "API URL", errors, {
        disallowApiVersionPath: true,
      })
    : "";
  const operationalTokenPresent = Boolean(env[planOptions.operationalTokenEnv]);
  const operatorTokenPresent = Boolean(env[planOptions.operatorTokenEnv]);
  const evidence = repositoryEvidence(cwd);

  if (!planOptions.dryRun) {
    if (!frontendUrl)
      missingInputs.push("STAGING_FRONTEND_URL or --frontend-url");
    if (!apiUrl) missingInputs.push("STAGING_API_URL or --api-url");
    if (!operationalTokenPresent) {
      missingInputs.push(planOptions.operationalTokenEnv);
    }
  }

  for (const item of evidence) {
    if (!item.present) {
      errors.push(`Required repository evidence is missing: ${item.path}`);
    }
  }

  const checks = CHECK_DEFINITIONS.map((definition) => {
    const needsOperationalToken =
      definition.operationalToken && !operationalTokenPresent;
    const needsOperatorToken =
      definition.operatorToken && !operatorTokenPresent;
    const targetMissing =
      (definition.target === "frontend" && !frontendUrl) ||
      (definition.target === "api" && !apiUrl);
    const skipped =
      planOptions.dryRun ||
      targetMissing ||
      needsOperationalToken ||
      needsOperatorToken;

    return {
      id: definition.id,
      description: definition.description,
      path: definition.path,
      required: definition.required,
      target: definition.target,
      status: planOptions.dryRun ? "planned" : skipped ? "skipped" : "pending",
      reason: targetMissing
        ? `${definition.target} URL is missing.`
        : needsOperationalToken
          ? `${planOptions.operationalTokenEnv} is not set.`
          : needsOperatorToken
            ? `${planOptions.operatorTokenEnv} is not set.`
            : planOptions.dryRun
              ? "Dry run only."
              : undefined,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    mode: planOptions.dryRun ? "dry-run" : "live",
    commit: getCommitSha(cwd),
    configuration: {
      apiUrl: apiUrl || null,
      evidenceFile: planOptions.evidenceFile || null,
      frontendUrl: frontendUrl || null,
      operationalTokenEnv: planOptions.operationalTokenEnv,
      operationalTokenPresent,
      operatorTokenEnv: planOptions.operatorTokenEnv,
      operatorTokenPresent,
      timeoutMs: planOptions.timeoutMs,
    },
    repositoryEvidence: evidence,
    missingInputs,
    validationErrors: errors,
    checks,
  };
}

function joinUrl(baseUrl, path) {
  return new URL(path, `${baseUrl.replace(/\/+$/u, "")}/`).toString();
}

function headersToObject(headers) {
  const output = {};
  for (const headerName of [
    "cache-control",
    "content-type",
    "www-authenticate",
    "x-request-id",
  ]) {
    const value = headers.get(headerName);
    if (value) {
      output[headerName] = value;
    }
  }
  return output;
}

async function readResponseBody(response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json") || !text) {
    return { text: text.slice(0, 160) };
  }

  try {
    return { json: JSON.parse(text) };
  } catch {
    return { text: text.slice(0, 160) };
  }
}

function summarizeBody(body) {
  const json = body.json;
  if (!json || typeof json !== "object") {
    return body.text ? { textPreview: body.text } : {};
  }

  const summary = {};
  for (const key of [
    "ok",
    "ready",
    "service",
    "status",
    "environment",
    "version",
    "requestId",
  ]) {
    if (key in json) {
      summary[key] = json[key];
    }
  }
  return summary;
}

function statusAllowed(status, allowed) {
  return allowed.includes(status);
}

function evaluateCheck(definition, response, body) {
  const json = body.json;
  const cacheControl = response.headers.get("cache-control") ?? "";

  switch (definition.id) {
    case "frontend-health":
      return (
        response.status === 200 &&
        json?.service === "cruzible-frontend" &&
        json?.status === "ok" &&
        /\bno-store\b/iu.test(cacheControl)
      );
    case "api-live":
      return response.status === 200 && json?.ok === true;
    case "api-ready":
      return (
        response.status === 200 &&
        (json?.ready === true || json?.status === "ready")
      );
    case "api-full-health-rejects-anonymous":
    case "api-reconciliation-status-rejects-anonymous":
      return response.status === 401;
    case "api-metrics-rejects-anonymous":
    case "api-docs-rejects-anonymous":
      return statusAllowed(response.status, [401, 404]);
    case "api-full-health-with-operational-token":
      return response.status === 200 && json?.service === "cruzible-api";
    case "api-public-reconciliation":
      return response.status === 200;
    case "api-reconciliation-status-with-operator-token":
    case "api-alert-summary-with-operator-token":
      return response.status === 200;
    default:
      return response.status >= 200 && response.status < 300;
  }
}

async function requestWithTimeout(fetchImpl, url, { headers, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(url, {
      headers,
      method: "GET",
      signal: controller.signal,
    });
    const body = await readResponseBody(response);
    return {
      body,
      durationMs: Date.now() - startedAt,
      headers: headersToObject(response.headers),
      status: response.status,
      response,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runStagedLaunchDrill({
  cwd = process.cwd(),
  env = process.env,
  fetchImpl = globalThis.fetch,
  options = {},
} = {}) {
  const plan = buildStagedLaunchDrillPlan({ cwd, env, options });

  if (plan.mode === "dry-run") {
    return {
      ...plan,
      status: plan.validationErrors.length > 0 ? "failed" : "dry-run-ready",
      summary: {
        failed: plan.validationErrors.length,
        passed: 0,
        planned: plan.checks.length,
        skipped: 0,
      },
    };
  }

  if (plan.validationErrors.length > 0 || plan.missingInputs.length > 0) {
    return {
      ...plan,
      status: "failed",
      summary: {
        failed: plan.validationErrors.length + plan.missingInputs.length,
        passed: 0,
        planned: 0,
        skipped: plan.checks.length,
      },
    };
  }

  if (typeof fetchImpl !== "function") {
    throw new Error(
      "A fetch implementation is required for live staged launch drills.",
    );
  }

  const checks = [];
  const operationalToken = env[plan.configuration.operationalTokenEnv];
  const operatorToken = env[plan.configuration.operatorTokenEnv];

  for (const definition of CHECK_DEFINITIONS) {
    const planned = plan.checks.find((check) => check.id === definition.id);
    if (!planned || planned.status === "skipped") {
      checks.push(planned);
      continue;
    }

    const baseUrl =
      definition.target === "frontend"
        ? plan.configuration.frontendUrl
        : plan.configuration.apiUrl;
    const headers = {};
    if (definition.operationalToken) {
      headers["x-operational-token"] = operationalToken;
    }
    if (definition.operatorToken) {
      headers.authorization = `Bearer ${operatorToken}`;
    }

    try {
      const url = joinUrl(baseUrl, definition.path);
      const result = await requestWithTimeout(fetchImpl, url, {
        headers,
        timeoutMs: plan.configuration.timeoutMs,
      });
      const passed = evaluateCheck(definition, result.response, result.body);
      checks.push({
        ...planned,
        durationMs: result.durationMs,
        headers: result.headers,
        httpStatus: result.status,
        status: passed ? "pass" : "fail",
        summary: summarizeBody(result.body),
      });
    } catch (error) {
      checks.push({
        ...planned,
        message: error instanceof Error ? error.message : String(error),
        status: "fail",
      });
    }
  }

  const failed = checks.filter(
    (check) => check.required && check.status !== "pass",
  ).length;
  const passed = checks.filter((check) => check.status === "pass").length;
  const skipped = checks.filter((check) => check.status === "skipped").length;

  return {
    ...plan,
    checks,
    status: failed > 0 ? "failed" : "passed",
    summary: {
      failed,
      passed,
      planned: 0,
      skipped,
    },
  };
}

function writeEvidenceFile(cwd, evidenceFile, result) {
  if (!evidenceFile) {
    return;
  }

  const outputPath = resolve(cwd, evidenceFile);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `Wrote staged launch drill evidence to ${relative(cwd, outputPath)}`,
  );
}

async function main() {
  let options;
  try {
    options = parseStagedLaunchDrillArgs();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exit(2);
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  const result = await runStagedLaunchDrill({ options });
  writeEvidenceFile(process.cwd(), options.evidenceFile, result);
  console.log(JSON.stringify(result, null, 2));

  if (result.status === "failed") {
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
}
