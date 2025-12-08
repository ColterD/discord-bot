# Dashboard API Documentation

All API endpoints require authentication via session cookie unless noted as **Public**.

## Authentication

The dashboard uses Discord OAuth2 for authentication. Sessions are stored in Valkey (with in-memory fallback) and identified by a `dashboard_session` cookie.

### Auth Flow

1. User visits `/login`
2. Redirect to Discord OAuth2 (`/auth/discord`)
3. Discord redirects back to `/auth/callback` with code
4. Server exchanges code for tokens, creates session
5. User redirected to `/` (dashboard)

### Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/auth/discord` | GET | No | Initiates Discord OAuth2 flow |
| `/auth/callback` | GET | No | Handles OAuth2 callback |
| `/auth/logout` | GET | Yes | Clears session and redirects to login |

---

## Containers

### List Containers

```
GET /api/containers
```

Returns all containers in the Discord bot Docker stack.

**Response:**
```json
[
  {
    "id": "abc123...",
    "name": "discord-bot",
    "image": "ghcr.io/colterd/discord-bot:latest",
    "state": "running",
    "status": "Up 2 hours",
    "cpu": 2.5,
    "memory": {
      "used": 256000000,
      "limit": 4294967296,
      "percent": 5.96
    },
    "ports": ["3000/tcp -> 3000"]
  }
]
```

### Start Container

```
POST /api/containers/{name}/start
```

Starts a stopped container by name.

**Response:**
```json
{ "success": true }
```

### Stop Container

```
POST /api/containers/{name}/stop
```

Stops a running container by name.

### Restart Container

```
POST /api/containers/{name}/restart
```

Restarts a container by name.

### Container Logs

```
GET /api/containers/{name}/logs?tail=100
```

Returns recent logs from a container.

**Query Parameters:**
- `tail` (optional): Number of lines (default: 100)

**Response:**
```json
{
  "logs": "[2024-01-15T12:00:00Z] Bot started...\n..."
}
```

---

## GPU

### Get GPU Status

```
GET /api/gpu
```

Returns GPU/VRAM information, loaded models, and service health.

**Response:**
```json
{
  "vram": {
    "total": 24576,
    "used": 8192,
    "free": 16384
  },
  "loadedModels": [
    {
      "name": "qwen2.5:72b",
      "size": 42949672960,
      "vram": 8192
    }
  ],
  "ollamaStatus": "online",
  "comfyuiStatus": "online"
}
```

---

## Metrics

### Get All Metrics

```
GET /api/metrics
```

Returns system metrics and per-container metrics with history.

**Response:**
```json
{
  "system": {
    "cpu": [
      { "timestamp": 1705320000000, "value": 15.2 }
    ],
    "memory": [
      { "timestamp": 1705320000000, "value": 42.1 }
    ]
  },
  "containers": [
    {
      "containerId": "abc123",
      "containerName": "discord-bot",
      "cpu": 2.5,
      "memoryPercent": 5.96,
      "memoryUsed": 256000000,
      "timestamp": 1705320000000
    }
  ],
  "lastUpdate": 1705320000000
}
```

### Get History Only

```
GET /api/metrics?type=history
```

Returns only the rolling 10-minute history of system metrics.

### Get Container Metrics Only

```
GET /api/metrics?type=containers
```

Returns only current container resource usage.

---

## Settings

### Get Settings

```
GET /api/settings
```

Returns bot configuration settings organized by category. Sensitive values are masked.

**Response:**
```json
{
  "categories": [
    {
      "id": "ai",
      "name": "AI / LLM",
      "icon": "brain",
      "description": "Language model and AI settings",
      "settings": [
        {
          "key": "OLLAMA_HOST",
          "label": "Ollama Host",
          "description": "URL of the Ollama API server",
          "type": "string",
          "value": "http://ollama:11434",
          "defaultValue": "http://ollama:11434"
        },
        {
          "key": "DISCORD_TOKEN",
          "label": "Bot Token",
          "type": "secret",
          "value": "****...****",
          "sensitive": true
        }
      ]
    }
  ]
}
```

**Setting Types:**
- `string`: Plain text value
- `number`: Numeric value
- `boolean`: true/false toggle
- `secret`: Masked sensitive value (read-only)
- `select`: Dropdown with predefined options

---

## Cloudflare

### Health Check (Public)

```
GET /api/cloudflare/health
```

**No authentication required.** Checks Cloudflare Workers AI availability.

**Response:**
```json
{
  "available": true,
  "routerModel": "@cf/ibm-granite/granite-4.0-h-micro",
  "embeddingModel": "@cf/qwen/qwen3-embedding-0.6b",
  "configured": true,
  "usingWorker": true,
  "datacenter": "SEA (Seattle)",
  "latencyMs": 45
}
```

**Fields:**
- `available`: Whether the service is reachable
- `configured`: Whether credentials are set
- `usingWorker`: Whether using edge Worker (faster) or REST API
- `datacenter`: Cloudflare datacenter serving the request
- `latencyMs`: Round-trip latency

---

## Error Responses

All errors return JSON with an `error` field:

```json
{
  "error": "Unauthorized"
}
```

**Status Codes:**
- `401 Unauthorized`: Missing or invalid session
- `404 Not Found`: Resource doesn't exist
- `500 Internal Server Error`: Server-side failure

---

## WebSocket (Planned)

Future implementation will add WebSocket support at `/ws` for real-time updates:

- Container state changes
- Resource usage streaming
- Log tailing
