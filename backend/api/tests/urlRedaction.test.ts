import { describe, expect, it } from "vitest";
import { redactUrlForLogs } from "../src/utils/urlRedaction";

describe("URL log redaction", () => {
  it("redacts query strings that commonly carry provider tokens", () => {
    expect(
      redactUrlForLogs("https://rpc.cruzible.test/v1/mainnet?apiKey=secret"),
    ).toBe("https://rpc.cruzible.test/v1/mainnet?redacted");
  });

  it("redacts userinfo and drops fragments defensively", () => {
    expect(
      redactUrlForLogs(
        "wss://user:pass@rpc.cruzible.test/ws?token=secret#fragment",
      ),
    ).toBe("wss://redacted:redacted@rpc.cruzible.test/ws?redacted");
  });

  it("does not throw when asked to log malformed URLs", () => {
    expect(redactUrlForLogs("not a url")).toBe("[invalid-url]");
  });
});
