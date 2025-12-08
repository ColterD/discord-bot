<script lang="ts">
  import Card from '$lib/components/ui/Card.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import type { OllamaRunningModel } from '$lib/server/gpu';
  import type { GpuStatus, MetricDataPoint } from '$lib/types';

  interface GpuInfo {
    gpu: GpuStatus | null;
    loadedModels: OllamaRunningModel[];
    ollamaHealthy: boolean;
    comfyuiHealthy: boolean;
  }

  let gpuInfo = $state<GpuInfo | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // VRAM history for sparkline chart (last 60 data points = 10 minutes at 10s intervals)
  let vramHistory = $state<MetricDataPoint[]>([]);
  const MAX_HISTORY = 60;

  async function fetchGpuInfo() {
    try {
      const response = await fetch('/api/gpu');
      if (!response.ok) {
        throw new Error('Failed to fetch GPU info');
      }
      gpuInfo = await response.json();

      // Add to history if we have GPU data
      if (gpuInfo?.gpu) {
        vramHistory = [
          ...vramHistory.slice(-(MAX_HISTORY - 1)),
          { timestamp: Date.now(), value: gpuInfo.gpu.usagePercent }
        ];
      }

      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    fetchGpuInfo();
    const interval = setInterval(fetchGpuInfo, 10000);
    return () => clearInterval(interval);
  });

  function formatBytes(mb: number): string {
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

  function formatExpiry(expiresAt: string): string {
    const expires = new Date(expiresAt);
    const now = new Date();
    const diff = expires.getTime() - now.getTime();
    const minutes = Math.floor(diff / 60000);

    if (minutes <= 0) return 'Expiring soon';
    if (minutes < 60) return `${minutes}m remaining`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m remaining`;
  }

  // Generate SVG path for sparkline
  function getSparklinePath(data: MetricDataPoint[]): string {
    if (data.length < 2) return '';

    const width = 200;
    const height = 40;
    const padding = 2;

    const maxValue = 100; // percentage
    const xStep = (width - padding * 2) / (MAX_HISTORY - 1);

    const points = data.map((d, i) => {
      const x = padding + i * xStep;
      const y = height - padding - (d.value / maxValue) * (height - padding * 2);
      return `${x},${y}`;
    });

    return `M ${points.join(' L ')}`;
  }

  const sparklinePath = $derived(getSparklinePath(vramHistory));
  const currentUsage = $derived(gpuInfo?.gpu?.usagePercent ?? 0);

</script>

<svelte:head>
  <title>GPU Status - Dashboard</title>
</svelte:head>

<div class="gpu-page">
  <header class="page-header">
    <div class="header-content">
      <div class="title-section">
        <div class="gpu-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="2"/>
            <rect x="8" y="8" width="8" height="8" rx="1"/>
            <path d="M2 9h2M2 15h2M20 9h2M20 15h2M9 2v2M15 2v2M9 20v2M15 20v2"/>
          </svg>
        </div>
        <div>
          <h1>GPU Status</h1>
          <p class="subtitle">Monitor GPU, VRAM, and AI model resources</p>
        </div>
      </div>
      <div class="service-status">
        <div class="service-item">
          <span class="status-dot" class:healthy={gpuInfo?.ollamaHealthy}></span>
          <span>Ollama</span>
        </div>
        <div class="service-item">
          <span class="status-dot" class:healthy={gpuInfo?.comfyuiHealthy}></span>
          <span>ComfyUI</span>
        </div>
      </div>
    </div>
  </header>

  {#if loading}
    <div class="loading-state">
      <div class="spinner"></div>
      <span>Loading GPU information...</span>
    </div>
  {:else if error}
    <Card variant="glass" padding="lg">
      <div class="error-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4M12 16h.01"/>
        </svg>
        <h3>Failed to Load GPU Status</h3>
        <p>{error}</p>
      </div>
    </Card>
  {:else}
    <div class="gpu-grid">
      <!-- VRAM Usage Card -->
      <Card variant="glass" padding="lg">
        <div class="vram-card">
          <div class="card-header">
            <h2>VRAM Usage</h2>
            {#if gpuInfo?.gpu}
              <Badge variant={getUsageColor(gpuInfo.gpu.usagePercent)} size="md">
                {gpuInfo.gpu.usagePercent.toFixed(1)}%
              </Badge>
            {/if}
          </div>

          {#if gpuInfo?.gpu}
            <div class="vram-gauge">
              <div class="gauge-ring">
                <svg viewBox="0 0 120 120" class="gauge-svg">
                  <circle
                    cx="60"
                    cy="60"
                    r="52"
                    fill="none"
                    stroke="var(--glass-border)"
                    stroke-width="8"
                  />
                  <circle
                    cx="60"
                    cy="60"
                    r="52"
                    fill="none"
                    stroke="url(#vramGradient)"
                    stroke-width="8"
                    stroke-linecap="round"
                    stroke-dasharray={`${(gpuInfo.gpu.usagePercent / 100) * 327} 327`}
                    transform="rotate(-90 60 60)"
                  />
                  <defs>
                    <linearGradient id="vramGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" style="stop-color: var(--success)" />
                      <stop offset="70%" style="stop-color: var(--warning)" />
                      <stop offset="100%" style="stop-color: var(--danger)" />
                    </linearGradient>
                  </defs>
                </svg>
                <div class="gauge-content">
                  <span class="gauge-value">{formatBytes(gpuInfo.gpu.usedMB)}</span>
                  <span class="gauge-label">of {formatBytes(gpuInfo.gpu.totalMB)}</span>
                </div>
              </div>
            </div>

            <div class="vram-stats">
              <div class="stat-item">
                <span class="stat-label">Used</span>
                <span class="stat-value used">{formatBytes(gpuInfo.gpu.usedMB)}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Free</span>
                <span class="stat-value free">{formatBytes(gpuInfo.gpu.freeMB)}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Total</span>
                <span class="stat-value">{formatBytes(gpuInfo.gpu.totalMB)}</span>
              </div>
            </div>
          {:else}
            <div class="no-data">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="2"/>
                <path d="M9 9l6 6M15 9l-6 6"/>
              </svg>
              <span>No GPU data available</span>
              <span class="hint">Load a model in Ollama to see VRAM usage</span>
            </div>
          {/if}
        </div>
      </Card>

      <!-- VRAM History Chart -->
      <Card variant="glass" padding="lg">
        <div class="history-card">
          <div class="card-header">
            <h2>VRAM History</h2>
            <span class="time-range">Last 10 minutes</span>
          </div>

          <div class="sparkline-container">
            {#if vramHistory.length > 1}
              <svg viewBox="0 0 200 50" class="sparkline" preserveAspectRatio="none">
                <!-- Grid lines -->
                <line x1="0" y1="12.5" x2="200" y2="12.5" stroke="var(--glass-border)" stroke-width="0.5" />
                <line x1="0" y1="25" x2="200" y2="25" stroke="var(--glass-border)" stroke-width="0.5" />
                <line x1="0" y1="37.5" x2="200" y2="37.5" stroke="var(--glass-border)" stroke-width="0.5" />

                <!-- Area fill -->
                <path
                  d="{sparklinePath} L 200,48 L 2,48 Z"
                  fill="url(#areaGradient)"
                  opacity="0.3"
                />

                <!-- Line -->
                <path
                  d={sparklinePath}
                  fill="none"
                  stroke="var(--primary)"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />

                <defs>
                  <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color: var(--primary)" />
                    <stop offset="100%" style="stop-color: transparent" />
                  </linearGradient>
                </defs>
              </svg>

              <div class="chart-labels">
                <span>100%</span>
                <span>50%</span>
                <span>0%</span>
              </div>
            {:else}
              <div class="no-history">
                <span>Collecting data...</span>
              </div>
            {/if}
          </div>
        </div>
      </Card>

      <!-- Loaded Models Card -->
      <Card variant="glass" padding="lg">
        <div class="models-card">
          <div class="card-header">
            <h2>Loaded Models</h2>
            <Badge variant="info" size="md">{gpuInfo?.loadedModels.length ?? 0}</Badge>
          </div>

          {#if gpuInfo?.loadedModels && gpuInfo.loadedModels.length > 0}
            <ul class="model-list">
              {#each gpuInfo.loadedModels as model}
                <li class="model-item">
                  <div class="model-icon">🤖</div>
                  <div class="model-info">
                    <span class="model-name">{model.name}</span>
                    <span class="model-meta">
                      {formatBytes(model.size_vram / (1024 * 1024))} VRAM • {formatExpiry(model.expires_at)}
                    </span>
                  </div>
                  <Badge variant="success" size="sm">Active</Badge>
                </li>
              {/each}
            </ul>
          {:else}
            <div class="no-models">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5" aria-hidden="true">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                <line x1="12" y1="22.08" x2="12" y2="12"/>
              </svg>
              <span class="no-models-text">No models currently loaded</span>
              <span class="hint">Models are loaded on-demand when you chat with the bot</span>
            </div>
          {/if}
        </div>
      </Card>

      <!-- Service Health Card -->
      <Card variant="glass" padding="lg">
        <div class="health-card">
          <div class="card-header">
            <h2>Service Health</h2>
          </div>

          <div class="services-list">
            <div class="service-row">
              <div class="service-icon ollama">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
              </div>
              <div class="service-info">
                <span class="service-name">Ollama</span>
                <span class="service-desc">Large Language Model runtime</span>
              </div>
              <Badge variant={gpuInfo?.ollamaHealthy ? 'success' : 'danger'} size="md">
                {gpuInfo?.ollamaHealthy ? 'Healthy' : 'Unhealthy'}
              </Badge>
            </div>

            <div class="service-row">
              <div class="service-icon comfyui">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <path d="M21 15l-5-5L5 21"/>
                </svg>
              </div>
              <div class="service-info">
                <span class="service-name">ComfyUI</span>
                <span class="service-desc">Image generation backend</span>
              </div>
              <Badge variant={gpuInfo?.comfyuiHealthy ? 'success' : 'danger'} size="md">
                {gpuInfo?.comfyuiHealthy ? 'Healthy' : 'Unhealthy'}
              </Badge>
            </div>
          </div>
        </div>
      </Card>
    </div>
  {/if}
</div>

<style>
  .gpu-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .page-header {
    margin-bottom: var(--space-2);
  }

  .header-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .title-section {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .gpu-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    background: var(--gradient-primary);
    border-radius: var(--radius-lg);
    color: white;
  }

  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.02em;
  }

  .subtitle {
    margin: 4px 0 0;
    font-size: 14px;
    color: var(--text-muted);
  }

  .service-status {
    display: flex;
    gap: var(--space-4);
  }

  .service-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 13px;
    color: var(--text-secondary);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--danger);
    transition: all var(--transition-normal);
  }

  .status-dot.healthy {
    background: var(--success);
    box-shadow: 0 0 8px var(--success);
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    padding: var(--space-8);
    color: var(--text-muted);
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--glass-border);
    border-top-color: var(--primary);
    border-radius: var(--radius-full);
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-6);
    text-align: center;
    color: var(--danger);
  }

  .error-state h3 {
    margin: 0;
    color: var(--text-primary);
  }

  .error-state p {
    margin: 0;
    color: var(--text-muted);
  }

  .gpu-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-5);
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-4);
  }

  .card-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .time-range {
    font-size: 12px;
    color: var(--text-muted);
  }

  /* VRAM Card */
  .vram-card {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .vram-gauge {
    display: flex;
    justify-content: center;
    padding: var(--space-4) 0;
  }

  .gauge-ring {
    position: relative;
    width: 160px;
    height: 160px;
  }

  .gauge-svg {
    width: 100%;
    height: 100%;
  }

  .gauge-content {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .gauge-value {
    font-size: 24px;
    font-weight: 700;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .gauge-label {
    font-size: 12px;
    color: var(--text-muted);
  }

  .vram-stats {
    display: flex;
    justify-content: space-around;
    padding: var(--space-4);
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    margin-top: auto;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .stat-label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .stat-value {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .stat-value.used {
    color: var(--warning);
  }

  .stat-value.free {
    color: var(--success);
  }

  .no-data, .no-models, .no-history {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-8);
    color: var(--text-muted);
    text-align: center;
  }

  .hint {
    font-size: 12px;
    opacity: 0.7;
  }

  /* History Chart */
  .history-card {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .sparkline-container {
    position: relative;
    flex: 1;
    min-height: 150px;
    display: flex;
    align-items: center;
  }

  .sparkline {
    width: 100%;
    height: 100%;
  }

  .chart-labels {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 4px 0;
    font-size: 10px;
    color: var(--text-muted);
  }

  /* Models Card */
  .models-card {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .model-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .model-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
  }

  .model-icon {
    font-size: 24px;
  }

  .model-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .model-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .model-meta {
    font-size: 12px;
    color: var(--text-muted);
  }

  .no-models-text {
    font-size: 14px;
    font-weight: 500;
  }

  /* Health Card */
  .health-card {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .services-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .service-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
  }

  .service-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
    color: white;
  }

  .service-icon.ollama {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  }

  .service-icon.comfyui {
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  }

  .service-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .service-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .service-desc {
    font-size: 12px;
    color: var(--text-muted);
  }

  @media (max-width: 900px) {
    .gpu-grid {
      grid-template-columns: 1fr;
    }

    .header-content {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-3);
    }
  }
</style>
