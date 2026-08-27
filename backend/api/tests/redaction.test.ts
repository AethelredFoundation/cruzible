import { describe, expect, it } from "vitest";
import {
  CIRCULAR,
  REDACTED,
  TRUNCATED,
  redactFields,
  redactHeaders,
  redactUrlPath,
} from "../src/utils/redaction";

describe("redaction utilities", () => {
  it("redacts sensitive headers and request URLs", () => {
    expect(
      redactHeaders({
        authorization: "Bearer token-123",
        "x-api-key": "api-key-123",
        "user-agent": "vitest",
        "x-forwarded-for": "10.0.0.5",
        "x-operational-token": "ops-token-123",
      }),
    ).toEqual({
      authorization: REDACTED,
      "x-api-key": REDACTED,
      "user-agent": REDACTED,
      "x-forwarded-for": REDACTED,
      "x-operational-token": REDACTED,
    });

    expect(
      redactUrlPath(
        "/callback?access_token=token-123&signature=sig-123&address=aeth1user",
      ),
    ).toBe(
      "/callback?access_token=[REDACTED]&signature=[REDACTED]&address=aeth1user",
    );
  });

  it("fails closed when malformed URLs cannot be parsed", () => {
    const redacted = redactUrlPath(
      "https://user:pass@[::1/callback?access_token=token-123&address=aeth1user#refresh_token=refresh-123",
    );

    expect(redacted).toBe(
      "/callback?access_token=[REDACTED]&address=aeth1user",
    );
    expect(redacted).not.toContain("user:pass");
    expect(redacted).not.toContain("token-123");
    expect(redacted).not.toContain("refresh-123");
  });

  it("sanitizes malformed query components before logging", () => {
    expect(
      redactUrlPath(
        "/callback?refresh_token=%E0%A4%A&state=hello world&signature=sig-123",
      ),
    ).toBe(
      "/callback?refresh_token=[REDACTED]&state=hello%20world&signature=[REDACTED]",
    );
  });

  it("deep-redacts sensitive fields while preserving safe metadata", () => {
    const payload = {
      requestId: "req-123",
      nested: {
        refreshToken: "refresh-secret",
        publicValue: "visible",
      },
      entries: [{ signature: "sig-secret", amount: 1 }],
    };

    expect(redactFields(payload)).toEqual({
      requestId: "req-123",
      nested: {
        refreshToken: REDACTED,
        publicValue: "visible",
      },
      entries: [{ signature: REDACTED, amount: 1 }],
    });
  });

  it("returns JSON-safe placeholders for circular and oversized payloads", () => {
    const circular: Record<string, unknown> = { requestId: "req-123" };
    circular.self = circular;

    expect(redactFields(circular)).toEqual({
      requestId: "req-123",
      self: CIRCULAR,
    });

    expect(redactFields([1, 2, 3], { maxArrayLength: 2 })).toEqual([
      1,
      2,
      TRUNCATED,
    ]);
  });
});
