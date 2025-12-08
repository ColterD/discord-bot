import Docker from 'dockerode';

// Docker client - uses Windows named pipe
const docker = new Docker({ socketPath: '//./pipe/docker_engine' });

// Stack container name patterns
const STACK_PATTERNS = [
  'discord-bot',
  'ollama',
  'chromadb',
  'valkey',
  'searxng',
  'comfyui'
];

// ============================================================================
// Caching Layer - Reduces Docker API calls for rapid polling/SSR
// ============================================================================
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

type ContainerData = Awaited<ReturnType<typeof getStackContainersUncached>>;
const CACHE_TTL_MS = 2000; // 2 seconds - balances freshness vs performance
let containerCache: CacheEntry<ContainerData> | null = null;

/**
 * Check if cache entry is still valid
 */
function isCacheValid<T>(cache: CacheEntry<T> | null): cache is CacheEntry<T> {
  return cache !== null && Date.now() - cache.timestamp < CACHE_TTL_MS;
}

/**
 * Check if container belongs to our stack
 */
function isStackContainer(names: string[]): boolean {
  return names.some(name =>
    STACK_PATTERNS.some(pattern => name.includes(pattern))
  );
}

/**
 * CPU usage info with both normalized and raw values
 */
interface CpuUsage {
  /** Normalized percentage (0-100% of total system capacity) */
  percent: number;
  /** Number of online CPU cores */
  cores: number;
}

/**
 * Calculate CPU percentage from Docker stats
 * Returns normalized value (0-100% of total system) like Docker Desktop/Portainer
 */
function calculateCpuPercent(stats: Docker.ContainerStats): CpuUsage {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage -
                   stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage -
                      stats.precpu_stats.system_cpu_usage;
  const cores = stats.cpu_stats.online_cpus || 1;

  if (systemDelta > 0 && cpuDelta > 0) {
    // Normalized: (cpuDelta / systemDelta) * 100 gives 0-100% of total system
    // This matches Docker Desktop, Portainer, and most monitoring tools
    const percent = (cpuDelta / systemDelta) * 100;
    return { percent, cores };
  }
  return { percent: 0, cores };
}

/**
 * Calculate memory usage from Docker stats
 */
function calculateMemoryUsage(stats: Docker.ContainerStats): {
  used: number;
  limit: number;
  percent: number;
} | null {
  const memStats = stats.memory_stats;
  if (!memStats.usage || !memStats.limit) {
    return null;
  }

  const used = memStats.usage - (memStats.stats?.cache || 0);
  const limit = memStats.limit;
  const percent = (used / limit) * 100;

  return { used, limit, percent };
}

interface PortMapping {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: string;
}

/**
 * Deduplicate ports - Docker returns both IPv4 (0.0.0.0) and IPv6 (::) bindings
 * We only need unique PrivatePort:PublicPort/Type combinations
 */
function deduplicatePorts(ports: PortMapping[]): PortMapping[] {
  if (!ports || ports.length === 0) return [];

  const seen = new Set<string>();
  const unique: PortMapping[] = [];

  for (const port of ports) {
    // Create key from port mapping (ignore IP address)
    const key = `${port.PrivatePort}:${port.PublicPort ?? 'none'}/${port.Type}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(port);
    }
  }

  return unique;
}

/**
 * Get all containers in the stack with their stats (uncached - internal use)
 */
async function getStackContainersUncached() {
  const containers = await docker.listContainers({ all: true });
  const stackContainers = containers.filter(c => isStackContainer(c.Names));

  const results = await Promise.all(
    stackContainers.map(async (c) => {
      const container = docker.getContainer(c.Id);
      let stats = null;

      if (c.State === 'running') {
        try {
          stats = await container.stats({ stream: false });
        } catch {
          // Container might have stopped between list and stats
        }
      }

      const cpuUsage = stats ? calculateCpuPercent(stats) : null;
      return {
        id: c.Id.substring(0, 12),
        name: c.Names[0]?.replace('/', '') ?? 'unknown',
        state: c.State as 'running' | 'exited' | 'paused' | 'restarting',
        status: c.Status,
        image: c.Image,
        ports: deduplicatePorts(c.Ports),
        created: c.Created,
        cpu: cpuUsage?.percent ?? null,
        cpuCores: cpuUsage?.cores ?? null,
        memory: stats ? calculateMemoryUsage(stats) : null
      };
    })
  );

  return results;
}

/**
 * Get all containers in the stack with their stats (cached for performance)
 * Uses 2-second cache to reduce Docker API calls during rapid polling
 */
export async function getStackContainers() {
  if (isCacheValid(containerCache)) {
    return containerCache.data;
  }

  const data = await getStackContainersUncached();
  containerCache = { data, timestamp: Date.now() };
  return data;
}

/**
 * Get a single container by name
 */
export async function getContainerByName(name: string) {
  const containers = await docker.listContainers({ all: true });
  const container = containers.find(c =>
    c.Names.some(n => n.replace('/', '') === name)
  );

  if (!container) {
    return null;
  }

  return docker.getContainer(container.Id);
}

/**
 * Start a container by name
 */
export async function startContainer(name: string): Promise<void> {
  const container = await getContainerByName(name);
  if (!container) {
    throw new Error(`Container not found: ${name}`);
  }
  await container.start();
}

/**
 * Stop a container by name
 */
export async function stopContainer(name: string): Promise<void> {
  const container = await getContainerByName(name);
  if (!container) {
    throw new Error(`Container not found: ${name}`);
  }
  await container.stop();
}

/**
 * Restart a container by name
 */
export async function restartContainer(name: string): Promise<void> {
  const container = await getContainerByName(name);
  if (!container) {
    throw new Error(`Container not found: ${name}`);
  }
  await container.restart();
}

/**
 * Structured log entry
 */
export interface LogEntry {
  timestamp: string;
  message: string;
  stream: 'stdout' | 'stderr';
}

/**
 * Create a log entry from parsed payload
 */
function createLogEntry(payload: string, streamType: number): LogEntry {
  const stream: 'stdout' | 'stderr' = streamType === 2 ? 'stderr' : 'stdout';
  // Parse timestamp and message (format: "2024-01-01T12:00:00.000000000Z message")
  const timestampMatch = payload.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s*(.*)/s);

  if (timestampMatch) {
    return { timestamp: timestampMatch[1], message: timestampMatch[2], stream };
  }
  return { timestamp: new Date().toISOString(), message: payload, stream };
}

/**
 * Parse Docker multiplexed log buffer into structured entries
 * Docker logs have an 8-byte header: [stream, 0, 0, 0, size1, size2, size3, size4]
 * - stream: 1=stdout, 2=stderr
 * - size: big-endian uint32 payload size
 */
function parseDockerLogs(buffer: Buffer): LogEntry[] {
  const entries: LogEntry[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    // Need at least 8 bytes for header
    if (offset + 8 > buffer.length) break;

    // Read header
    const streamType = buffer[offset];
    const payloadSize = buffer.readUInt32BE(offset + 4);
    offset += 8;

    // Read payload
    if (offset + payloadSize > buffer.length) break;
    const payload = buffer.subarray(offset, offset + payloadSize).toString('utf-8').trim();
    offset += payloadSize;

    if (payload) {
      entries.push(createLogEntry(payload, streamType));
    }
  }

  return entries;
}

/**
 * Get container logs as structured entries
 */
export async function getContainerLogs(
  name: string,
  options: { tail?: number; since?: number } = {}
): Promise<LogEntry[]> {
  const container = await getContainerByName(name);
  if (!container) {
    throw new Error(`Container not found: ${name}`);
  }

  const logs = await container.logs({
    stdout: true,
    stderr: true,
    tail: options.tail ?? 100,
    since: options.since,
    timestamps: true
  });

  // logs is a Buffer with multiplexed stream data
  return parseDockerLogs(logs as Buffer);
}

export { docker };
