import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const workflowsDir = resolve(repoRoot, ".github/workflows");
const workflowFiles = readdirSync(workflowsDir)
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .sort();

function readWorkflow(file: string): string {
  return readFileSync(resolve(workflowsDir, file), "utf8");
}

function readRepoFile(file: string): string {
  return readFileSync(resolve(repoRoot, file), "utf8");
}

function workflowJobBlocks(workflow: string): Array<{
  name: string;
  block: string;
}> {
  const jobsStart = workflow.match(/^jobs:\n/m);
  if (jobsStart?.index === undefined) {
    return [];
  }

  const jobsBody = workflow.slice(jobsStart.index + jobsStart[0].length);
  const jobs: Array<{ name: string; block: string }> = [];
  let currentJob: { name: string; lines: string[] } | undefined;

  for (const line of jobsBody.split("\n")) {
    const jobMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (jobMatch) {
      if (currentJob?.lines.join("\n").includes("runs-on:")) {
        jobs.push({
          name: currentJob.name,
          block: currentJob.lines.join("\n"),
        });
      }
      currentJob = { name: jobMatch[1], lines: [] };
      continue;
    }

    currentJob?.lines.push(line);
  }

  if (currentJob?.lines.join("\n").includes("runs-on:")) {
    jobs.push({
      name: currentJob.name,
      block: currentJob.lines.join("\n"),
    });
  }

  return jobs;
}

function checkoutBlocks(workflow: string): string[] {
  const lines = workflow.split("\n");
  const blocks: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.includes("uses: actions/checkout@")) {
      continue;
    }

    const currentIndent = line.match(/^\s*/)?.[0].length ?? 0;
    const block = [line];

    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex++) {
      const nextLine = lines[nextIndex];
      const nextIndent = nextLine.match(/^\s*/)?.[0].length ?? 0;

      if (nextLine.trim() && nextIndent <= currentIndent) {
        break;
      }

      block.push(nextLine);
    }

    blocks.push(block.join("\n"));
  }

  return blocks;
}

function jobPermissionWrites(jobBlock: string): string[] {
  const permissionBlock = jobBlock.match(
    /\n    permissions:\n(?<permissions>(?:      [a-z-]+: (?:read|write)\n)+)/,
  );

  return Array.from(
    (permissionBlock?.groups?.permissions ?? "").matchAll(
      /^\s+([a-z-]+): write$/gm,
    ),
  )
    .map((match) => match[1])
    .sort();
}

function indexOfRequired(haystack: string, needle: string): number {
  const index = haystack.indexOf(needle);
  expect(index, needle).toBeGreaterThanOrEqual(0);
  return index;
}

describe("GitHub Actions workflow hardening", () => {
  it("uses least-privilege job permissions", () => {
    for (const file of workflowFiles) {
      const workflow = readWorkflow(file);
      expect(workflow).toMatch(/^permissions:\n(?:  [a-z-]+: read\n)+/m);
      expect(workflow).not.toContain("write-all");

      for (const job of workflowJobBlocks(workflow)) {
        expect(job.block, `${file}:${job.name}`).toMatch(
          /\n    permissions:\n(?:      [a-z-]+: (?:read|write)\n)+/,
        );

        if (file === "ci-cd.yml" && job.name === "release-images") {
          expect(job.block).toContain("contents: read");
          expect(jobPermissionWrites(job.block)).toEqual([
            "attestations",
            "id-token",
            "packages",
          ]);
          continue;
        }

        if (file === "ci-cd.yml" && job.name === "contract-release-artifacts") {
          expect(job.block).toContain("contents: read");
          expect(jobPermissionWrites(job.block)).toEqual(["id-token"]);
          continue;
        }

        expect(jobPermissionWrites(job.block), `${file}:${job.name}`).toEqual(
          [],
        );
      }
    }
  });

  it("does not persist checkout tokens after fetching source", () => {
    for (const file of workflowFiles) {
      const workflow = readWorkflow(file);
      const checkouts = checkoutBlocks(workflow);

      expect(checkouts.length, file).toBeGreaterThan(0);
      for (const checkout of checkouts) {
        expect(checkout, file).toContain("persist-credentials: false");
      }
    }
  });

  it("runs Node jobs on the production runtime major", () => {
    for (const file of ["ci-cd.yml", "security-audit.yml"]) {
      expect(readWorkflow(file), file).toContain('NODE_VERSION: "20"');
    }
  });

  it("installs Node dependencies without lifecycle scripts", () => {
    for (const file of workflowFiles) {
      const workflow = readWorkflow(file);

      for (const match of workflow.matchAll(/run:\s+npm ci(?<flags>[^\n]*)/g)) {
        expect(match.groups?.flags ?? "", `${file}:${match[0]}`).toContain(
          "--ignore-scripts",
        );
      }
    }
  });

  it("runs trusted backend generation after inert dependency install", () => {
    const workflow = readWorkflow("ci-cd.yml");
    const backendJob = workflowJobBlocks(workflow).find(
      (job) => job.name === "backend-api",
    );

    expect(backendJob, "backend-api job").toBeDefined();

    const installIndex = indexOfRequired(
      backendJob?.block ?? "",
      "Install backend dependencies",
    );
    const generateIndex = indexOfRequired(
      backendJob?.block ?? "",
      "Generate backend ORM client",
    );
    const lintIndex = indexOfRequired(
      backendJob?.block ?? "",
      "Lint backend API",
    );
    const typeCheckIndex = indexOfRequired(
      backendJob?.block ?? "",
      "Type-check backend API",
    );
    const testsIndex = indexOfRequired(
      backendJob?.block ?? "",
      "Run backend API tests with coverage",
    );

    expect(backendJob?.block).toContain("run: npm ci --ignore-scripts");
    expect(backendJob?.block).toContain("run: npm run db:generate");
    expect(generateIndex).toBeGreaterThan(installIndex);
    expect(generateIndex).toBeLessThan(lintIndex);
    expect(generateIndex).toBeLessThan(typeCheckIndex);
    expect(generateIndex).toBeLessThan(testsIndex);
  });

  it("avoids high-risk workflow triggers and unpinned action refs", () => {
    for (const file of workflowFiles) {
      const workflow = readWorkflow(file);
      expect(workflow).not.toContain("pull_request_target");

      for (const match of workflow.matchAll(/uses:\s+([^@\s]+)@([^\s]+)/g)) {
        const [, action, ref] = match;
        expect(ref, `${file}:${action}@${ref}`).toMatch(/^[a-f0-9]{40}$/);
      }
    }
  });

  it("builds backend runtime container targets in CI", () => {
    const workflow = readWorkflow("ci-cd.yml");

    expect(workflow).toContain("backend-containers:");
    expect(workflow).toContain("--file backend/api/Dockerfile");
    expect(workflow).toContain("--target production");
    expect(workflow).toContain("--tag cruzible-api:ci");
    expect(workflow).toContain("--target indexer");
    expect(workflow).toContain("--tag cruzible-api-indexer:ci");
  });

  it("enforces backend API formatting before type-checking and tests", () => {
    const workflow = readWorkflow("ci-cd.yml");
    const backendJob = workflowJobBlocks(workflow).find(
      (job) => job.name === "backend-api",
    );

    expect(backendJob?.block).toContain("Check backend API formatting");
    expect(backendJob?.block).toContain("working-directory: ./backend/api");
    expect(backendJob?.block).toContain("run: npm run format:check");
  });

  it("builds and inspects the frontend runtime container in CI", () => {
    const workflow = readWorkflow("ci-cd.yml");

    expect(workflow).toContain("Build frontend container");
    expect(workflow).toContain(
      "NEXT_PUBLIC_API_URL=https://api.testnet.aethelred.org",
    );
    expect(workflow).toContain("NEXT_PUBLIC_CHAIN_ENV=testnet");
    expect(workflow).toContain(
      "NEXT_PUBLIC_CRUZIBLE_ADDRESS=0x1111111111111111111111111111111111111111",
    );
    expect(workflow).toContain(
      'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="${CI_FRONTEND_WALLETCONNECT_PROJECT_ID}"',
    );
    expect(workflow).toContain("Check frontend bundle budget");
    expect(workflow).toContain("npm run performance:budget");
    expect(workflow).toContain("-t cruzible-frontend:ci .");
    expect(workflow).toContain("Verify frontend container runtime metadata");
    expect(workflow).toContain(
      '"docker", ["image", "inspect", "cruzible-frontend:ci"]',
    );
    expect(workflow).toContain('config.User !== "nextjs"');
    expect(workflow).toContain('["dumb-init", "--"]');
    expect(workflow).toContain("http://127.0.0.1:3000/api/health");
  });

  it("validates deployment manifests in CI", () => {
    const workflow = readWorkflow("ci-cd.yml");
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const validator = readRepoFile("scripts/validate-deployment-manifests.mjs");

    expect(packageJson.scripts["deployment:validate"]).toBe(
      "node scripts/validate-deployment-manifests.mjs",
    );
    expect(packageJson.devDependencies.yaml).toMatch(/^\^2\./);
    expect(workflow).toContain("deployment-manifests:");
    expect(workflow).toContain("name: Deployment Manifests");
    expect(workflow).toContain("Validate deployment manifests");
    expect(workflow).toContain("npm run deployment:validate");
    expect(validator).toContain("parseAllDocuments");
    expect(validator).toContain("assertComposeImagePolicy");
    expect(validator).toContain("assertKubernetesDeployment");
    expect(validator).toContain("cruzible-verify-signed-images");
  });

  it("validates release frontend public config before publishing images", () => {
    const workflow = readWorkflow("ci-cd.yml");
    const releaseJob = workflowJobBlocks(workflow).find(
      (job) => job.name === "release-images",
    );

    expect(releaseJob?.block).toContain("Validate frontend release config");
    expect(releaseJob?.block).toContain("NODE_ENV: production");
    expect(releaseJob?.block).toContain(
      "NEXT_PUBLIC_API_URL: ${{ vars.RELEASE_NEXT_PUBLIC_API_URL }}",
    );
    expect(releaseJob?.block).toContain(
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: ${{ vars.RELEASE_NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID }}",
    );
    expect(releaseJob?.block).toContain(
      "node scripts/validate-frontend-public-env.mjs",
    );
    expect(releaseJob?.block).toContain("provenance: mode=max");
    expect(releaseJob?.block).toContain("sbom: true");
  });

  it("preserves Playwright failure evidence from production smoke tests", () => {
    const workflow = readWorkflow("ci-cd.yml");
    const e2eJob = workflowJobBlocks(workflow).find(
      (job) => job.name === "frontend-e2e",
    );

    expect(e2eJob?.block).toContain("Run production smoke tests");
    expect(e2eJob?.block).toContain("Upload Playwright failure artifacts");
    expect(e2eJob?.block).toContain("if: failure()");
    expect(e2eJob?.block).toContain("actions/upload-artifact@");
    expect(e2eJob?.block).toContain("playwright-report-${{ github.sha }}");
    expect(e2eJob?.block).toContain("playwright-report");
    expect(e2eJob?.block).toContain("test-results");
    expect(e2eJob?.block).toContain("retention-days: 14");
  });

  it("builds contract audit artifacts with a pinned amd64 optimizer", () => {
    const workflow = readWorkflow("ci-cd.yml");
    const contractsJob = workflowJobBlocks(workflow).find(
      (job) => job.name === "contracts",
    );
    const optimizerScript = readRepoFile(
      "backend/contracts/scripts/build-optimized-artifacts.sh",
    );
    const artifactScript = readRepoFile(
      "backend/contracts/scripts/prepare-audit-artifacts.sh",
    );

    expect(contractsJob?.block).toContain(
      "bash -n scripts/build-optimized-artifacts.sh",
    );
    expect(contractsJob?.block).toContain(
      "bash scripts/build-optimized-artifacts.sh",
    );
    expect(contractsJob?.block).not.toContain(
      "cargo build --workspace --release --target wasm32-unknown-unknown --locked",
    );
    expect(optimizerScript).toContain(
      "cosmwasm/optimizer:0.17.0@sha256:7e0b9229c1a4118d0c9a2af2e7f5d95a91f264c26a2ce5681c779926e74d7f85",
    );
    expect(optimizerScript).toContain('OPTIMIZER_PLATFORM="linux/amd64"');
    expect(optimizerScript).toContain('--platform "${optimizer_platform}"');
    expect(optimizerScript).toContain(
      "ARTIFACT_BUILDER_KIND=cosmwasm_optimizer",
    );
    expect(artifactScript).toContain('"builder": {');
    expect(artifactScript).toContain('"image": "%s"');
    expect(artifactScript).toContain('"platform": "%s"');
  });

  it("publishes signed contract artifacts only from manual main runs", () => {
    const workflow = readWorkflow("ci-cd.yml");
    const releaseJob = workflowJobBlocks(workflow).find(
      (job) => job.name === "contract-release-artifacts",
    );
    const signScript = readRepoFile(
      "backend/contracts/scripts/sign-audit-artifacts.sh",
    );
    const verifyScript = readRepoFile(
      "backend/contracts/scripts/verify-audit-artifact-signatures.sh",
    );

    expect(releaseJob?.block).toContain(
      "if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
    );
    expect(releaseJob?.block).toContain("needs: contracts");
    expect(releaseJob?.block).toContain("id-token: write");
    expect(releaseJob?.block).toContain("uses: sigstore/cosign-installer@");
    expect(releaseJob?.block).toContain(
      "bash scripts/build-optimized-artifacts.sh",
    );
    expect(releaseJob?.block).toContain("SIGNING_BACKEND: cosign-keyless");
    expect(releaseJob?.block).toContain("bash scripts/sign-audit-artifacts.sh");
    expect(releaseJob?.block).toContain(
      "COSIGN_CERTIFICATE_IDENTITY: https://github.com/aethelred-foundation/cruzible/.github/workflows/ci-cd.yml@refs/heads/main",
    );
    expect(releaseJob?.block).toContain(
      "COSIGN_CERTIFICATE_OIDC_ISSUER: https://token.actions.githubusercontent.com",
    );
    expect(releaseJob?.block).toContain(
      "bash scripts/verify-audit-artifact-signatures.sh",
    );
    expect(releaseJob?.block).toContain(
      "name: signed-cosmwasm-contracts-${{ github.sha }}",
    );
    expect(releaseJob?.block).toContain("retention-days: 90");

    expect(signScript).toContain("sign_with_cosign_keyless()");
    expect(signScript).toContain("--output-certificate");
    expect(signScript).toContain('"certificate": "%s.%s"');
    expect(verifyScript).toContain("verify_with_cosign_keyless()");
    expect(verifyScript).toContain("--certificate-identity");
    expect(verifyScript).toContain("--certificate-oidc-issuer");
  });

  it("runs Python SDK conformance tests in CI", () => {
    const workflow = readWorkflow("ci-cd.yml");

    expect(workflow).toContain("python-sdk:");
    expect(workflow).toContain("uses: actions/setup-python@");
    expect(workflow).toContain(
      "python -m pip install --disable-pip-version-check --no-input ./sdk/python",
    );
    expect(workflow).toContain(
      'python -m unittest discover -s sdk/python/tests -p "test_*.py"',
    );
  });

  it("publishes signed and provenanced release images only from manual main runs", () => {
    const workflow = readWorkflow("ci-cd.yml");
    const releaseJob = workflowJobBlocks(workflow).find(
      (job) => job.name === "release-images",
    );

    expect(releaseJob?.block).toContain(
      "if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
    );
    expect(releaseJob?.block).toContain("packages: write");
    expect(releaseJob?.block).toContain("id-token: write");
    expect(releaseJob?.block).toContain("attestations: write");
    expect(releaseJob?.block).toContain(
      "image: ghcr.io/aethelred/cruzible/frontend",
    );
    expect(releaseJob?.block).toContain(
      "image: ghcr.io/aethelred/cruzible/api",
    );
    expect(releaseJob?.block).toContain(
      "image: ghcr.io/aethelred/cruzible/api-indexer",
    );
    expect(releaseJob?.block).toContain("uses: docker/build-push-action@");
    expect(releaseJob?.block).toContain("push: true");
    expect(releaseJob?.block).toContain("sbom: true");
    expect(releaseJob?.block).toContain("provenance: mode=max");
    expect(releaseJob?.block).toContain("uses: sigstore/cosign-installer@");
    expect(releaseJob?.block).toContain("cosign sign --yes");
    expect(releaseJob?.block).toContain(
      "uses: actions/attest-build-provenance@",
    );
    expect(releaseJob?.block).toContain(
      "Create release image digest inventory",
    );
    expect(releaseJob?.block).toContain(
      'schema: "cruzible.release_image_digest.v1"',
    );
    expect(releaseJob?.block).toContain(
      "IMAGE_DIGEST: ${{ steps.build.outputs.digest }}",
    );
    expect(releaseJob?.block).toContain(
      "IMAGE_DOCKERFILE: ${{ matrix.dockerfile }}",
    );
    expect(releaseJob?.block).toContain("IMAGE_TARGET: ${{ matrix.target }}");
    expect(releaseJob?.block).toContain("SOURCE_SHA: ${{ github.sha }}");
    expect(releaseJob?.block).toContain(
      "release-image-${process.env.IMAGE_KEY}.json",
    );
    expect(releaseJob?.block).toContain(
      "Upload release image digest inventory",
    );
    expect(releaseJob?.block).toContain(
      "name: release-image-${{ matrix.name }}-${{ github.sha }}",
    );
    expect(releaseJob?.block).toContain(
      "path: release-image-${{ matrix.name }}.json",
    );
    expect(releaseJob?.block).toContain("retention-days: 90");
    expect(releaseJob?.block).toContain(
      "RELEASE_NEXT_PUBLIC_API_URL repository variable is required",
    );
    for (const variable of [
      "RELEASE_NEXT_PUBLIC_CRUZIBLE_ADDRESS",
      "RELEASE_NEXT_PUBLIC_STAETHEL_ADDRESS",
      "RELEASE_NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS",
      "RELEASE_NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS",
      "RELEASE_NEXT_PUBLIC_USDC_TOKEN_ADDRESS",
      "RELEASE_NEXT_PUBLIC_USDT_TOKEN_ADDRESS",
      "RELEASE_NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
    ]) {
      expect(releaseJob?.block).toContain(
        `${variable} repository variable is required for deployed frontend releases`,
      );
    }
    expect(releaseJob?.block).toContain(
      "NEXT_PUBLIC_API_URL=${{ vars.RELEASE_NEXT_PUBLIC_API_URL }}",
    );
    expect(releaseJob?.block).toContain(
      "NEXT_PUBLIC_CHAIN_ENV=${{ vars.RELEASE_NEXT_PUBLIC_CHAIN_ENV }}",
    );
    for (const buildArg of [
      "NEXT_PUBLIC_CRUZIBLE_ADDRESS",
      "NEXT_PUBLIC_STAETHEL_ADDRESS",
      "NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS",
      "NEXT_PUBLIC_GOVERNANCE_ADDRESS",
      "NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS",
      "NEXT_PUBLIC_USDC_TOKEN_ADDRESS",
      "NEXT_PUBLIC_USDT_TOKEN_ADDRESS",
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
    ]) {
      expect(releaseJob?.block).toContain(
        `${buildArg}=\${{ vars.RELEASE_${buildArg} }}`,
      );
    }
  });
});
