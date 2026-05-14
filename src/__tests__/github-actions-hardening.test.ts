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
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=0123456789abcdef0123456789abcdef",
    );
    expect(workflow).toContain("-t cruzible-frontend:ci .");
    expect(workflow).toContain("Verify frontend container runtime metadata");
    expect(workflow).toContain(
      '"docker", ["image", "inspect", "cruzible-frontend:ci"]',
    );
    expect(workflow).toContain('config.User !== "nextjs"');
    expect(workflow).toContain('["dumb-init", "--"]');
    expect(workflow).toContain("http://127.0.0.1:3000/api/health");
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
