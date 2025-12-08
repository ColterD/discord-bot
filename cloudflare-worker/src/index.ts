/**
 * Cloudflare Worker - AI Proxy
 *
 * Runs at the edge for low-latency AI inference.
 * Proxies requests to Workers AI binding.
 *
 * Endpoints:
 * - POST /chat     - Chat completion (router model)
 * - POST /embed    - Generate embeddings
 * - GET  /health   - Health check with edge location
 */

export interface Env {
  AI: Ai;
  API_SECRET?: string;
}

interface ChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
}

interface EmbedRequest {
  model: string;
  text: string | string[];
}

/**
 * Authenticate request using bearer token
 */
function authenticate(request: Request, env: Env): boolean {
  // If no secret configured, allow all (dev mode)
  if (!env.API_SECRET) {
    return true;
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return false;
  }

  const token = authHeader.slice(7);
  return token === env.API_SECRET;
}

/**
 * Get the Cloudflare datacenter code from the request
 */
function getDatacenter(request: Request): string {
  // CF-Ray header format: "8a1b2c3d4e5f6g7h-SEA"
  const cfRay = request.headers.get("cf-ray");
  if (cfRay) {
    const parts = cfRay.split("-");
    if (parts.length > 1) {
      return parts[parts.length - 1];
    }
  }
  // Fallback to colo from cf object
  const cf = request.cf;
  return (cf?.colo as string) || "unknown";
}

/**
 * CORS headers for browser requests
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check endpoint - no auth required
    if (url.pathname === "/health" && request.method === "GET") {
      const datacenter = getDatacenter(request);
      return Response.json(
        {
          status: "ok",
          edge: true,
          datacenter,
          timestamp: new Date().toISOString(),
        },
        { headers: corsHeaders }
      );
    }

    // All other endpoints require authentication
    if (!authenticate(request, env)) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    try {
      // Chat completion endpoint
      if (url.pathname === "/chat" && request.method === "POST") {
        const body: ChatRequest = await request.json();
        const start = Date.now();

        const response = await env.AI.run(body.model as BaseAiTextGenerationModels, {
          messages: body.messages,
          max_tokens: body.max_tokens,
          temperature: body.temperature,
        });

        const latencyMs = Date.now() - start;
        const datacenter = getDatacenter(request);

        return Response.json(
          {
            result: response,
            success: true,
            meta: {
              latencyMs,
              datacenter,
              edge: true,
            },
          },
          { headers: corsHeaders }
        );
      }

      // Embeddings endpoint
      if (url.pathname === "/embed" && request.method === "POST") {
        const body: EmbedRequest = await request.json();
        const start = Date.now();

        const response = await env.AI.run(body.model as BaseAiTextEmbeddingsModels, {
          text: body.text,
        });

        const latencyMs = Date.now() - start;
        const datacenter = getDatacenter(request);

        return Response.json(
          {
            result: response,
            success: true,
            meta: {
              latencyMs,
              datacenter,
              edge: true,
            },
          },
          { headers: corsHeaders }
        );
      }

      return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return Response.json(
        { error: message, success: false },
        { status: 500, headers: corsHeaders }
      );
    }
  },
} satisfies ExportedHandler<Env>;
