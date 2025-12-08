<script lang="ts">
  import type { Snippet } from 'svelte';

  interface User {
    id: string;
    username: string;
    avatar: string | null;
  }

  interface Props {
    botName?: string;
    user?: User | null;
    nav?: Snippet;
    actions?: Snippet;
  }

  const { botName = 'Discord Bot', user = null, nav, actions }: Props = $props();

  function getAvatarUrl(user: User): string {
    if (user.avatar) {
      return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=40`;
    }
    const defaultIndex = Number.parseInt(user.id, 10) % 5;
    return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
  }
</script>

<header class="header">
  <div class="brand">
    <div class="logo">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#6366f1" />
            <stop offset="100%" stop-color="#a855f7" />
          </linearGradient>
        </defs>
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="url(#logo-gradient)"/>
      </svg>
    </div>
    <div class="brand-text">
      <h1>{botName}</h1>
      <span class="badge">Dashboard</span>
    </div>
  </div>

  <nav class="nav">
    {#if nav}
      {@render nav()}
    {/if}
  </nav>

  <div class="actions">
    {#if actions}
      {@render actions()}
    {/if}

    {#if user}
      <div class="user-menu">
        <img src={getAvatarUrl(user)} alt={user.username} class="avatar" />
        <span class="username">{user.username}</span>
        <a href="/auth/logout" class="logout-link" title="Logout">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
          </svg>
        </a>
      </div>
    {/if}
  </div>
</header>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-5);
    background: var(--glass-bg);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--glass-border);
    height: 64px;
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
  }

  .brand-text {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .brand h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.02em;
  }

  .brand .badge {
    font-size: 10px;
    padding: 4px 8px;
    background: var(--accent-gradient);
    color: white;
    border-radius: var(--radius-full);
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  .nav {
    display: flex;
    gap: var(--space-1);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .user-menu {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 6px 12px 6px 6px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-full);
    transition: all var(--transition-fast);
  }

  .user-menu:hover {
    background: var(--glass-hover);
    border-color: rgba(255, 255, 255, 0.12);
  }

  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid var(--glass-border);
  }

  .username {
    font-size: 14px;
    color: var(--text-primary);
    font-weight: 500;
  }

  .logout-link {
    display: flex;
    align-items: center;
    padding: 6px;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    transition: all var(--transition-fast);
  }

  .logout-link:hover {
    color: var(--danger);
    background: var(--danger-bg);
  }
</style>
