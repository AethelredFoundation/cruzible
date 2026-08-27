import { describe, expect, it } from "vitest";
import { errorContext } from "../src/utils/errorContext";
import { redactFields } from "../src/utils/redaction";

describe("error context utilities", () => {
  it("keeps Error objects structured so logger redaction removes messages", () => {
    const context = errorContext(
      new Error("provider leaked redis://:super-secret@cache.internal:6379"),
    );
    const redacted = redactFields(context);
    const serialized = JSON.stringify(redacted);

    // Generic (library/IO) Error messages stay hidden; only the name and a
    // locating stack frame survive redaction.
    expect(redacted).toMatchObject({ error: { errorName: "Error" } });
    expect(
      (redacted as { error: { errorMessage?: string } }).error.errorMessage,
    ).toBeUndefined();
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("cache.internal");
  });

  it("classifies non-Error throwables without stringifying their values", () => {
    expect(errorContext("secret-bearing raw string")).toEqual({
      errorType: "string",
    });
  });
});
