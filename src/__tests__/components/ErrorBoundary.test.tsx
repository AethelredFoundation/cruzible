import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const sensitiveError = new Error(
  "render failed at https://user:pass@rpc.example/path?access_token=super-secret with Authorization Bearer abc.def.ghi and signature=0xdeadbeef",
);

function getSentryWindow() {
  return window as Window & {
    Sentry?: {
      captureException: ReturnType<typeof vi.fn>;
    };
  };
}

describe("ErrorBoundary", () => {
  const originalSentry = getSentryWindow().Sentry;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getSentryWindow().Sentry = {
      captureException: vi.fn(),
    };
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    if (originalSentry) {
      getSentryWindow().Sentry = originalSentry;
    } else {
      delete getSentryWindow().Sentry;
    }
  });

  it("redacts production crash telemetry before sending browser reports", () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.componentDidCatch(sensitiveError, {
      componentStack: "\n    at ThrowingChild",
    });

    const captureException = getSentryWindow().Sentry?.captureException;
    expect(captureException).toHaveBeenCalledTimes(1);

    const [reportedError, context] = captureException?.mock.calls[0] ?? [];
    expect(reportedError).toBeInstanceOf(Error);
    expect((reportedError as Error).message).toContain("https://rpc.example");
    expect((reportedError as Error).message).toContain("Bearer [REDACTED]");
    expect((reportedError as Error).message).toContain("signature=[REDACTED]");
    expect((reportedError as Error).message).not.toContain("user:pass");
    expect((reportedError as Error).message).not.toContain("access_token");
    expect((reportedError as Error).message).not.toContain("super-secret");
    expect((reportedError as Error).message).not.toContain("abc.def.ghi");
    expect((reportedError as Error).message).not.toContain("0xdeadbeef");
    expect(context).toMatchObject({
      extra: {
        componentStackAvailable: true,
        componentStackFrames: expect.any(Number),
      },
    });
    expect(JSON.stringify(context)).not.toContain("ThrowingChild");

    const boundaryLog = (consoleErrorSpy.mock.calls as unknown[][]).find(
      (call) => call[0] === "ErrorBoundary caught an error:",
    );
    expect(boundaryLog).toBeDefined();
    expect(boundaryLog?.[1]).toContain("https://rpc.example");
    expect(boundaryLog?.[1]).not.toContain("super-secret");
  });
});
