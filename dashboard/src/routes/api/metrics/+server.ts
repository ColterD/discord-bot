/**
 * Metrics API Endpoint
 *
 * Returns container resource usage history for charts
 * Stores metrics in memory with rolling window
 */

import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/api-auth';
import { getStackContainers } from '$lib/server/docker';
import type { ContainerMetrics, MetricDataPoint } from '$lib/types';
import type { RequestHandler } from './$types';

interface MetricsStore {
  containers: Map<string, MetricDataPoint[]>;
  system: {
    cpu: MetricDataPoint[];
    memory: MetricDataPoint[];
  };
  lastUpdate: number;
}

// In-memory metrics store (rolling 10 minutes of data at 10s intervals = 60 points)
const MAX_POINTS = 60;
const metricsStore: MetricsStore = {
  containers: new Map(),
  system: {
    cpu: [],
    memory: []
  },
  lastUpdate: 0
};

/**
 * Update metrics with latest container stats
 */
async function updateMetrics(): Promise<void> {
  try {
    const containers = await getStackContainers();
    const now = Date.now();

    let totalCpu = 0;
    let totalMemPercent = 0;
    let runningCount = 0;

    for (const container of containers) {
      if (container.state !== 'running') continue;

      runningCount++;

      // Track per-container metrics
      const containerHistory = metricsStore.containers.get(container.id) ?? [];
      const cpuValue = container.cpu ?? 0;

      containerHistory.push({
        timestamp: now,
        value: cpuValue,
        label: container.name
      });

      // Trim to max points
      if (containerHistory.length > MAX_POINTS) {
        containerHistory.shift();
      }

      metricsStore.containers.set(container.id, containerHistory);

      totalCpu += cpuValue;
      totalMemPercent += container.memory?.percent ?? 0;
    }

    // Track system-wide metrics
    metricsStore.system.cpu.push({
      timestamp: now,
      value: totalCpu
    });

    metricsStore.system.memory.push({
      timestamp: now,
      value: runningCount > 0 ? totalMemPercent / runningCount : 0
    });

    // Trim system metrics
    if (metricsStore.system.cpu.length > MAX_POINTS) {
      metricsStore.system.cpu.shift();
    }
    if (metricsStore.system.memory.length > MAX_POINTS) {
      metricsStore.system.memory.shift();
    }

    metricsStore.lastUpdate = now;
  } catch (error) {
    console.error('Failed to update metrics:', error);
  }
}

/**
 * Get current container metrics snapshot
 */
async function getContainerMetrics(): Promise<ContainerMetrics[]> {
  const containers = await getStackContainers();

  return containers
    .filter((c) => c.state === 'running')
    .map((c) => ({
      containerId: c.id,
      containerName: c.name,
      cpu: c.cpu ?? 0,
      memoryPercent: c.memory?.percent ?? 0,
      memoryUsed: c.memory?.used ?? 0,
      timestamp: Date.now()
    }));
}

export const GET: RequestHandler = async (event) => {
  requireAuth(event);

  // Update metrics before returning
  await updateMetrics();

  const { url } = event;

  const type = url.searchParams.get('type') ?? 'all';

  if (type === 'history') {
    return json({
      system: metricsStore.system,
      lastUpdate: metricsStore.lastUpdate
    });
  }

  if (type === 'containers') {
    const containerMetrics = await getContainerMetrics();
    return json({
      containers: containerMetrics,
      lastUpdate: metricsStore.lastUpdate
    });
  }

  // Return all data
  const containerMetrics = await getContainerMetrics();
  return json({
    system: metricsStore.system,
    containers: containerMetrics,
    lastUpdate: metricsStore.lastUpdate
  });
};
