<script lang="ts">
  import Card from '$lib/components/ui/Card.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import type { OllamaRunningModel } from '$lib/server/gpu';
  import type { GpuStatus } from '$lib/types';

  interface GpuInfo {
    gpu: GpuStatus | null;
    loadedModels: OllamaRunningModel[];
    ollamaHealthy: boolean;
    comfyuiHealthy: boolean;
  }

  let gpuInfo = $state<GpuInfo | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function fetchGpuInfo() {
    try {
      const response = await fetch('/api/gpu');
      if (!response.ok) {
        throw new Error('Failed to fetch GPU info');
      }
      gpuInfo = await response.json();
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loading = false;
    }
  }

  // Use $effect with cleanup instead of onMount per Svelte 5 docs
  $effect(() => {
    fetchGpuInfo();
    const interval = setInterval(fetchGpuInfo, 10000);
    return () => clearInterval(interval);
  });

  function formatBytes(bytes: number): string {
    const mb = bytes;
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${mb.toFixed(0)} MB`;
  }

  function getUsageColor(percent: number): 'danger' | 'warning' | 'success' {
    if (percent >= 90) return 'danger';
    if (percent >= 70) return 'warning';
    return 'success';
  }

  function getUsageGradient(percent: number): string {
    if (percent >= 90) return 'var(--gradient-danger)';
    if (percent >= 70) return 'var(--gradient-warning)';
    return 'var(--gradient-success)';
  }

  const primaryModel = $derived(gpuInfo?.loadedModels[0] ?? null);
  const modelCount = $derived(gpuInfo?.loadedModels.length ?? 0);

</script>

<Card variant="glass" padding="md">
  <div class="gpu-banner">
    <div class="banner-header">
      <div class="title-row">
        <div class="gpu-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="2"/>
            <rect x="8" y="8" width="8" height="8" rx="1"/>
            <path d="M2 9h2M2 15h2M20 9h2M20 15h2M9 2v2M15 2v2M9 20v2M15 20v2"/>
          </svg>
        </div>
        <span class="title">GPU Status</span>
      </div>
      <div class="health-row">
        <div class="health-item">
          <span class="health-dot" class:healthy={gpuInfo?.ollamaHealthy}></span>
          <span class="health-label">Ollama</span>
        </div>
        <div class="health-item">
          <span class="health-dot" class:healthy={gpuInfo?.comfyuiHealthy}></span>
          <span class="health-label">ComfyUI</span>
        </div>
      </div>
    </div>

    <div class="banner-content">
      {#if loading}
        <div class="loading">
          <div class="skeleton-bar"></div>
        </div>
      {:else if error}
        <div class="error-mini">
          <span>Error loading GPU</span>
        </div>
      {:else if gpuInfo?.gpu}
        <div class="vram-compact">
          <div class="vram-info">
            <span class="vram-label">VRAM</span>
            <Badge variant={getUsageColor(gpuInfo.gpu.usagePercent)} size="sm">
              {gpuInfo.gpu.usagePercent.toFixed(0)}%
            </Badge>
          </div>
          <div class="vram-bar">
            <div
              class="vram-fill"
              style="width: {gpuInfo.gpu.usagePercent}%; background: {getUsageGradient(gpuInfo.gpu.usagePercent)}"
            ></div>
          </div>
          <div class="vram-stats">
            <span class="used">{formatBytes(gpuInfo.gpu.usedMB)}</span>
            <span class="sep">/</span>
            <span class="total">{formatBytes(gpuInfo.gpu.totalMB)}</span>
          </div>
        </div>
        {#if !loading && gpuInfo}
          <div class="models-compact">
            <span class="models-label">Loaded</span>
            <div class="model-info">
              <span class="model-count">{modelCount}</span>
              <span class="model-text">model{modelCount !== 1 ? 's' : ''}</span>
              {#if primaryModel}
                <span class="primary-model" title={primaryModel.name}>
                  ({primaryModel.name.split(':')[0]})
                </span>
              {/if}
            </div>
          </div>
        {/if}
      {:else}
        <div class="no-gpu-mini">
          <span>GPU unavailable</span>
        </div>
      {/if}
    </div>
  </div>
</Card>

<style>
  .gpu-banner {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .banner-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .gpu-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: var(--gradient-primary);
    border-radius: var(--radius-md);
    color: white;
  }

  .title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .health-row {
    display: flex;
    gap: var(--space-3);
  }

  .health-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .health-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--danger);
    transition: all var(--transition-normal);
  }

  .health-dot.healthy {
    background: var(--success);
    box-shadow: 0 0 6px var(--success);
  }

  .health-label {
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 500;
  }

  .banner-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .loading {
    width: 100%;
  }

  .skeleton-bar {
    height: 8px;
    width: 100%;
    background: linear-gradient(
      90deg,
      var(--glass-bg) 0%,
      var(--bg-hover) 50%,
      var(--glass-bg) 100%
    );
    background-size: 200% 100%;
    animation: skeleton-pulse 1.5s ease-in-out infinite;
    border-radius: var(--radius-sm);
  }

  @keyframes skeleton-pulse {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .error-mini {
    font-size: 12px;
    color: var(--danger);
  }

  .vram-compact {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
  }

  .vram-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .vram-label {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .vram-bar {
    height: 6px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .vram-fill {
    height: 100%;
    transition: width var(--transition-normal), background var(--transition-normal);
    border-radius: var(--radius-full);
  }

  .vram-stats {
    display: flex;
    align-items: center;
    gap: 2px;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .vram-stats .used {
    color: var(--text-primary);
    font-weight: 600;
  }

  .vram-stats .sep {
    color: var(--text-muted);
  }

  .vram-stats .total {
    color: var(--text-muted);
  }

  .no-gpu-mini {
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
  }

  .models-compact {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: var(--space-2);
    border-top: 1px solid var(--glass-border);
  }

  .models-label {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .model-info {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .model-count {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    font-size: 11px;
    font-weight: 700;
    background: var(--gradient-primary);
    color: white;
    border-radius: var(--radius-full);
  }

  .model-text {
    font-size: 11px;
    color: var(--text-secondary);
  }

  .primary-model {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
