import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
      pg_dump: { command: string };
    };

    expect(plan.schema).toBe("cruzible.database_backup.v1");
    expect(plan.dry_run).toBe(true);
    expect(plan.database.host).toBe("db.internal");
    expect(plan.database.sslmode).toBe("require");
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
});
