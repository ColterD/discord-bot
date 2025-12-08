/**
 * Prometheus Metrics Endpoint
 *
 * Exports metrics in Prometheus text format for external monitoring.
 * Endpoint: GET /metrics/prometheus
 *
 * No authentication required - designed for prometheus scraping.
 * Metrics include container stats, GPU usage, and dashboard health.
 */

import { getStackContainers } from '$lib/server/docker';
import type { RequestHandler } from './$types';

// Dashboard startup time for uptime calculation
const startupTime = Date.now();

/**
 * Format a metric line in Prometheus exposition format
 */
function metric(
  name: string,
  value: number,
  labels?: Record<string, string>,
  help?: string,
  type?: 'gauge' | 'counter'
): string {
  const lines: string[] = [];

  // Add HELP and TYPE comments (only once per metric name)
  if (help) {
    lines.push(`# HELP ${name} ${help}`);
  }
  if (type) {
    lines.push(`# TYPE ${name} ${type}`);
  }

  // Format labels
  let labelStr = '';
  if (labels && Object.keys(labels).length > 0) {
    const labelPairs = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    labelStr = `{${labelPairs}}`;
  }

  lines.push(`${name}${labelStr} ${value}`);
  return lines.join('\n');
}

type ContainerInfo = Awaited<ReturnType<typeof getStackContainers>>[number];

/**
 * Add per-container resource metrics to the metrics array
 */
function addContainerResourceMetrics(metrics: string[], container: ContainerInfo): void {
  const labels = { name: container.name, image: container.image };

  metrics.push(metric('container_running', container.state === 'running' ? 1 : 0, labels));

  if (container.state !== 'running') return;

  if (container.cpu !== null) {
    metrics.push(metric('container_cpu_percent', container.cpu, labels));
  }
  if (container.memory) {
    metrics.push(
      metric('container_memory_bytes', container.memory.used, labels),
      metric('container_memory_percent', container.memory.percent, labels)
    );
  }
}

/**
 * Collect all container metrics
 */
async function collectContainerMetrics(metrics: string[]): Promise<void> {
  const containers = await getStackContainers();

  // Container counts by state
  const stateCounts: Record<string, number> = {};
  for (const container of containers) {
    stateCounts[container.state] = (stateCounts[container.state] ?? 0) + 1;
  }

  metrics.push(
    `# HELP container_count Number of containers by state`,
    `# TYPE container_count gauge`
  );
  for (const [state, count] of Object.entries(stateCounts)) {
    metrics.push(metric('container_count', count, { state }));
  }

  // Per-container metric headers
  metrics.push(
    metric('container_total', containers.length, undefined, 'Total number of monitored containers', 'gauge'),
    `# HELP container_cpu_percent Container CPU usage percentage`,
    `# TYPE container_cpu_percent gauge`,
    `# HELP container_memory_bytes Container memory usage in bytes`,
    `# TYPE container_memory_bytes gauge`,
    `# HELP container_memory_percent Container memory usage percentage`,
    `# TYPE container_memory_percent gauge`,
    `# HELP container_running Container running state (1=running, 0=stopped)`,
    `# TYPE container_running gauge`
  );

  for (const container of containers) {
    addContainerResourceMetrics(metrics, container);
  }
}

export const GET: RequestHandler = async () => {
  const metrics: string[] = [];

  try {
    const uptimeMs = Date.now() - startupTime;
    metrics.push(metric('dashboard_uptime_seconds', Math.floor(uptimeMs / 1000), undefined, 'Dashboard uptime in seconds', 'gauge'));

    await collectContainerMetrics(metrics);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'unknown';
    metrics.push(metric('dashboard_scrape_errors_total', 1, { error: errorMsg }, 'Total number of scrape errors', 'counter'));
  }

  return new Response(`${metrics.join('\n')}\n`, {
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' }
  });
};
