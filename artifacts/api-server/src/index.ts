import app from "./app";
import { logger } from "./lib/logger";
import { seedAuth } from "./lib/auth";
import { migrateTodosToAgenda } from "./lib/migrate";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start(): Promise<void> {
  try {
    await seedAuth();
    await migrateTodosToAgenda();
  } catch (err) {
    logger.error({ err }, "Failed to seed/migrate data");
    process.exit(1);
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

void start();
