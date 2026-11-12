// The single worker process (Q7): no HTTP surface; drains the Postgres job queue.
// Owns all scheduled/async work: emails, daily digests (A10), retention purges
// (INF6/D5), nightly statistics (INF11/D4), and later discovery/deploy/webhook jobs.
import { randomBytes } from 'node:crypto';
import { claimNext, complete, fail, handlers, queueDepth, enqueue } from '@eventdesk/jobs';

const workerId = `worker-${randomBytes(4).toString('hex')}`;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 2000);

async function tick(): Promise<void> {
  const job = await claimNext(workerId);
  if (!job) return;
  const handler = handlers[job.type];
  if (!handler) {
    await fail(job.id, `no handler for ${job.type}`);
    return;
  }
  try {
    await handler(job.payload as Record<string, unknown>);
    await complete(job.id);
    console.log(
      JSON.stringify({
        level: 'info',
        worker: workerId,
        job: job.id,
        type: job.type,
        result: 'done',
      })
    );
  } catch (e) {
    await fail(job.id, e instanceof Error ? e.message : String(e));
    console.log(
      JSON.stringify({
        level: 'error',
        worker: workerId,
        job: job.id,
        type: job.type,
        error: String(e),
      })
    );
  }
}

async function main(): Promise<void> {
  console.log(JSON.stringify({ level: 'info', worker: workerId, msg: 'started' }));
  // Schedule recurring jobs idempotently on boot.
  await enqueue('daily-digest', {}, new Date());
  await enqueue('retention-purge', {}, new Date());
  await enqueue('nightly-stats', {}, new Date());
  for (;;) {
    await tick();
    const depth = await queueDepth();
    if (depth > 100) {
      console.log(JSON.stringify({ level: 'warn', worker: workerId, queueDepth: depth })); // LAU5 alert feed
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

if (process.env.WORKER_RUN_ONCE === '1') {
  await tick();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
