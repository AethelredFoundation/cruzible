#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateEvmDeploymentManifest } from "./lib/evm-deployment-manifest.mjs";

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isCliEntrypoint) {
  const path = process.argv[2];
  if (!path) {
    console.error(
      "Usage: node scripts/validate-evm-deployment-manifest.mjs <manifest.json>",
    );
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const { errors } = validateEvmDeploymentManifest(manifest);
  if (errors.length > 0) {
    console.error("EVM deployment manifest validation failed.");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log("EVM deployment manifest validation passed.");
}
