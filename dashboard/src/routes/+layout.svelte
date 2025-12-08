<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';

  const { children, data } = $props();

  const navItems = [
    { icon: '📦', label: 'Containers', href: '/' },
    { icon: '🧠', label: 'GPU Status', href: '/gpu' },
    { icon: '📊', label: 'Metrics', href: '/metrics' },
    { icon: '⚙️', label: 'Settings', href: '/settings' }
  ];

  const _itemsWithActive = $derived(navItems.map(item => ({
    ...item,
    active: page.url.pathname === item.href
  })));

  const _sidebarCollapsed = $state(false);
</script>

<div class="app">
  <Header botName="Discord Bot" user={data.user}>
    {#snippet actions()}
      <Button variant="secondary" size="sm">
        Refresh
      </Button>
    {/snippet}
  </Header>

  <div class="main-container">
    <Sidebar
      items={itemsWithActive}
      bind:collapsed={sidebarCollapsed}
    />

    <main class="content">
      {@render children()}
    </main>
  </div>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .main-container {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-5);
  }
</style>
