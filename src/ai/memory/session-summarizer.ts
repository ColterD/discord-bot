/**
 * Session Summarizer
 * Background summarization of conversations using a lightweight model on CPU
 */

import axios from "axios";
import { config } from "../../config.js";
import { createLogger } from "../../utils/logger.js";
import { type ConversationMessage, conversationStore } from "./conversation-store.js";

const log = createLogger("SessionSummarizer");

/**
 * Summarization request queue to prevent overwhelming the CPU
 */
interface SummarizationTask {
  userId: string;
  channelId: string;
  messages: ConversationMessage[];
  resolve: (summary: string) => void;
  reject: (error: Error) => void;
}

/**
 * SessionSummarizer - handles background conversation summarization
 */
export class SessionSummarizer {
  private readonly queue: SummarizationTask[] = [];
  private processing = false;
  private readonly model: string;
  private readonly apiUrl: string;

  constructor() {
    this.model = config.summarization.model;
    this.apiUrl = config.llm.apiUrl;
  }

  /**
   * Queue a conversation for summarization
   */
  async summarize(
    userId: string,
    channelId: string,
    messages: ConversationMessage[]
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        userId,
        channelId,
        messages,
        resolve,
        reject,
      });

      // Start processing if not already running
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process the summarization queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) continue;

      try {
        const summary = await this.generateSummary(task.messages);
        // Store the summary back in the conversation
        await conversationStore.markSummarized(task.userId, task.channelId, summary);
        task.resolve(summary);
      } catch (error) {
        log.error(
          "Failed to summarize conversation: " +
            (error instanceof Error ? error.message : String(error)),
          error
        );
        task.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }

    this.processing = false;
  }

  /**
   * Generate a summary using the summarization model (CPU-only)
   */
  private async generateSummary(messages: ConversationMessage[]): Promise<string> {
    // Format messages for the summarization prompt
    const formattedMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        const role = m.role === "user" ? "User" : "Assistant";
        return `${role}: ${m.content}`;
      })
      .join("\n\n");

    const prompt = `Summarize the following conversation concisely. Focus on:
1. Key topics discussed
2. Important decisions or conclusions
3. Any preferences or facts learned about the user
4. Outstanding questions or tasks

Conversation:
${formattedMessages}

Summary:`;

    try {
      const response = await axios.post(
        `${this.apiUrl}/api/generate`,
        {
          model: this.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.3,
            num_ctx: 4096,
          },
        },
        { timeout: 120000 } // Increased timeout to 120s
      );

      const summary = response.data.response.trim();
      log.debug(`Generated summary: ${summary.slice(0, 100)}...`);
      return summary;
    } catch (error) {
      log.error(
        "Ollama summarization request failed: " +
          (error instanceof Error ? error.message : String(error)),
        error
      );
      throw error;
    }
  }

  /**
   * Check if summarization should be triggered and do it
   */
  async checkAndSummarize(
    userId: string,
    channelId: string,
    shouldSummarize: boolean
  ): Promise<void> {
    if (!shouldSummarize) return;

    try {
      const messages = await conversationStore.getRecentMessages(userId, channelId);

      if (messages.length < 3) {
        // Not enough messages to summarize
        return;
      }

      log.info(`Triggering summarization for user ${userId}`);

      // Run summarization in background (don't await)
      this.summarize(userId, channelId, messages).catch((error) => {
        log.error(
          "Background summarization failed: " +
            (error instanceof Error ? error.message : String(error)),
          error
        );
      });
    } catch (error) {
      log.error(
        `Error checking summarization: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Get queue status
   */
  getQueueStatus(): { queueLength: number; processing: boolean } {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
    };
  }
}

// Export singleton
export const sessionSummarizer = new SessionSummarizer();
