<script lang="ts">
  import { page } from '$app/state';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';

  const statusMessages: Record<number, { title: string; description: string }> = {
    400: { title: 'Bad Request', description: 'The request could not be understood.' },
    401: { title: 'Unauthorized', description: 'You need to log in to access this page.' },
    403: { title: 'Forbidden', description: 'You do not have permission to access this page.' },
    404: { title: 'Not Found', description: 'The page you are looking for does not exist.' },
    500: { title: 'Server Error', description: 'Something went wrong on our end.' },
    502: { title: 'Bad Gateway', description: 'The server received an invalid response.' },
    503: { title: 'Service Unavailable', description: 'The service is temporarily unavailable.' }
  };

  const info = $derived(statusMessages[page.status] ?? {
    title: 'Error',
    description: page.error?.message ?? 'An unexpected error occurred.'
  });
</script>

<svelte:head>
  <title>{page.status} - {info.title} | Discord Bot Dashboard</title>
</svelte:head>

<div class="error-container">
  <Card>
    <div class="error-content">
      <div class="error-code">{page.status}</div>

      <h1 class="error-title">{info.title}</h1>

      <p class="error-description">
        {#if page.error?.message && page.error.message !== info.description}
          {page.error.message}
        {:else}
          {info.description}
        {/if}
      </p>

      <div class="error-actions">
        <a href="/">
          <Button variant="primary">
            Go to Dashboard
          </Button>
        </a>

        <Button variant="secondary" onclick={() => history.back()}>
          Go Back
        </Button>
      </div>

      {#if page.error?.errorId}
        <p class="error-id">Error ID: <code>{page.error.errorId}</code></p>
      {/if}
    </div>
  </Card>
</div>

<style>
  .error-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: calc(100vh - 64px);
    padding: var(--space-4);
  }

  .error-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: var(--space-6);
    max-width: 500px;
  }

  .error-code {
    font-size: 6rem;
    font-weight: 800;
    line-height: 1;
    background: linear-gradient(135deg, var(--dc-red) 0%, var(--dc-red-light) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: var(--space-2);
  }

  .error-title {
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--dc-text-primary);
    margin: 0 0 var(--space-3);
  }

  .error-description {
    color: var(--dc-text-secondary);
    margin: 0 0 var(--space-5);
    line-height: 1.6;
  }

  .error-actions {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    justify-content: center;
  }

  .error-id {
    margin-top: var(--space-5);
    font-size: 0.75rem;
    color: var(--dc-text-muted);
  }

  .error-id code {
    font-family: var(--font-mono);
    background: var(--dc-darker);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
  }
</style>
