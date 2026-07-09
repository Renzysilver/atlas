// ATLAS API — lib/queue.ts
// Queue abstraction that adapts between BullMQ+Redis (production) and an
// in-process fallback (dev sandbox where Redis is unavailable).
//
// USER CLARIFICATION (Path A confirmation):
//   "Mock" ONLY means substituting Redis with an in-memory queue for this
//   dev sandbox. It does NOT mean mocking any match data, predictions, or
//   layer outputs. Constitution Rule 4 (never fabricate data/probabilities/
//   outputs) still applies fully.
//
// PRODUCTION SWAP:
//   Set REDIS_URL=redis://localhost:6379 in .env (pointed at the Redis
//   container from infra/docker-compose.yml). This module automatically
//   uses real BullMQ + ioredis. No code changes anywhere else.

import { logger } from "./logger.ts";

export interface QueueJob {
  name: string;
  data: Record<string, unknown>;
}

export type JobProcessor = (job: QueueJob) => Promise<void>;

interface QueueAdapter {
  add(name: string, data: Record<string, unknown>): Promise<void>;
  registerProcessor(processor: JobProcessor): void;
  close(): Promise<void>;
  readonly mode: "redis" | "in-memory";
}

// ============================================================
// In-memory adapter (dev sandbox only)
// ============================================================

class InMemoryQueueAdapter implements QueueAdapter {
  readonly mode = "in-memory" as const;
  private queue: QueueJob[] = [];
  private processor: JobProcessor | null = null;
  private processing = false;

  async add(name: string, data: Record<string, unknown>): Promise<void> {
    this.queue.push({ name, data });
    this.kickProcessor();
  }

  registerProcessor(processor: JobProcessor): void {
    this.processor = processor;
    this.kickProcessor();
  }

  private async kickProcessor(): Promise<void> {
    if (this.processing || !this.processor) return;
    this.processing = true;
    try {
      while (this.queue.length > 0 && this.processor) {
        const job = this.queue.shift()!;
        try {
          await this.processor(job);
        } catch (err) {
          logger.error("in-memory queue job failed", {
            jobName: job.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      this.processing = false;
    }
  }

  async close(): Promise<void> {
    this.queue = [];
    this.processor = null;
  }
}

// ============================================================
// BullMQ adapter (production — Redis-backed)
// ============================================================

class BullMqQueueAdapter implements QueueAdapter {
  readonly mode = "redis" as const;
  // Dynamic import so the dev sandbox doesn't crash if ioredis isn't connected.
  // We construct Queue + Worker lazily.
  private queue: any = null;
  private worker: any = null;
  private readonly queueName = "atlas-jobs";
  private connection: any;

  constructor(redisUrl: string) {
    // Lazy: create IORedis connection. BullMQ will reuse it.
    // The actual imports happen in init() to avoid loading bullmq in dev.
    this.connection = redisUrl;
  }

  private async init(): Promise<void> {
    if (this.queue) return;
    const IORedis = (await import("ioredis")).default;
    const { Queue, Worker } = await import("bullmq");
    const redis = new IORedis(this.connection, { maxRetriesPerRequest: null });
    this.queue = new Queue(this.queueName, { connection: redis });
    // Worker is created in registerProcessor so we can wire the processor fn.
    (this as any)._redis = redis;
    (this as any)._Queue = Queue;
    (this as any)._Worker = Worker;
  }

  async add(name: string, data: Record<string, unknown>): Promise<void> {
    await this.init();
    await this.queue.add(name, data, {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
    });
  }

  registerProcessor(processor: JobProcessor): void {
    // BullMQ workers MUST be created synchronously with a connection, so
    // we init() then register.
    this.init().then(() => {
      const Worker = (this as any)._Worker;
      this.worker = new Worker(
        this.queueName,
        async (job: any) => {
          await processor({ name: job.name, data: job.data });
        },
        { connection: (this as any)._redis, concurrency: Number(process.env.QUEUE_CONCURRENCY ?? 4) },
      );
      this.worker.on("failed", (job: any, err: Error) => {
        logger.error("bullmq job failed", { jobName: job?.name, error: err.message });
      });
    });
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await (this as any)._redis?.quit();
  }
}

// ============================================================
// Factory
// ============================================================

let cachedAdapter: QueueAdapter | null = null;

export function getQueue(): QueueAdapter {
  if (cachedAdapter) return cachedAdapter;
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    logger.info("queue adapter: bullmq + redis", { redisUrl: redisUrl.replace(/:[^:@]+@/, ":***@") });
    cachedAdapter = new BullMqQueueAdapter(redisUrl);
  } else {
    logger.warn("queue adapter: in-memory fallback (dev sandbox). Set REDIS_URL for production.");
    cachedAdapter = new InMemoryQueueAdapter();
  }
  return cachedAdapter;
}

export async function closeQueue(): Promise<void> {
  if (cachedAdapter) await cachedAdapter.close();
  cachedAdapter = null;
}
