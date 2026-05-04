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

    for (const [index, line] of lines.entries()) {
      for (const rule of scanRules) {
        if (rule.pattern.test(line)) {
          findings.push({
            file: path.relative(root, filePath),
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
