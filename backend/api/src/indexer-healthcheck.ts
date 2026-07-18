import {
  assertIndexerWorkerHeartbeatFresh,
  indexerHeartbeatFileFromEnvironment,
  indexerHeartbeatMaxAgeFromEnvironment,
} from "./lib/indexerWorkerHeartbeat";

async function main(): Promise<void> {
  await assertIndexerWorkerHeartbeatFresh({
    filePath: indexerHeartbeatFileFromEnvironment(),
    maxAgeMs: indexerHeartbeatMaxAgeFromEnvironment(),
  });
  process.stdout.write("indexer worker heartbeat is healthy\n");
}

main().catch((error) => {
  process.stderr.write(
    `indexer worker heartbeat check failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
