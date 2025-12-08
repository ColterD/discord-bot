<script lang="ts">
  import Card from '$lib/components/ui/Card.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import type { SettingItem, SettingsCategory } from '$lib/types';

  interface SettingsResponse {
    categories: SettingsCategory[];
  }

  let settings = $state<SettingsResponse | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let activeCategory = $state<string>('bot');

  async function fetchSettings() {
    try {
      const response = await fetch('/api/settings');
      if (!response.ok) {
        throw new Error('Failed to fetch settings');
      }
      settings = await response.json();

      // Set first category as active if current isn't found
      if (settings?.categories && !settings.categories.find((c) => c.id === activeCategory)) {
        activeCategory = settings.categories[0]?.id ?? 'bot';
      }

      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    fetchSettings();
  });

  const activeCategoryData = $derived(settings?.categories.find((c) => c.id === activeCategory));

  function getTypeIcon(type: SettingItem['type']): string {
    switch (type) {
      case 'string':
        return '📝';
      case 'number':
        return '#️⃣';
      case 'boolean':
        return '✓';
      case 'select':
        return '📋';
      case 'secret':
        return '🔑';
      default:
        return '⚙️';
    }
  }

  function formatValue(setting: SettingItem): string {
    if (setting.type === 'boolean') {
      return setting.value ? 'Enabled' : 'Disabled';
    }
    if (setting.type === 'select' && setting.options) {
      const option = setting.options.find((o) => o.value === setting.value);
      return option?.label ?? String(setting.value);
    }
    return String(setting.value);
  }
</script>

<svelte:head>
  <title>Settings - Dashboard</title>
</svelte:head>

<div class="settings-page">
  <header class="page-header">
    <div class="header-content">
      <div class="title-section">
        <div class="settings-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
        </div>
        <div>
          <h1>Settings</h1>
          <p class="subtitle">Bot configuration (read-only view)</p>
        </div>
      </div>
      <Badge variant="warning" size="md">Read Only</Badge>
    </div>
  </header>

  {#if loading}
    <div class="loading-state">
      <div class="spinner"></div>
      <span>Loading settings...</span>
    </div>
  {:else if error}
    <Card variant="glass" padding="lg">
      <div class="error-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        <h3>Failed to Load Settings</h3>
        <p>{error}</p>
      </div>
    </Card>
  {:else if settings}
    <div class="settings-layout">
      <!-- Category Navigation -->
      <nav class="category-nav">
        {#each settings.categories as category}
          <button
            type="button"
            class="category-btn"
            class:active={activeCategory === category.id}
            onclick={() => (activeCategory = category.id)}
          >
            <span class="category-icon">{category.icon}</span>
            <span class="category-label">{category.name}</span>
          </button>
        {/each}
      </nav>

      <!-- Settings Content -->
      <div class="settings-content">
        {#if activeCategoryData}
          <Card variant="glass" padding="lg">
            <div class="category-header">
              <div class="category-title">
                <span class="icon">{activeCategoryData.icon}</span>
                <div>
                  <h2>{activeCategoryData.name}</h2>
                  <p class="description">{activeCategoryData.description}</p>
                </div>
              </div>
            </div>

            <div class="settings-list">
              {#each activeCategoryData.settings as setting}
                <div class="setting-item">
                  <div class="setting-header">
                    <div class="setting-label">
                      <span class="type-icon">{getTypeIcon(setting.type)}</span>
                      <span class="label">{setting.label}</span>
                      {#if setting.sensitive}
                        <Badge variant="danger" size="sm">Sensitive</Badge>
                      {/if}
                    </div>
                    <code class="setting-key">{setting.key}</code>
                  </div>

                  {#if setting.description}
                    <p class="setting-description">{setting.description}</p>
                  {/if}

                  <div class="setting-value">
                    {#if setting.type === 'boolean'}
                      <div class="toggle-display" class:enabled={setting.value === true}>
                        <span class="toggle-indicator"></span>
                        <span class="toggle-text">{setting.value ? 'Enabled' : 'Disabled'}</span>
                      </div>
                    {:else if setting.type === 'select'}
                      <div class="select-display">
                        <span class="select-value">{formatValue(setting)}</span>
                        {#if setting.options}
                          <span class="select-options">
                            ({setting.options.length} options)
                          </span>
                        {/if}
                      </div>
                    {:else if setting.type === 'secret'}
                      <div class="secret-display">
                        <span class="secret-value">{setting.value}</span>
                      </div>
                    {:else}
                      <div class="value-display">
                        <code class="value">{setting.value}</code>
                        {#if setting.defaultValue !== undefined && setting.value !== setting.defaultValue}
                          <span class="default">(default: {setting.defaultValue})</span>
                        {/if}
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </Card>

          <!-- Info Card -->
          <Card variant="glass" padding="md">
            <div class="info-card">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              <div class="info-content">
                <h4>Editing Configuration</h4>
                <p>
                  Settings are managed through environment variables in the
                  <code>.env</code> file. Changes require restarting the bot to take effect.
                </p>
              </div>
            </div>
          </Card>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .settings-page {
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

  .settings-icon {
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
    to {
      transform: rotate(360deg);
    }
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

  /* Settings Layout */
  .settings-layout {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: var(--space-5);
  }

  /* Category Navigation */
  .category-nav {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    position: sticky;
    top: var(--space-4);
    align-self: start;
  }

  .category-btn {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: transparent;
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    color: var(--text-muted);
    transition: all var(--transition-fast);
  }

  .category-btn:hover {
    background: var(--glass-hover);
    color: var(--text-primary);
  }

  .category-btn.active {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    color: var(--text-primary);
  }

  .category-icon {
    font-size: 18px;
  }

  .category-label {
    font-size: 14px;
    font-weight: 500;
  }

  /* Settings Content */
  .settings-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .category-header {
    margin-bottom: var(--space-4);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--glass-border);
  }

  .category-title {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .category-title .icon {
    font-size: 24px;
  }

  .category-title h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .category-title .description {
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--text-muted);
  }

  /* Settings List */
  .settings-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .setting-item {
    padding: var(--space-4);
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
  }

  .setting-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: var(--space-2);
  }

  .setting-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .type-icon {
    font-size: 14px;
  }

  .setting-label .label {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .setting-key {
    font-size: 11px;
    color: var(--text-muted);
    background: var(--bg-tertiary);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
  }

  .setting-description {
    margin: 0 0 var(--space-3);
    font-size: 12px;
    color: var(--text-muted);
  }

  .setting-value {
    display: flex;
    align-items: center;
  }

  /* Toggle Display */
  .toggle-display {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .toggle-indicator {
    width: 36px;
    height: 20px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-full);
    position: relative;
    transition: background var(--transition-fast);
  }

  .toggle-display.enabled .toggle-indicator {
    background: var(--success);
  }

  .toggle-indicator::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: white;
    border-radius: var(--radius-full);
    transition: transform var(--transition-fast);
  }

  .toggle-display.enabled .toggle-indicator::after {
    transform: translateX(16px);
  }

  .toggle-text {
    font-size: 13px;
    color: var(--text-secondary);
  }

  /* Select Display */
  .select-display {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .select-value {
    font-size: 13px;
    color: var(--text-primary);
    font-weight: 500;
  }

  .select-options {
    font-size: 12px;
    color: var(--text-muted);
  }

  /* Secret Display */
  .secret-display {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-muted);
    letter-spacing: 1px;
  }

  /* Value Display */
  .value-display {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .value-display .value {
    font-size: 13px;
    color: var(--text-primary);
    background: var(--bg-tertiary);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    word-break: break-all;
  }

  .value-display .default {
    font-size: 12px;
    color: var(--text-muted);
  }

  /* Info Card */
  .info-card {
    display: flex;
    gap: var(--space-3);
    color: var(--text-muted);
  }

  .info-card svg {
    flex-shrink: 0;
    margin-top: 2px;
  }

  .info-content h4 {
    margin: 0 0 var(--space-1);
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .info-content p {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
  }

  .info-content code {
    font-size: 12px;
    background: var(--bg-tertiary);
    padding: 2px 4px;
    border-radius: var(--radius-sm);
  }

  @media (max-width: 900px) {
    .settings-layout {
      grid-template-columns: 1fr;
    }

    .category-nav {
      flex-direction: row;
      flex-wrap: wrap;
      position: static;
      gap: var(--space-2);
    }

    .category-btn {
      padding: var(--space-2) var(--space-3);
    }

    .category-label {
      display: none;
    }

    .header-content {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-3);
    }
  }
</style>
