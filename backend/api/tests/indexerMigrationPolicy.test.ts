import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("stAETHEL share-ledger migration policy", () => {
  it("requires separate indexer and pre-namespace scheduler drain acknowledgements", () => {
    const runner = readFileSync(
      resolve(process.cwd(), "scripts/run-prisma-migrate.mjs"),
      "utf8",
    );

    expect(runner).toContain("CRUZIBLE_MIGRATION_QUIESCED");
    expect(runner).toContain("CRUZIBLE_LEGACY_SCHEDULERS_QUIESCED");
    expect(runner).toContain("every pre-namespace API scheduler");
  });

  it.each([
    "20260718000000_indexer_event_identity",
    "20260718001000_indexer_reorg_rebuild_marker",
    "20260718002000_vault_stake_event_identity",
    "20260718003000_staethel_share_ledger",
    "20260718004000_vault_state_block_number",
  ])("wraps %s in an explicit PostgreSQL transaction", (migrationName) => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "prisma/migrations",
        migrationName,
        "migration.sql",
      ),
      "utf8",
    );

    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("marks recovery and resets legacy projections in one explicit transaction", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "prisma/migrations/20260718003000_staethel_share_ledger/migration.sql",
      ),
      "utf8",
    );
    const marker = migration.indexOf('SET "requiresRebuild" = true');
    const transferDelete = migration.indexOf('DELETE FROM "StAethelTransfer"');
    const balanceDelete = migration.indexOf('DELETE FROM "StAethelBalance"');

    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).toContain(
      "Cannot migrate stAETHEL share ledger without evm-indexer cursor",
    );
    expect(marker).toBeGreaterThan(-1);
    expect(marker).toBeLessThan(transferDelete);
    expect(marker).toBeLessThan(balanceDelete);
  });

  it("persists the complete indexed-source identity on durable cursors", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "prisma/migrations/20260718001000_indexer_reorg_rebuild_marker/migration.sql",
      ),
      "utf8",
    );

    expect(migration).toContain('"networkChainId"');
    expect(migration).toContain('"networkAnchorHash"');
    expect(migration).toContain('"networkVaultAddress"');
    expect(migration).toContain('"networkStaethelAddress"');
    expect(migration).toContain('"networkStablecoinBridgeAddress"');
  });

  it("uses bounded canonical replay for multi-log VaultStake identity", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "prisma/migrations/20260718002000_vault_stake_event_identity/migration.sql",
      ),
      "utf8",
    );

    expect(migration).not.toContain('MIN(event."logIndex")');
    expect(migration).toContain("event.\"type\" = 'Staked'");
    expect(migration).toContain('"recoveryTargetBlock" = recovery_target');
    expect(migration).toContain('"requiresRebuild" = true');
    expect(migration).toContain('DELETE FROM "VaultStake"');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "VaultStake_txHash_logIndex_key"',
    );
  });

  it("preserves legacy vault rows with explicit unverified provenance", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "prisma/migrations/20260718002000_vault_stake_event_identity/migration.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("'LEGACY_UNVERIFIED'");
    expect(migration).toContain('SET "completionTime" = NULL');
    expect(migration).not.toContain('DELETE FROM "VaultUnstake"');
    expect(migration).not.toContain('DELETE FROM "VaultWithdrawal"');
    expect(migration).not.toContain('DELETE FROM "VaultReward"');
  });
});
