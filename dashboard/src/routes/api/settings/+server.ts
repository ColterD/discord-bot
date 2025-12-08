/**
 * Settings API Endpoint
 *
 * Returns bot configuration settings (read-only for security)
 * Sensitive values are masked
 */

import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/api-auth';
import type { SettingsCategory } from '$lib/types';
import type { RequestHandler } from './$types';

/**
 * Mask sensitive values for display
 */
function maskSecret(value: string | undefined): string {
  if (!value) return '(not set)';
  if (value.length <= 8) return '••••••••';
  return `${value.substring(0, 4)}••••${value.substring(value.length - 4)}`;
}

/**
 * Get boolean from env var
 */
function getBool(value: string | undefined, defaultVal: boolean): boolean {
  if (value === undefined) return defaultVal;
  return value === 'true';
}

/**
 * Get number from env var
 */
function getNum(value: string | undefined, defaultVal: number): number {
  if (!value) return defaultVal;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? defaultVal : parsed;
}

/**
 * Build settings categories from environment
 */
function getSettingsCategories(): SettingsCategory[] {
  return [
    {
      id: 'bot',
      name: 'Bot',
      icon: '🤖',
      description: 'General bot configuration',
      settings: [
        {
          key: 'BOT_NAME',
          label: 'Bot Name',
          description: 'Display name for the bot',
          type: 'string',
          value: process.env.BOT_NAME ?? 'Discord Bot',
          defaultValue: 'Discord Bot'
        }
      ]
    },
    {
      id: 'discord',
      name: 'Discord',
      icon: '💬',
      description: 'Discord API configuration',
      settings: [
        {
          key: 'DISCORD_TOKEN',
          label: 'Bot Token',
          description: 'Discord bot authentication token',
          type: 'secret',
          value: maskSecret(process.env.DISCORD_TOKEN),
          sensitive: true
        },
        {
          key: 'DISCORD_CLIENT_ID',
          label: 'Client ID',
          description: 'Discord application client ID',
          type: 'string',
          value: process.env.DISCORD_CLIENT_ID ?? '(not set)'
        },
        {
          key: 'DEV_GUILD_ID',
          label: 'Dev Guild ID',
          description: 'Development server for testing commands',
          type: 'string',
          value: process.env.DEV_GUILD_ID ?? '(not set)'
        }
      ]
    },
    {
      id: 'ai',
      name: 'AI / LLM',
      icon: '🧠',
      description: 'Language model and AI settings',
      settings: [
        {
          key: 'OLLAMA_HOST',
          label: 'Ollama Host',
          description: 'URL of the Ollama API server',
          type: 'string',
          value: process.env.OLLAMA_HOST ?? 'http://ollama:11434',
          defaultValue: 'http://ollama:11434'
        },
        {
          key: 'LLM_MODEL',
          label: 'LLM Model',
          description: 'Primary model for conversations',
          type: 'string',
          value: process.env.LLM_MODEL ?? 'hf.co/DavidAU/...'
        },
        {
          key: 'LLM_FALLBACK_MODEL',
          label: 'Fallback Model',
          description: 'Used when VRAM is constrained',
          type: 'string',
          value: process.env.LLM_FALLBACK_MODEL ?? 'qwen2.5:7b',
          defaultValue: 'qwen2.5:7b'
        },
        {
          key: 'LLM_MAX_TOKENS',
          label: 'Max Tokens',
          description: 'Maximum tokens per response',
          type: 'number',
          value: getNum(process.env.LLM_MAX_TOKENS, 4096),
          defaultValue: 4096
        },
        {
          key: 'LLM_TEMPERATURE',
          label: 'Temperature',
          description: 'Creativity level (0.0-2.0)',
          type: 'number',
          value: getNum(process.env.LLM_TEMPERATURE, 0.7),
          defaultValue: 0.7
        },
        {
          key: 'LLM_KEEP_ALIVE',
          label: 'Keep Alive (seconds)',
          description: 'Model memory retention time (-1 = forever)',
          type: 'number',
          value: getNum(process.env.LLM_KEEP_ALIVE, 300),
          defaultValue: 300
        },
        {
          key: 'LLM_CONTEXT_LENGTH',
          label: 'Context Length',
          description: 'Maximum context window size',
          type: 'number',
          value: getNum(process.env.LLM_CONTEXT_LENGTH, 65536),
          defaultValue: 65536
        },
        {
          key: 'LLM_PRELOAD',
          label: 'Preload on Startup',
          description: 'Load model when bot starts',
          type: 'boolean',
          value: process.env.LLM_PRELOAD !== 'false',
          defaultValue: true
        },
        {
          key: 'LLM_USE_ORCHESTRATOR',
          label: 'Use Orchestrator',
          description: 'Enable enhanced tool-aware conversations',
          type: 'boolean',
          value: process.env.LLM_USE_ORCHESTRATOR !== 'false',
          defaultValue: true
        }
      ]
    },
    {
      id: 'cloudflare',
      name: 'Cloudflare',
      icon: '☁️',
      description: 'Cloudflare Workers AI configuration',
      settings: [
        {
          key: 'CLOUDFLARE_ACCOUNT_ID',
          label: 'Account ID',
          description: 'Cloudflare account identifier',
          type: 'string',
          value: maskSecret(process.env.CLOUDFLARE_ACCOUNT_ID),
          sensitive: true
        },
        {
          key: 'CLOUDFLARE_API_TOKEN',
          label: 'API Token',
          description: 'Workers AI authentication token',
          type: 'secret',
          value: maskSecret(process.env.CLOUDFLARE_API_TOKEN),
          sensitive: true
        },
        {
          key: 'CLOUDFLARE_ROUTER_ENABLED',
          label: 'Router Enabled',
          description: 'Use Cloudflare for intent routing',
          type: 'boolean',
          value: getBool(process.env.CLOUDFLARE_ROUTER_ENABLED, false),
          defaultValue: false
        }
      ]
    },
    {
      id: 'memory',
      name: 'Memory',
      icon: '💾',
      description: 'Memory and caching configuration',
      settings: [
        {
          key: 'VALKEY_URL',
          label: 'Valkey URL',
          description: 'Redis-compatible cache URL',
          type: 'string',
          value: process.env.VALKEY_URL ?? 'valkey://valkey:6379',
          defaultValue: 'valkey://valkey:6379'
        },
        {
          key: 'CHROMA_URL',
          label: 'ChromaDB URL',
          description: 'Vector database for semantic memory',
          type: 'string',
          value: process.env.CHROMA_URL ?? 'http://chromadb:8000',
          defaultValue: 'http://chromadb:8000'
        }
      ]
    },
    {
      id: 'image',
      name: 'Image Generation',
      icon: '🎨',
      description: 'ComfyUI and image generation settings',
      settings: [
        {
          key: 'COMFYUI_URL',
          label: 'ComfyUI URL',
          description: 'ComfyUI API endpoint',
          type: 'string',
          value: process.env.COMFYUI_URL ?? 'http://comfyui:8188',
          defaultValue: 'http://comfyui:8188'
        },
        {
          key: 'IMAGE_GENERATION_ENABLED',
          label: 'Enabled',
          description: 'Allow image generation commands',
          type: 'boolean',
          value: process.env.IMAGE_GENERATION_ENABLED !== 'false',
          defaultValue: true
        }
      ]
    },
    {
      id: 'security',
      name: 'Security',
      icon: '🔒',
      description: 'Security and access control',
      settings: [
        {
          key: 'OWNER_ID',
          label: 'Owner ID',
          description: 'Discord user ID with full access',
          type: 'string',
          value: process.env.OWNER_ID ?? '(not set)'
        },
        {
          key: 'IMPERSONATION_DETECTION',
          label: 'Impersonation Detection',
          description: 'Detect and block impersonation attempts',
          type: 'boolean',
          value: getBool(process.env.IMPERSONATION_DETECTION, true),
          defaultValue: true
        }
      ]
    },
    {
      id: 'logging',
      name: 'Logging',
      icon: '📝',
      description: 'Logging and debugging settings',
      settings: [
        {
          key: 'LOG_LEVEL',
          label: 'Log Level',
          description: 'Minimum log level to output',
          type: 'select',
          value: process.env.LOG_LEVEL ?? 'info',
          defaultValue: 'info',
          options: [
            { value: 'debug', label: 'Debug' },
            { value: 'info', label: 'Info' },
            { value: 'warn', label: 'Warning' },
            { value: 'error', label: 'Error' }
          ]
        },
        {
          key: 'TEST_MODE',
          label: 'Test Mode',
          description: 'Enable testing features',
          type: 'boolean',
          value: getBool(process.env.TEST_MODE, false),
          defaultValue: false
        }
      ]
    }
  ];
}

export const GET: RequestHandler = async (event) => {
  requireAuth(event);
  const categories = getSettingsCategories();
  return json({ categories });
};
