import { setupTestDatabase } from './setup-pg';

declare global {
  // eslint-disable-next-line no-var
  var __TEST_DB__: { url: string; stop: () => Promise<void> } | undefined;
}

export default async function globalSetup() {
  const db = await setupTestDatabase();
  globalThis.__TEST_DB__ = db;
  return async () => {
    await db.stop();
  };
}
