import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = join(process.cwd(), "src");

function collectRuntimeSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const absolutePath = join(dir, entry);
    const relativePath = relative(srcRoot, absolutePath);

    if (
      relativePath.startsWith("__tests__") ||
      relativePath.startsWith("mocks")
    ) {
      continue;
    }

    if (statSync(absolutePath).isDirectory()) {
      files.push(...collectRuntimeSourceFiles(absolutePath));
      continue;
    }

    if (/\.(ts|tsx)$/u.test(entry)) {
      files.push(absolutePath);
    }
  }

  return files.sort();
}

describe("mock isolation", () => {
  it("keeps MSW handlers out of runtime source", () => {
    for (const filePath of collectRuntimeSourceFiles(srcRoot)) {
      const source = readFileSync(filePath, "utf8");
      const label = relative(process.cwd(), filePath);

      expect(source, label).not.toMatch(/["']@\/mocks/u);
      expect(source, label).not.toMatch(/["'](?:\.\.\/)+mocks/u);
      expect(source, label).not.toContain("setupWorker");
      expect(source, label).not.toContain("msw");
    }
  });
});
