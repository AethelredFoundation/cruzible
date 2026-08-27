import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanRepository } from "../../scripts/security-hygiene-scan.mjs";

function writeFixture(root: string, files: Record<string, string>) {
  for (const [filePath, source] of Object.entries(files)) {
    const absolutePath = join(root, filePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, source);
  }
}

function scanFixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "cruzible-hygiene-"));

  try {
    writeFixture(root, files);
    return scanRepository(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("security hygiene scan", () => {
  it("blocks high-risk runtime frontend, backend, and deployment patterns", () => {
    const findings = scanFixture({
      "src/components/Unsafe.tsx": `
export function Unsafe({
  html,
  token,
}: {
  html: string;
  token: string;
}) {
  localStorage.setItem("auth_token", token);
  window.open("https://evil.example");
  window.addEventListener("message", () => undefined);

  return (
    <a href="#" target="_blank">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </a>
  );
}
`,
      "src/pages/RuntimeMock.tsx": `
import { setupWorker } from "msw/browser";

export const worker = setupWorker();
`,
      "backend/api/src/server.ts": `
import express from "express";
import { exec } from "node:child_process";

const app = express();
app.set("trust proxy", true);
app.use(express.json());

app.get("/bounce", (req, res) => res.redirect(req.query.next));
app.get("/file", (req, res) => res.sendFile(req.query.path));
exec("whoami");
`,
      Dockerfile: `
FROM node:20-alpine
RUN next dev
`,
      "backend/api/Dockerfile": `
FROM node:20-alpine
CMD ["node", "--inspect=0.0.0.0:9229", "dist/index.js"]
`,
    });

    expect(new Set(findings.map((finding) => finding.rule))).toEqual(
      new Set([
        "backend-command-execution-sink",
        "backend-insecure-trust-proxy",
        "backend-open-redirect-from-request",
        "backend-unbounded-body-parser",
        "backend-unsafe-file-serving-from-request",
        "deployment-next-dev-runtime",
        "deployment-node-inspector",
        "frontend-dangerous-dom-sink",
        "frontend-placeholder-link",
        "frontend-runtime-mock-import",
        "frontend-sensitive-web-storage",
        "frontend-target-blank-without-noopener",
        "frontend-unreviewed-postmessage",
        "frontend-window-open",
      ]),
    );
  });

  it("allows reviewed wallet storage, safe external links, tests, and mocks", () => {
    const findings = scanFixture({
      "src/config/wagmi.ts": `
export const storage = typeof window !== "undefined" ? window.localStorage : undefined;
`,
      "src/components/SafeLink.tsx": `
export function SafeLink() {
  return (
    <a href="https://docs.example" target="_blank" rel="noopener noreferrer">
      Docs
    </a>
  );
}
`,
      "src/__tests__/unsafe-fixture.test.tsx": `
export const fixture = '<div dangerouslySetInnerHTML={{ __html: html }} />';
localStorage.setItem("auth_token", "fixture-token");
`,
      "src/mocks/handlers.ts": `
import { setupWorker } from "msw/browser";
export const worker = setupWorker();
`,
      "backend/api/src/server.ts": `
import express from "express";
import { config } from "./config";

const app = express();
app.set("trust proxy", config.trustProxy);
app.use(express.json({ limit: "1mb" }));
`,
      Dockerfile: `
FROM node:20-alpine
RUN npm run build
`,
    });

    expect(findings).toEqual([]);
  });
});
