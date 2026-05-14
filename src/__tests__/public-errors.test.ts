import { describe, expect, it } from "vitest";
import { getPublicErrorMessage } from "@/lib/publicErrors";

describe("public error messages", () => {
  it("uses safe fallbacks for unknown or empty errors", () => {
    expect(getPublicErrorMessage(undefined, "Unable to load data.")).toBe(
      "Unable to load data.",
    );
    expect(getPublicErrorMessage(new Error(""), "Unable to load data.")).toBe(
      "Unable to load data.",
    );
  });

  it("prefers short provider messages when present", () => {
    const message = getPublicErrorMessage({
      shortMessage: "execution reverted: insufficient allowance",
      message: "noisy transport detail",
    });

    expect(message).toBe("execution reverted: insufficient allowance");
  });

  it("normalizes and truncates noisy errors", () => {
    const message = getPublicErrorMessage(`first line

      ${"x".repeat(400)}`);

    expect(message).not.toContain("\n");
    expect(message.length).toBeLessThanOrEqual(280);
    expect(message.endsWith("...")).toBe(true);
  });

  it("redacts URLs, credentials, and token-like values", () => {
    const message = getPublicErrorMessage(
      new Error(
        "RPC failed at https://user:pass@rpc.example/path?access_token=super-secret with Authorization Bearer abc.def.ghi and signature=0xdeadbeef",
      ),
    );

    expect(message).toContain("https://rpc.example");
    expect(message).toContain("Bearer [REDACTED]");
    expect(message).toContain("signature=[REDACTED]");
    expect(message).not.toContain("user:pass");
    expect(message).not.toContain("access_token");
    expect(message).not.toContain("super-secret");
    expect(message).not.toContain("abc.def.ghi");
    expect(message).not.toContain("0xdeadbeef");
  });
});
