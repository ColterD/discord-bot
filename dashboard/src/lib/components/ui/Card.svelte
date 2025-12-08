<script lang="ts">
  import type { Snippet } from 'svelte';

  type Variant = 'default' | 'glass' | 'elevated';

  interface Props {
    variant?: Variant;
    padding?: 'none' | 'sm' | 'md' | 'lg';
    hover?: boolean;
    glow?: boolean;
    children?: Snippet;
  }

  const { variant = 'default', padding = 'md', hover = false, glow = false, children }: Props = $props();
</script>

<div class="card variant-{variant} padding-{padding}" class:hover class:glow>
  {#if children}
    {@render children()}
  {/if}
</div>

<style>
  .card {
    background: var(--glass-bg);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    height: 100%;
    transition:
      transform var(--transition-normal),
      box-shadow var(--transition-normal),
      border-color var(--transition-normal),
      background var(--transition-normal);
  }

  .card.hover {
    cursor: pointer;
  }

  .card.hover:hover {
    background: var(--glass-hover);
    border-color: rgba(255, 255, 255, 0.12);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  .card.glow:hover {
    box-shadow: var(--shadow-glow);
  }

  .padding-none {
    padding: 0;
  }

  .padding-sm {
    padding: var(--space-3);
  }

  .padding-md {
    padding: var(--space-4);
  }

  .padding-lg {
    padding: var(--space-6);
  }

  /* Variant styles */
  .variant-default,
  .variant-glass {
    background: var(--glass-bg);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }

  .variant-elevated {
    background: var(--bg-elevated);
    box-shadow: var(--shadow-lg);
  }
</style>
