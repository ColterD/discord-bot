<script lang="ts">
  type NavItem = {
    icon: string;
    label: string;
    href: string;
    active?: boolean;
  };

  interface Props {
    items?: NavItem[];
    collapsed?: boolean;
  }

  let { items = [], collapsed = $bindable(false) }: Props = $props();
</script>

<aside class="sidebar" class:collapsed>
  <nav class="nav">
    {#each items as item}
      <a
        href={item.href}
        class="nav-item"
        class:active={item.active}
        title={collapsed ? item.label : undefined}
      >
        <span class="icon">{item.icon}</span>
        {#if !collapsed}
          <span class="label">{item.label}</span>
        {/if}
        {#if item.active && !collapsed}
          <span class="active-indicator"></span>
        {/if}
      </a>
    {/each}
  </nav>

  <button type="button" class="toggle" onclick={() => collapsed = !collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="chevron" class:rotated={collapsed} aria-hidden="true">
      <path d="M15 18l-6-6 6-6"/>
    </svg>
  </button>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    width: 220px;
    background: var(--glass-bg);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-right: 1px solid var(--glass-border);
    transition: width var(--transition-normal);
  }

  .sidebar.collapsed {
    width: 64px;
  }

  .nav {
    flex: 1;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 12px 14px;
    border-radius: var(--radius-md);
    color: var(--text-muted);
    text-decoration: none;
    transition: all var(--transition-fast);
    white-space: nowrap;
    overflow: hidden;
    position: relative;
  }

  .nav-item:hover {
    background: var(--glass-hover);
    color: var(--text-primary);
  }

  .nav-item.active {
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(139, 92, 246, 0.1) 100%);
    color: var(--text-primary);
    border: 1px solid rgba(99, 102, 241, 0.2);
  }

  .active-indicator {
    position: absolute;
    right: 12px;
    width: 6px;
    height: 6px;
    background: var(--accent-gradient);
    border-radius: 50%;
    box-shadow: 0 0 10px var(--accent-primary-glow);
  }

  .icon {
    font-size: 20px;
    flex-shrink: 0;
    width: 24px;
    text-align: center;
  }

  .label {
    font-size: 14px;
    font-weight: 500;
  }

  .toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: none;
    border: none;
    border-top: 1px solid var(--glass-border);
    color: var(--text-muted);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .toggle:hover {
    background: var(--glass-hover);
    color: var(--text-primary);
  }

  .chevron {
    transition: transform var(--transition-normal);
  }

  .chevron.rotated {
    transform: rotate(180deg);
  }
</style>
