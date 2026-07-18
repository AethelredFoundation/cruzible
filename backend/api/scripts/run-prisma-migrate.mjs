import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const mode = process.argv[2] ?? "deploy";
if (mode !== "deploy" && mode !== "status") {
  throw new Error(`Unsupported Prisma migration mode: ${mode}`);
}

if (
  mode === "deploy" &&
  process.env.CRUZIBLE_MIGRATION_QUIESCED?.trim().toLowerCase() !== "true"
) {
  throw new Error(
    "CRUZIBLE_MIGRATION_QUIESCED=true is required after the indexer has been scaled to zero and fully drained",
  );
}

if (
  mode === "deploy" &&
  process.env.CRUZIBLE_LEGACY_SCHEDULERS_QUIESCED?.trim().toLowerCase() !==
    "true"
) {
  throw new Error(
    "CRUZIBLE_LEGACY_SCHEDULERS_QUIESCED=true is required after every pre-namespace API scheduler has been scaled to zero and fully drained",
  );
}

const directUrl = process.env.DATABASE_URL?.trim();
const urlFile = process.env.DATABASE_URL_FILE?.trim();
if (directUrl && urlFile) {
  throw new Error(
    "DATABASE_URL and DATABASE_URL_FILE are mutually exclusive for migrations",
  );
}

let databaseUrl = directUrl;
if (!databaseUrl && urlFile) {
  try {
    databaseUrl = readFileSync(urlFile, "utf8").trim();
  } catch {
    throw new Error("Unable to read DATABASE_URL_FILE for migrations");
  }
}

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL or DATABASE_URL_FILE is required for migrations",
  );
}

const result = spawnSync(
  "./node_modules/.bin/prisma",
  ["migrate", mode, "--schema", "prisma/schema.prisma"],
  {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  },
);

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
