<script lang="ts">
  import { fromStore } from 'svelte/store';
  import Card from '$lib/components/ui/Card.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { loadingContainers, restartContainer, stopContainer, startContainer } from '$lib/stores/containers';
  import type { ContainerInfo } from '$lib/types';

  interface Props {
    container: ContainerInfo;
    onclick?: () => void;
  }

  const { container, onclick }: Props = $props();

  // Bridge Svelte 4 store to Svelte 5 runes using fromStore() per docs
  const loadingStore = fromStore(loadingContainers);

  // Use $derived.by() for complex derivations per Svelte 5 docs
  type BadgeVariant = 'default' | 'success' | 'danger' | 'warning' | 'info';
  const statusVariant = $derived.by<BadgeVariant>(() => {
    const variants: Record<string, BadgeVariant> = {
      running: 'success',
      exited: 'danger',
      paused: 'warning',
      restarting: 'info',
      dead: 'danger',
      created: 'default'
    };
    return variants[container.state] ?? 'default';
  });

  const isLoading = $derived(loadingStore.current.has(container.name));
  const isRunning = $derived(container.state === 'running');

  function formatPort(port: { PrivatePort: number; PublicPort?: number; Type: string }): string {
    if (port.PublicPort) {
      return `${port.PublicPort}:${port.PrivatePort}/${port.Type}`;
    }
    return `${port.PrivatePort}/${port.Type}`;
  }

  function formatMemory(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    if (mb > 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${mb.toFixed(0)} MB`;
  }

  // CPU thresholds for normalized 0-100% system usage
  function getCpuColor(cpu: number): string {
    if (cpu > 80) return 'var(--danger)';
    if (cpu > 50) return 'var(--warning)';
    return 'var(--success)';
  }

</script>

<Card padding="md" hover>
  <div class="container-card">
    <div class="card-content">
      <div class="header">
        <div class="title-group">
          <h3 class="name">{container.name}</h3>
          <span class="image">{container.image}</span>
        </div>
        <Badge variant={statusVariant} dot pulse={isRunning}>{container.state}</Badge>
      </div>

      <div class="ports">
        {#if container.ports && container.ports.length > 0}
          {#each container.ports as port}
            <span class="port">{formatPort(port)}</span>
          {/each}
        {:else}
          <span class="no-ports">No exposed ports</span>
        {/if}
      </div>

      <div class="stats">
      {#if container.state === 'running'}
        <div class="stat">
          <div class="stat-header">
            <span class="label">CPU</span>
            <span class="value" style="color: {getCpuColor(container.cpu ?? 0)}">{container.cpu?.toFixed(1) ?? '0.0'}%</span>
          </div>
          <div class="progress-bar">
            <div
              class="progress-fill cpu"
              style="width: {Math.min(container.cpu ?? 0, 100)}%; background: {getCpuColor(container.cpu ?? 0)}"
            ></div>
          </div>
        </div>
        <div class="stat">
          <div class="stat-header">
            <span class="label">Memory</span>
            <span class="value">{container.memory ? formatMemory(container.memory.used) : 'N/A'}</span>
          </div>
          {#if container.memory}
            <div class="progress-bar">
              <div
                class="progress-fill memory"
                style="width: {container.memory.percent}%"
              ></div>
            </div>
          {/if}
        </div>
      {:else}
        <div class="stopped-message">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 12h8"/>
          </svg>
          <span>Container stopped</span>
        </div>
      {/if}
    </div>
    </div>

    <div class="actions">
      {#if isRunning}
        <Button
          variant="ghost"
          size="sm"
          loading={isLoading}
          onclick={() => restartContainer(container.name)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M1 4v6h6M23 20v-6h-6"/>
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
          </svg>
          Restart
        </Button>
        <Button
          variant="danger-outline"
          size="sm"
          loading={isLoading}
          onclick={() => stopContainer(container.name)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
          Stop
        </Button>
      {:else}
        <Button
          variant="success"
          size="sm"
          loading={isLoading}
          onclick={() => startContainer(container.name)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="5,3 19,12 5,21"/>
          </svg>
          Start
        </Button>
      {/if}
      <Button
        variant="ghost"
        size="sm"
        {onclick}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        Logs
      </Button>
    </div>
  </div>
</Card>

<style>
  .container-card {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .card-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    flex: 1;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  .title-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .name {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .image {
    font-size: 12px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .ports {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 26px;
  }

  .port {
    font-size: 11px;
    font-family: var(--font-mono);
    padding: 4px 8px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
  }

  .no-ports {
    font-size: 11px;
    color: var(--text-muted);
    font-style: italic;
  }

  .stats {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-top: 1px solid var(--glass-border);
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .stat-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .stat .label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 500;
  }

  .stat .value {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    font-family: var(--font-mono);
  }

  .progress-bar {
    height: 4px;
    background: var(--glass-bg);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    border-radius: var(--radius-full);
    transition: width var(--transition-normal);
  }

  .progress-fill.memory {
    background: var(--accent-gradient);
  }

  .stopped-message {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: 13px;
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    padding-top: var(--space-3);
    margin-top: auto;
    border-top: 1px solid var(--glass-border);
  }
</style>
