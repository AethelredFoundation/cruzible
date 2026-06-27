import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attachBackupArtifactIntegrity,
  buildBackupManifest,
} from "../scripts/backup-database.mjs";

const apiRoot = process.cwd();

describe("database backup script", () => {
  it("is exposed as a backend API package command", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(apiRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["db:backup"]).toBe(
      "node scripts/backup-database.mjs",
    );
    expect(packageJson.scripts["db:backup:dry-run"]).toBe(
      "node scripts/backup-database.mjs --dry-run",
    );
    expect(packageJson.scripts["format:check"]).toContain('"scripts/**/*.mjs"');
  });

  it("prints a redacted backup plan without exposing credentials", () => {
    const stdout = execFileSync(
      process.execPath,
      [
        "scripts/backup-database.mjs",
        "--dry-run",
        "--output-dir",
        "/tmp/cruzible-backups",
        "--label",
        "pre-migration",
      ],
      {
        cwd: apiRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL:
            "postgresql://cruzible:super-secret-password@db.internal:5432/cruzible?sslmode=require",
          DATABASE_URL_FILE: "",
        },
      },
    );
    const plan = JSON.parse(stdout) as {
      schema: string;
      dry_run: boolean;
      database: { host: string; sslmode: string };
      backup: { sha256: null; size_bytes: null };
      pg_dump: { command: string };
      verification: { status: string; pg_restore: { command: string } };
    };

    expect(plan.schema).toBe("cruzible.database_backup.v1");
    expect(plan.dry_run).toBe(true);
    expect(plan.backup.sha256).toBeNull();
    expect(plan.backup.size_bytes).toBeNull();
    expect(plan.database.host).toBe("db.internal");
    expect(plan.database.sslmode).toBe("require");
    expect(plan.verification.status).toBe("not_run");
    expect(plan.verification.pg_restore.command).toBe(
      "pg_restore --list <backup>",
    );
    expect(plan.pg_dump.command).toBe(
      "pg_dump --format=custom --no-owner --no-privileges --file <backup>",
    );
    expect(stdout).not.toContain("super-secret-password");
    expect(stdout).not.toContain("postgresql://");
  });

  it("rejects unsupported database protocols without leaking the URL", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/backup-database.mjs", "--dry-run"],
      {
        cwd: apiRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: "mysql://user:secret@db.internal/cruzible",
          DATABASE_URL_FILE: "",
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Database URL must use postgres:// or postgresql://",
    );
    expect(result.stderr).not.toContain("mysql://");
    expect(result.stderr).not.toContain("secret");
  });

  it("attaches backup artifact checksum, size, and restore verification evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "cruzible-backup-manifest-"));

    try {
      const backupPath = join(root, "cruzible-db-pre-migration.dump");
      const manifestPath = join(
        root,
        "cruzible-db-pre-migration.manifest.json",
      );
      writeFileSync(backupPath, "restorable-backup-bytes");

      const manifest = buildBackupManifest({
        backupPath,
        connection: {
          protocol: "postgresql",
          host: "db.internal",
          port: "5432",
          database: "cruzible",
          username: "cruzible",
          sslmode: "require",
        },
        dryRun: false,
        label: "pre-migration",
        manifestPath,
        pgDumpCommand:
          "pg_dump --format=custom --no-owner --no-privileges --file <backup>",
        source: "DATABASE_URL_FILE",
        version: "pg_dump (PostgreSQL) 16.4",
      });
      const enriched = await attachBackupArtifactIntegrity(
        manifest,
        backupPath,
        {
          status: "passed",
          checked_at: "2026-06-27T07:48:00.000Z",
          duration_ms: 1284,
          object_count: 12,
          pg_restore: {
            version: "pg_restore (PostgreSQL) 16.4",
            command: "pg_restore --list <backup>",
          },
        },
      );

      expect(enriched.backup.sha256).toBe(
        "8220b9a69b3426e486ec6b1ac83dbbe94e1805a9ca3cfe6e6b59e7790d418ec9",
      );
      expect(enriched.backup.size_bytes).toBe(23);
      expect(enriched.verification).toMatchObject({
        status: "passed",
        object_count: 12,
        pg_restore: {
          command: "pg_restore --list <backup>",
        },
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
