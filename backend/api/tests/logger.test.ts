import { describe, expect, it, vi } from "vitest";
import { logger } from "../src/utils/logger";

describe("logger", () => {
  it("redacts sensitive structured context before writing logs", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const context = {
      requestId: "req-123",
      refreshToken: "refresh-secret",
      nested: {
        privateKey: "private-key-secret",
        safe: "visible",
      },
      entries: [{ signature: "sig-secret", amount: 1 }],
    };

    try {
      logger.info("structured context", context);

      expect(infoSpy).toHaveBeenCalledWith(
        "[cruzible-api] structured context",
        {
          requestId: "req-123",
          refreshToken: "[REDACTED]",
          nested: {
            privateKey: "[REDACTED]",
            safe: "visible",
          },
          entries: [{ signature: "[REDACTED]", amount: 1 }],
        },
      );
      expect(context.refreshToken).toBe("refresh-secret");
      expect(context.nested.privateKey).toBe("private-key-secret");
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("logs Error instances without leaking messages or stack traces", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      logger.error("operation failed", {
        error: new Error("token refresh-secret leaked in provider response"),
      });

      expect(errorSpy).toHaveBeenCalledWith("[cruzible-api] operation failed", {
        error: expect.objectContaining({ errorName: "Error" }),
      });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
        "refresh-secret",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
