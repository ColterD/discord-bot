<script lang="ts">
  import type { LogEntry } from '$lib/types';

  interface Props {
    containerName: string;
    visible?: boolean;
  }

  let { containerName, visible = $bindable(false) }: Props = $props();

  // Generate unique ID for form element accessibility
  const uid = $props.id();

  let logs = $state<LogEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let logsContainer = $state<HTMLDivElement | null>(null);
  let autoScroll = $state(true);

  async function fetchLogs() {
    if (!visible) return;

    loading = true;
    error = null;

    try {
      const response = await fetch(`/api/containers/${containerName}/logs?tail=200`);
      if (!response.ok) throw new Error('Failed to fetch logs');

      const data = await response.json();
      logs = data.logs;

      if (autoScroll && logsContainer) {
        setTimeout(() => {
          if (logsContainer) {
            logsContainer.scrollTop = logsContainer.scrollHeight;
          }
        }, 0);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loading = false;
    }
  }

  // Per Svelte 5 docs: cleanup should be returned from $effect, not in separate onDestroy
  $effect(() => {
    let refreshInterval: ReturnType<typeof setInterval> | null = null;

    if (visible) {
      fetchLogs();
      refreshInterval = setInterval(fetchLogs, 3000);
    }

    // Return cleanup function from $effect
    return () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    };
  });

  function handleScroll() {
    if (!logsContainer) return;
    const { scrollTop, scrollHeight, clientHeight } = logsContainer;
    autoScroll = scrollHeight - scrollTop - clientHeight < 50;
  }

</script>

{#if visible}
  <div class="logs-modal">
    <div
      class="logs-backdrop"
      onclick={() => visible = false}
      onkeydown={(e) => e.key === 'Escape' && (visible = false)}
      role="button"
      tabindex="-1"
      aria-label="Close logs modal"
    ></div>
    <div class="logs-panel glass-effect">
      <div class="logs-header">
        <div class="header-left">
          <div class="icon-container">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          </div>
          <div class="header-text">
            <h3>Container Logs</h3>
            <span class="container-name">{containerName}</span>
          </div>
        </div>
        <div class="logs-controls">
          <label class="auto-scroll-toggle" for="{uid}-autoscroll">
            <input id="{uid}-autoscroll" type="checkbox" bind:checked={autoScroll} />
            <span class="toggle-track">
              <span class="toggle-thumb"></span>
            </span>
            <span class="toggle-label">Auto-scroll</span>
          </label>
          <button type="button" class="refresh-btn" onclick={fetchLogs} disabled={loading} aria-label="Refresh logs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class:spinning={loading} aria-hidden="true">
              <path d="M1 4v6h6M23 20v-6h-6"/>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
          </button>
          <button type="button" class="close-btn" onclick={() => visible = false} aria-label="Close log viewer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      <div
        class="logs-content"
        bind:this={logsContainer}
        onscroll={handleScroll}
      >
        {#if loading && logs.length === 0}
          <div class="logs-status">
            <div class="spinner"></div>
            <span>Loading logs...</span>
          </div>
        {:else if error}
          <div class="logs-status error">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4M12 16h.01"/>
            </svg>
            <span>{error}</span>
          </div>
        {:else if logs.length === 0}
          <div class="logs-status">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span>No logs available</span>
          </div>
        {:else}
          {#each logs as log, index}
            <div class="log-line" class:stderr={log.stream === 'stderr'}>
              <span class="log-index">{index + 1}</span>
              <span class="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
              <span class="log-message">{log.message}</span>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .logs-modal {
    position: fixed;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
    padding: var(--space-6);
  }

  .logs-backdrop {
    position: absolute;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(4px);
  }

  .logs-panel {
    position: relative;
    width: 100%;
    max-width: 1000px;
    height: 75vh;
    background: var(--bg-primary);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-xl);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: var(--shadow-xl);
  }

  .logs-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-4) var(--space-5);
    background: var(--glass-bg);
    border-bottom: 1px solid var(--glass-border);
  }

  .header-left {
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

  .header-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .logs-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .container-name {
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-muted);
  }

  .logs-controls {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .auto-scroll-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
  }

  .auto-scroll-toggle input {
    display: none;
  }

  .toggle-track {
    position: relative;
    width: 36px;
    height: 20px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-full);
    transition: all var(--transition-fast);
  }

  .auto-scroll-toggle input:checked + .toggle-track {
    background: var(--gradient-success);
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: white;
    border-radius: var(--radius-full);
    transition: all var(--transition-fast);
    box-shadow: var(--shadow-sm);
  }

  .auto-scroll-toggle input:checked + .toggle-track .toggle-thumb {
    left: 18px;
  }

  .toggle-label {
    font-size: 12px;
    color: var(--text-muted);
    font-weight: 500;
  }

  .refresh-btn,
  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    color: var(--text-muted);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .refresh-btn:hover,
  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--primary);
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .close-btn:hover {
    background: rgba(237, 66, 69, 0.1);
    border-color: var(--danger);
    color: var(--danger);
  }

  .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .logs-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-2);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.6;
    background: #0a0a0a;
  }

  .logs-status {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    height: 100%;
    color: var(--text-muted);
    font-size: 13px;
  }

  .logs-status.error {
    color: var(--danger);
  }

  .logs-status svg {
    opacity: 0.5;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--glass-border);
    border-top-color: var(--primary);
    border-radius: var(--radius-full);
    animation: spin 0.8s linear infinite;
  }

  .log-line {
    display: flex;
    gap: var(--space-3);
    padding: 4px var(--space-2);
    border-radius: var(--radius-sm);
    transition: background var(--transition-fast);
  }

  .log-line:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .log-line.stderr {
    background: rgba(254, 231, 92, 0.05);
  }

  .log-line.stderr:hover {
    background: rgba(254, 231, 92, 0.1);
  }

  .log-index {
    color: var(--text-muted);
    opacity: 0.4;
    min-width: 36px;
    text-align: right;
    user-select: none;
  }

  .log-time {
    color: var(--primary-light);
    flex-shrink: 0;
    opacity: 0.7;
  }

  .log-message {
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-all;
  }

  .log-line.stderr .log-message {
    color: var(--warning);
  }
</style>
