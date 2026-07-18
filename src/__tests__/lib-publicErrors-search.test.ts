import { describe, it, expect, vi, beforeEach } from "vitest";

import { getPublicErrorMessage } from "@/lib/publicErrors";
import { downloadTextFile } from "@/lib/download";
import {
  buildSearchResults,
  SEARCH_NAVIGATION_TARGETS,
  type SearchableValidator,
} from "@/lib/search";

describe("publicErrors getPublicErrorMessage", () => {
  it("returns the fallback for null/undefined/empty", () => {
    expect(getPublicErrorMessage(null)).toBe("Unexpected error");
    expect(getPublicErrorMessage(undefined)).toBe("Unexpected error");
    expect(getPublicErrorMessage("")).toBe("Unexpected error");
    expect(getPublicErrorMessage("   ")).toBe("Unexpected error");
  });

  it("honors a custom fallback", () => {
    expect(getPublicErrorMessage(null, "boom")).toBe("boom");
  });

  it("extracts a plain string error", () => {
    expect(getPublicErrorMessage("something failed")).toBe("something failed");
  });

  it("prefers shortMessage over message", () => {
    expect(
      getPublicErrorMessage({
        shortMessage: "short",
        message: "long detailed message",
      }),
    ).toBe("short");
  });

  it("falls back to message when no shortMessage", () => {
    expect(getPublicErrorMessage({ message: "the message" })).toBe(
      "the message",
    );
  });

  it("normalizes whitespace", () => {
    expect(getPublicErrorMessage("a\n\n  b   c")).toBe("a b c");
  });

  it("redacts a URL down to its origin", () => {
    expect(
      getPublicErrorMessage(
        "failed calling https://api.secret.com/v1/keys?token=abc",
      ),
    ).toContain("https://api.secret.com");
    expect(
      getPublicErrorMessage(
        "failed calling https://api.secret.com/v1/keys?token=abc",
      ),
    ).not.toContain("/v1/keys");
  });

  it("strips query strings by reducing a URL to its origin", () => {
    const out = getPublicErrorMessage(
      "GET https://host.example/path?apikey=SECRET failed",
    );
    expect(out).toContain("https://host.example");
    expect(out).not.toContain("SECRET");
  });

  it.each([
    "password=hunter2",
    "api_key: sk-12345",
    "authorization=Bearer xyz",
    "secret = topsecret",
    "private_key=0xdeadbeef",
  ])("redacts sensitive assignment %s", (input) => {
    expect(getPublicErrorMessage(input)).toContain("[REDACTED]");
  });

  it("redacts a bare Bearer auth header token", () => {
    const out = getPublicErrorMessage(
      "request failed with Bearer sometokenvalue123abc",
    );
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("sometokenvalue123abc");
  });

  it("redacts a long high-entropy hex string", () => {
    const hex = "0x" + "a".repeat(64);
    expect(getPublicErrorMessage(`tx ${hex} reverted`)).toContain(
      "[REDACTED_HEX]",
    );
  });

  it("redacts a JWT-like token that follows a sensitive keyword", () => {
    const jwt =
      "aaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbb.ccccccccccccccccccccc";
    // "token <jwt>" is caught by the auth-header pattern (Token keyword)
    const redacted = getPublicErrorMessage(`token ${jwt}`);
    expect(redacted).toContain("[REDACTED]");
    expect(redacted).not.toContain(jwt);
    // A benign leading word leaves the high-entropy value untouched (no keyword)
    expect(getPublicErrorMessage(`value ${jwt}`)).toContain(jwt);
  });

  it("truncates very long messages to <= 280 chars with an ellipsis", () => {
    const long = "x".repeat(500);
    const out = getPublicErrorMessage(long);
    expect(out.length).toBeLessThanOrEqual(280);
    expect(out.endsWith("...")).toBe(true);
  });

  it("leaves a benign short message intact", () => {
    expect(getPublicErrorMessage("insufficient funds for gas")).toBe(
      "insufficient funds for gas",
    );
  });
});

describe("search buildSearchResults", () => {
  const validators: SearchableValidator[] = [
    { address: "aeth1atlas", moniker: "Atlas", identity: "atlas-id" },
    { address: "aeth1nova", moniker: "Nova" },
    { address: "aeth1atlas2", moniker: "Atlas Backup", identity: "atlas-id-2" },
  ];

  it("returns nothing for an empty/whitespace query", () => {
    expect(buildSearchResults("", validators)).toEqual([]);
    expect(buildSearchResults("   ", validators)).toEqual([]);
  });

  it("matches navigation targets case-insensitively", () => {
    const groups = buildSearchResults("vault", []);
    expect(groups[0].category).toBe("Navigation");
    expect(groups[0].items.some((i) => i.href === "/vault")).toBe(true);
  });

  it("matches navigation by description text", () => {
    const groups = buildSearchResults("unstake", []);
    expect(groups[0].items.some((i) => i.href === "/vault")).toBe(true);
  });

  it("caps navigation results at 5", () => {
    // "e" appears in most descriptions
    const groups = buildSearchResults("e", []);
    const nav = groups.find((g) => g.kind === "navigation");
    expect(nav?.items.length ?? 0).toBeLessThanOrEqual(5);
  });

  it("matches validators by moniker", () => {
    const groups = buildSearchResults("atlas", validators);
    const vg = groups.find((g) => g.kind === "validator");
    expect(vg?.items.map((i) => i.label)).toContain("Atlas");
  });

  it("matches validators by address", () => {
    const groups = buildSearchResults("aeth1nova", validators);
    const vg = groups.find((g) => g.kind === "validator");
    expect(vg?.items[0].label).toBe("Nova");
  });

  it("includes identity in the description when present", () => {
    const groups = buildSearchResults("aeth1atlas", validators);
    const vg = groups.find((g) => g.kind === "validator")!;
    const atlas = vg.items.find((i) => i.label === "Atlas")!;
    expect(atlas.description).toBe("aeth1atlas - atlas-id");
  });

  it("url-encodes the validator address in the href", () => {
    const groups = buildSearchResults("nova", validators);
    const vg = groups.find((g) => g.kind === "validator")!;
    expect(vg.items[0].href).toBe("/validators/aeth1nova");
  });

  it("returns only navigation when no validators match", () => {
    const groups = buildSearchResults("governance", validators);
    expect(groups.every((g) => g.kind === "navigation")).toBe(true);
  });

  it("returns an empty array when nothing matches at all", () => {
    expect(buildSearchResults("zzzzzznotfound", [])).toEqual([]);
  });

  it("withholds the unreleased stablecoin bridge from navigation", () => {
    expect(SEARCH_NAVIGATION_TARGETS).toHaveLength(7);
    expect(
      SEARCH_NAVIGATION_TARGETS.some(
        (target) => target.href === "/stablecoins",
      ),
    ).toBe(false);
    expect(SEARCH_NAVIGATION_TARGETS.every((t) => t.href.startsWith("/"))).toBe(
      true,
    );
  });
});

describe("download downloadTextFile", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("uses the default text/plain mime type", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:x");
    const revokeObjectURL = vi.fn();
    const BlobSpy = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("Blob", BlobSpy);

    const anchor = {
      href: "",
      download: "",
      click: vi.fn(),
      remove: vi.fn(),
    } as unknown as HTMLAnchorElement;
    vi.spyOn(window.document, "createElement").mockReturnValue(anchor);
    vi.spyOn(window.document.body, "appendChild").mockImplementation(
      ((n: unknown) => n) as typeof window.document.body.appendChild,
    );

    downloadTextFile("f.txt", "content");
    expect(BlobSpy).toHaveBeenCalledWith(["content"], {
      type: "text/plain;charset=utf-8",
    });
    expect(anchor.download).toBe("f.txt");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });

  it("honors a custom mime type", () => {
    const BlobSpy = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:y"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("Blob", BlobSpy);
    const anchor = {
      href: "",
      download: "",
      click: vi.fn(),
      remove: vi.fn(),
    } as unknown as HTMLAnchorElement;
    vi.spyOn(window.document, "createElement").mockReturnValue(anchor);
    vi.spyOn(window.document.body, "appendChild").mockImplementation(
      ((n: unknown) => n) as typeof window.document.body.appendChild,
    );

    downloadTextFile("data.json", "{}", "application/json");
    expect(BlobSpy).toHaveBeenCalledWith(["{}"], { type: "application/json" });
  });
});
