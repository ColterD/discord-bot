import type { GuildMember, User } from "discord.js";
import { CONVERSATION_TIMEOUT_MS, MAX_CONTEXT_MESSAGES } from "../constants.js";
import { type AgentService, getAgentService } from "./agent.js";
import { getAIControlService } from "./control.js";
import { getMemoryManager } from "./memory/index.js";
import { getOrchestrator } from "./orchestrator.js";
import { type AIService, getAIService } from "./service.js";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface ConversationContext {
  messages: ConversationMessage[];
  lastActivity: number;
}

/**
 * Conversation Service - Manages multi-turn conversations with memory
 */
export class ConversationService {
  private readonly aiService: AIService;
  private readonly agentService: AgentService;
  private readonly conversations = new Map<string, ConversationContext>();
  private isAvailable: boolean | null = null;
  private lastHealthCheck = 0;
  private readonly healthCheckInterval = 30000; // Check every 30 seconds

  constructor() {
    this.aiService = getAIService();
    this.agentService = getAgentService();
  }

  /**
   * Check if the AI service is available
   */
  async checkAvailability(): Promise<boolean> {
    // Check if manually disabled first
    const controlService = getAIControlService();
    if (controlService.isManuallyDisabled()) {
      this.isAvailable = false;
      return false;
    }

    const now = Date.now();

    // Use cached result if recent
    if (this.isAvailable !== null && now - this.lastHealthCheck < this.healthCheckInterval) {
      return this.isAvailable;
    }

    try {
      this.isAvailable = await this.aiService.healthCheck();
      this.lastHealthCheck = now;
      return this.isAvailable;
    } catch {
      this.isAvailable = false;
      this.lastHealthCheck = now;
      return false;
    }
  }

  /**
   * Get or create conversation context for a channel/user
   */
  private getContext(contextId: string): ConversationContext {
    const now = Date.now();
    let context = this.conversations.get(contextId);

    // Check if context exists and is not expired
    if (context && now - context.lastActivity < CONVERSATION_TIMEOUT_MS) {
      return context;
    }

    // Create new context
    context = {
      messages: [],
      lastActivity: now,
    };
    this.conversations.set(contextId, context);
    return context;
  }

  /**
   * Add a message to conversation context
   */
  private addToContext(contextId: string, role: "user" | "assistant", content: string): void {
    const context = this.getContext(contextId);
    context.messages.push({
      role,
      content,
      timestamp: Date.now(),
    });
    context.lastActivity = Date.now();

    // Trim old messages
    if (context.messages.length > MAX_CONTEXT_MESSAGES) {
      context.messages = context.messages.slice(-MAX_CONTEXT_MESSAGES);
    }
  }

  /**
   * Build conversation history for the LLM
   */
  private buildConversationPrompt(contextId: string, newMessage: string): string {
    const context = this.getContext(contextId);

    if (context.messages.length === 0) {
      return newMessage;
    }

    // Build conversation history
    let prompt = "Previous conversation:\n";
    for (const msg of context.messages.slice(-10)) {
      const role = msg.role === "user" ? "User" : "Assistant";
      prompt += `${role}: ${msg.content}\n`;
    }
    prompt += `\nUser: ${newMessage}`;

    return prompt;
  }

  /**
   * Chat with the AI, maintaining conversation context
   * @param contextId - Unique context ID (channel/DM)
   * @param message - User message
   * @param username - Display name for personalization
   * @param userId - Discord user ID for memory isolation
   */
  async chat(
    contextId: string,
    message: string,
    username: string,
    userId: string
  ): Promise<string> {
    // Check availability first
    const available = await this.checkAvailability();
    if (!available) {
      throw new Error("AI service is currently unavailable");
    }

    // Build prompt with conversation history
    const prompt = this.buildConversationPrompt(contextId, message);

    // Add user message to context
    this.addToContext(contextId, "user", message);

    // Get memory context for this user
    const memoryManager = getMemoryManager();
    const memoryContext = await memoryManager.buildFullContext(userId, message);

    try {
      const systemPrompt = `You are a friendly and helpful Discord bot assistant. You're chatting with ${username}.
Keep your responses conversational, concise, and helpful. You can use casual language and even humor when appropriate.
If someone asks you to do something that requires tools (like web search, calculations, research), let them know they can use /agent or /research commands for that.
Don't use markdown formatting excessively - keep it simple for Discord chat.

${memoryContext}`;

      const response = await this.aiService.chat(prompt, {
        temperature: 0.8,
        maxTokens: 1024,
        systemPrompt,
      });

      // Add assistant response to context
      this.addToContext(contextId, "assistant", response);

      // Store memories from this exchange (async, don't await)
      const context = this.getContext(contextId);
      const recentMessages = context.messages.slice(-2).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      memoryManager.addFromConversation(userId, recentMessages).catch(() => {
        // Silently ignore memory storage failures
      });

      return response;
    } catch (error) {
      // Remove the user message from context since we failed
      const context = this.getContext(contextId);
      context.messages.pop();
      throw error;
    }
  }

  /**
   * Run agent mode for complex tasks
   * @param task - Task description
   * @param userId - Discord user ID for memory isolation
   */
  async runAgent(task: string, userId: string): Promise<{ response: string; toolsUsed: string[] }> {
    const available = await this.checkAvailability();
    if (!available) {
      throw new Error("AI service is currently unavailable");
    }

    const result = await this.agentService.run(task, userId);
    return {
      response: result.response,
      toolsUsed: result.toolsUsed,
    };
  }

  /**
   * Run with the Orchestrator for enhanced tool-aware conversations
   * Includes MCP tools, security checks, and three-tier memory
   * @param message - User message
   * @param user - Discord user making the request
   * @param member - Guild member (for permission checks)
   * @param channelId - Channel ID for conversation tracking
   * @param guildId - Guild ID for context
   * @param onImageGenerationStart - Optional callback when image generation begins
   */
  async chatWithOrchestrator(
    message: string,
    user: User,
    member: GuildMember | null,
    channelId: string,
    guildId?: string,
    onImageGenerationStart?: () => Promise<void>,
    onTyping?: () => Promise<void>
  ): Promise<{
    response: string;
    toolsUsed: string[];
    blocked?: boolean | undefined;
    generatedImage?: { buffer: Buffer; filename: string } | undefined;
  }> {
    const available = await this.checkAvailability();
    if (!available) {
      throw new Error("AI service is currently unavailable");
    }

    const orchestrator = getOrchestrator();
    const result = await orchestrator.run(message, {
      user,
      member,
      channelId,
      guildId: guildId ?? null,
      ...(onImageGenerationStart && { onImageGenerationStart }),
      ...(onTyping && { onTyping }),
    });

    return {
      response: result.content,
      toolsUsed: result.toolsUsed,
      blocked: result.blocked,
      generatedImage: result.generatedImage,
    };
  }

  /**
   * Clear conversation context for a channel/user
   */
  clearContext(contextId: string): void {
    this.conversations.delete(contextId);
  }

  /**
   * Get the AI service availability status
   */
  getAvailabilityStatus(): { available: boolean | null; lastCheck: number } {
    return {
      available: this.isAvailable,
      lastCheck: this.lastHealthCheck,
    };
  }

  /**
   * Clean up expired conversations (call periodically)
   */
  cleanupExpiredConversations(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [contextId, context] of this.conversations) {
      if (now - context.lastActivity > CONVERSATION_TIMEOUT_MS) {
        this.conversations.delete(contextId);
        cleaned++;
      }
    }

    return cleaned;
  }
}

// Singleton instance
let instance: ConversationService | null = null;

export function getConversationService(): ConversationService {
  instance ??= new ConversationService();
  return instance;
}

export default ConversationService;
