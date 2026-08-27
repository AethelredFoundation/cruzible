import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_SCAN_BYTES = 5 * 1024 * 1024;
const EXCLUDED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "audit-artifacts",
  "coverage",
  "dist",
  "node_modules",
  "reports",
  "target",
]);
const EXCLUDED_FILE_SUFFIXES = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".tsbuildinfo",
  ".wasm",
];

const stitch = (...fragments) => fragments.join("");
const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const blockedSourceTerms = [
  stitch("cl", "aude"),
  stitch("anth", "ropic"),
  stitch("co", "dex"),
  stitch("op", "en", "ai"),
  stitch("co", "-", "authored"),
  stitch("co", "-", "author"),
  stitch("dependent", " ", "bot"),
  stitch("dependent", " ", "bots"),
];

const scanRules = [
  {
    id: "restricted-provenance-text",
    pattern: new RegExp(
      `\\b(${blockedSourceTerms.map(escapePattern).join("|")})\\b`,
      "i",
    ),
  },
  {
    id: "private-key-block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----/i,
  },
  {
    id: "aws-access-key",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: "github-token",
    pattern: /\b(?:ghp_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  {
    id: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    id: "stripe-live-key",
    pattern: /\bsk_live_[A-Za-z0-9]{20,}\b/,
  },
  {
    id: "sendgrid-token",
    pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
  },
];

const normalizePath = (value) => value.split(path.sep).join("/");

function relativePathFor(root, filePath) {
  return normalizePath(path.relative(root, filePath));
}

function isFrontendRuntimeSource(relativePath) {
  return (
    relativePath.startsWith("src/") &&
    !relativePath.startsWith("src/__tests__/") &&
    !relativePath.startsWith("src/mocks/") &&
    /\.(?:ts|tsx|js|jsx)$/.test(relativePath)
  );
}

function isBackendApiRuntimeSource(relativePath) {
  return (
    relativePath.startsWith("backend/api/src/") &&
    /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(relativePath)
  );
}

function isRuntimeSource(relativePath) {
  return (
    isFrontendRuntimeSource(relativePath) ||
    isBackendApiRuntimeSource(relativePath)
  );
}

function isDeploymentRuntimeFile(relativePath) {
  return (
    relativePath === "Dockerfile" ||
    relativePath === "backend/api/Dockerfile" ||
    relativePath.startsWith("backend/infra/") ||
    relativePath.startsWith("k8s/") ||
    relativePath.startsWith("terraform/")
  );
}

const scopedLineRules = [
  {
    id: "frontend-dangerous-dom-sink",
    appliesTo: isFrontendRuntimeSource,
    pattern:
      /\bdangerouslySetInnerHTML\b|\b__html\s*:|\.(?:innerHTML|outerHTML)\b|\binsertAdjacentHTML\s*\(|\bdocument\.(?:write|writeln)\s*\(|\bDOMParser\s*\(|\bcreateContextualFragment\s*\(/,
  },
  {
    id: "frontend-dynamic-code-execution",
    appliesTo: isFrontendRuntimeSource,
    pattern:
      /(?<![\w$.])eval\s*\(|\bnew\s+Function\s*\(|\bset(?:Timeout|Interval)\s*\(\s*["'`]/,
  },
  {
    id: "frontend-unreviewed-postmessage",
    appliesTo: isFrontendRuntimeSource,
    pattern:
      /\.postMessage\s*\([^,\n]+,\s*["']\*["']|addEventListener\s*\(\s*["']message["']/,
  },
  {
    id: "frontend-sensitive-web-storage",
    appliesTo: isFrontendRuntimeSource,
    pattern:
      /(?:localStorage|sessionStorage).*(?:token|jwt|session|auth|refresh|secret|private|password)|(?:token|jwt|session|auth|refresh|secret|private|password).*(?:localStorage|sessionStorage)/i,
  },
  {
    id: "frontend-placeholder-link",
    appliesTo: isFrontendRuntimeSource,
    pattern: /\bhref\s*=\s*["']#["']|\bhref\s*:\s*["']#["']/,
  },
  {
    id: "frontend-window-open",
    appliesTo: isFrontendRuntimeSource,
    pattern: /\bwindow\.open\s*\(/,
  },
  {
    id: "frontend-runtime-mock-import",
    appliesTo: isFrontendRuntimeSource,
    pattern: /["'](?:@\/mocks|(?:\.\.\/)+mocks)|\bsetupWorker\b|\bmsw\b/,
  },
  {
    id: "runtime-insecure-http-parser",
    appliesTo: isRuntimeSource,
    pattern: /\binsecureHTTPParser\s*:\s*true\b/,
  },
  {
    id: "backend-command-execution-sink",
    appliesTo: isBackendApiRuntimeSource,
    pattern:
      /from\s+["']node:child_process["']|require\s*\(\s*["'](?:node:)?child_process["']\s*\)|(?<![\w$.])(?:exec|execSync|spawn|spawnSync|fork)\s*\(|\bshell\s*:\s*true\b/,
  },
  {
    id: "backend-open-redirect-from-request",
    appliesTo: isBackendApiRuntimeSource,
    pattern:
      /\bres\.redirect\s*\(\s*req\.(?:query|body|params)|\bres\.location\s*\(\s*req\.(?:query|body|params)/,
  },
  {
    id: "backend-unsafe-file-serving-from-request",
    appliesTo: isBackendApiRuntimeSource,
    pattern:
      /\bres\.(?:sendFile|download)\s*\(\s*req\.(?:query|body|params)|\bfs\.(?:readFile|createReadStream)\s*\(\s*req\.(?:query|body|params)/,
  },
  {
    id: "backend-unbounded-body-parser",
    appliesTo: isBackendApiRuntimeSource,
    pattern: /\bexpress\.(?:json|urlencoded)\s*\(\s*\)/,
  },
  {
    id: "backend-insecure-trust-proxy",
    appliesTo: isBackendApiRuntimeSource,
    pattern: /\btrust proxy["']?\s*,\s*true\b/,
  },
  {
    id: "backend-wildcard-cors",
    appliesTo: isBackendApiRuntimeSource,
    pattern: /Access-Control-Allow-Origin["']?\s*,?\s*["']\*["']/,
  },
  {
    id: "deployment-node-inspector",
    appliesTo: isDeploymentRuntimeFile,
    pattern: /--inspect(?:=|\b)/,
  },
  {
    id: "deployment-next-dev-runtime",
    appliesTo: isDeploymentRuntimeFile,
    pattern: /\bnext\s+dev\b/,
  },
];

const scopedContextRules = [
  {
    id: "frontend-target-blank-without-noopener",
    appliesTo: isFrontendRuntimeSource,
    matches(lines, index) {
      const line = lines[index];
      if (!/\btarget\s*=\s*["']_blank["']/.test(line)) {
        return false;
      }

      const nearbyMarkup = lines.slice(index, index + 4).join("\n");
      return !/\brel\s*=\s*["'][^"']*\bnoopener\b[^"']*\bnoreferrer\b[^"']*["']|\brel\s*=\s*["'][^"']*\bnoreferrer\b[^"']*\bnoopener\b[^"']*["']/.test(
        nearbyMarkup,
      );
    },
  },
];

function isExcludedPath(root, candidate) {
  const relativePath = path.relative(root, candidate);
  const parts = relativePath.split(path.sep);

  return parts.some((part) => EXCLUDED_DIRS.has(part));
}

function shouldScanFile(root, filePath, fileStats) {
  if (isExcludedPath(root, filePath)) {
    return false;
  }

  if (fileStats.size > MAX_SCAN_BYTES) {
    return false;
  }

  const normalized = filePath.toLowerCase();
  return !EXCLUDED_FILE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function isLikelyBinary(buffer) {
  return buffer.includes(0);
}

function* walkFiles(root) {
  const entries = readdirSync(root, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name),
  );

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        yield* walkFiles(entryPath);
      }
      continue;
    }

    if (entry.isFile()) {
      yield entryPath;
    }
  }
}

export function scanRepository(rootDirectory = process.cwd()) {
  const root = path.resolve(rootDirectory);

  if (!existsSync(root)) {
    throw new Error(`Scan root does not exist: ${root}`);
  }

  const findings = [];

  for (const filePath of walkFiles(root)) {
    const fileStats = statSync(filePath);

    if (!shouldScanFile(root, filePath, fileStats)) {
      continue;
    }

    const buffer = readFileSync(filePath);

    if (isLikelyBinary(buffer)) {
      continue;
    }

    const lines = buffer.toString("utf8").split(/\r?\n/);
    const relativePath = relativePathFor(root, filePath);

    for (const [index, line] of lines.entries()) {
      for (const rule of scanRules) {
        if (rule.pattern.test(line)) {
          findings.push({
            file: relativePath,
            line: index + 1,
            rule: rule.id,
          });
        }
      }

      for (const rule of scopedLineRules) {
        if (rule.appliesTo(relativePath) && rule.pattern.test(line)) {
          findings.push({
            file: relativePath,
            line: index + 1,
            rule: rule.id,
          });
        }
      }

      for (const rule of scopedContextRules) {
        if (rule.appliesTo(relativePath) && rule.matches(lines, index)) {
          findings.push({
            file: relativePath,
            line: index + 1,
            rule: rule.id,
          });
        }
      }
    }
  }

  return findings;
}

function printFindings(findings) {
  console.error("Repository hygiene scan failed.");
  console.error(
    "Remove the flagged content or document an explicit scanner update.",
  );

  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} ${finding.rule}`);
  }
}

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isCliEntrypoint) {
  const root = process.argv[2] ?? process.cwd();
  const findings = scanRepository(root);

  if (findings.length > 0) {
    printFindings(findings);
    process.exit(1);
  }

  console.log("Repository hygiene scan passed.");
}
