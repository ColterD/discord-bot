<script lang="ts">
  import Card from '$lib/components/ui/Card.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';

  interface CloudflareHealth {
    available: boolean;
    routerModel: string | null;
    embeddingModel: string | null;
    configured: boolean;
    usingWorker: boolean;
    datacenter: string | null;
    latencyMs: number | null;
    lastCheck: string | null;
  }

  let health = $state<CloudflareHealth>({
    available: false,
    routerModel: null,
    embeddingModel: null,
    configured: false,
    usingWorker: false,
    datacenter: null,
    latencyMs: null,
    lastCheck: null
  });
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function checkHealth() {
    try {
      const response = await fetch('/api/cloudflare/health');
      if (!response.ok) {
        throw new Error('Failed to check Cloudflare health');
      }
      const data = await response.json();
      health = {
        ...data,
        lastCheck: new Date().toISOString()
      };
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
      health = { ...health, available: false };
    } finally {
      loading = false;
    }
  }

  // Use $effect with cleanup instead of onMount per Svelte 5 docs
  $effect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000); // Check every 30s
    return () => clearInterval(interval);
  });

  type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

  const statusVariant = $derived<BadgeVariant>(
    loading ? 'default' : health.available ? 'success' : 'danger'
  );

  // Latency thresholds depend on whether using Worker (edge) or REST API
  const latencyColor = $derived.by(() => {
    const ms = health.latencyMs;
    if (!ms) return 'var(--text-muted)';
    if (health.usingWorker) {
      // Edge Worker: expect <100ms
      if (ms < 100) return 'var(--success)';
      if (ms < 200) return 'var(--warning)';
      return 'var(--danger)';
    } else {
      // REST API: expect 150-500ms
      if (ms < 200) return 'var(--success)';
      if (ms < 500) return 'var(--warning)';
      return 'var(--danger)';
    }
  });

</script>

<Card variant="glass" padding="md">
  <div class="cf-status">
    <div class="status-header">
      <div class="title-row">
        <div class="cf-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M16.5088 16.8447C16.6273 16.4322 16.5403 16.0165 16.2711 15.7134C16.0019 15.4104 15.5996 15.2494 15.1778 15.2688L8.5926 15.4298C8.5001 15.4329 8.42363 15.3936 8.37632 15.3338C8.32588 15.2709 8.31337 15.1924 8.34404 15.1139C8.37789 15.0292 8.4586 14.9632 8.55423 14.9476L15.2119 13.9384C15.6337 13.8755 16.0172 13.6364 16.2711 13.2832C16.5247 12.9302 16.6116 12.5018 16.5088 12.0893L16.0047 10.2007C15.9738 10.0909 15.9051 9.99693 15.8127 9.93403C15.7203 9.87113 15.6087 9.84359 15.4975 9.85633L8.7176 10.6495C8.62510 10.6589 8.53573 10.6214 8.4742 10.5554C8.41267 10.4894 8.38830 10.3984 8.40710 10.3106L8.78830 8.49243C8.81267 8.37483 8.89650 8.27773 9.00777 8.23363C9.11904 8.18953 9.24280 8.20227 9.34157 8.26833L11.0281 9.29813C11.3917 9.51473 11.8353 9.53693 12.2163 9.35953C12.5974 9.18213 12.8603 8.83263 12.9128 8.42583L13.3269 5.23943C13.3489 5.07633 13.2987 4.91323 13.1937 4.79253C13.0887 4.67183 12.9367 4.60263 12.7752 4.60263H11.2249C11.0635 4.60263 10.9115 4.67183 10.8065 4.79253C10.7015 4.91323 10.6513 5.07633 10.6733 5.23943L11.0874 8.42583C11.1274 8.73613 10.9472 9.03393 10.6611 9.15783C10.3751 9.28173 10.0485 9.20623 9.84483 8.97083L8.15830 7.01073C8.05353 6.88693 7.9015 6.81783 7.7401 6.81783C7.5787 6.81783 7.4267 6.88693 7.3219 7.01073L6.21800 8.29653C6.1130 8.42043 6.0628 8.58353 6.0848 8.74663L6.4988 11.9330C6.5513 12.3398 6.3961 12.7466 6.0848 13.0215C5.7736 13.2965 5.3461 13.4020 4.9494 13.3018L1.8414 12.5087C1.6831 12.4676 1.5153 12.5024 1.3854 12.6045C1.2554 12.7065 1.1802 12.8634 1.1802 13.0309V14.6041C1.1802 14.8176 1.2961 15.0124 1.4792 15.1139L4.3498 16.7871C4.7089 17.0027 4.9056 17.4001 4.8531 17.8069L4.4391 21.0058C4.4171 21.1689 4.4673 21.332 4.5723 21.4527C4.6773 21.5734 4.8293 21.6426 4.9907 21.6426H6.5410C6.7024 21.6426 6.8544 21.5734 6.9594 21.4527C7.0644 21.332 7.1146 21.1689 7.0926 21.0058L6.6786 17.8069C6.6261 17.4001 6.7813 16.9933 7.0926 16.7184C7.4038 16.4434 7.8313 16.3379 8.2280 16.4381L11.3360 17.2312C11.4943 17.2723 11.6621 17.2375 11.7920 17.1354C11.9220 17.0334 11.9972 16.8765 11.9972 16.7090V15.1358C11.9972 14.9223 11.8813 14.7275 11.6982 14.6260L8.8276 12.9528C8.4685 12.7372 8.2718 12.3398 8.3243 11.9330L8.7383 8.73403C8.7603 8.57093 8.8292 8.42033 8.9373 8.30283L10.0412 7.01703C10.1462 6.89323 10.2982 6.82403 10.4596 6.82403C10.6210 6.82403 10.7730 6.89323 10.8780 7.01703L12.5645 8.97713C12.7682 9.21253 13.0948 9.28803 13.3809 9.16413C13.6670 9.04023 13.8471 8.74243 13.8071 8.43213L13.3931 5.24573C13.3711 5.08263 13.3209 4.93203 13.2128 4.81453C13.1047 4.69693 12.9496 4.60893 12.7850 4.60893L11.2347 4.60893C11.0701 4.60893 10.9150 4.69693 10.8069 4.81453C10.6988 4.93203 10.6486 5.08263 10.6266 5.24573L10.2126 8.43213C10.1601 8.83893 10.4230 9.18843 10.8040 9.36583C11.1850 9.54323 11.6287 9.52103 11.9922 9.30443L13.6788 8.27463C13.7775 8.20857 13.9013 8.19583 14.0125 8.23993C14.1238 8.28403 14.2076 8.38113 14.2320 8.49873L14.6132 10.3169C14.6320 10.4047 14.6076 10.4957 14.5461 10.5617C14.4846 10.6277 14.3952 10.6652 14.3027 10.6558L7.5228 9.86263C7.4116 9.84989 7.3000 9.87743 7.2076 9.94033C7.1152 10.0032 7.0465 10.0972 7.0156 10.2070L6.5115 12.0956C6.4087 12.5081 6.4956 12.9365 6.7492 13.2895C7.0031 13.6427 7.3866 13.8818 7.8084 13.9447L14.4661 14.9539C14.5617 14.9695 14.6424 15.0355 14.6763 15.1202C14.7069 15.1987 14.6944 15.2772 14.6440 15.3401C14.5967 15.3999 14.5202 15.4392 14.4277 15.4361L7.8425 15.2751C7.4207 15.2557 7.0184 15.4167 6.7492 15.7197C6.4800 16.0228 6.3930 16.4385 6.5115 16.8510L7.0156 18.7396C7.0465 18.8494 7.1152 18.9434 7.2076 19.0063C7.3000 19.0692 7.4116 19.0967 7.5228 19.0840L14.3027 18.2908C14.3952 18.2814 14.4846 18.3189 14.5461 18.3849C14.6076 18.4509 14.6320 18.5419 14.6132 18.6297L14.2320 20.4479C14.2076 20.5655 14.1238 20.6626 14.0125 20.7067C13.9013 20.7508 13.7775 20.7380 13.6788 20.6720L11.9922 19.6422C11.6287 19.4256 11.1850 19.4034 10.8040 19.5808C10.4230 19.7582 10.1601 20.1077 10.2126 20.5145L10.6266 23.7009C10.6486 23.8640 10.6988 24.0146 10.8069 24.1321C10.9150 24.2497 11.0701 24.3377 11.2347 24.3377H12.7850C12.9496 24.3377 13.1047 24.2497 13.2128 24.1321C13.3209 24.0146 13.3711 23.8640 13.3931 23.7009L13.8071 20.5145C13.8596 20.1077 14.0148 19.7009 14.3260 19.4260C14.6373 19.1510 15.0648 19.0455 15.4615 19.1457L18.5695 19.9388C18.7278 19.9799 18.8956 19.9451 19.0256 19.8430C19.1555 19.7410 19.2307 19.5841 19.2307 19.4166V17.8434C19.2307 17.6299 19.1148 17.4351 18.9317 17.3336L16.0611 15.6604C15.7020 15.4448 15.5053 15.0474 15.5578 14.6406L15.9718 11.4417C15.9938 11.2786 16.0440 11.1280 16.1521 11.0105C16.2602 10.8929 16.4153 10.8049 16.5799 10.8049H18.1302C18.2948 10.8049 18.4499 10.8929 18.5580 11.0105C18.6661 11.1280 18.7163 11.2786 18.7383 11.4417L19.1523 14.6406C19.2048 15.0474 19.0496 15.4542 18.7383 15.7291C18.4271 16.0041 17.9996 16.1096 17.6029 16.0094L14.4949 15.2163C14.3366 15.1752 14.1688 15.2100 14.0389 15.3120C13.9089 15.4141 13.8337 15.5710 13.8337 15.7385V17.3117C13.8337 17.5252 13.9496 17.7200 14.1327 17.8215L17.0033 19.4947C17.3624 19.7103 17.5591 20.1077 17.5066 20.5145L17.0926 23.7134C17.0706 23.8765 17.0204 24.0271 16.9123 24.1446C16.8042 24.2622 16.6491 24.3502 16.4845 24.3502H14.9342C14.7696 24.3502 14.6145 24.2622 14.5064 24.1446C14.3983 24.0271 14.3481 23.8765 14.3261 23.7134L13.9121 20.5145"/>
          </svg>
        </div>
        <span class="title">Cloudflare AI</span>
      </div>
      <Badge variant={statusVariant} size="sm" dot pulse={health.available}>
        {loading ? 'Checking...' : health.available ? 'Online' : 'Offline'}
      </Badge>
    </div>

    {#if loading}
      <div class="loading-state">
        <div class="skeleton-bar"></div>
      </div>
    {:else if error}
      <div class="error-state">
        <span class="error-text">{error}</span>
      </div>
    {:else if health.available}
      <div class="metrics">
        <div class="metric">
          <span class="metric-label">
            {health.usingWorker ? 'Edge Latency' : 'API Latency'}
          </span>
          <span class="metric-value" style="color: {latencyColor}">
            {health.latencyMs ?? '—'}ms
          </span>
        </div>
        {#if health.datacenter}
          <div class="metric">
            <span class="metric-label">Datacenter</span>
            <span class="metric-value mono">
              {health.datacenter}
            </span>
          </div>
        {/if}
        <div class="metric">
          <span class="metric-label">Mode</span>
          <span class="metric-value">
            {#if health.usingWorker}
              <Badge variant="success" size="sm">Edge</Badge>
            {:else}
              <Badge variant="warning" size="sm">REST API</Badge>
            {/if}
          </span>
        </div>
        <div class="metric">
          <span class="metric-label">Router</span>
          <span class="metric-value mono">
            {health.routerModel?.split('/').pop() ?? 'N/A'}
          </span>
        </div>
      </div>
      {#if !health.usingWorker}
        <div class="latency-note">
          <span class="note-icon" aria-hidden="true">ℹ️</span>
          <span>Using central API. Deploy a <a href="https://developers.cloudflare.com/workers-ai/" target="_blank" rel="noopener">Worker</a> for edge latency.</span>
        </div>
      {/if}
    {:else}
      <div class="offline-state">
        <span>Workers AI not configured</span>
      </div>
    {/if}
  </div>
</Card>

<style>
  .cf-status {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .status-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .cf-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: linear-gradient(135deg, #f38020 0%, #faad3f 100%);
    border-radius: var(--radius-md);
    color: white;
  }

  .title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .loading-state {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .skeleton-bar {
    height: 12px;
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

  .error-state {
    padding: var(--space-2);
    background: rgba(239, 68, 68, 0.1);
    border-radius: var(--radius-sm);
  }

  .error-text {
    font-size: 12px;
    color: var(--danger);
  }

  .metrics {
    display: flex;
    gap: var(--space-4);
  }

  .metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .metric-label {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .metric-value {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .metric-value.mono {
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .offline-state {
    font-size: 12px;
    color: var(--text-muted);
  }

  .latency-note {
    display: flex;
    align-items: flex-start;
    gap: var(--space-1);
    padding: var(--space-2);
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .latency-note a {
    color: var(--info);
    text-decoration: none;
  }

  .latency-note a:hover {
    text-decoration: underline;
  }

  .note-icon {
    flex-shrink: 0;
    font-size: 10px;
  }
</style>
