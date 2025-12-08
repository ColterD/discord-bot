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

  // Use $effect for lifecycle - per Svelte 5 docs, return cleanup function from $effect
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
</script>

<Card variant="glass" padding="lg">
  <div class="gpu-widget">
    <div class="widget-header">
      <div class="title-group">
        <div class="icon-container">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="2"/>
            <rect x="8" y="8" width="8" height="8" rx="1"/>
            <path d="M2 9h2M2 15h2M20 9h2M20 15h2M9 2v2M15 2v2M9 20v2M15 20v2"/>
          </svg>
        </div>
        <h3>GPU Status</h3>
      </div>
      <div class="health-indicators">
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

    {#if loading}
      <div class="loading">
        <div class="spinner"></div>
        <span>Loading GPU info...</span>
      </div>
    {:else if error}
      <div class="error">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4M12 16h.01"/>
        </svg>
        <span>{error}</span>
      </div>
    {:else if gpuInfo?.gpu}
      <div class="vram-section">
        <div class="vram-header">
          <span class="vram-label">VRAM Usage</span>
          <Badge variant={getUsageColor(gpuInfo.gpu.usagePercent)} size="sm">
            {gpuInfo.gpu.usagePercent.toFixed(1)}%
          </Badge>
        </div>

        <div class="vram-visual">
          <div class="vram-bar">
            <div
              class="vram-fill"
              style="width: {gpuInfo.gpu.usagePercent}%; background: {getUsageGradient(gpuInfo.gpu.usagePercent)}"
            ></div>
          </div>
          <div class="vram-stats">
            <span class="used">{formatBytes(gpuInfo.gpu.usedMB)}</span>
            <span class="separator">/</span>
            <span class="total">{formatBytes(gpuInfo.gpu.totalMB)}</span>
          </div>
        </div>
      </div>

      <div class="models-section">
        <div class="section-header">
          <h4>Loaded Models</h4>
          <span class="model-count">{gpuInfo.loadedModels.length}</span>
        </div>

        {#if gpuInfo.loadedModels.length > 0}
          <ul class="model-list">
            {#each gpuInfo.loadedModels as model}
              <li class="model-item">
                <div class="model-info">
                  <span class="model-icon">🤖</span>
                  <span class="model-name">{model.name}</span>
                </div>
                <span class="model-size">{formatBytes(model.size_vram / (1024 * 1024))}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="no-models">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
            <span>No models loaded</span>
          </div>
        {/if}
      </div>
    {:else}
      <div class="no-gpu">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="2" opacity="0.5"/>
          <path d="M9 9l6 6M15 9l-6 6"/>
        </svg>
        <span class="no-gpu-title">GPU Unavailable</span>
        <span class="no-gpu-hint">Ollama may not have a model loaded</span>
      </div>
    {/if}
  </div>
</Card>

<style>
  .gpu-widget {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .widget-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .title-group {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .icon-container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: var(--gradient-primary);
    border-radius: var(--radius-md);
    color: white;
  }

  .widget-header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .health-indicators {
    display: flex;
    gap: var(--space-4);
  }

  .health-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .health-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--danger);
    transition: all var(--transition-normal);
  }

  .health-dot.healthy {
    background: var(--success);
    box-shadow: 0 0 8px var(--success);
  }

  .health-label {
    font-size: 12px;
    color: var(--text-muted);
    font-weight: 500;
  }

  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-6);
    color: var(--text-muted);
    font-size: 13px;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--glass-border);
    border-top-color: var(--primary);
    border-radius: var(--radius-full);
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-4);
    color: var(--danger);
    font-size: 13px;
    background: rgba(237, 66, 69, 0.1);
    border-radius: var(--radius-md);
  }

  .vram-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
  }

  .vram-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .vram-label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 500;
  }

  .vram-visual {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .vram-bar {
    height: 8px;
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
    gap: 4px;
    font-family: var(--font-mono);
    font-size: 13px;
  }

  .vram-stats .used {
    color: var(--text-primary);
    font-weight: 600;
  }

  .vram-stats .separator {
    color: var(--text-muted);
  }

  .vram-stats .total {
    color: var(--text-muted);
  }

  .models-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .section-header h4 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .model-count {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    font-size: 11px;
    font-weight: 600;
    background: var(--gradient-primary);
    color: white;
    border-radius: var(--radius-full);
  }

  .model-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .model-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-3);
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    transition: all var(--transition-fast);
  }

  .model-item:hover {
    border-color: var(--primary);
  }

  .model-info {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .model-icon {
    font-size: 14px;
  }

  .model-name {
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
  }

  .model-size {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .no-models {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-4);
    color: var(--text-muted);
    font-size: 13px;
    text-align: center;
  }

  .no-models svg {
    opacity: 0.5;
  }

  .no-gpu {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-6);
    text-align: center;
  }

  .no-gpu svg {
    color: var(--text-muted);
    opacity: 0.5;
  }

  .no-gpu-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .no-gpu-hint {
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
