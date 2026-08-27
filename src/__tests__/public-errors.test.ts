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

  it("redacts broader secret labels and high-entropy material", () => {
    const message = getPublicErrorMessage(
      new Error(
        [
          "privateKey=0x" + "a".repeat(64),
          "mnemonic=correct-horse-battery-staple",
          "seedPhrase=legal winner thank year wave sausage worth useful legal winner thank yellow",
          "cookie=sessionid=abc123",
          "session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZXRoMXVzZXIiLCJpYXQiOjE3Nzg3NjgwMDB9.signaturepartthatislong",
        ].join("; "),
      ),
    );

    expect(message).toContain("privateKey=[REDACTED]");
    expect(message).toContain("mnemonic=[REDACTED]");
    expect(message).toContain("seedPhrase=[REDACTED]");
    expect(message).toContain("cookie=[REDACTED]");
    expect(message).toContain("session=[REDACTED]");
    expect(message).not.toContain("correct-horse-battery-staple");
    expect(message).not.toContain("legal winner");
    expect(message).not.toContain("sessionid=abc123");
    expect(message).not.toContain("eyJhbGci");
    expect(message).not.toContain("aaaaaaaa");
  });
});
