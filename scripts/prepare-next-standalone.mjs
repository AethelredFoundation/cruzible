import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const standaloneDir = join(".next", "standalone");
const standaloneStaticDir = join(standaloneDir, ".next", "static");
const standalonePublicDir = join(standaloneDir, "public");

function requirePath(path, hint) {
  if (!existsSync(path)) {
    throw new Error(`${path} is missing. ${hint}`);
  }
}

requirePath(
  standaloneDir,
  "Run npm run build before preparing the standalone server.",
);
requirePath(
  join(".next", "static"),
  "Next.js static assets are required for production-equivalent E2E tests.",
);

rmSync(standaloneStaticDir, { force: true, recursive: true });
mkdirSync(join(standaloneDir, ".next"), { recursive: true });
cpSync(join(".next", "static"), standaloneStaticDir, { recursive: true });

if (existsSync("public")) {
  rmSync(standalonePublicDir, { force: true, recursive: true });
  cpSync("public", standalonePublicDir, { recursive: true });
}

console.log("Prepared .next/standalone with static and public assets.");
