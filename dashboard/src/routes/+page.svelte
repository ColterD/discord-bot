<script lang="ts">
  import { fromStore } from 'svelte/store';
  // Keep polling fallback for development
  import { fetchContainers, startPolling, stopPolling } from '$lib/stores/containers';
  import {
    connect,
    connectionState,
    disconnect,
    wsContainers
  } from '$lib/stores/websocket';
  import type { ContainerInfo } from '$lib/types';
  import GpuStatusBanner from '$lib/components/gpu/GpuStatusBanner.svelte';
  import CloudflareStatus from '$lib/components/status/CloudflareStatus.svelte';
  import ContainerList from '$lib/components/containers/ContainerList.svelte';
  import LogViewer from '$lib/components/containers/LogViewer.svelte';

  // SSR data from +page.server.ts - provides instant initial render
  const { data } = $props();

  let selectedContainer = $state<string | null>(null);
  let logsVisible = $state(false);
  const useWebSocket = $state(true);

  // Bridge Svelte 4 stores to Svelte 5 runes using fromStore()
  // This is the recommended pattern per Svelte 5 docs instead of manual subscriptions
  const wsContainerStore = fromStore(wsContainers);
  const connectionStateStore = fromStore(connectionState);

  // Derived state from stores - reactive and clean
  const wsContainerList = $derived(wsContainerStore.current);
  const wsConnectionState = $derived(connectionStateStore.current);

  // Use SSR data until WebSocket provides updates
  // This gives instant page render, then live updates take over
  const containers = $derived(wsContainerList.length > 0 ? wsContainerList : (data.containers as ContainerInfo[]));

  // Use $effect for lifecycle - per Svelte 5 docs, return cleanup function from $effect
  $effect(() => {
    if (useWebSocket) {
      connect();
    } else {
      fetchContainers();
      startPolling(5000);
    }

    return () => {
      if (useWebSocket) {
        disconnect();
      } else {
        stopPolling();
      }
    };
  });

  function handleViewLogs(containerName: string) {
    selectedContainer = containerName;
    logsVisible = true;
  }

  // Derived stats from containers (SSR or WebSocket)
  const runningCount = $derived(containers.filter(c => c.state === 'running').length);
  const totalCount = $derived(containers.length);
  const stoppedCount = $derived(totalCount - runningCount);
  const healthStatus = $derived(runningCount === totalCount ? 'healthy' : runningCount > 0 ? 'degraded' : 'critical');

</script>

<svelte:head>
  <title>Containers | Discord Bot Dashboard</title>
</svelte:head>

<div class="page">
  <div class="page-header">
    <div class="header-content">
      <div class="title-section">
        <h1>Containers</h1>
        <p class="subtitle">Manage your Docker stack containers</p>
      </div>
      <div class="header-right">
        <div class="health-badge" class:healthy={healthStatus === 'healthy'} class:degraded={healthStatus === 'degraded'} class:critical={healthStatus === 'critical'}>
          <span class="health-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          </span>
          <span class="health-text">
            {healthStatus === 'healthy' ? 'All Healthy' : healthStatus === 'degraded' ? 'Degraded' : 'Critical'}
          </span>
        </div>
        {#if useWebSocket}
          <div class="connection-status" class:connected={wsConnectionState === 'connected'}>
            <span class="status-dot" class:pulse={wsConnectionState === 'connected'}></span>
            <span class="status-text">
              {wsConnectionState === 'connected' ? 'Live' : wsConnectionState === 'connecting' ? 'Connecting...' : 'Offline'}
            </span>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Status Banner Row -->
  <div class="status-row">
    <div class="gpu-banner-wrapper">
      <GpuStatusBanner />
    </div>
    <div class="cf-status-wrapper">
      <CloudflareStatus />
    </div>
  </div>

  <!-- Main Content -->
  <section class="containers-section">
    <ContainerList
      containers={containers}
      onviewLogs={handleViewLogs}
    />
  </section>
</div>

{#if selectedContainer}
  <LogViewer
    containerName={selectedContainer}
    bind:visible={logsVisible}
  />
{/if}

<style>
  .page {
    max-width: 1600px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .page-header {
    margin-bottom: var(--space-1);
  }

  .header-content {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-4);
  }

  .title-section h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.02em;
  }

  .subtitle {
    margin: var(--space-2) 0 0;
    color: var(--text-muted);
    font-size: 14px;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .health-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-full);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    transition: all var(--transition-normal);
  }

  .health-badge.healthy {
    border-color: rgba(87, 242, 135, 0.3);
    background: rgba(87, 242, 135, 0.1);
    color: var(--success);
  }

  .health-badge.degraded {
    border-color: rgba(245, 158, 11, 0.3);
    background: rgba(245, 158, 11, 0.1);
    color: var(--warning);
  }

  .health-badge.critical {
    border-color: rgba(239, 68, 68, 0.3);
    background: rgba(239, 68, 68, 0.1);
    color: var(--danger);
  }

  .health-icon {
    display: flex;
    align-items: center;
  }

  .health-text {
    letter-spacing: 0.02em;
  }

  .connection-status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-full);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    transition: all var(--transition-normal);
  }

  .connection-status.connected {
    border-color: rgba(87, 242, 135, 0.3);
    background: rgba(87, 242, 135, 0.1);
    color: var(--success);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--text-muted);
    transition: all var(--transition-normal);
  }

  .status-dot.pulse {
    background: var(--success);
    box-shadow: 0 0 6px var(--success);
    animation: pulse-glow 2s ease-in-out infinite;
  }

  @keyframes pulse-glow {
    0%, 100% { box-shadow: 0 0 6px var(--success); }
    50% { box-shadow: 0 0 12px var(--success); }
  }

  /* Status Row - GPU Banner (1x) + CF Status (1x) */
  .status-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
  }

  @media (max-width: 1024px) {
    .status-row {
      grid-template-columns: 1fr;
    }
  }

  .gpu-banner-wrapper,
  .cf-status-wrapper {
    min-width: 0;
  }

  .containers-section {
    min-width: 0;
  }

  @media (max-width: 768px) {
    .header-content {
      flex-direction: column;
      align-items: flex-start;
    }

    .header-right {
      flex-wrap: wrap;
    }

    .title-section h1 {
      font-size: 24px;
    }
  }
</style>
