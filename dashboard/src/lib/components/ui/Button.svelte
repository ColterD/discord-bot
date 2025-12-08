<script lang="ts">
  import type { Snippet } from 'svelte';

  type Variant = 'primary' | 'secondary' | 'success' | 'danger' | 'danger-outline' | 'warning' | 'ghost' | 'outline';
  type Size = 'xs' | 'sm' | 'md' | 'lg';

  interface Props {
    variant?: Variant;
    size?: Size;
    disabled?: boolean;
    loading?: boolean;
    fullWidth?: boolean;
    icon?: boolean;
    onclick?: () => void;
    children?: Snippet;
  }

  const {
    variant = 'secondary',
    size = 'md',
    disabled = false,
    loading = false,
    fullWidth = false,
    icon = false,
    onclick,
    children
  }: Props = $props();
</script>

<button
  type="button"
  class="btn btn-{variant} btn-{size}"
  class:loading
  class:full-width={fullWidth}
  class:icon-only={icon}
  disabled={disabled || loading}
  {onclick}
>
  {#if loading}
    <span class="spinner"></span>
  {/if}
  <span class="content" class:hidden={loading}>
    {#if children}
      {@render children()}
    {/if}
  </span>
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: none;
    border-radius: var(--radius-md);
    font-weight: 600;
    font-family: inherit;
    position: relative;
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
    transition:
      transform 0.15s cubic-bezier(0.4, 0, 0.2, 1),
      box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      background 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
      opacity 0.15s ease;
  }

  .btn::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .btn:hover:not(:disabled)::before {
    opacity: 1;
  }

  .btn:hover:not(:disabled) {
    transform: translateY(-2px);
  }

  .btn:active:not(:disabled) {
    transform: translateY(0) scale(0.98);
  }

  .btn:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
  }

  .btn.full-width {
    width: 100%;
  }

  .content {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    z-index: 1;
  }

  .content.hidden {
    opacity: 0;
  }

  /* Sizes */
  .btn-xs {
    padding: 4px 8px;
    font-size: 11px;
    border-radius: var(--radius-sm);
    gap: 4px;
  }

  .btn-sm {
    padding: 6px 14px;
    font-size: 12px;
    border-radius: var(--radius-sm);
  }

  .btn-md {
    padding: 10px 20px;
    font-size: 13px;
    letter-spacing: 0.01em;
  }

  .btn-lg {
    padding: 14px 28px;
    font-size: 15px;
  }

  /* Icon-only buttons */
  .icon-only.btn-xs {
    padding: 4px;
    width: 24px;
    height: 24px;
  }

  .icon-only.btn-sm {
    padding: 6px;
    width: 28px;
    height: 28px;
  }

  .icon-only.btn-md {
    padding: 8px;
    width: 36px;
    height: 36px;
  }

  .icon-only.btn-lg {
    padding: 10px;
    width: 44px;
    height: 44px;
  }

  /* Primary Variant - Gradient with glow */
  .btn-primary {
    background: var(--gradient-primary);
    color: white;
    box-shadow:
      0 2px 8px rgba(99, 102, 241, 0.25),
      0 1px 2px rgba(0, 0, 0, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }

  .btn-primary::before {
    background: linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.15) 0%,
      rgba(255, 255, 255, 0) 100%
    );
  }

  .btn-primary:hover:not(:disabled) {
    box-shadow:
      0 4px 20px rgba(99, 102, 241, 0.4),
      0 2px 4px rgba(0, 0, 0, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.15);
  }

  .btn-primary:active:not(:disabled) {
    box-shadow:
      0 1px 4px rgba(99, 102, 241, 0.3),
      inset 0 1px 2px rgba(0, 0, 0, 0.1);
  }

  /* Secondary Variant - Glass morphism */
  .btn-secondary {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--text-primary);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  .btn-secondary::before {
    background: linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.08) 0%,
      rgba(255, 255, 255, 0) 100%
    );
  }

  .btn-secondary:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.18);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  }

  .btn-secondary:active:not(:disabled) {
    background: rgba(255, 255, 255, 0.03);
  }

  /* Outline Variant - Clean border style */
  .btn-outline {
    background: transparent;
    border: 1.5px solid var(--primary);
    color: var(--primary);
  }

  .btn-outline::before {
    background: var(--primary);
  }

  .btn-outline:hover:not(:disabled) {
    background: var(--primary);
    color: white;
    box-shadow: 0 4px 16px rgba(99, 102, 241, 0.3);
  }

  .btn-outline:hover:not(:disabled)::before {
    opacity: 0;
  }

  /* Ghost Variant - Subtle but visible */
  .btn-ghost {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--text-secondary);
  }

  .btn-ghost::before {
    background: rgba(255, 255, 255, 0.08);
    border-radius: inherit;
  }

  .btn-ghost:hover:not(:disabled) {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .btn-ghost:active:not(:disabled) {
    background: rgba(255, 255, 255, 0.06);
  }

  /* Success Variant */
  .btn-success {
    background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
    color: white;
    box-shadow:
      0 2px 8px rgba(34, 197, 94, 0.25),
      0 1px 2px rgba(0, 0, 0, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }

  .btn-success::before {
    background: linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.15) 0%,
      rgba(255, 255, 255, 0) 100%
    );
  }

  .btn-success:hover:not(:disabled) {
    box-shadow:
      0 4px 20px rgba(34, 197, 94, 0.4),
      0 2px 4px rgba(0, 0, 0, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.15);
  }

  /* Danger Variant */
  .btn-danger {
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    color: white;
    box-shadow:
      0 2px 8px rgba(239, 68, 68, 0.25),
      0 1px 2px rgba(0, 0, 0, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }

  .btn-danger::before {
    background: linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.15) 0%,
      rgba(255, 255, 255, 0) 100%
    );
  }

  .btn-danger:hover:not(:disabled) {
    box-shadow:
      0 4px 20px rgba(239, 68, 68, 0.4),
      0 2px 4px rgba(0, 0, 0, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.15);
  }

  /* Danger Outline Variant - Subtle destructive action */
  .btn-danger-outline {
    background: transparent;
    border: 1px solid rgba(239, 68, 68, 0.4);
    color: #f87171;
  }

  .btn-danger-outline::before {
    background: rgba(239, 68, 68, 0.1);
    border-radius: inherit;
  }

  .btn-danger-outline:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.6);
    color: #fca5a5;
  }

  .btn-danger-outline:active:not(:disabled) {
    background: rgba(239, 68, 68, 0.15);
  }

  /* Warning Variant */
  .btn-warning {
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    color: #0a0a0f;
    box-shadow:
      0 2px 8px rgba(245, 158, 11, 0.25),
      0 1px 2px rgba(0, 0, 0, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
  }

  .btn-warning::before {
    background: linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.2) 0%,
      rgba(255, 255, 255, 0) 100%
    );
  }

  .btn-warning:hover:not(:disabled) {
    box-shadow:
      0 4px 20px rgba(245, 158, 11, 0.4),
      0 2px 4px rgba(0, 0, 0, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.25);
  }

  /* Loading spinner */
  .spinner {
    position: absolute;
    width: 16px;
    height: 16px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  .btn-sm .spinner,
  .btn-xs .spinner {
    width: 12px;
    height: 12px;
    border-width: 1.5px;
  }

  .btn-lg .spinner {
    width: 20px;
    height: 20px;
    border-width: 2.5px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
