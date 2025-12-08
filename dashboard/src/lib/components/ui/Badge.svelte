<script lang="ts">
  import type { Snippet } from 'svelte';

  type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info';
  type Size = 'xs' | 'sm' | 'md';

  interface Props {
    variant?: Variant;
    size?: Size;
    dot?: boolean;
    pulse?: boolean;
    children?: Snippet;
  }

  const { variant = 'default', size = 'md', dot = false, pulse = false, children }: Props = $props();
</script>

<span class="badge badge-{variant} size-{size}">
  {#if dot}
    <span class="dot" class:pulse></span>
  {/if}
  {#if children}
    {@render children()}
  {/if}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: var(--radius-full);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: currentColor;
    box-shadow: 0 0 8px currentColor;
  }

  .dot.pulse {
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(0.9); }
  }

  .badge-default {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-secondary);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .badge-success {
    background: var(--success-bg);
    color: var(--success);
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .badge-warning {
    background: var(--warning-bg);
    color: var(--warning);
    border: 1px solid rgba(245, 158, 11, 0.3);
  }

  .badge-danger {
    background: var(--danger-bg);
    color: var(--danger);
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .badge-info {
    background: var(--info-bg);
    color: var(--info);
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  /* Size variants */
  .size-xs {
    padding: 2px 6px;
    font-size: 9px;
  }

  .size-sm {
    padding: 3px 8px;
    font-size: 10px;
  }

  .size-md {
    padding: 4px 10px;
    font-size: 11px;
  }
</style>
