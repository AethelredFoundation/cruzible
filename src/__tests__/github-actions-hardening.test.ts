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

describe("GitHub Actions workflow hardening", () => {
  it("uses least-privilege job permissions", () => {
    for (const file of workflowFiles) {
      const workflow = readWorkflow(file);
      expect(workflow).toMatch(/^permissions:\n(?:  [a-z-]+: read\n)+/m);
      expect(workflow).not.toContain("write-all");
      expect(workflow).not.toMatch(/^\s+[a-z-]+:\s+write$/m);

      for (const job of workflowJobBlocks(workflow)) {
        expect(job.block, `${file}:${job.name}`).toMatch(
          /\n    permissions:\n(?:      [a-z-]+: read\n)+/,
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

  it("avoids high-risk workflow triggers and floating action refs", () => {
    for (const file of workflowFiles) {
      const workflow = readWorkflow(file);
      expect(workflow).not.toContain("pull_request_target");

      for (const match of workflow.matchAll(/uses:\s+([^@\s]+)@([^\s]+)/g)) {
        const [, action, ref] = match;
        expect(
          ["main", "master", "latest", "HEAD"].includes(ref),
          `${file}:${action}@${ref}`,
        ).toBe(false);
      }
    }
  });
});
