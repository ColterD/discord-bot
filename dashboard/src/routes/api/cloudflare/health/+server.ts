import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface CloudflareHealth {
  available: boolean;
  routerModel: string | null;
  embeddingModel: string | null;
  configured: boolean;
  /** Whether using edge Worker (low latency) or REST API (higher latency) */
  usingWorker: boolean;
  /** Datacenter code (e.g., "SEA (Seattle)") */
  datacenter: string | null;
  /** Latency in ms */
  latencyMs: number | null;
}

// Datacenter code to city name mapping (common ones)
const DATACENTER_NAMES: Record<string, string> = {
  SEA: 'Seattle',
  SJC: 'San Jose',
  LAX: 'Los Angeles',
  DFW: 'Dallas',
  ORD: 'Chicago',
  IAD: 'Ashburn',
  EWR: 'Newark',
  ATL: 'Atlanta',
  MIA: 'Miami',
  YYZ: 'Toronto',
  YVR: 'Vancouver',
  LHR: 'London',
  AMS: 'Amsterdam',
  FRA: 'Frankfurt',
  CDG: 'Paris',
  NRT: 'Tokyo',
  HKG: 'Hong Kong',
  SIN: 'Singapore',
  SYD: 'Sydney'
};

/**
 * Format datacenter code with city name
 */
function formatDatacenter(code: string | null): string | null {
  if (!code) return null;
  const name = DATACENTER_NAMES[code];
  return name ? `${code} (${name})` : code;
}

/**
 * Extract datacenter code from cf-ray header
 * Format: "8a1b2c3d4e5f6g7h-SEA" where SEA is the datacenter
 */
function extractDatacenter(cfRay: string | null): string | null {
  if (!cfRay) return null;
  const parts = cfRay.split('-');
  return parts.length > 1 ? parts[parts.length - 1] : null;
}

export const GET: RequestHandler = async () => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const routerModel = process.env.CLOUDFLARE_ROUTER_MODEL || '@cf/ibm-granite/granite-4.0-h-micro';
  const embeddingModel = process.env.CLOUDFLARE_EMBEDDING_MODEL || '@cf/qwen/qwen3-embedding-0.6b';
  const workerUrl = process.env.CLOUDFLARE_WORKER_URL;
  const workerSecret = process.env.CLOUDFLARE_WORKER_SECRET;

  // Check if Cloudflare is configured
  if (!accountId || !apiToken) {
    return json({
      available: false,
      routerModel: null,
      embeddingModel: null,
      configured: false,
      usingWorker: false,
      datacenter: null,
      latencyMs: null
    } satisfies CloudflareHealth);
  }

  // If Worker is configured, use it for health check (edge-based, low latency)
  if (workerUrl) {
    try {
      const start = performance.now();
      const headers: Record<string, string> = {};
      if (workerSecret) {
        headers.Authorization = `Bearer ${workerSecret}`;
      }

      const response = await fetch(`${workerUrl}/health`, { headers });
      const latencyMs = Math.round(performance.now() - start);

      if (!response.ok) {
        return json({
          available: false,
          routerModel,
          embeddingModel,
          configured: true,
          usingWorker: true,
          datacenter: null,
          latencyMs
        } satisfies CloudflareHealth);
      }

      const data = await response.json() as { datacenter?: string; status?: string };

      return json({
        available: data.status === 'ok',
        routerModel,
        embeddingModel,
        configured: true,
        usingWorker: true,
        datacenter: formatDatacenter(data.datacenter ?? null),
        latencyMs
      } satisfies CloudflareHealth);
    } catch {
      // Worker failed, fall through to REST API check
    }
  }

  // Fallback: REST API health check (higher latency)
  try {
    const start = performance.now();
    const response = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      }
    });
    const latencyMs = Math.round(performance.now() - start);

    // Extract datacenter from cf-ray header
    const cfRay = response.headers.get('cf-ray');
    const datacenter = formatDatacenter(extractDatacenter(cfRay));

    if (!response.ok) {
      return json({
        available: false,
        routerModel,
        embeddingModel,
        configured: true,
        usingWorker: false,
        datacenter,
        latencyMs
      } satisfies CloudflareHealth);
    }

    const data = await response.json() as { success?: boolean };

    return json({
      available: data.success === true,
      routerModel,
      embeddingModel,
      configured: true,
      usingWorker: false,
      datacenter,
      latencyMs
    } satisfies CloudflareHealth);
  } catch {
    return json({
      available: false,
      routerModel,
      embeddingModel,
      configured: true,
      usingWorker: false,
      datacenter: null,
      latencyMs: null
    } satisfies CloudflareHealth);
  }
};
