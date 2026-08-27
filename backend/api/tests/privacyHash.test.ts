import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPrivacyValue } from "../src/utils/privacyHash";

describe("privacy hash", () => {
  it("uses keyed HMAC rather than unsalted SHA-256", () => {
    const value = "203.0.113.10";

    expect(hashPrivacyValue(value)).toBe(
      createHmac("sha256", "cruzible-dev-log-hash-secret")
        .update(value)
        .digest("hex"),
    );
    expect(hashPrivacyValue(value)).not.toBe(
      createHash("sha256").update(value).digest("hex"),
    );
  });
});
