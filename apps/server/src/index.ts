import { buildApp } from './app.js';
import { MemoryRepository } from './repo/memory.js';
import type { SyncRepository } from './repo/types.js';

// Load apps/server/.env when present (Node ≥ 20.12). Real environment variables take precedence.
try {
  process.loadEnvFile?.('.env');
} catch {
  /* no .env file */
}

const env = process.env;
const storage = process.argv.includes('--memory') ? 'memory' : env.STORAGE ?? 'prisma';
const port = Number(env.PORT ?? 8787);
const host = env.HOST ?? '0.0.0.0';

async function createRepo(): Promise<SyncRepository> {
  if (storage === 'memory') {
    console.warn('[laptimer] STORAGE=memory: data is not persisted. Use only for development.');
    return new MemoryRepository();
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set (or use STORAGE=memory for development).');
  const { PrismaRepository } = await import('./repo/prisma.js');
  return new PrismaRepository();
}

async function main() {
  const repo = await createRepo();
  const app = await buildApp({
    repo,
    corsOrigins: (env.CORS_ORIGIN ?? 'http://localhost:5180').split(',').map((s) => s.trim()).filter(Boolean),
    bodyLimit: Number(env.BODY_LIMIT ?? 25 * 1024 * 1024),
    logger: true,
  });
  const shutdown = async () => {
    await app.close();
    await repo.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  await app.listen({ port, host });
}

main().catch((e) => {
  console.error('[laptimer] failed to start:', e instanceof Error ? e.message : e);
  process.exit(1);
});
