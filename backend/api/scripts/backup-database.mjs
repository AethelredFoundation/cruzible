#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_OUTPUT_DIR = "backups";
const BACKUP_SCHEMA = "cruzible.database_backup.v1";

export function parseArgs(argv) {
  const options = {
    dryRun: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    label: "pre-migration",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--output-dir") {
      options.outputDir = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--output-dir=")) {
      options.outputDir = arg.slice("--output-dir=".length);
      continue;
    }

    if (arg === "--label") {
      options.label = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--label=")) {
      options.label = arg.slice("--label=".length);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  validateLabel(options.label);

  if (!options.outputDir.trim()) {
    throw new Error("--output-dir must not be empty");
  }

  return options;
}

export function loadDatabaseUrl(env = process.env) {
  if (env.DATABASE_URL_FILE) {
    const value = readFileSync(env.DATABASE_URL_FILE, "utf8").trim();
    if (!value) {
      throw new Error("DATABASE_URL_FILE is empty");
    }

    return { value, source: "DATABASE_URL_FILE" };
  }

  if (env.DATABASE_URL) {
    return { value: env.DATABASE_URL.trim(), source: "DATABASE_URL" };
  }

  throw new Error("DATABASE_URL_FILE or DATABASE_URL is required");
}

export function parsePostgresUrl(databaseUrl) {
  let parsed;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Database URL is not a valid URL");
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("Database URL must use postgres:// or postgresql://");
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const sslmode = parsed.searchParams.get("sslmode") ?? undefined;

  if (!parsed.hostname) {
    throw new Error("Database URL must include a hostname");
  }

  if (!database) {
    throw new Error("Database URL must include a database name");
  }

  if (!username) {
    throw new Error("Database URL must include a username");
  }

  return {
    protocol: parsed.protocol.replace(":", ""),
    host: parsed.hostname,
    port: parsed.port || "5432",
    database,
    username,
    password,
    sslmode,
  };
}

export function buildBackupPaths(outputDir, label, now = new Date()) {
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const safeLabel = validateLabel(label);
  const outputDirectory = resolve(process.cwd(), outputDir);
  const baseName = `cruzible-db-${safeLabel}-${timestamp}`;

  return {
    outputDirectory,
    backupPath: resolve(outputDirectory, `${baseName}.dump`),
    manifestPath: resolve(outputDirectory, `${baseName}.manifest.json`),
  };
}

export function buildPgDumpInvocation(
  connection,
  backupPath,
  env = process.env,
) {
  const pgEnv = {
    ...env,
    PGCONNECT_TIMEOUT: env.PGCONNECT_TIMEOUT || "10",
    PGDATABASE: connection.database,
    PGHOST: connection.host,
    PGPORT: connection.port,
    PGUSER: connection.username,
  };

  delete pgEnv.DATABASE_URL;
  delete pgEnv.DATABASE_URL_FILE;

  if (connection.password) {
    pgEnv.PGPASSWORD = connection.password;
  } else {
    delete pgEnv.PGPASSWORD;
  }

  if (connection.sslmode) {
    pgEnv.PGSSLMODE = connection.sslmode;
  }

  return {
    command: "pg_dump",
    args: [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--file",
      backupPath,
    ],
    env: pgEnv,
    redactedCommand:
      "pg_dump --format=custom --no-owner --no-privileges --file <backup>",
  };
}

export function buildBackupManifest({
  backupPath,
  connection,
  dryRun,
  label,
  manifestPath,
  pgDumpCommand,
  source,
  version,
}) {
  return {
    schema: BACKUP_SCHEMA,
    created_at: new Date().toISOString(),
    label,
    dry_run: dryRun,
    database: {
      protocol: connection.protocol,
      host: connection.host,
      port: connection.port,
      name: connection.database,
      username: connection.username,
      sslmode: connection.sslmode ?? null,
    },
    source,
    backup: {
      format: "postgres_custom",
      file: basename(backupPath),
      manifest: basename(manifestPath),
    },
    pg_dump: {
      version,
      command: pgDumpCommand,
    },
  };
}

function validateLabel(label) {
  if (!/^[A-Za-z0-9._-]{1,48}$/.test(label)) {
    throw new Error(
      "--label must be 1-48 characters using only letters, numbers, dot, underscore, or hyphen",
    );
  }

  return label;
}

function getPgDumpVersion() {
  const result = spawnSync("pg_dump", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw new Error(`pg_dump is required: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error("pg_dump --version failed");
  }

  return result.stdout.trim();
}

function printHelp() {
  console.log(`Usage: npm run db:backup -- [--output-dir DIR] [--label LABEL] [--dry-run]

Creates a PostgreSQL custom-format backup using DATABASE_URL_FILE or DATABASE_URL.
The database password is passed through PGPASSWORD, not command-line arguments.

Options:
  --output-dir DIR   Directory for .dump and .manifest.json files. Default: ${DEFAULT_OUTPUT_DIR}
  --label LABEL      Safe filename label for the backup. Default: pre-migration
  --dry-run          Print the redacted backup plan without running pg_dump.
`);
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);

  if (options.help) {
    printHelp();
    return 0;
  }

  const { value: databaseUrl, source } = loadDatabaseUrl(env);
  const connection = parsePostgresUrl(databaseUrl);
  const { outputDirectory, backupPath, manifestPath } = buildBackupPaths(
    options.outputDir,
    options.label,
  );
  const invocation = buildPgDumpInvocation(connection, backupPath, env);
  const manifest = buildBackupManifest({
    backupPath,
    connection,
    dryRun: options.dryRun,
    label: options.label,
    manifestPath,
    pgDumpCommand: invocation.redactedCommand,
    source,
    version: options.dryRun ? "not-executed" : getPgDumpVersion(),
  });

  if (options.dryRun) {
    console.log(JSON.stringify(manifest, null, 2));
    return 0;
  }

  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

  const result = spawnSync(invocation.command, invocation.args, {
    env: invocation.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw new Error(`pg_dump failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`pg_dump exited with status ${result.status}`);
  }

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });

  console.log(`Database backup written to ${backupPath}`);
  console.log(`Backup manifest written to ${manifestPath}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
