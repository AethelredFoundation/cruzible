import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SCAN_TARGETS = [
  "README.md",
  "docs/architecture",
  "docs/ops",
  "backend/contracts",
  "src/components",
  "src/lib",
  "src/pages",
];

const SCANNED_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".md",
  ".mdx",
  ".ts",
  ".tsx",
]);

const EXCLUDED_PATHS = [
  /(^|\/)\.next(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)out(\/|$)/,
  /(^|\/)src\/__tests__(\/|$)/,
  /\.test\.[jt]sx?$/,
];

export const LAUNCH_CLAIM_RULES = [
  {
    id: "CLAIM-PRODUCTION-READY",
    pattern: /\bproduction[-\s]+ready\b/i,
    message:
      "Do not describe Cruzible as production ready until external audit, staging evidence, and operator sign-off are complete.",
    allow: [
      /\bnot\s+(?:yet\s+)?production[-\s]+ready\b/i,
      /\bshould\s+not\s+be\s+described\s+as\s+production[-\s]+ready\b/i,
      /\bnot\s+a\s+production\s+promise\b/i,
      /\bdoes\s+not\s+(?:assert|support)\s+(?:a\s+)?production[-\s]+ready\b/i,
      /\bunsupported\b.*\bproduction[-\s]+ready\b/i,
      /\bbefore\b.*\bproduction[-\s]+ready\b/i,
    ],
  },
  {
    id: "CLAIM-MAINNET-READY",
    pattern: /\bmainnet[-\s]+ready\b/i,
    message:
      "Do not describe Cruzible as mainnet ready until deployed contracts, operators, and external assurance are complete.",
    allow: [
      /\bnot\s+(?:yet\s+)?mainnet[-\s]+ready\b/i,
      /\bnot\s+a\s+mainnet[-\s]+ready\s+statement\b/i,
      /\bdoes\s+not\s+(?:assert|support)\b.*\bmainnet[-\s]+ready\b/i,
      /\bshould\s+not\s+be\s+described\s+as\b.*\bmainnet[-\s]+ready\b/i,
      /\bunsupported\b.*\bmainnet[-\s]+ready\b/i,
    ],
  },
  {
    id: "CLAIM-DEPLOYMENT-READY",
    pattern: /\bready\s+for\s+deployment\b/i,
    message:
      "Do not describe contracts as ready for deployment until staging evidence, external audit, and operator sign-off are complete.",
    allow: [
      /\bnot\s+ready\s+for\s+deployment\b/i,
      /\bshould\s+not\s+be\s+described\s+as\s+ready\s+for\s+deployment\b/i,
      /\bunsupported\b.*\bready\s+for\s+deployment\b/i,
    ],
  },
  {
    id: "CLAIM-ABSOLUTE-COVERAGE",
    pattern:
      /\b100%\s+(?:(?:execution\s+path|line|branch|error\s+handling|state\s+transition|query\s+handler)\s+)?coverage\b/i,
    message:
      "Do not claim absolute coverage without measured coverage artifacts and reviewable evidence.",
    allow: [
      /\bnot\s+(?:a\s+)?100%\s+coverage\s+claim\b/i,
      /\bshould\s+not\s+be\s+read\s+as\s+a\s+100%\s+coverage\s+claim\b/i,
      /\bunsupported\b.*\b100%\s+coverage\b/i,
    ],
  },
  {
    id: "CLAIM-UNBACKED-TEE-PROOF",
    pattern:
      /\b(?:proof[-\s]+backed|TEE[-\s]+verified|hardware[-\s]+verified|TEE\s+attestation\s+verification)\b/i,
    message:
      "Contract documentation must not imply proof-backed, TEE-verified, or hardware-verified assurance without explicit evidence scope.",
    paths: [/^backend\/contracts\//],
    allow: [
      /\bnot\s+(?:yet\s+)?(?:proof[-\s]+backed|TEE[-\s]+verified|hardware[-\s]+verified)\b/i,
      /\bnot\s+(?:a\s+)?(?:proof|TEE|hardware)[-\s]+(?:assurance|verification)\s+claim\b/i,
      /\bunsupported\b.*\b(?:proof|TEE|hardware)[-\s]+(?:backed|verified)\b/i,
      /\bevidence\b.*\b(?:field|scope|binding|record|manifest)\b/i,
      /\b(?:field|scope|binding|record|manifest)\b.*\bevidence\b/i,
    ],
  },
  {
    id: "CLAIM-RISK-FREE",
    pattern: /\b(?:risk[-\s]*free|zero\s+risk)\b/i,
    message:
      "Do not imply liquid staking is risk-free; validator, liquidity, contract, and operational risks must remain visible.",
    allow: [
      /\bnot\s+risk[-\s]*free\b/i,
      /\bnot\s+a\s+risk[-\s]*free\b/i,
      /\bno\s+risk[-\s]*free\s+claim\b/i,
      /\bunsupported\b.*\brisk[-\s]*free\b/i,
    ],
  },
  {
    id: "CLAIM-GUARANTEED-YIELD",
    pattern:
      /\b(?:guaranteed\s+(?:apy|yield|returns?|rewards?|profit|profits?)|(?:apy|yield|returns?|rewards?)\s+(?:is|are)\s+guaranteed)\b/i,
    message:
      "Do not guarantee APY, yield, rewards, returns, or profit; only live source-backed values may be shown.",
    allow: [
      /\bnot\s+guaranteed\b/i,
      /\bnot\s+a\s+guarantee\b/i,
      /\bdoes\s+not\s+guarantee\b/i,
    ],
  },
  {
    id: "CLAIM-AUDITED",
    pattern: /\b(?:fully\s+audited|audit[-\s]+ready|tier[-\s]+1\s+audited)\b/i,
    message:
      "Do not imply external audit completion or audit readiness beyond the repo-backed internal controls.",
    allow: [
      /\bnot\s+(?:fully\s+)?audited\b/i,
      /\bnot\s+audit[-\s]+ready\b/i,
      /\bunsupported\s+(?:external[-\s]+audit|audit[-\s]+ready)\b/i,
    ],
  },
];

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function isExcluded(filePath) {
  return EXCLUDED_PATHS.some((pattern) => pattern.test(filePath));
}

function walkFiles(root, relativePath = "") {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    return [];
  }

  const statEntries = readdirSync(absolutePath, { withFileTypes: true });
  return statEntries.flatMap((entry) => {
    const entryPath = toPosixPath(path.join(relativePath, entry.name));

    if (isExcluded(entryPath)) {
      return [];
    }

    if (entry.isDirectory()) {
      return walkFiles(root, entryPath);
    }

    if (!entry.isFile() || !SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
      return [];
    }

    return [entryPath];
  });
}

export function discoverLaunchClaimFiles({
  root = process.cwd(),
  targets = DEFAULT_SCAN_TARGETS,
} = {}) {
  return targets
    .flatMap((target) => {
      const absoluteTarget = path.join(root, target);
      if (!existsSync(absoluteTarget)) {
        return [];
      }

      const normalizedTarget = toPosixPath(target);
      if (isExcluded(normalizedTarget)) {
        return [];
      }

      const extension = path.extname(normalizedTarget);
      if (extension) {
        return SCANNED_EXTENSIONS.has(extension) ? [normalizedTarget] : [];
      }

      return walkFiles(root, normalizedTarget);
    })
    .filter((file, index, files) => files.indexOf(file) === index)
    .sort();
}

export function scanTextForLaunchClaims(filePath, text) {
  const findings = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const rule of LAUNCH_CLAIM_RULES) {
      if (rule.paths && !rule.paths.some((pattern) => pattern.test(filePath))) {
        continue;
      }

      if (!rule.pattern.test(line)) {
        continue;
      }

      if (rule.allow.some((allowed) => allowed.test(line))) {
        continue;
      }

      findings.push({
        rule: rule.id,
        file: filePath,
        line: index + 1,
        excerpt: line.trim(),
        message: rule.message,
      });
    }
  });

  return findings;
}

export function validateLaunchClaims(options = {}) {
  const root = options.root ?? process.cwd();
  const files =
    options.files ??
    discoverLaunchClaimFiles({ root, targets: options.targets });
  const findings = files.flatMap((file) => {
    const text = readFileSync(path.join(root, file), "utf8");
    return scanTextForLaunchClaims(file, text);
  });

  return {
    files,
    findings,
    errors: findings.map(
      (finding) =>
        `${finding.file}:${finding.line} ${finding.rule} ${finding.message} Offending copy: ${finding.excerpt}`,
    ),
  };
}

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isCliEntrypoint) {
  const { files, errors } = validateLaunchClaims();

  if (errors.length > 0) {
    console.error("Launch claim validation failed.");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `Launch claim validation passed (${files.length} files scanned).`,
  );
}
