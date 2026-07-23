import * as Sentry from "@sentry/node";

async function main(): Promise<void> {
  const client = Sentry.getClient();
  if (!client) {
    console.error("Sentry not initialized");
    process.exitCode = 1;
    return;
  }

  console.log("projectId", client.getDsn()?.projectId);
  const eventId = Sentry.captureException(
    new Error(`Grimkeeper Sentry live verify ${Date.now()}`),
  );
  console.log("eventId", eventId);
  const ok = await Sentry.flush(15_000);
  console.log("flushOk", ok);
}

await main();
