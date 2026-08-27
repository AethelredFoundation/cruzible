import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dockerfiles = [
  "Dockerfile",
  "backend/api/Dockerfile",
  "backend/contracts/Dockerfile",
];

describe("Dockerfile base image pinning", () => {
  it("pins every external base image by immutable digest", () => {
    for (const file of dockerfiles) {
      const dockerfile = readFileSync(resolve(process.cwd(), file), "utf8");
      const externalFromLines = dockerfile
        .split("\n")
        .filter((line) => line.startsWith("FROM "))
        .filter((line) => !/^FROM [A-Za-z0-9_-]+(?: AS |$)/.test(line));

      expect(externalFromLines.length, file).toBeGreaterThan(0);

      for (const line of externalFromLines) {
        expect(line, `${file}: ${line}`).toMatch(
          /^FROM [^\s]+:[^\s@]+@sha256:[a-f0-9]{64}(?: AS [A-Za-z0-9_-]+)?$/,
        );
      }
    }
  });
});
