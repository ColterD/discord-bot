# ADR-002: SvelteKit Dashboard

**Status**: Proposed
**Date**: December 2025

## Context

The dashboard is currently implemented as:

- **Backend**: Express.js server (`dashboard/server.js`)
- **Frontend**: Vanilla HTML/CSS/JS (`dashboard/public/`)
- **Real-time**: WebSocket for live updates
- **Features**: Container management, GPU monitoring, logs, metrics

## Decision

Migrate to **SvelteKit** for full-stack dashboard.

## Rationale

### Why SvelteKit?

1. **Performance**: Compiled output, no virtual DOM
2. **Full-stack**: Server routes replace Express
3. **TypeScript**: Native support
4. **SSR/SSG**: Flexible rendering options
5. **File-based routing**: Intuitive structure
6. **Discord UI patterns**: Component-based like Discord's React

## Target Architecture

### Component Structure

```
src/
├── lib/
│   ├── components/
│   │   ├── ui/               # Reusable UI primitives
│   │   │   ├── Button.svelte
│   │   │   ├── Card.svelte
│   │   │   ├── Badge.svelte
│   │   │   └── Toast.svelte
│   │   ├── layout/           # Layout components
│   │   │   ├── Header.svelte
│   │   │   ├── Sidebar.svelte
│   │   │   └── MainContent.svelte
│   │   ├── containers/       # Container management
│   │   │   ├── ContainerCard.svelte
│   │   │   ├── ContainerList.svelte
│   │   │   └── ContainerActions.svelte
│   │   ├── gpu/              # GPU monitoring
│   │   │   ├── GpuStatus.svelte
│   │   │   └── VramChart.svelte
│   │   └── logs/             # Log viewing
│   │       └── LogViewer.svelte
│   ├── stores/               # Svelte stores
│   │   ├── containers.ts
│   │   ├── gpu.ts
│   │   └── websocket.ts
│   ├── api/                  # API client
│   │   └── docker.ts
│   └── types/                # TypeScript types
│       └── index.ts
├── routes/
│   ├── +layout.svelte        # Root layout
│   ├── +page.svelte          # Dashboard home
│   ├── api/                  # API routes
│   │   ├── containers/
│   │   ├── gpu/
│   │   └── logs/
│   └── logs/
│       └── +page.svelte      # Full-page log viewer
└── app.css                   # Global styles (Discord theme)
```

### Discord-like Styling

```css
:root {
  /* Discord Color Palette */
  --dc-bg-primary: #36393f;
  --dc-bg-secondary: #2f3136;
  --dc-bg-tertiary: #202225;
  --dc-text-primary: #dcddde;
  --dc-text-secondary: #b9bbbe;
  --dc-text-muted: #72767d;
  --dc-accent: #5865f2;
  --dc-accent-hover: #4752c4;
  --dc-green: #3ba55d;
  --dc-yellow: #faa81a;
  --dc-red: #ed4245;

  /* Spacing (Discord uses 4px grid) */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;

  /* Border radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 16px;
}
```

### WebSocket Integration

```typescript
// src/lib/stores/websocket.ts
import { writable } from "svelte/store";

function createWebSocketStore() {
  const { subscribe, set, update } = writable<{
    connected: boolean;
    messages: Message[];
  }>({
    connected: false,
    messages: [],
  });

  let ws: WebSocket | null = null;

  function connect() {
    ws = new WebSocket(`ws://${window.location.host}`);

    ws.onopen = () => update((s) => ({ ...s, connected: true }));
    ws.onclose = () => update((s) => ({ ...s, connected: false }));
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      update((s) => ({ ...s, messages: [...s.messages, data] }));
    };
  }

  return {
    subscribe,
    connect,
    disconnect: () => ws?.close(),
  };
}
```

## API Routes Migration

Express endpoints → SvelteKit server routes:

| Current File             | SvelteKit Location                     |
| ------------------------ | -------------------------------------- |
| `server.js` (containers) | `src/routes/api/containers/+server.ts` |
| `server.js` (gpu)        | `src/routes/api/gpu/+server.ts`        |
| `server.js` (logs)       | `src/routes/api/logs/+server.ts`       |
| `public/index.html`      | `src/routes/+page.svelte`              |
| `public/styles.css`      | `src/app.css`                          |
| `public/app.js`          | Split into Svelte components           |

## Dependencies

```json
{
  "devDependencies": {
    "@sveltejs/adapter-node": "^5.0.0",
    "@sveltejs/kit": "^2.0.0",
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "svelte": "^5.0.0",
    "typescript": "^5.0.0",
    "vite": "^6.0.0"
  },
  "dependencies": {
    "dockerode": "^4.0.0"
  }
}
```

## Implementation Priority

1. **Project scaffold** - Create SvelteKit project structure
2. **Docker API routes** - Port container management
3. **GPU monitoring** - Real-time VRAM display
4. **Log streaming** - WebSocket-based log viewer
5. **Discord styling** - Theme and component library

## Verification Checklist

- [ ] All container management functions work
- [ ] GPU status displays correctly
- [ ] Log streaming works via WebSocket
- [ ] Discord-like UI theme applied
- [ ] TypeScript types for all API responses
- [ ] Error handling and loading states
- [ ] Mobile-responsive layout

## Alternatives Considered

### Keep Express + Vanilla JS

**Pros**: No migration effort
**Cons**: No TypeScript, harder to maintain, no component reuse

### React/Next.js

**Pros**: Popular, lots of resources
**Cons**: Heavier runtime, more complex setup

### Vue/Nuxt

**Pros**: Similar to Svelte in philosophy
**Cons**: Less familiar, larger bundle size

## Consequences

### Positive

- TypeScript throughout
- Component-based architecture
- Faster development with hot reload
- Better code organization
- Smaller bundle size

### Negative

- Migration effort required
- Team needs to learn SvelteKit
- Two different runtimes (bot is Node, dashboard is SvelteKit)

## Status

**Proposed** - Awaiting user approval before implementation.
