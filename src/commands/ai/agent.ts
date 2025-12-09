import { ApplicationCommandOptionType, type CommandInteraction, EmbedBuilder } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { getAgentService } from "../../ai/agent.js";
import config from "../../config.js";

/**
 * Safely extract model name from model path (e.g., "ollama/llama3" -> "llama3")
 */
function getModelDisplayName(): string {
  const parts = config.llm.model.split("/");
  return parts.pop() ?? config.llm.model;
}

@Discord()
export class AgentCommands {
  private get agentService() {
    return getAgentService();
  }

  @Slash({
    name: "agent",
    description: "Ask the AI agent to research or complete a task using tools",
  })
  async agent(
    @SlashOption({
      name: "task",
      description: "What would you like the agent to do?",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    task: string,
    @SlashOption({
      name: "verbose",
      description: "Show detailed agent activity (default: false)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    verbose: boolean | undefined,
    interaction: CommandInteraction
  ): Promise<void> {
    await interaction.deferReply();

    const showVerbose = verbose ?? false;

    try {
      // Run the agent with user context
      const result = await this.agentService.run(task, interaction.user.id);

      // Build the response embed
      const embed = new EmbedBuilder()
        .setColor(config.colors.primary)
        .setTitle("🤖 Agent Response")
        .setTimestamp();

      // Main response
      const responseText = result.response.slice(0, 4000);
      embed.setDescription(responseText);

      // Add footer with metadata
      const footerParts: string[] = [];
      if (result.toolsUsed.length > 0) {
        footerParts.push(`Tools: ${result.toolsUsed.join(", ")}`);
      }
      footerParts.push(`Steps: ${result.iterations}`, `Model: ${getModelDisplayName()}`);
      embed.setFooter({ text: footerParts.join(" | ") });

      // If verbose mode, add thinking process
      if (showVerbose && result.thinking && result.thinking.length > 0) {
        const thinkingText = result.thinking
          .map((t, i) => `${i + 1}. ${t}`)
          .join("\n")
          .slice(0, 1000);
        embed.addFields({
          name: "💭 Thinking Process",
          value: thinkingText,
          inline: false,
        });
      }

      // If verbose mode, show tools used
      if (showVerbose && result.toolsUsed.length > 0) {
        embed.addFields({
          name: "🔧 Tools Used",
          value: result.toolsUsed.join(", "),
          inline: true,
        });
        embed.addFields({
          name: "📊 Iterations",
          value: result.iterations.toString(),
          inline: true,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      const errorEmbed = new EmbedBuilder()
        .setColor(config.colors.error)
        .setTitle("❌ Agent Error")
        .setDescription(`Failed to complete task: ${errorMessage}`)
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }

  @Slash({
    name: "research",
    description: "Have the agent research a topic using web and academic sources",
  })
  async research(
    @SlashOption({
      name: "topic",
      description: "Topic to research",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    topic: string,
    @SlashOption({
      name: "depth",
      description: "Research depth (quick, standard, deep)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    depth: "quick" | "standard" | "deep" | undefined,
    interaction: CommandInteraction
  ): Promise<void> {
    await interaction.deferReply();

    const researchDepth = depth ?? "standard";

    // Build a research-focused prompt
    const prompts: Record<string, string> = {
      quick: `Quickly summarize what "${topic}" is. Use Wikipedia and one web search.`,
      standard: `Research "${topic}" thoroughly. Use Wikipedia for foundational knowledge, then search the web for current information. If it's a technical/scientific topic, also check arXiv for recent papers. Synthesize your findings into a comprehensive summary.`,
      deep: `Conduct deep research on "${topic}". Start by understanding the basics from Wikipedia. Then search the web for current news and developments. Check arXiv for any relevant academic papers. Think through what aspects are most important. Finally, provide a detailed, well-organized summary covering history, current state, and future directions if applicable.`,
    };

    try {
      const prompt = prompts[researchDepth];
      if (!prompt) {
        await interaction.editReply("Invalid research depth specified.");
        return;
      }
      const result = await this.agentService.run(prompt, interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor(config.colors.info)
        .setTitle(`📚 Research: ${topic}`)
        .setDescription(result.response.slice(0, 4000))
        .setTimestamp();

      // Sources used
      const sources: string[] = [];
      if (result.toolsUsed.includes("wikipedia_summary")) sources.push("Wikipedia");
      if (result.toolsUsed.includes("web_search")) sources.push("Web Search");
      if (result.toolsUsed.includes("search_arxiv")) sources.push("arXiv");
      if (result.toolsUsed.includes("fetch_url")) sources.push("Web Pages");

      if (sources.length > 0) {
        embed.addFields({
          name: "📖 Sources",
          value: sources.join(", "),
          inline: true,
        });
      }

      embed.addFields({
        name: "🔍 Depth",
        value: researchDepth.charAt(0).toUpperCase() + researchDepth.slice(1),
        inline: true,
      });

      embed.setFooter({
        text: `Completed in ${
          result.iterations
        } steps | Model: ${config.llm.model.split("/").pop()}`,
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      await interaction.editReply({
        content: `❌ Research failed: ${errorMessage}`,
      });
    }
  }

  @Slash({
    name: "calculate",
    description: "Have the agent solve a math problem or calculation",
  })
  async calculate(
    @SlashOption({
      name: "problem",
      description: "Math problem or expression to solve",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    problem: string,
    interaction: CommandInteraction
  ): Promise<void> {
    await interaction.deferReply();

    const prompt = `Solve this math problem step by step: ${problem}

Use the calculate tool to verify your work. Show your reasoning and provide the final answer.`;

    try {
      const result = await this.agentService.run(prompt, interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor(config.colors.success)
        .setTitle("🔢 Calculation Result")
        .setDescription(result.response.slice(0, 4000))
        .setFooter({
          text: `Model: ${getModelDisplayName()}`,
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      await interaction.editReply({
        content: `❌ Calculation failed: ${errorMessage}`,
      });
    }
  }
}
