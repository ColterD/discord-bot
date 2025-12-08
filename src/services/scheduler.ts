import { type Job, Queue, Worker } from "bullmq";
import type { Client, TextChannel } from "discord.js";
import IORedis from "ioredis";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("SchedulerService");

interface ReminderJob {
  userId: string;
  channelId: string;
  message: string;
}

export class SchedulerService {
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private queueConnection: IORedis | null = null;
  private workerConnection: IORedis | null = null;
  private client: Client | null = null;
  private initialized = false;
  private initializationFailed = false;
  private readonly queueName: string;

  constructor(queueName = "reminders") {
    this.queueName = queueName;
  }

  /**
   * Lazily initialize connections to Valkey
   * This allows the bot to start even if Valkey is unavailable
   */
  private async ensureInitialized(): Promise<boolean> {
    if (this.initialized) return true;
    if (this.initializationFailed) return false;

    try {
      // Replace valkey:// with redis:// for ioredis compatibility
      const connectionUrl = config.valkey.url.replace("valkey://", "redis://");

      // Queue connection with error handling
      this.queueConnection = new IORedis(connectionUrl, {
        maxRetriesPerRequest: null,
        retryStrategy: (times: number) => {
          if (times > 3) {
            log.warn("Valkey connection failed after 3 retries");
            return null;
          }
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });

      // Suppress connection error spam - log only once
      let errorLogged = false;
      this.queueConnection.on("error", (err: Error) => {
        if (!errorLogged) {
          log.warn(`Scheduler queue connection error: ${err.message}`);
          errorLogged = true;
        }
      });

      await this.queueConnection.connect();

      this.queue = new Queue(this.queueName, {
        connection: this.queueConnection,
      });

      // Worker connection
      this.workerConnection = new IORedis(connectionUrl, {
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });

      let workerErrorLogged = false;
      this.workerConnection.on("error", (err: Error) => {
        if (!workerErrorLogged) {
          log.warn(`Scheduler worker connection error: ${err.message}`);
          workerErrorLogged = true;
        }
      });

      await this.workerConnection.connect();

      this.worker = new Worker(
        this.queueName,
        async (job: Job<ReminderJob>) => {
          await this.processReminder(job);
        },
        {
          connection: this.workerConnection,
        }
      );

      this.worker.on("completed", (job) => {
        log.info(`Reminder job ${job.id} completed`);
      });

      this.worker.on("failed", (job, err) => {
        log.error(`Reminder job ${job?.id} failed: ${err.message}`);
      });

      this.initialized = true;
      log.info("SchedulerService initialized");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`SchedulerService initialization failed (reminders disabled): ${message}`);
      this.initializationFailed = true;
      return false;
    }
  }

  public setClient(client: Client) {
    this.client = client;
    // Trigger lazy initialization when client is set
    this.ensureInitialized().catch(() => {
      // Error already logged in ensureInitialized
    });
  }

  /**
   * Check if the scheduler is available (Valkey connected)
   */
  public isAvailable(): boolean {
    return this.initialized && !this.initializationFailed;
  }

  public async scheduleReminder(
    userId: string,
    channelId: string,
    message: string,
    delayMs: number
  ): Promise<boolean> {
    const ready = await this.ensureInitialized();
    if (!ready || !this.queue) {
      log.warn("Cannot schedule reminder: Valkey connection unavailable");
      return false;
    }

    await this.queue.add(
      "reminder",
      {
        userId,
        channelId,
        message,
      },
      {
        delay: delayMs,
      }
    );
    log.info(`Scheduled reminder for user ${userId} in ${delayMs}ms`);
    return true;
  }

  private async processReminder(job: Job<ReminderJob>) {
    if (!this.client) {
      log.error("Discord client not initialized in SchedulerService");
      throw new Error("Discord client not initialized");
    }

    const { userId, channelId, message } = job.data;

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel?.isTextBased()) {
        await (channel as TextChannel).send(`⏰ <@${userId}> Reminder: ${message}`);
      } else {
        log.warn(`Could not find text channel ${channelId} for reminder`);
      }
    } catch (error) {
      log.error(`Failed to send reminder to channel ${channelId}:`, error);
      throw error;
    }
  }

  public async close() {
    if (this.queue) await this.queue.close();
    if (this.worker) await this.worker.close();
    if (this.queueConnection) await this.queueConnection.quit();
    if (this.workerConnection) await this.workerConnection.quit();
    log.info("SchedulerService connections closed");
  }
}

// Singleton
let instance: SchedulerService | null = null;
export function getSchedulerService(): SchedulerService {
  instance ??= new SchedulerService();
  return instance;
}
