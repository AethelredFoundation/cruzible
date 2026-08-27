import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REGISTER_PATH = "docs/architecture/13-production-gap-register.md";
const MINIMUM_GAP_COUNT = 50;
const VALID_STATUSES = new Set([
  "Ready",
  "Mitigated",
  "In progress",
  "Open",
  "Blocked external",
]);

function splitMarkdownRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function parseProductionGapRows(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^\|\s*PG-\d{3}\s*\|/.test(line))
    .map((line) => {
      const [id, domain, gap, evidence, status, nextAction] =
        splitMarkdownRow(line);

      return {
        id,
        domain,
        gap,
        evidence,
        status,
        nextAction,
      };
    });
}

function hasRepoOrExternalEvidence(value) {
  return /`[^`]+`|\bexternal\b|\boperator\b|\bstaging\b|\bfunding\b/i.test(
    value,
  );
}

export function validateProductionGapRegister(markdown) {
  const rows = parseProductionGapRows(markdown);
  const errors = [];
  const ids = new Set();

  if (rows.length < MINIMUM_GAP_COUNT) {
    errors.push(
      `Expected at least ${MINIMUM_GAP_COUNT} production gaps, found ${rows.length}`,
    );
  }

  rows.forEach((row, index) => {
    const expectedId = `PG-${String(index + 1).padStart(3, "0")}`;

    if (row.id !== expectedId) {
      errors.push(
        `Expected row ${index + 1} to use ${expectedId}, got ${row.id}`,
      );
    }

    if (ids.has(row.id)) {
      errors.push(`Duplicate production gap id ${row.id}`);
    }
    ids.add(row.id);

    for (const [field, value] of Object.entries(row)) {
      if (!value || value.length < 3) {
        errors.push(`${row.id} has an empty or too-short ${field}`);
      }
    }

    if (!VALID_STATUSES.has(row.status)) {
      errors.push(`${row.id} uses invalid status "${row.status}"`);
    }

    if (!hasRepoOrExternalEvidence(row.evidence)) {
      errors.push(
        `${row.id} evidence must reference repo evidence or external dependency`,
      );
    }

    if (/^(?:n\/a|none|tbd|todo)$/i.test(row.nextAction)) {
      errors.push(`${row.id} must have a concrete next action`);
    }
  });

  return { rows, errors };
}

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isCliEntrypoint) {
  const root = process.cwd();
  const registerPath = path.join(root, REGISTER_PATH);
  const markdown = readFileSync(registerPath, "utf8");
  const { rows, errors } = validateProductionGapRegister(markdown);

  if (errors.length > 0) {
    console.error("Production gap register validation failed.");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `Production gap register validation passed (${rows.length} tracked gaps).`,
  );
}
