import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUILD_MANIFEST = ".next/build-manifest.json";
const BYTES_PER_KIB = 1024;
const DEFAULT_ROUTE_MAX_GZIP_KIB = 950;
const ROUTE_BUDGETS_KIB = {
  "/_app": 925,
  "/vault": 1025,
};

function readBuildManifest() {
  try {
    return JSON.parse(readFileSync(BUILD_MANIFEST, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read ${BUILD_MANIFEST}. Run npm run build before npm run performance:budget. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function uniqueAssetFiles(files) {
  return [...new Set(files)].filter((file) => /\.(?:js|css)$/u.test(file));
}

function routeAssets(manifest, route) {
  const pageAssets = manifest.pages?.[route];
  if (!Array.isArray(pageAssets)) {
    throw new Error(`Missing Next.js build assets for route ${route}.`);
  }

  if (route === "/_app") {
    return uniqueAssetFiles(pageAssets);
  }

  return uniqueAssetFiles([
    ...(manifest.pages?.["/_app"] ?? []),
    ...pageAssets,
  ]);
}

function measureAssets(files) {
  let rawBytes = 0;
  let gzipBytes = 0;

  for (const file of files) {
    const buffer = readFileSync(join(".next", file));
    rawBytes += buffer.byteLength;
    gzipBytes += gzipSync(buffer, { level: 9 }).byteLength;
  }

  return { rawBytes, gzipBytes };
}

function kib(bytes) {
  return bytes / BYTES_PER_KIB;
}

const manifest = readBuildManifest();
const routes = Object.keys(manifest.pages ?? {}).filter(
  (route) => !route.startsWith("/api/") && route !== "/_error",
);
const failures = [];

console.log("Frontend bundle budget (gzip):");

for (const route of routes) {
  const files = routeAssets(manifest, route);
  const { rawBytes, gzipBytes } = measureAssets(files);
  const maxGzipKib = ROUTE_BUDGETS_KIB[route] ?? DEFAULT_ROUTE_MAX_GZIP_KIB;
  const gzipKib = kib(gzipBytes);
  const rawKib = kib(rawBytes);
  const status = gzipKib <= maxGzipKib ? "PASS" : "FAIL";

  console.log(
    `${status} ${route.padEnd(24)} ${gzipKib.toFixed(1).padStart(7)} KiB gzip / ${rawKib.toFixed(1).padStart(8)} KiB raw (budget ${maxGzipKib} KiB)`,
  );

  if (gzipKib > maxGzipKib) {
    failures.push(
      `${route} is ${gzipKib.toFixed(1)} KiB gzip, above ${maxGzipKib} KiB.`,
    );
  }
}

if (failures.length > 0) {
  console.error("Frontend bundle budget exceeded:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
