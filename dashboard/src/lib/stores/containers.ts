import { derived, writable } from 'svelte/store';
import type { ContainerInfo, DashboardStats } from '$lib/types';

/** Store for container data */
export const containers = writable<ContainerInfo[]>([]);

/** Loading state */
export const isLoading = writable(false);

/** Error state */
export const error = writable<string | null>(null);

/** Derived stats from containers */
export const stats = derived(containers, ($containers): DashboardStats => {
  const running = $containers.filter(c => c.state === 'running');
  const stopped = $containers.filter(c => c.state === 'exited');

  const totalCpu = running.reduce((sum, c) => sum + (c.cpu ?? 0), 0);

  // Aggregate memory from all running containers
  let totalMemory = null;
  if (running.length > 0) {
    const memoryContainers = running.filter(c => c.memory !== null);
    if (memoryContainers.length > 0) {
      const totalUsed = memoryContainers.reduce((sum, c) => sum + (c.memory?.used ?? 0), 0);
      const totalLimit = memoryContainers.reduce((sum, c) => sum + (c.memory?.limit ?? 0), 0);
      totalMemory = {
        used: totalUsed,
        limit: totalLimit,
        percent: totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0
      };
    }
  }

  return {
    totalContainers: $containers.length,
    runningContainers: running.length,
    stoppedContainers: stopped.length,
    totalCpu,
    totalMemory,
    gpu: null // GPU stats handled separately
  };
});

/** Fetch containers from API */
export async function fetchContainers(): Promise<void> {
  isLoading.set(true);
  error.set(null);

  try {
    const response = await fetch('/api/containers');
    if (!response.ok) {
      throw new Error(`Failed to fetch containers: ${response.statusText}`);
    }
    const data = await response.json();

    if ('error' in data) {
      throw new Error(data.error);
    }

    containers.set(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    error.set(message);
  } finally {
    isLoading.set(false);
  }
}

/** Perform container action */
export async function containerAction(
  name: string,
  action: 'start' | 'stop' | 'restart'
): Promise<{ success: boolean; message?: string }> {
  try {
    const response = await fetch(`/api/containers/${name}/${action}`, {
      method: 'POST'
    });
    const data = await response.json();

    if (!response.ok || 'error' in data) {
      return { success: false, message: data.error ?? 'Action failed' };
    }

    // Refresh container list after action
    await fetchContainers();

    return { success: true, message: data.message };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { success: false, message };
  }
}

/** Polling state */
let pollInterval: ReturnType<typeof setInterval> | null = null;

/** Set of containers currently loading (performing action) */
export const loadingContainers = writable<Set<string>>(new Set());

/** Helper to add/remove from loadingContainers */
function setLoading(name: string, loading: boolean): void {
  loadingContainers.update(set => {
    const newSet = new Set(set);
    if (loading) {
      newSet.add(name);
    } else {
      newSet.delete(name);
    }
    return newSet;
  });
}

/** Start container */
export async function startContainer(name: string): Promise<void> {
  setLoading(name, true);
  await containerAction(name, 'start');
  setLoading(name, false);
}

/** Stop container */
export async function stopContainer(name: string): Promise<void> {
  setLoading(name, true);
  await containerAction(name, 'stop');
  setLoading(name, false);
}

/** Restart container */
export async function restartContainer(name: string): Promise<void> {
  setLoading(name, true);
  await containerAction(name, 'restart');
  setLoading(name, false);
}

/** Start polling for container updates */
export function startPolling(intervalMs = 5000): void {
  stopPolling();
  pollInterval = setInterval(fetchContainers, intervalMs);
}

/** Stop polling */
export function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
