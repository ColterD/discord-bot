<script lang="ts">
  import { fly } from 'svelte/transition';

  type Type = 'success' | 'error' | 'warning' | 'info';

  interface Props {
    type?: Type;
    message: string;
    duration?: number;
    onclose?: () => void;
  }

  const { type = 'info', message, duration = 5000, onclose }: Props = $props();

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };

  // Use $effect with cleanup instead of onMount per Svelte 5 docs
  // This also makes the effect reactive to duration changes
  $effect(() => {
    if (duration > 0) {
      const timeout = setTimeout(() => onclose?.(), duration);
      return () => clearTimeout(timeout);
    }
  });
</script>

<div
  class="toast toast-{type}"
  transition:fly={{ x: 300, duration: 200 }}
>
  <span class="icon">{icons[type]}</span>
  <span class="message">{message}</span>
  <button type="button" class="close" onclick={() => onclose?.()}>✕</button>
</div>

<style>
  .toast {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background-color: var(--dc-bg-secondary);
    border-radius: var(--radius-md);
    border-left: 4px solid;
    box-shadow: var(--shadow-lg);
  }

  .toast-success {
    border-color: var(--dc-green);
  }

  .toast-error {
    border-color: var(--dc-red);
  }

  .toast-warning {
    border-color: var(--dc-yellow);
  }

  .toast-info {
    border-color: var(--dc-accent);
  }

  .icon {
    font-size: 18px;
    font-weight: bold;
  }

  .toast-success .icon { color: var(--dc-green); }
  .toast-error .icon { color: var(--dc-red); }
  .toast-warning .icon { color: var(--dc-yellow); }
  .toast-info .icon { color: var(--dc-accent); }

  .message {
    flex: 1;
    color: var(--dc-text-primary);
  }

  .close {
    background: none;
    border: none;
    color: var(--dc-text-muted);
    cursor: pointer;
    font-size: 14px;
    padding: var(--space-1);
  }

  .close:hover {
    color: var(--dc-text-primary);
  }
</style>
