<script lang="ts">
  import ContainerCard from './ContainerCard.svelte';
  import type { ContainerInfo } from '$lib/types';

  interface Props {
    containers: ContainerInfo[];
    onviewLogs?: (containerName: string) => void;
  }

  const { containers, onviewLogs }: Props = $props();

  // Generate unique ID for form element accessibility
  const uid = $props.id();

  let filter = $state<'all' | 'running' | 'stopped'>('all');
  let searchQuery = $state('');

  // Ensure we have a valid array
  const safeContainers = $derived(containers ?? []);

  const filteredContainers = $derived(safeContainers.filter(c => {
    // Apply status filter
    if (filter === 'running' && c.state !== 'running') return false;
    if (filter === 'stopped' && c.state === 'running') return false;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return c.name.toLowerCase().includes(query) ||
             c.image.toLowerCase().includes(query);
    }
    return true;
  }));

  const runningCount = $derived(safeContainers.filter(c => c.state === 'running').length);
  const stoppedCount = $derived(safeContainers.filter(c => c.state !== 'running').length);

</script>

<div class="container-list">
  <div class="header">
    <div class="filters">
      <button
        type="button"
        class="filter"
        class:active={filter === 'all'}
        onclick={() => filter = 'all'}
      >
        <span class="filter-label">All</span>
        <span class="filter-count">{safeContainers.length}</span>
      </button>
      <button
        type="button"
        class="filter"
        class:active={filter === 'running'}
        onclick={() => filter = 'running'}
      >
        <span class="filter-dot running"></span>
        <span class="filter-label">Running</span>
        <span class="filter-count">{runningCount}</span>
      </button>
      <button
        type="button"
        class="filter"
        class:active={filter === 'stopped'}
        onclick={() => filter = 'stopped'}
      >
        <span class="filter-dot stopped"></span>
        <span class="filter-label">Stopped</span>
        <span class="filter-count">{stoppedCount}</span>
      </button>
    </div>

    <div class="search">
      <label for="{uid}-search" class="sr-only">Search containers</label>
      <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="11" cy="11" r="8"/>
        <path d="M21 21l-4.35-4.35"/>
      </svg>
      <input
        id="{uid}-search"
        type="text"
        placeholder="Search containers..."
        bind:value={searchQuery}
        class="search-input"
        aria-label="Search containers"
      />
      {#if searchQuery}
        <button type="button" class="clear-search" onclick={() => searchQuery = ''} aria-label="Clear search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      {/if}
    </div>
  </div>

  <div class="grid">
    {#each filteredContainers as container (container.id)}
      <ContainerCard
        {container}
        onclick={() => onviewLogs?.(container.name)}
      />
    {:else}
      <div class="empty glass-effect">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M9 9h.01M15 9h.01M9 15h6"/>
        </svg>
        <span class="empty-title">No containers found</span>
        <span class="empty-subtitle">
          {#if searchQuery}
            No containers match "{searchQuery}"
          {:else if filter !== 'all'}
            No {filter} containers
          {:else}
            Start some containers to see them here
          {/if}
        </span>
      </div>
    {/each}
  </div>
</div>

<style>
  .container-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .filters {
    display: flex;
    gap: var(--space-2);
    padding: 4px;
    background: var(--glass-bg);
    border-radius: var(--radius-lg);
    border: 1px solid var(--glass-border);
  }

  .filter {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    padding: 8px 14px;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .filter:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .filter.active {
    background: var(--gradient-primary);
    color: white;
    box-shadow: var(--shadow-sm);
  }

  .filter-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
  }

  .filter-dot.running {
    background: var(--success);
    box-shadow: 0 0 6px var(--success);
  }

  .filter-dot.stopped {
    background: var(--text-muted);
  }

  .filter-count {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: var(--radius-full);
    background: rgba(255, 255, 255, 0.1);
  }

  .filter.active .filter-count {
    background: rgba(255, 255, 255, 0.2);
  }

  .search {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 12px;
    color: var(--text-muted);
  }

  .search-input {
    padding: 10px 36px 10px 38px;
    font-size: 13px;
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    background: var(--glass-bg);
    color: var(--text-primary);
    min-width: 240px;
    transition: all var(--transition-fast);
  }

  .search-input::placeholder {
    color: var(--text-muted);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.1);
  }

  .clear-search {
    position: absolute;
    right: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    background: var(--bg-hover);
    border-radius: var(--radius-full);
    color: var(--text-muted);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .clear-search:hover {
    background: var(--text-muted);
    color: var(--bg-primary);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: var(--space-4);
  }

  .empty {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-8);
    text-align: center;
    color: var(--text-muted);
    border-radius: var(--radius-lg);
    border: 1px dashed var(--glass-border);
  }

  .empty svg {
    opacity: 0.5;
  }

  .empty-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .empty-subtitle {
    font-size: 13px;
    color: var(--text-muted);
  }
</style>
