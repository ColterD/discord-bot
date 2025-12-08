/**
 * Owner Notification Service
 *
 * Sends DM alerts to bot owners for critical events.
 * Includes cooldowns to prevent spam and formatted messages
 * with error details, recovery attempts, and Claude prompts.
 */

import type { Client, User } from "discord.js";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("NotificationService");

/**
 * Alert categories with different cooldowns and priorities
 */
export enum AlertCategory {
  HEALTH_CRITICAL = "health_critical",
  SELF_HEAL_FAILED = "self_heal_failed",
  SECURITY_ALERT = "security_alert",
  RESOURCE_WARNING = "resource_warning",
}

/**
 * Cooldowns per alert category (in milliseconds)
 */
const ALERT_COOLDOWNS: Record<AlertCategory, number> = {
  [AlertCategory.HEALTH_CRITICAL]: 60 * 60 * 1000, // 1 hour
  [AlertCategory.SELF_HEAL_FAILED]: 60 * 60 * 1000, // 1 hour
  [AlertCategory.SECURITY_ALERT]: 0, // No cooldown - always send
  [AlertCategory.RESOURCE_WARNING]: 4 * 60 * 60 * 1000, // 4 hours
};

/**
 * Alert structure for owner notifications
 */
export interface OwnerAlert {
  category: AlertCategory;
  title: string;
  error: string;
  triedSteps?: string[] | undefined;
  proposedFix?: string | undefined;
  claudePrompt?: string | undefined;
  metadata?: Record<string, string | number | boolean> | undefined;
}

/**
 * Recovery attempt result for self-healing alerts
 */
export interface RecoveryAttempt {
  step: string;
  success: boolean;
  error?: string;
  timestamp: Date;
}

/**
 * Notification service singleton
 */
class NotificationService {
  private client: Client | null = null;
  private readonly lastAlerts = new Map<string, number>();
  private readonly ownerCache = new Map<string, User>();

  /**
   * Initialize the notification service with a Discord client
   */
  setClient(client: Client): void {
    this.client = client;
    log.info("NotificationService initialized with Discord client");
  }

  /**
   * Get the configured owner IDs from config
   */
  private getOwnerIds(): string[] {
    return config.security.ownerIds;
  }

  /**
   * Check if an alert is on cooldown
   */
  private isOnCooldown(category: AlertCategory, serviceKey?: string): boolean {
    const key = serviceKey ? `${category}:${serviceKey}` : category;
    const lastAlert = this.lastAlerts.get(key);
    if (!lastAlert) return false;

    const cooldown = ALERT_COOLDOWNS[category];
    if (cooldown === 0) return false; // No cooldown

    return Date.now() - lastAlert < cooldown;
  }

  /**
   * Mark an alert as sent (for cooldown tracking)
   */
  private markAlertSent(category: AlertCategory, serviceKey?: string): void {
    const key = serviceKey ? `${category}:${serviceKey}` : category;
    this.lastAlerts.set(key, Date.now());
  }

  /**
   * Format timestamp for US Central Time (readable format)
   */
  private formatTimestamp(date: Date = new Date()): string {
    return date.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    });
  }

  /**
   * Format an alert into a Discord DM message
   */
  private formatAlert(alert: OwnerAlert): string {
    // Header with emoji based on category
    const emoji = this.getCategoryEmoji(alert.category);
    const lines: string[] = [
      "━━━━━━━━━━━━━━━━━━━━━━",
      `${emoji} **${alert.title}**`,
      "",
      "**Error**:",
      `\`\`\`${alert.error}\`\`\``,
    ];

    // What was tried (for self-healing failures)
    if (alert.triedSteps && alert.triedSteps.length > 0) {
      const stepsLines = alert.triedSteps.map((step, i) => `${i + 1}. ${step}`);
      lines.push("", "**Tried**:", ...stepsLines);
    }

    // Proposed manual fix
    if (alert.proposedFix) {
      lines.push("", "**Proposed Fix**:", alert.proposedFix);
    }

    // Claude prompt for complex debugging
    if (alert.claudePrompt) {
      lines.push("", "**Claude Prompt** (copy if needed):", "```", alert.claudePrompt, "```");
    }

    // Metadata footer
    if (alert.metadata && Object.keys(alert.metadata).length > 0) {
      const metadataLines = Object.entries(alert.metadata).map(
        ([key, value]) => `• ${key}: \`${value}\``
      );
      lines.push("", "**Details**:", ...metadataLines);
    }

    // Timestamp in readable US CST format
    lines.push("", `*${this.formatTimestamp()}*`);

    return lines.join("\n");
  }

  /**
   * Get emoji for alert category
   */
  private getCategoryEmoji(category: AlertCategory): string {
    switch (category) {
      case AlertCategory.HEALTH_CRITICAL:
        return "🚨";
      case AlertCategory.SELF_HEAL_FAILED:
        return "⚠️";
      case AlertCategory.SECURITY_ALERT:
        return "🔒";
      case AlertCategory.RESOURCE_WARNING:
        return "📊";
      default:
        return "ℹ️";
    }
  }

  /**
   * Fetch and cache owner user objects
   */
  private async getOwner(ownerId: string): Promise<User | null> {
    if (!this.client) return null;

    // Check cache first
    const cached = this.ownerCache.get(ownerId);
    if (cached) return cached;

    try {
      const user = await this.client.users.fetch(ownerId);
      this.ownerCache.set(ownerId, user);
      return user;
    } catch (error) {
      log.error(`Failed to fetch owner ${ownerId}: ${error}`);
      return null;
    }
  }

  /**
   * Send an alert to all configured owners
   */
  async sendAlert(alert: OwnerAlert, serviceKey?: string): Promise<boolean> {
    if (!this.client) {
      log.warn("Cannot send alert: Discord client not initialized");
      return false;
    }

    // Check cooldown
    if (this.isOnCooldown(alert.category, serviceKey)) {
      log.debug(`Alert ${alert.category} for ${serviceKey ?? "global"} is on cooldown, skipping`);
      return false;
    }

    const ownerIds = this.getOwnerIds();
    if (ownerIds.length === 0) {
      log.warn("No owner IDs configured, cannot send alert");
      return false;
    }

    const message = this.formatAlert(alert);
    let sentCount = 0;

    for (const ownerId of ownerIds) {
      try {
        const owner = await this.getOwner(ownerId);
        if (!owner) continue;

        // Split message if too long (Discord limit is 2000 chars)
        if (message.length <= 2000) {
          await owner.send(message);
        } else {
          // Split into multiple messages
          const chunks = this.splitMessage(message, 1900);
          for (const chunk of chunks) {
            await owner.send(chunk);
          }
        }

        sentCount++;
        log.info(`Sent ${alert.category} alert to owner ${ownerId}`);
      } catch (error) {
        log.error(`Failed to send alert to owner ${ownerId}: ${error}`);
      }
    }

    if (sentCount > 0) {
      this.markAlertSent(alert.category, serviceKey);
    }

    return sentCount > 0;
  }

  /**
   * Split a long message into chunks
   */
  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Find a good break point
      let breakPoint = remaining.lastIndexOf("\n", maxLength);
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = remaining.lastIndexOf(" ", maxLength);
      }
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = maxLength;
      }

      chunks.push(remaining.slice(0, breakPoint));
      remaining = remaining.slice(breakPoint).trim();
    }

    return chunks;
  }

  /**
   * Convenience method for health critical alerts
   */
  async sendHealthCritical(
    serviceName: string,
    error: string,
    proposedFix?: string
  ): Promise<boolean> {
    return this.sendAlert(
      {
        category: AlertCategory.HEALTH_CRITICAL,
        title: `Service Down: ${serviceName}`,
        error,
        proposedFix,
        metadata: {
          service: serviceName,
          downSince: new Date().toISOString(),
        },
      },
      serviceName
    );
  }

  /**
   * Convenience method for self-healing failure alerts
   */
  async sendSelfHealFailed(
    serviceName: string,
    error: string,
    attempts: RecoveryAttempt[],
    claudePrompt: string
  ): Promise<boolean> {
    const triedSteps = attempts.map((a) => {
      const status = a.success ? " ✓" : ` ✗ (${a.error ?? "failed"})`;
      return `${a.step}${status}`;
    });

    const lastAttempt = attempts.at(-1)?.timestamp.toISOString() ?? "unknown";

    return this.sendAlert(
      {
        category: AlertCategory.SELF_HEAL_FAILED,
        title: `Self-Healing Failed: ${serviceName}`,
        error,
        triedSteps,
        proposedFix: `SSH to server and run: \`docker compose restart ${serviceName.toLowerCase()}\``,
        claudePrompt,
        metadata: {
          service: serviceName,
          attemptCount: attempts.length,
          lastAttempt,
        },
      },
      serviceName
    );
  }

  /**
   * Convenience method for security alerts
   */
  async sendSecurityAlert(title: string, details: string, userId?: string): Promise<boolean> {
    return this.sendAlert({
      category: AlertCategory.SECURITY_ALERT,
      title: `Security: ${title}`,
      error: details,
      metadata: userId ? { userId } : undefined,
    });
  }

  /**
   * Convenience method for resource warnings
   */
  async sendResourceWarning(
    resource: string,
    currentValue: number,
    threshold: number,
    unit: string
  ): Promise<boolean> {
    return this.sendAlert(
      {
        category: AlertCategory.RESOURCE_WARNING,
        title: `Resource Warning: ${resource}`,
        error: `${resource} at ${currentValue}${unit} (threshold: ${threshold}${unit})`,
        proposedFix: this.getResourceFixSuggestion(resource),
        metadata: {
          resource,
          current: `${currentValue}${unit}`,
          threshold: `${threshold}${unit}`,
        },
      },
      resource
    );
  }

  /**
   * Get fix suggestion based on resource type
   */
  private getResourceFixSuggestion(resource: string): string {
    switch (resource.toLowerCase()) {
      case "vram":
        return "Unload unused models with `/ai control model unload` or reduce concurrent operations";
      case "disk":
        return "Clean up Docker volumes with `docker system prune -a` or remove old logs";
      case "memory":
        return "Restart services to free memory or increase Docker memory limits";
      default:
        return "Check system resources and consider scaling up or reducing load";
    }
  }

  /**
   * Clear cooldown for a specific alert (useful for testing)
   */
  clearCooldown(category: AlertCategory, serviceKey?: string): void {
    const key = serviceKey ? `${category}:${serviceKey}` : category;
    this.lastAlerts.delete(key);
    log.debug(`Cleared cooldown for ${key}`);
  }

  /**
   * Clear all cooldowns (useful for testing)
   */
  clearAllCooldowns(): void {
    this.lastAlerts.clear();
    log.debug("Cleared all alert cooldowns");
  }
}

// Singleton instance
let instance: NotificationService | null = null;

/**
 * Get the notification service singleton
 */
export function getNotificationService(): NotificationService {
  instance ??= new NotificationService();
  return instance;
}

export { NotificationService };
