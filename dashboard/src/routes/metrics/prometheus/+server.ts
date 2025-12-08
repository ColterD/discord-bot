/**
 * Prometheus Metrics Endpoint
 *
 * Exports metrics in Prometheus text format for external monitoring.
 * Endpoint: GET /metrics/prometheus
 *
 * No authentication required - designed for prometheus scraping.
 * Metrics include container stats, GPU usage, and dashboard health.
 */

import type { RequestHandler } from './$types';
import { getStackContainers } from '$lib/server/docker';

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

export const GET: RequestHandler = async () => {
  const metrics: string[] = [];

  try {
    // Dashboard uptime
    const uptimeMs = Date.now() - startupTime;
    metrics.push(
      metric(
        'dashboard_uptime_seconds',
        Math.floor(uptimeMs / 1000),
        undefined,
        'Dashboard uptime in seconds',
        'gauge'
      )
    );

    // Fetch container data
    const containers = await getStackContainers();

    // Container counts by state
    const stateCounts: Record<string, number> = {};
    for (const container of containers) {
      stateCounts[container.state] = (stateCounts[container.state] ?? 0) + 1;
    }

    metrics.push(`# HELP container_count Number of containers by state`);
    metrics.push(`# TYPE container_count gauge`);
    for (const [state, count] of Object.entries(stateCounts)) {
      metrics.push(metric('container_count', count, { state }));
    }

    // Total containers
    metrics.push(
      metric(
        'container_total',
        containers.length,
        undefined,
        'Total number of monitored containers',
        'gauge'
      )
    );

    // Per-container metrics
    metrics.push(`# HELP container_cpu_percent Container CPU usage percentage`);
    metrics.push(`# TYPE container_cpu_percent gauge`);
    metrics.push(`# HELP container_memory_bytes Container memory usage in bytes`);
    metrics.push(`# TYPE container_memory_bytes gauge`);
    metrics.push(`# HELP container_memory_percent Container memory usage percentage`);
    metrics.push(`# TYPE container_memory_percent gauge`);
    metrics.push(`# HELP container_running Container running state (1=running, 0=stopped)`);
    metrics.push(`# TYPE container_running gauge`);

    for (const container of containers) {
      const labels = { name: container.name, image: container.image };

      // Running state
      metrics.push(
        metric('container_running', container.state === 'running' ? 1 : 0, labels)
      );

      if (container.state === 'running') {
        // CPU usage
        if (container.cpu !== null) {
          metrics.push(metric('container_cpu_percent', container.cpu, labels));
        }

        // Memory usage
        if (container.memory) {
          metrics.push(metric('container_memory_bytes', container.memory.used, labels));
          metrics.push(metric('container_memory_percent', container.memory.percent, labels));
        }
      }
    }
  } catch (error) {
    // Add error metric
    metrics.push(
      metric(
        'dashboard_scrape_errors_total',
        1,
        { error: error instanceof Error ? error.message : 'unknown' },
        'Total number of scrape errors',
        'counter'
      )
    );
  }

  // Return Prometheus-formatted response
  return new Response(metrics.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8'
    }
  });
};
