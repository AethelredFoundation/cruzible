#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadDisasterRecoveryTargets,
  validateDisasterRecoveryTargets,
} from "./validate-dr-targets.mjs";

export const RESTORE_DRILL_EVIDENCE_PATH =
  "docs/ops/restore-drill-evidence.example.json";

const SCHEMA = "cruzible.restore_drill_evidence.v1";
const BACKUP_SCHEMA = "cruzible.database_backup.v1";
const SHA256_HEX = /^[a-f0-9]{64}$/iu;
const COMMIT_SHA = /^[a-f0-9]{7,64}$/iu;
const ENVIRONMENTS = new Set(["staging", "pre-production", "production"]);
const READINESS_STATUS = new Set(["passed", "ready"]);
const APPROVAL_DECISION = "approved";
const SENSITIVE_KEY =
  /(?:authorization|bearer|cookie|credential|database_url|password|private[_-]?key|secret|token)/iu;
const SENSITIVE_VALUE =
  /(?:Bearer\s+[A-Za-z0-9._~+/=-]+|postgres(?:ql)?:\/\/[^/\s:@]+:[^@\s]+@|-----BEGIN [A-Z ]*PRIVATE KEY-----)/u;

function requireObject(value, pathLabel, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${pathLabel} must be an object`);
    return {};
  }

  return value;
}

function requireNonEmptyString(value, pathLabel, errors) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${pathLabel} must be a non-empty string`);
    return "";
  }

  return value.trim();
}

function requireTimestamp(value, pathLabel, errors) {
  const timestamp = requireNonEmptyString(value, pathLabel, errors);
  const parsed = Date.parse(timestamp);

  if (!timestamp || Number.isNaN(parsed)) {
    errors.push(`${pathLabel} must be a valid ISO timestamp`);
    return null;
  }

  if (new Date(parsed).toISOString() !== timestamp) {
    errors.push(`${pathLabel} must use canonical UTC ISO format`);
  }

  return parsed;
}

function requireInteger(value, pathLabel, errors, { min = 0 } = {}) {
  if (!Number.isInteger(value) || value < min) {
    errors.push(`${pathLabel} must be an integer >= ${min}`);
    return min;
  }

  return value;
}

function scanForSensitiveMaterial(value, pathLabel, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      scanForSensitiveMaterial(item, `${pathLabel}[${index}]`, errors),
    );
    return;
  }

  if (!value || typeof value !== "object") {
    if (typeof value === "string" && SENSITIVE_VALUE.test(value)) {
      errors.push(`${pathLabel} must not contain secret-bearing values`);
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${pathLabel}.${key}`;
    if (SENSITIVE_KEY.test(key)) {
      errors.push(`${childPath} must not be present in restore evidence`);
    }
    scanForSensitiveMaterial(child, childPath, errors);
  }
}

function validateBackupManifest(manifest, errors) {
  const backupManifest = requireObject(
    manifest,
    "$.database_backup_manifest",
    errors,
  );

  if (backupManifest.schema !== BACKUP_SCHEMA) {
    errors.push(`$.database_backup_manifest.schema must be ${BACKUP_SCHEMA}`);
  }

  if (backupManifest.dry_run !== false) {
    errors.push("$.database_backup_manifest.dry_run must be false");
  }

  requireTimestamp(
    backupManifest.created_at,
    "$.database_backup_manifest.created_at",
    errors,
  );
  requireNonEmptyString(
    backupManifest.label,
    "$.database_backup_manifest.label",
    errors,
  );

  if (!["DATABASE_URL", "DATABASE_URL_FILE"].includes(backupManifest.source)) {
    errors.push(
      "$.database_backup_manifest.source must be DATABASE_URL or DATABASE_URL_FILE",
    );
  }

  const database = requireObject(
    backupManifest.database,
    "$.database_backup_manifest.database",
    errors,
  );
  for (const field of ["protocol", "host", "port", "name", "username"]) {
    requireNonEmptyString(
      database[field],
      `$.database_backup_manifest.database.${field}`,
      errors,
    );
  }

  if (!["postgres", "postgresql"].includes(database.protocol)) {
    errors.push(
      "$.database_backup_manifest.database.protocol must be postgres or postgresql",
    );
  }

  const backup = requireObject(
    backupManifest.backup,
    "$.database_backup_manifest.backup",
    errors,
  );

  if (backup.format !== "postgres_custom") {
    errors.push(
      "$.database_backup_manifest.backup.format must be postgres_custom",
    );
  }

  const backupFile = requireNonEmptyString(
    backup.file,
    "$.database_backup_manifest.backup.file",
    errors,
  );
  const manifestFile = requireNonEmptyString(
    backup.manifest,
    "$.database_backup_manifest.backup.manifest",
    errors,
  );

  if (backupFile && !backupFile.endsWith(".dump")) {
    errors.push("$.database_backup_manifest.backup.file must end with .dump");
  }

  if (manifestFile && !manifestFile.endsWith(".manifest.json")) {
    errors.push(
      "$.database_backup_manifest.backup.manifest must end with .manifest.json",
    );
  }

  if (typeof backup.sha256 !== "string" || !SHA256_HEX.test(backup.sha256)) {
    errors.push(
      "$.database_backup_manifest.backup.sha256 must be a 64-character hex digest",
    );
  }

  requireInteger(
    backup.size_bytes,
    "$.database_backup_manifest.backup.size_bytes",
    errors,
    { min: 1 },
  );

  const pgDump = requireObject(
    backupManifest.pg_dump,
    "$.database_backup_manifest.pg_dump",
    errors,
  );
  requireNonEmptyString(
    pgDump.version,
    "$.database_backup_manifest.pg_dump.version",
    errors,
  );
  const command = requireNonEmptyString(
    pgDump.command,
    "$.database_backup_manifest.pg_dump.command",
    errors,
  );

  if (command && !command.includes("<backup>")) {
    errors.push(
      "$.database_backup_manifest.pg_dump.command must be redacted with <backup>",
    );
  }

  const verification = requireObject(
    backupManifest.verification,
    "$.database_backup_manifest.verification",
    errors,
  );
  if (verification.status !== "passed") {
    errors.push(
      "$.database_backup_manifest.verification.status must be passed",
    );
  }
  requireTimestamp(
    verification.checked_at,
    "$.database_backup_manifest.verification.checked_at",
    errors,
  );
  requireInteger(
    verification.duration_ms,
    "$.database_backup_manifest.verification.duration_ms",
    errors,
    { min: 0 },
  );
  requireInteger(
    verification.object_count,
    "$.database_backup_manifest.verification.object_count",
    errors,
    { min: 1 },
  );

  const pgRestore = requireObject(
    verification.pg_restore,
    "$.database_backup_manifest.verification.pg_restore",
    errors,
  );
  requireNonEmptyString(
    pgRestore.version,
    "$.database_backup_manifest.verification.pg_restore.version",
    errors,
  );
  const restoreCommand = requireNonEmptyString(
    pgRestore.command,
    "$.database_backup_manifest.verification.pg_restore.command",
    errors,
  );

  if (restoreCommand && !restoreCommand.includes("<backup>")) {
    errors.push(
      "$.database_backup_manifest.verification.pg_restore.command must be redacted with <backup>",
    );
  }
}

function validateReadinessProbe(readinessProbe, recoveredAt, errors) {
  const probe = requireObject(
    readinessProbe,
    "$.readiness_probe_result",
    errors,
  );
  const status = requireNonEmptyString(
    probe.status,
    "$.readiness_probe_result.status",
    errors,
  );

  if (status && !READINESS_STATUS.has(status)) {
    errors.push("$.readiness_probe_result.status must be passed or ready");
  }

  const checkedAt = requireTimestamp(
    probe.checked_at,
    "$.readiness_probe_result.checked_at",
    errors,
  );
  if (checkedAt !== null && recoveredAt !== null && checkedAt < recoveredAt) {
    errors.push(
      "$.readiness_probe_result.checked_at must be at or after recovered_at",
    );
  }

  if (!Array.isArray(probe.checks) || probe.checks.length < 4) {
    errors.push(
      "$.readiness_probe_result.checks must contain at least 4 checks",
    );
    return;
  }

  const checkIds = new Set();
  probe.checks.forEach((check, index) => {
    const item = requireObject(
      check,
      `$.readiness_probe_result.checks[${index}]`,
      errors,
    );
    const id = requireNonEmptyString(
      item.id,
      `$.readiness_probe_result.checks[${index}].id`,
      errors,
    );
    requireNonEmptyString(
      item.target,
      `$.readiness_probe_result.checks[${index}].target`,
      errors,
    );
    const checkStatus = requireNonEmptyString(
      item.status,
      `$.readiness_probe_result.checks[${index}].status`,
      errors,
    );

    if (id && checkIds.has(id)) {
      errors.push(`$.readiness_probe_result.checks contains duplicate ${id}`);
    }
    checkIds.add(id);

    if (checkStatus && !READINESS_STATUS.has(checkStatus)) {
      errors.push(
        `$.readiness_probe_result.checks[${index}].status must be passed or ready`,
      );
    }
  });
}

function validateOperatorApprovals(approvals, recoveredAt, errors) {
  if (!Array.isArray(approvals) || approvals.length < 2) {
    errors.push("$.operator_approvals must contain at least 2 approvals");
    return;
  }

  const approvers = new Set();
  const roles = new Set();
  approvals.forEach((approval, index) => {
    const item = requireObject(
      approval,
      `$.operator_approvals[${index}]`,
      errors,
    );
    const approver = requireNonEmptyString(
      item.approver,
      `$.operator_approvals[${index}].approver`,
      errors,
    );
    const role = requireNonEmptyString(
      item.role,
      `$.operator_approvals[${index}].role`,
      errors,
    );
    const decision = requireNonEmptyString(
      item.decision,
      `$.operator_approvals[${index}].decision`,
      errors,
    );
    const approvedAt = requireTimestamp(
      item.approved_at,
      `$.operator_approvals[${index}].approved_at`,
      errors,
    );

    if (approver && approvers.has(approver)) {
      errors.push(
        `$.operator_approvals contains duplicate approver ${approver}`,
      );
    }
    approvers.add(approver);
    if (role) {
      roles.add(role);
    }

    if (decision && decision !== APPROVAL_DECISION) {
      errors.push(
        `$.operator_approvals[${index}].decision must be ${APPROVAL_DECISION}`,
      );
    }

    if (
      approvedAt !== null &&
      recoveredAt !== null &&
      approvedAt < recoveredAt
    ) {
      errors.push(
        `$.operator_approvals[${index}].approved_at must be at or after recovered_at`,
      );
    }
  });

  if (roles.size < 2) {
    errors.push("$.operator_approvals must include at least 2 distinct roles");
  }
}

export function validateRestoreDrillEvidence(evidence, targets) {
  const errors = [];
  const root = requireObject(evidence, "$", errors);
  const targetValidation = validateDisasterRecoveryTargets(targets);

  for (const error of targetValidation.errors) {
    errors.push(`targets: ${error}`);
  }

  if (root.schema !== SCHEMA) {
    errors.push(`$.schema must be ${SCHEMA}`);
  }

  const commit = requireNonEmptyString(root.commit, "$.commit", errors);
  if (commit && !COMMIT_SHA.test(commit)) {
    errors.push("$.commit must be a git commit SHA");
  }

  const environment = requireNonEmptyString(
    root.environment,
    "$.environment",
    errors,
  );
  if (environment && !ENVIRONMENTS.has(environment)) {
    errors.push("$.environment must be staging, pre-production, or production");
  }

  const scenario = requireNonEmptyString(
    root.incident_scenario,
    "$.incident_scenario",
    errors,
  );
  if (scenario && scenario.length < 12) {
    errors.push("$.incident_scenario must describe the tested incident");
  }

  const startedAt = requireTimestamp(root.started_at, "$.started_at", errors);
  const recoveredAt = requireTimestamp(
    root.recovered_at,
    "$.recovered_at",
    errors,
  );

  if (startedAt !== null && recoveredAt !== null && recoveredAt <= startedAt) {
    errors.push("$.recovered_at must be after started_at");
  }

  const rtoActual = requireInteger(
    root.rto_actual_minutes,
    "$.rto_actual_minutes",
    errors,
    { min: 1 },
  );
  const rpoActual = requireInteger(
    root.rpo_actual_minutes,
    "$.rpo_actual_minutes",
    errors,
    { min: 0 },
  );
  const objectives = targets?.objectives ?? {};

  if (
    Number.isInteger(objectives.rto_minutes) &&
    rtoActual > objectives.rto_minutes
  ) {
    errors.push(
      `$.rto_actual_minutes exceeds target ${objectives.rto_minutes}`,
    );
  }

  if (
    Number.isInteger(objectives.rpo_minutes) &&
    rpoActual > objectives.rpo_minutes
  ) {
    errors.push(
      `$.rpo_actual_minutes exceeds target ${objectives.rpo_minutes}`,
    );
  }

  if (startedAt !== null && recoveredAt !== null) {
    const elapsedMinutes = Math.ceil((recoveredAt - startedAt) / 60_000);
    if (rtoActual > elapsedMinutes + 1) {
      errors.push(
        "$.rto_actual_minutes must not exceed elapsed drill minutes by more than 1",
      );
    }
  }

  validateBackupManifest(root.database_backup_manifest, errors);
  validateReadinessProbe(root.readiness_probe_result, recoveredAt, errors);
  validateOperatorApprovals(root.operator_approvals, recoveredAt, errors);
  scanForSensitiveMaterial(root, "$", errors);

  return { errors };
}

export function loadRestoreDrillEvidence(
  evidencePath = RESTORE_DRILL_EVIDENCE_PATH,
  root = process.cwd(),
) {
  const absolutePath = path.isAbsolute(evidencePath)
    ? evidencePath
    : path.join(root, evidencePath);
  return JSON.parse(readFileSync(absolutePath, "utf8"));
}

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isCliEntrypoint) {
  const evidencePath = process.argv[2] ?? RESTORE_DRILL_EVIDENCE_PATH;

  if (evidencePath === "--help" || evidencePath === "-h") {
    console.log(
      "Usage: node scripts/validate-restore-drill-evidence.mjs [evidence.json]",
    );
    process.exit(0);
  }

  const targets = loadDisasterRecoveryTargets();
  const evidence = loadRestoreDrillEvidence(evidencePath);
  const { errors } = validateRestoreDrillEvidence(evidence, targets);

  if (errors.length > 0) {
    console.error("Restore drill evidence validation failed.");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("Restore drill evidence validation passed.");
}
