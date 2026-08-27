import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  renderLiveReconciliationMarkdown,
  downloadTextFile,
  type LiveReconciliationDocument,
} from "@/lib/reconciliation";

function doc(
  overrides: Partial<LiveReconciliationDocument> = {},
): LiveReconciliationDocument {
  return {
    epoch: 42,
    network: "aethelred-testnet-1",
    mode: "public",
    captured_at: "2026-07-12T00:00:00Z",
    ...overrides,
  };
}

describe("renderLiveReconciliationMarkdown", () => {
  it("renders the header block with document fields", () => {
    const md = renderLiveReconciliationMarkdown(doc());
    expect(md).toContain("# Cruzible Live Reconciliation");
    expect(md).toContain("- Epoch: `42`");
    expect(md).toContain("- Network: `aethelred-testnet-1`");
    expect(md).toContain("- Mode: `public`");
    expect(md).toContain("- Captured At: `2026-07-12T00:00:00Z`");
  });

  it("defaults validator counts to n/a when absent", () => {
    const md = renderLiveReconciliationMarkdown(doc());
    expect(md).toContain("- Displayed Validators: `n/a`");
    expect(md).toContain("- Hashed Validator Universe: `n/a`");
  });

  it("renders validator selection meta when present", () => {
    const md = renderLiveReconciliationMarkdown(
      doc({
        validator_selection: {
          observed: { universe_hash: "0xuniverse" },
          meta: { validator_count: 100, total_eligible_validators: 250 },
        },
      }),
    );
    expect(md).toContain("- Displayed Validators: `100`");
    expect(md).toContain("- Hashed Validator Universe: `250`");
    expect(md).toContain("- Universe Hash: `0xuniverse`");
  });

  it("defaults observed hashes to n/a", () => {
    const md = renderLiveReconciliationMarkdown(doc());
    expect(md).toContain("- Universe Hash: `n/a`");
    expect(md).toContain("- Stake Snapshot Hash: `n/a`");
    expect(md).toContain("- Staker Registry Root: `n/a`");
    expect(md).toContain("- Delegation Registry Root: `n/a`");
    expect(md).toContain("- Delegation Payload: `n/a`");
  });

  it("renders a complete stake-snapshot section", () => {
    const md = renderLiveReconciliationMarkdown(
      doc({
        stake_snapshot: {
          observed: { stake_snapshot_hash: "0xsnap" },
          meta: {
            complete: true,
            skipped_stakers: 0,
            included_total_shares: "1000",
            vault_total_shares: "1000",
            registry_roots_available: true,
          },
        },
      }),
    );
    expect(md).toContain("## Stake Snapshot Status");
    expect(md).toContain("- Complete: `yes`");
    expect(md).toContain("- Registry Roots Available: `yes`");
    expect(md).toContain("- Stake Snapshot Hash: `0xsnap`");
  });

  it("marks an incomplete stake snapshot as partial", () => {
    const md = renderLiveReconciliationMarkdown(
      doc({
        stake_snapshot: {
          meta: { complete: false, registry_roots_available: false },
        },
      }),
    );
    expect(md).toContain("- Complete: `partial`");
    expect(md).toContain("- Registry Roots Available: `no`");
  });

  it("omits the stake-snapshot section when meta is absent", () => {
    expect(renderLiveReconciliationMarkdown(doc())).not.toContain(
      "## Stake Snapshot Status",
    );
  });

  it("renders a source section from key/value pairs", () => {
    const md = renderLiveReconciliationMarkdown(
      doc({ source: { indexer: "v1", height: 12345, verified: true } }),
    );
    expect(md).toContain("## Source");
    expect(md).toContain("- `indexer`: `v1`");
    expect(md).toContain("- `height`: `12345`");
    expect(md).toContain("- `verified`: `true`");
  });

  it("omits the source section when empty", () => {
    expect(renderLiveReconciliationMarkdown(doc())).not.toContain("## Source");
  });

  it("renders warnings when present and reports the count", () => {
    const md = renderLiveReconciliationMarkdown(
      doc({ warnings: ["fallback epoch", "stale height"] }),
    );
    expect(md).toContain("- Warning Count: `2`");
    expect(md).toContain("## Warnings");
    expect(md).toContain("- fallback epoch");
    expect(md).toContain("- stale height");
  });

  it("omits the warnings section when there are none", () => {
    const md = renderLiveReconciliationMarkdown(doc());
    expect(md).toContain("- Warning Count: `0`");
    expect(md).not.toContain("## Warnings");
  });

  it("renders discrepancies with severity and code", () => {
    const md = renderLiveReconciliationMarkdown(
      doc({
        discrepancies: [
          {
            code: "SUPPLY_MISMATCH",
            severity: "CRITICAL",
            status: "ACTIVE",
            title: "Supply mismatch",
            message: "shares do not reconcile",
            affected_accounts: 3,
            sample_addresses: ["aeth1a"],
          },
        ],
      }),
    );
    expect(md).toContain("- Discrepancy Count: `1`");
    expect(md).toContain("## Discrepancies");
    expect(md).toContain(
      "- [CRITICAL] `SUPPLY_MISMATCH`: shares do not reconcile",
    );
  });

  it("omits the discrepancies section when there are none", () => {
    expect(renderLiveReconciliationMarkdown(doc())).not.toContain(
      "## Discrepancies",
    );
  });

  it("ends with exactly one trailing newline", () => {
    const md = renderLiveReconciliationMarkdown(doc());
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });
});

describe("downloadTextFile", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an anchor, clicks it, and revokes the object URL", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:mock");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const click = vi.fn();
    const remove = vi.fn();
    const anchor = {
      href: "",
      download: "",
      click,
      remove,
    } as unknown as HTMLAnchorElement;
    const createElement = vi
      .spyOn(window.document, "createElement")
      .mockReturnValue(anchor);
    const appendChild = vi
      .spyOn(window.document.body, "appendChild")
      .mockImplementation(
        ((node: unknown) => node) as typeof window.document.body.appendChild,
      );

    downloadTextFile("report.md", "# hello");

    expect(createElement).toHaveBeenCalledWith("a");
    expect(anchor.download).toBe("report.md");
    expect(anchor.href).toBe("blob:mock");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });
});
