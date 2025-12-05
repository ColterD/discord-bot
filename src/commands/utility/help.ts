import { type CommandInteraction, EmbedBuilder } from "discord.js";
import { Discord, Slash } from "discordx";
import config from "../../config.js";

@Discord()
export class HelpCommands {
  @Slash({
    name: "help",
    description: "Show all available commands and features",
  })
  async help(interaction: CommandInteraction): Promise<void> {
    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle("📚 Bot Commands & Features")
      .setDescription(
        "Here's everything I can do! You can also chat with me by @mentioning me or sending me a DM."
      )
      .addFields(
        {
          name: "💬 AI Chat",
          value: [
            "`@mention` - Chat with me in any channel",
            "`DM` - Send me a direct message for private conversations",
            "`/ask` - Ask a one-off question (with optional file attachment)",
            "`/remember` - Tell me something to remember about you",
            "`/forget` - Clear all memories I have about you",
            "`/clear-context` - Clear conversation memory",
          ].join("\n"),
          inline: false,
        },
        {
          name: "🤖 AI Agent & Research",
          value: [
            "`/agent` - Have the AI agent research or complete tasks using tools",
            "`/research` - Deep research on a topic with web search",
            "`/calculate` - Solve math problems step by step",
          ].join("\n"),
          inline: false,
        },
        {
          name: "🛠️ AI Utilities",
          value: [
            "`/summarize` - Summarize recent channel messages",
            "`/translate` - Translate text to another language",
            "`/imagine` - Generate an image from a text prompt",
            "`Right-click message → Analyze Message` - Analyze any message",
          ].join("\n"),
          inline: false,
        },
        {
          name: "ℹ️ General",
          value: [
            "`/help` - Show this help message",
            "`/ping` - Check bot latency",
            "`/info` - Bot information",
            "`/avatar` - Get a user's avatar",
            "`/server` - Server information",
            "`/ai-status` - Check AI service status",
          ].join("\n"),
          inline: false,
        },
        {
          name: "🔨 Moderation",
          value: [
            "`/kick` - Kick a member",
            "`/ban` - Ban a member",
            "`/clear` - Delete messages in bulk",
          ].join("\n"),
          inline: false,
        },
        {
          name: "🔒 Owner Only",
          value: [
            "`/startai` - Enable AI service",
            "`/stopai` - Disable AI service",
            "`/aistatus` - Detailed AI status",
          ].join("\n"),
          inline: false,
        }
      )
      .setFooter({
        text: "Tip: Use Tab to see command options!",
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
}
