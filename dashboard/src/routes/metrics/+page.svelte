<script lang="ts">
  import Card from '$lib/components/ui/Card.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import type { ContainerMetrics, MetricDataPoint } from '$lib/types';

  interface SystemMetrics {
    cpu: MetricDataPoint[];
    memory: MetricDataPoint[];
  }

  interface MetricsResponse {
    system: SystemMetrics;
    containers: ContainerMetrics[];
    lastUpdate: number;
  }

  let metrics = $state<MetricsResponse | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function fetchMetrics() {
    try {
      const response = await fetch('/api/metrics');
      if (!response.ok) {
        throw new Error('Failed to fetch metrics');
      }
      metrics = await response.json();
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  });

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
  }

  function getUsageColor(percent: number): 'danger' | 'warning' | 'success' {
    if (percent >= 80) return 'danger';
    if (percent >= 60) return 'warning';
    return 'success';
  }

  // Generate SVG path for area chart
  function getChartPath(data: MetricDataPoint[], maxPoints: number = 60): { line: string; area: string } {
    if (data.length < 2) return { line: '', area: '' };

    const width = 400;
    const height = 120;
    const padding = 4;

    const maxValue = Math.max(100, ...data.map((d) => d.value));
    const xStep = (width - padding * 2) / (maxPoints - 1);

    const points = data.map((d, i) => {
      const x = padding + i * xStep;
      const y = height - padding - (d.value / maxValue) * (height - padding * 2);
      return { x, y };
    });

    const linePath = `M ${points.map((p) => `${p.x},${p.y}`).join(' L ')}`;
    const areaPath = `${linePath} L ${points[points.length - 1].x},${height - padding} L ${points[0].x},${height - padding} Z`;

    return { line: linePath, area: areaPath };
  }

  const cpuChart = $derived(getChartPath(metrics?.system.cpu ?? []));
  const memoryChart = $derived(getChartPath(metrics?.system.memory ?? []));

  const currentCpu = $derived(
    metrics?.system.cpu.length ? metrics.system.cpu[metrics.system.cpu.length - 1].value : 0
  );
  const currentMemory = $derived(
    metrics?.system.memory.length ? metrics.system.memory[metrics.system.memory.length - 1].value : 0
  );

  const sortedContainers = $derived(
    [...(metrics?.containers ?? [])].sort((a, b) => b.cpu - a.cpu)
  );
</script>

<svelte:head>
  <title>Metrics - Dashboard</title>
</svelte:head>

<div class="metrics-page">
  <header class="page-header">
    <div class="header-content">
      <div class="title-section">
        <div class="metrics-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M3 3v18h18" />
            <path d="M18 17V9" />
            <path d="M13 17V5" />
            <path d="M8 17v-3" />
          </svg>
        </div>
        <div>
          <h1>Metrics</h1>
          <p class="subtitle">Real-time resource monitoring and container statistics</p>
        </div>
      </div>
      <div class="last-update">
        {#if metrics}
          <span class="update-dot"></span>
          <span>Updated {new Date(metrics.lastUpdate).toLocaleTimeString()}</span>
        {/if}
      </div>
    </div>
  </header>

  {#if loading}
    <div class="loading-state">
      <div class="spinner"></div>
      <span>Loading metrics...</span>
    </div>
  {:else if error}
    <Card variant="glass" padding="lg">
      <div class="error-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        <h3>Failed to Load Metrics</h3>
        <p>{error}</p>
      </div>
    </Card>
  {:else}
    <!-- Summary Cards -->
    <div class="summary-row">
      <Card variant="glass" padding="md">
        <div class="summary-card">
          <div class="summary-header">
            <span class="summary-label">Total CPU</span>
            <Badge variant={getUsageColor(currentCpu)} size="sm">{currentCpu.toFixed(1)}%</Badge>
          </div>
          <div class="summary-value">{currentCpu.toFixed(1)}%</div>
          <div class="summary-sparkline">
            {#if cpuChart.line}
              <svg viewBox="0 0 400 120" preserveAspectRatio="none">
                <path d={cpuChart.area} fill="url(#cpuGradient)" opacity="0.3" />
                <path d={cpuChart.line} fill="none" stroke="var(--primary)" stroke-width="2" />
                <defs>
                  <linearGradient id="cpuGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color: var(--primary)" />
                    <stop offset="100%" style="stop-color: transparent" />
                  </linearGradient>
                </defs>
              </svg>
            {/if}
          </div>
        </div>
      </Card>

      <Card variant="glass" padding="md">
        <div class="summary-card">
          <div class="summary-header">
            <span class="summary-label">Avg Memory</span>
            <Badge variant={getUsageColor(currentMemory)} size="sm">{currentMemory.toFixed(1)}%</Badge>
          </div>
          <div class="summary-value">{currentMemory.toFixed(1)}%</div>
          <div class="summary-sparkline">
            {#if memoryChart.line}
              <svg viewBox="0 0 400 120" preserveAspectRatio="none">
                <path d={memoryChart.area} fill="url(#memGradient)" opacity="0.3" />
                <path d={memoryChart.line} fill="none" stroke="var(--success)" stroke-width="2" />
                <defs>
                  <linearGradient id="memGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color: var(--success)" />
                    <stop offset="100%" style="stop-color: transparent" />
                  </linearGradient>
                </defs>
              </svg>
            {/if}
          </div>
        </div>
      </Card>

      <Card variant="glass" padding="md">
        <div class="summary-card">
          <div class="summary-header">
            <span class="summary-label">Active Containers</span>
          </div>
          <div class="summary-value">{metrics?.containers.length ?? 0}</div>
          <div class="summary-detail">Running with metrics</div>
        </div>
      </Card>
    </div>

    <!-- Container Metrics Table -->
    <Card variant="glass" padding="lg">
      <div class="table-card">
        <div class="card-header">
          <h2>Container Resources</h2>
          <span class="time-range">Live - 5 second refresh</span>
        </div>

        {#if sortedContainers.length > 0}
          <div class="table-container">
            <table class="metrics-table">
              <thead>
                <tr>
                  <th>Container</th>
                  <th>CPU</th>
                  <th>Memory</th>
                  <th>Memory Used</th>
                </tr>
              </thead>
              <tbody>
                {#each sortedContainers as container}
                  <tr>
                    <td class="container-cell">
                      <span class="container-name">{container.containerName}</span>
                    </td>
                    <td>
                      <div class="metric-bar-cell">
                        <div class="metric-bar">
                          <div
                            class="metric-fill cpu"
                            style="width: {Math.min(container.cpu, 100)}%"
                          ></div>
                        </div>
                        <span class="metric-value">{container.cpu.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td>
                      <div class="metric-bar-cell">
                        <div class="metric-bar">
                          <div
                            class="metric-fill memory"
                            style="width: {Math.min(container.memoryPercent, 100)}%"
                          ></div>
                        </div>
                        <span class="metric-value">{container.memoryPercent.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td>
                      <span class="memory-used">{formatBytes(container.memoryUsed)}</span>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <div class="no-data">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M12 8v8M8 12h8" />
            </svg>
            <span>No running containers</span>
            <span class="hint">Start some containers to see their metrics</span>
          </div>
        {/if}
      </div>
    </Card>

    <!-- Historical Charts -->
    <div class="charts-grid">
      <Card variant="glass" padding="lg">
        <div class="chart-card">
          <div class="card-header">
            <h2>CPU History</h2>
            <span class="time-range">Last 10 minutes</span>
          </div>
          <div class="chart-container">
            {#if metrics?.system.cpu && metrics.system.cpu.length > 1}
              <svg viewBox="0 0 400 150" class="chart-svg" preserveAspectRatio="none">
                <!-- Grid lines -->
                <line x1="4" y1="37.5" x2="396" y2="37.5" stroke="var(--glass-border)" stroke-width="0.5" />
                <line x1="4" y1="75" x2="396" y2="75" stroke="var(--glass-border)" stroke-width="0.5" />
                <line x1="4" y1="112.5" x2="396" y2="112.5" stroke="var(--glass-border)" stroke-width="0.5" />

                <path d={cpuChart.area} fill="url(#cpuChartGradient)" opacity="0.4" />
                <path d={cpuChart.line} fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" />

                <defs>
                  <linearGradient id="cpuChartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color: var(--primary)" />
                    <stop offset="100%" style="stop-color: transparent" />
                  </linearGradient>
                </defs>
              </svg>
              <div class="chart-y-labels">
                <span>100%</span>
                <span>75%</span>
                <span>50%</span>
                <span>25%</span>
                <span>0%</span>
              </div>
            {:else}
              <div class="no-chart-data">
                <span>Collecting data...</span>
              </div>
            {/if}
          </div>
        </div>
      </Card>

      <Card variant="glass" padding="lg">
        <div class="chart-card">
          <div class="card-header">
            <h2>Memory History</h2>
            <span class="time-range">Last 10 minutes</span>
          </div>
          <div class="chart-container">
            {#if metrics?.system.memory && metrics.system.memory.length > 1}
              <svg viewBox="0 0 400 150" class="chart-svg" preserveAspectRatio="none">
                <!-- Grid lines -->
                <line x1="4" y1="37.5" x2="396" y2="37.5" stroke="var(--glass-border)" stroke-width="0.5" />
                <line x1="4" y1="75" x2="396" y2="75" stroke="var(--glass-border)" stroke-width="0.5" />
                <line x1="4" y1="112.5" x2="396" y2="112.5" stroke="var(--glass-border)" stroke-width="0.5" />

                <path d={memoryChart.area} fill="url(#memChartGradient)" opacity="0.4" />
                <path d={memoryChart.line} fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" />

                <defs>
                  <linearGradient id="memChartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color: var(--success)" />
                    <stop offset="100%" style="stop-color: transparent" />
                  </linearGradient>
                </defs>
              </svg>
              <div class="chart-y-labels">
                <span>100%</span>
                <span>75%</span>
                <span>50%</span>
                <span>25%</span>
                <span>0%</span>
              </div>
            {:else}
              <div class="no-chart-data">
                <span>Collecting data...</span>
              </div>
            {/if}
          </div>
        </div>
      </Card>
    </div>
  {/if}
</div>

<style>
  .metrics-page {
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

  .metrics-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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

  .last-update {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 12px;
    color: var(--text-muted);
  }

  .update-dot {
    width: 8px;
    height: 8px;
    background: var(--success);
    border-radius: var(--radius-full);
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
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

  /* Summary Cards */
  .summary-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-4);
  }

  .summary-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .summary-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .summary-label {
    font-size: 12px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .summary-value {
    font-size: 32px;
    font-weight: 700;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .summary-detail {
    font-size: 12px;
    color: var(--text-muted);
  }

  .summary-sparkline {
    height: 40px;
    margin-top: var(--space-2);
  }

  .summary-sparkline svg {
    width: 100%;
    height: 100%;
  }

  /* Table */
  .table-card {
    display: flex;
    flex-direction: column;
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

  .table-container {
    overflow-x: auto;
  }

  .metrics-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .metrics-table th {
    text-align: left;
    padding: var(--space-3);
    color: var(--text-muted);
    font-weight: 500;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--glass-border);
  }

  .metrics-table td {
    padding: var(--space-3);
    border-bottom: 1px solid var(--glass-border);
  }

  .metrics-table tr:last-child td {
    border-bottom: none;
  }

  .container-cell {
    min-width: 150px;
  }

  .container-name {
    font-weight: 500;
    color: var(--text-primary);
  }

  .metric-bar-cell {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 150px;
  }

  .metric-bar {
    flex: 1;
    height: 6px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .metric-fill {
    height: 100%;
    border-radius: var(--radius-full);
    transition: width var(--transition-normal);
  }

  .metric-fill.cpu {
    background: var(--gradient-primary);
  }

  .metric-fill.memory {
    background: var(--gradient-success);
  }

  .metric-value {
    font-size: 12px;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    min-width: 45px;
    text-align: right;
  }

  .memory-used {
    font-size: 12px;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .no-data {
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

  /* Charts Grid */
  .charts-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-5);
  }

  .chart-card {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .chart-container {
    position: relative;
    flex: 1;
    min-height: 180px;
  }

  .chart-svg {
    width: 100%;
    height: 100%;
  }

  .chart-y-labels {
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

  .no-chart-data {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
    font-size: 13px;
  }

  @media (max-width: 900px) {
    .summary-row {
      grid-template-columns: 1fr;
    }

    .charts-grid {
      grid-template-columns: 1fr;
    }

    .header-content {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-3);
    }
  }
</style>
