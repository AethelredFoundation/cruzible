import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DR_TARGETS_PATH = "docs/ops/disaster-recovery-targets.json";
const SCHEMA = "cruzible.disaster_recovery_targets.v1";
const MAX_RTO_MINUTES = 240;
const MAX_RPO_MINUTES = 60;
const REQUIRED_SERVICES = ["postgres", "redis", "api", "frontend", "contracts"];
const REQUIRED_DRILL_EVIDENCE = [
  "commit",
  "environment",
  "incident scenario",
  "started_at",
  "recovered_at",
  "rto_actual_minutes",
  "rpo_actual_minutes",
  "database_backup_manifest",
  "readiness_probe_result",
  "operator_approvals",
];

function requireObject(value, pathLabel, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${pathLabel} must be an object`);
    return {};
  }

  return value;
}

function requireBoolean(value, pathLabel, errors) {
  if (typeof value !== "boolean") {
    errors.push(`${pathLabel} must be a boolean`);
    return false;
  }

  return value;
}

function requirePositiveInteger(value, pathLabel, errors) {
  if (!Number.isInteger(value) || value <= 0) {
    errors.push(`${pathLabel} must be a positive integer`);
    return 0;
  }

  return value;
}

function requireStringList(value, pathLabel, errors, { minLength = 1 } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${pathLabel} must be an array`);
    return [];
  }

  const strings = value.filter(
    (item) => typeof item === "string" && item.trim(),
  );
  if (strings.length !== value.length) {
    errors.push(`${pathLabel} must contain only non-empty strings`);
  }

  if (strings.length < minLength) {
    errors.push(`${pathLabel} must contain at least ${minLength} entries`);
  }

  if (new Set(strings).size !== strings.length) {
    errors.push(`${pathLabel} must not contain duplicates`);
  }

  return strings;
}

export function validateDisasterRecoveryTargets(targets) {
  const errors = [];
  const root = requireObject(targets, "$", errors);

  if (root.schema !== SCHEMA) {
    errors.push(`$.schema must be ${SCHEMA}`);
  }

  if (
    typeof root.last_reviewed !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(root.last_reviewed)
  ) {
    errors.push("$.last_reviewed must use YYYY-MM-DD");
  }

  const objectives = requireObject(root.objectives, "$.objectives", errors);
  const rtoMinutes = requirePositiveInteger(
    objectives.rto_minutes,
    "$.objectives.rto_minutes",
    errors,
  );
  const rpoMinutes = requirePositiveInteger(
    objectives.rpo_minutes,
    "$.objectives.rpo_minutes",
    errors,
  );

  if (rtoMinutes > MAX_RTO_MINUTES) {
    errors.push(`$.objectives.rto_minutes cannot exceed ${MAX_RTO_MINUTES}`);
  }

  if (rpoMinutes > MAX_RPO_MINUTES) {
    errors.push(`$.objectives.rpo_minutes cannot exceed ${MAX_RPO_MINUTES}`);
  }

  for (const key of [
    "restore_drill_required_before_public_traffic",
    "backup_required_before_migrations",
    "privileged_audit_chain_must_be_preserved",
  ]) {
    if (!requireBoolean(objectives[key], `$.objectives.${key}`, errors)) {
      errors.push(`$.objectives.${key} must be true`);
    }
  }

  const services = Array.isArray(root.critical_services)
    ? root.critical_services
    : [];
  if (!Array.isArray(root.critical_services)) {
    errors.push("$.critical_services must be an array");
  }

  const serviceNames = new Set();
  const priorities = new Set();
  services.forEach((service, index) => {
    const serviceObj = requireObject(
      service,
      `$.critical_services[${index}]`,
      errors,
    );
    const name = serviceObj.name;
    if (typeof name !== "string" || !name.trim()) {
      errors.push(`$.critical_services[${index}].name must be a string`);
    } else if (serviceNames.has(name)) {
      errors.push(`$.critical_services contains duplicate service ${name}`);
    } else {
      serviceNames.add(name);
    }

    const priority = requirePositiveInteger(
      serviceObj.recovery_priority,
      `$.critical_services[${index}].recovery_priority`,
      errors,
    );
    if (priorities.has(priority)) {
      errors.push(
        `$.critical_services contains duplicate priority ${priority}`,
      );
    }
    priorities.add(priority);

    requireBoolean(
      serviceObj.stateful,
      `$.critical_services[${index}].stateful`,
      errors,
    );
    requireStringList(
      serviceObj.evidence_required,
      `$.critical_services[${index}].evidence_required`,
      errors,
      { minLength: 2 },
    );
  });

  for (const service of REQUIRED_SERVICES) {
    if (!serviceNames.has(service)) {
      errors.push(`$.critical_services must include ${service}`);
    }
  }

  const drillEvidence = requireStringList(
    root.required_drill_evidence,
    "$.required_drill_evidence",
    errors,
    { minLength: REQUIRED_DRILL_EVIDENCE.length },
  );
  for (const evidence of REQUIRED_DRILL_EVIDENCE) {
    if (!drillEvidence.includes(evidence)) {
      errors.push(`$.required_drill_evidence must include ${evidence}`);
    }
  }

  return { errors };
}

export function loadDisasterRecoveryTargets(root = process.cwd()) {
  return JSON.parse(readFileSync(path.join(root, DR_TARGETS_PATH), "utf8"));
}

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isCliEntrypoint) {
  const targets = loadDisasterRecoveryTargets();
  const { errors } = validateDisasterRecoveryTargets(targets);

  if (errors.length > 0) {
    console.error("Disaster recovery target validation failed.");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("Disaster recovery target validation passed.");
}
