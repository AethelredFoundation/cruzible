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
        "x-operational-token": "ops-token-123",
      }),
    ).toEqual({
      authorization: REDACTED,
      "x-api-key": REDACTED,
      "user-agent": "vitest",
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
