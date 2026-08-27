import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stablecoinHook = readFileSync(
  resolve(process.cwd(), "src/hooks/useStablecoinBridge.ts"),
  "utf8",
);

describe("stablecoin bridge chain alignment", () => {
  it("pins stablecoin read and write paths to the active chain", () => {
    expect(stablecoinHook).toContain(
      'import { activeChain } from "@/config/wagmi"',
    );

    const readContractCalls =
      stablecoinHook.match(/useReadContract\(\{/gu) ?? [];
    expect(readContractCalls).toHaveLength(2);
    expect(stablecoinHook.match(/chainId: activeChain\.id/gu)).toHaveLength(8);
  });
});
