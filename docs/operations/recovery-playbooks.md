# Recovery Playbooks

> Self-healing procedures for all services in the Discord Bot infrastructure.

This document serves as a reference for the self-healing infrastructure. Each playbook defines:

- **Symptoms**: How to detect the issue
- **Auto-Recovery**: Steps the system attempts automatically
- **Manual Fix**: What to do if auto-recovery fails
- **Claude Prompt**: Copy-paste prompt for complex debugging

---

## Table of Contents

1. [Ollama Issues](#ollama-issues)
2. [ChromaDB Issues](#chromadb-issues)
3. [Valkey Issues](#valkey-issues)
4. [ComfyUI Issues](#comfyui-issues)
5. [Discord Bot Issues](#discord-bot-issues)
6. [Network Issues](#network-issues)

---

## Ollama Issues

### OOM (Out of Memory) Kill

**Symptoms**:

- Health check fails with connection refused
- Container status: `Exited (137)` or `OOMKilled: true`
- Logs show: `signal: killed` or memory allocation errors

**Auto-Recovery**:

1. Call `POST /api/generate` with `keep_alive: 0` to unload models
2. Wait 5 seconds for memory release
3. Restart container: `docker restart ollama`
4. Verify health: `GET /api/tags`

**Manual Fix**:

```bash
# Check if OOM killed
docker inspect ollama | grep -A 5 "OOMKilled"

# Force restart with memory cleanup
docker stop ollama
docker rm ollama
docker compose up -d ollama

# If persistent, reduce model size in .env
# OLLAMA_MODEL=qwen3:8b  # Instead of 14b
```

**Claude Prompt**:

```
My Discord bot's Ollama container keeps getting OOM killed.
System specs: [GPU MODEL], [VRAM]GB VRAM, [RAM]GB system RAM
Running model: [MODEL_NAME]
Docker memory limit: [LIMIT or "none"]
Last error logs:
[PASTE LAST 20 LINES OF docker logs ollama]

What's causing the OOM and how do I prevent it? Consider:
1. Model quantization options
2. Context length reduction
3. Docker memory settings
4. num_gpu layers configuration
```

---

### Model Load Failure

**Symptoms**:

- `GET /api/tags` returns empty or missing expected model
- Generation requests return "model not found"
- Logs show: `error loading model` or `file not found`

**Auto-Recovery**:

1. List available models: `GET /api/tags`
2. If model missing, attempt pull: `POST /api/pull {"name": "model"}`
3. Wait for pull completion (check progress)
4. Retry health check

**Manual Fix**:

```bash
# Check available models
curl http://localhost:11434/api/tags

# Re-pull the model
curl -X POST http://localhost:11434/api/pull -d '{"name": "qwen3:14b"}'

# Check Ollama storage space
docker exec ollama df -h /root/.ollama
```

---

### Slow Response / Timeout

**Symptoms**:

- Health check succeeds but generation times out
- Logs show generation starting but not completing
- High GPU utilization stuck at 100%

**Auto-Recovery**:

1. Cancel any running generations (if API supports)
2. Unload all models: `POST /api/generate {"keep_alive": 0}`
3. Wait 10 seconds
4. Reload primary model with reduced context

**Manual Fix**:

```bash
# Check GPU status
nvidia-smi

# Check for stuck processes
docker exec ollama ps aux

# Force model unload
curl -X POST http://localhost:11434/api/generate \
  -d '{"model": "qwen3:14b", "keep_alive": 0}'

# Restart with fresh state
docker restart ollama
```

---

## ChromaDB Issues

### Connection Refused

**Symptoms**:

- Health check to `/api/v2/heartbeat` fails
- Bot logs: `ChromaDB connection failed`
- Container running but not accepting connections

**Auto-Recovery**:

1. Check container status
2. Restart container: `docker restart chromadb`
3. Wait 10 seconds for initialization
4. Verify heartbeat endpoint

**Manual Fix**:

```bash
# Check container logs
docker logs chromadb --tail 50

# Check if port is bound
netstat -tlnp | grep 8000

# Full restart
docker compose restart chromadb
```

---

### Collection Corruption

**Symptoms**:

- Queries return unexpected errors
- `get` or `query` operations fail with internal errors
- Logs show SQLite or persistence errors

**Auto-Recovery**:

1. Attempt collection list to verify connectivity
2. If specific collection fails, log for manual intervention
3. Do NOT auto-delete data - escalate to owner

**Manual Fix**:

```bash
# Backup current data first!
docker cp chromadb:/chroma/chroma ./chroma-backup-$(date +%Y%m%d)

# Check collection health via API
curl http://localhost:8000/api/v2/collections

# If corrupted, may need to restore from backup
# or rebuild embeddings from source data
```

---

## Valkey Issues

### Connection Refused

**Symptoms**:

- `PING` command fails
- Bot logs: `Valkey connection error`
- BullMQ jobs not processing

**Auto-Recovery**:

1. Check container status
2. Restart container: `docker restart valkey`
3. Wait 5 seconds
4. Verify `PING` returns `PONG`

**Manual Fix**:

```bash
# Check container
docker logs valkey --tail 30

# Test connection manually
docker exec valkey valkey-cli PING

# Check memory usage
docker exec valkey valkey-cli INFO memory
```

---

### Memory Full

**Symptoms**:

- Write operations fail
- Logs show: `OOM command not allowed`
- `INFO memory` shows used_memory near maxmemory

**Auto-Recovery**:

1. Check memory usage via `INFO memory`
2. If >90%, trigger key eviction (if policy allows)
3. Clear expired keys: `SCAN` + `TTL` check
4. Restart if still full

**Manual Fix**:

```bash
# Check memory status
docker exec valkey valkey-cli INFO memory

# Check largest keys
docker exec valkey valkey-cli --bigkeys

# Clear specific patterns (careful!)
docker exec valkey valkey-cli KEYS "temp:*" | xargs docker exec valkey valkey-cli DEL

# Increase memory limit in docker-compose.yml
```

---

## ComfyUI Issues

### GPU Not Available

**Symptoms**:

- `/system_stats` shows no CUDA devices
- Generation fails immediately
- Logs show: `CUDA not available` or `No GPU detected`

**Auto-Recovery**:

1. Check if nvidia-docker runtime is working
2. Restart container with GPU reset
3. Verify GPU visibility after restart

**Manual Fix**:

```bash
# Check GPU from host
nvidia-smi

# Check if container sees GPU
docker exec comfyui nvidia-smi

# Reset GPU (may affect other containers!)
sudo nvidia-smi --gpu-reset

# Restart with fresh GPU state
docker compose restart comfyui
```

---

### VRAM Exhaustion

**Symptoms**:

- Generation starts but fails mid-process
- Logs show: `CUDA out of memory`
- `nvidia-smi` shows near 100% VRAM usage

**Auto-Recovery**:

1. Unload all models: `POST /free {"unload_models": true, "free_memory": true}`
2. If Ollama running, unload its models too
3. Wait 10 seconds for memory release
4. Retry generation

**Manual Fix**:

```bash
# Check VRAM usage
nvidia-smi

# Force unload ComfyUI models
curl -X POST http://localhost:8188/free \
  -H "Content-Type: application/json" \
  -d '{"unload_models": true, "free_memory": true}'

# Force unload Ollama models
curl -X POST http://localhost:11434/api/generate \
  -d '{"model": "qwen3:14b", "keep_alive": 0}'

# If still stuck, restart both
docker restart comfyui ollama
```

---

## Discord Bot Issues

### Bot Offline

**Symptoms**:

- Bot shows offline in Discord
- Health check endpoint not responding
- Container running but no activity in logs

**Auto-Recovery**:

1. Check container status
2. Check if process is running inside container
3. Restart container
4. Verify Discord gateway connection in logs

**Manual Fix**:

```bash
# Check container status
docker ps -a | grep discord-bot

# Check recent logs
docker logs discord-bot --tail 100

# Check for crash loops
docker inspect discord-bot | grep -A 10 "RestartCount"

# Restart
docker compose restart discord-bot
```

---

### Rate Limited by Discord

**Symptoms**:

- Logs show: `429 Too Many Requests`
- Bot responds intermittently
- Some commands fail silently

**Auto-Recovery**:

1. Log the rate limit, do not restart (will make it worse)
2. Wait for rate limit window to expire
3. Notify owner if persistent (>5 minutes)

**Manual Fix**:

```bash
# Check logs for rate limit info
docker logs discord-bot 2>&1 | grep -i "rate"

# The bot should auto-recover after the rate limit window
# If persistent, check for bugs causing spam
```

---

## Network Issues

### Container Network Isolation

**Symptoms**:

- Containers can't reach each other by name
- `ping ollama` from bot container fails
- Services work individually but not together

**Auto-Recovery**:

1. Check Docker network exists
2. Verify all containers on same network
3. Restart Docker networking (escalate to owner)

**Manual Fix**:

```bash
# Check networks
docker network ls

# Check which containers are on the network
docker network inspect discord-bot_default

# Reconnect a container to network
docker network connect discord-bot_default ollama

# Nuclear option - recreate network
docker compose down
docker compose up -d
```

---

## Recovery Priority Order

When multiple services are down, recover in this order:

1. **Valkey** - Other services depend on it for caching/queuing
2. **ChromaDB** - Memory system needs this
3. **Ollama** - Core LLM functionality
4. **ComfyUI** - Image generation (optional)
5. **Discord Bot** - Will auto-reconnect when dependencies are up

---

## Escalation Thresholds

| Scenario                  | Auto-Recovery Attempts | Escalate After            |
| ------------------------- | ---------------------- | ------------------------- |
| Single service down       | 3 attempts             | 5 minutes total           |
| Multiple services down    | 2 attempts each        | 3 minutes total           |
| GPU issues                | 1 attempt              | Immediately after failure |
| Data corruption suspected | 0 attempts             | Immediately               |
| Rate limiting             | 0 attempts             | 5 minutes of limits       |

---

## Adding New Playbooks

When adding a new recovery playbook, include:

1. **Service Name** and **Issue Title**
2. **Symptoms**: How the health monitor detects this
3. **Auto-Recovery**: Steps in order, with wait times
4. **Manual Fix**: Commands the owner can run
5. **Claude Prompt**: Template with placeholders for dynamic data

The self-healing system reads these playbooks to determine recovery steps.
