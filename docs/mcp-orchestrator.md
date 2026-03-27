# Architecture MCP Orchestrateur

Ce document explique comment les agents Claude Code (Super Agents / orchestrateurs) communiquent avec d'autres agents dans Dorotoring.

## Vue d'ensemble — les 4 couches

```
┌─────────────────────────────────────────────────────────────┐
│  Dorotoring (Tauri/Rust)                                    │
│  ┌──────────────────────┐  ┌──────────────────────────────┐ │
│  │  Tauri IPC Commands  │  │  HTTP API Server (Axum)      │ │
│  │  orchestrator.rs     │  │  127.0.0.1:31415             │ │
│  └──────────────────────┘  └──────────────────────────────┘ │
│         │ écrit                        ↑                     │
│         ↓                              │ REST + long-poll    │
│   ~/.claude/mcp.json          PTY Manager (pty.rs)          │
└─────────────────────────────────────────────────────────────┘
                                         │ spawn PTY
┌────────────────────────────────────────↓────────────────────┐
│  Super Agent (Claude Code process)                          │
│  claude --mcp-config ~/.claude/mcp.json                     │
│         --append-system-prompt-file ...                     │
│              ↕ stdio (protocole MCP)                        │
│  MCP Orchestrator Server (Node.js subprocess)               │
│              ↕ HTTP 127.0.0.1:31415                         │
└─────────────────────────────────────────────────────────────┘
                                         │ delegate_task()
┌────────────────────────────────────────↓────────────────────┐
│  Sub-Agent A (PTY)     Sub-Agent B (PTY)     ...            │
│  claude ...            claude ...                           │
└─────────────────────────────────────────────────────────────┘
```

**Résumé du flux :**
1. Dorotoring écrit `~/.claude/mcp.json` pour enregistrer le serveur MCP
2. Le Super Agent est lancé avec `--mcp-config` → Claude Code démarre le serveur MCP en subprocess
3. Le Super Agent appelle les outils MCP pour orchestrer d'autres agents
4. Le serveur MCP traduit ces appels en requêtes HTTP vers l'API REST Rust
5. L'API Rust spawne des PTY, gère les statuts, répond au long-poll

---

## Étape 1 — Setup : écriture du `mcp.json`

**Fichier :** `src-tauri/src/commands/orchestrator.rs`

Trois commandes Tauri IPC gèrent le cycle de vie :

| Commande | Rôle |
|---|---|
| `orchestrator_get_status` | Vérifie si `claude-mgr-orchestrator` est dans `~/.claude/mcp.json` |
| `orchestrator_setup` | Enregistre l'entrée MCP dans `~/.claude/mcp.json` |
| `orchestrator_remove` | Supprime l'entrée MCP |

`orchestrator_setup` écrit ceci dans `~/.claude/mcp.json` (ligne 119) :

```rust
config["mcpServers"]["claude-mgr-orchestrator"] = serde_json::json!({
    "command": "node",
    "args": [bundle_path.to_string_lossy().to_string()]
});
```

Résultat dans `~/.claude/mcp.json` :

```json
{
  "mcpServers": {
    "claude-mgr-orchestrator": {
      "command": "node",
      "args": ["/path/to/Dorotoring/mcp-orchestrator/dist/bundle.js"]
    }
  }
}
```

**Résolution du chemin du bundle** (lignes 14–51) :
1. Variable d'env `DOROTORING_MCP_BUNDLE` (dev override)
2. Relatif à l'exécutable (production, remonte 6 niveaux)
3. Fallback : `~/projects/Dorotoring/mcp-orchestrator/dist/bundle.js`

---

## Étape 2 — Lancement du Super Agent

**Fichier :** `src-tauri/src/api_server.rs`, fonction `build_cli_command` (ligne 514)

Quand un agent a `is_super_agent = true`, la commande CLI reçoit deux flags supplémentaires :

```rust
// api_server.rs:536-548
if agent.is_super_agent {
    // Flag 1 : charge le serveur MCP
    cmd_parts.push("--mcp-config".into());
    cmd_parts.push(mcp_config.to_string_lossy().to_string()); // ~/.claude/mcp.json

    // Flag 2 : injecte les instructions d'orchestration dans le system prompt
    cmd_parts.push("--append-system-prompt-file".into());
    cmd_parts.push(instructions_path.to_string_lossy().to_string()); // ~/.dorotoring/super-agent-instructions.md
}
```

Commande finale envoyée au PTY :

```bash
claude --dangerously-skip-permissions \
  --mcp-config ~/.claude/mcp.json \
  --append-system-prompt-file ~/.dorotoring/super-agent-instructions.md \
  --print 'ta tâche...'
```

Le fichier `super-agent-instructions.md` est embarqué dans le binaire Rust via `include_str!` et écrit sur disque au démarrage (`lib.rs:17-28`).

---

## Étape 3 — Le serveur MCP (Node.js)

**Fichier :** `mcp-orchestrator/src/index.ts`

C'est un processus Node.js lancé **en subprocess par Claude Code** via stdio (protocole MCP). Il ne tourne pas en daemon — il démarre quand Claude Code démarre et s'arrête avec lui.

```typescript
// mcp-orchestrator/src/index.ts
const server = new McpServer({ name: "claude-mgr-orchestrator", version: "1.0.0" });

registerAgentTools(server);      // 9 outils de gestion d'agents
registerMessagingTools(server);  // telegram, slack
registerSchedulerTools(server);  // cron jobs (launchd/cron natif)
registerAutomationTools(server); // github PRs/issues, jira

const transport = new StdioServerTransport();
await server.connect(transport); // communication Claude Code ↔ MCP via stdin/stdout
```

Le client HTTP partagé par tous les outils :

```typescript
// mcp-orchestrator/src/utils/api.ts
const API_URL = process.env.CLAUDE_MGR_API_URL || "http://127.0.0.1:31415";

export async function apiRequest(endpoint, method = "GET", body?) {
  const token = fs.readFileSync("~/.dorotoring/api-token").trim(); // token Bearer
  const isLongPoll = endpoint.includes("/wait");
  const timeoutMs = isLongPoll ? 600_000 : 30_000; // 10 min pour long-poll

  const response = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return response.json();
}
```

---

## Étape 4 — Les outils MCP disponibles

**Fichier :** `mcp-orchestrator/src/tools/agents.ts`

| Outil | Endpoint HTTP | Description |
|---|---|---|
| `list_agents` | `GET /api/agents` | Liste tous les agents et leurs statuts |
| `get_agent` | `GET /api/agents/{id}` | Détails complets d'un agent |
| `get_agent_output` | `GET /api/agents/{id}` → `lastCleanOutput` | Output propre (sans ANSI) capturé par les hooks |
| `create_agent` | `POST /api/agents` | Crée un agent en état `idle` |
| `start_agent` | `POST /api/agents/{id}/start` | Démarre un agent avec un prompt |
| `stop_agent` | `POST /api/agents/{id}/stop` | Arrête un agent (kill PTY) |
| `send_message` | `POST /api/agents/{id}/message` | Envoie du texte dans le PTY |
| `wait_for_agent` | `GET /api/agents/{id}/wait` | Long-poll jusqu'à fin de tâche |
| `delegate_task` | start + wait + get_output | **Outil principal** — délègue et attend le résultat |

### `delegate_task` — le pattern principal

```typescript
// agents.ts:466-573
async ({ id, prompt, model, timeoutSeconds = 300 }) => {
  const { status } = await apiRequest(`/api/agents/${id}`);

  // 1. Démarre ou envoie un message selon l'état actuel
  if (status === "running" || status === "waiting") {
    await apiRequest(`/api/agents/${id}/message`, "POST", { message: prompt });
  } else {
    await apiRequest(`/api/agents/${id}/start`, "POST", { prompt, skipPermissions: true });
  }

  // 2. Long-poll efficace — bloque jusqu'au changement de statut (pas de polling actif)
  const waitData = await apiRequest(`/api/agents/${id}/wait?timeout=${timeoutSeconds}`);

  // 3. Récupère l'output propre final
  const finalAgent = await apiRequest(`/api/agents/${id}`);
  return finalAgent.agent.lastCleanOutput;
}
```

### Logique de `send_message`

`send_message` s'adapte au statut de l'agent (agents.ts:270) :
- `idle` / `completed` / `error` → **démarre** l'agent avec le message comme prompt
- `waiting` → écrit dans le PTY (l'agent attend une réponse)
- `running` → écrit dans le PTY avec un avertissement d'interférence potentielle

---

## Étape 5 — L'API REST Rust

**Fichier :** `src-tauri/src/api_server.rs`

Serveur Axum sur `127.0.0.1:31415`, démarré au lancement de l'app (`lib.rs:67-74`).

### Routes

```
GET    /api/health                → health check (sans auth)
GET    /api/agents                → liste les agents
POST   /api/agents                → crée un agent
GET    /api/agents/{id}           → détails + lastCleanOutput
GET    /api/agents/{id}/wait      → long-poll (attend changement de statut)
POST   /api/agents/{id}/start     → spawn PTY + envoie commande claude
POST   /api/agents/{id}/stop      → kill PTY
POST   /api/agents/{id}/message   → écrit dans le PTY (stdin)
DELETE /api/agents/{id}           → supprime l'agent

POST   /api/hooks/status          → callback Claude Code (sans auth)
POST   /api/hooks/output          → callback Claude Code (sans auth)
```

Authentification via token Bearer lu depuis `~/.dorotoring/api-token` (généré au premier démarrage).

### Long-poll `wait_for_agent`

Utilise un **broadcast channel Tokio** — aucun polling actif, retour immédiat au changement de statut :

```rust
// api_server.rs:195-260
async fn wait_for_agent(...) {
    let result = tokio::time::timeout(Duration::from_secs(timeout), async {
        let mut rx = state.app_state.status_tx.subscribe();
        loop {
            let (agent_id, status) = rx.recv().await?;
            if agent_id == id {
                match status.as_str() {
                    "completed" | "idle" | "waiting" | "error" => return Ok(...),
                    _ => continue, // ignore les transitions intermédiaires
                }
            }
        }
    }).await;
}
```

---

## Étape 6 — Les Hooks : retour de statut vers l'API

Claude Code a un système de hooks configurables qui se déclenchent à chaque changement d'état. Ces hooks font des POST vers l'API Rust pour synchroniser l'état des agents.

```
Claude Code (sub-agent)
    │ status change : running → completed
    │
    ↓ hook déclenché par Claude Code
POST /api/hooks/status
    { "agent_id": "abc123", "status": "completed" }
    │
    ↓ Rust met à jour l'état + broadcast
broadcast channel Tokio
    │
    ↓ débloque wait_for_agent
Super Agent reçoit le résultat
```

Le hook `/api/hooks/output` capture le texte propre du transcript (sans codes ANSI) et le stocke dans `agent.lastCleanOutput` — c'est ce que retourne `get_agent_output` / `delegate_task`.

---

## Flux complet : Super Agent délègue une tâche

```
Super Agent (Claude Code)
│
│  "Implémente la feature X dans /project"
│
│  [MCP tool] create_agent({ projectPath: "/project", name: "Worker" })
│      → POST /api/agents
│      ← { agent: { id: "abc123", status: "idle" } }
│
│  [MCP tool] delegate_task({ id: "abc123", prompt: "Implémente feature X" })
│      → POST /api/agents/abc123/start { prompt, skipPermissions: true }
│             Rust: spawn PTY
│             PTY: "claude --dangerously-skip-permissions --print 'Implémente feature X'"
│      → GET /api/agents/abc123/wait?timeout=300   ← bloque ici
│                                      │
│                         Sub-Agent travaille...
│                         hook → POST /api/hooks/output { lastCleanOutput: "..." }
│                         hook → POST /api/hooks/status { status: "completed" }
│                                      │ broadcast Tokio
│      ← { status: "completed", lastCleanOutput: "Feat X implémentée : ..." }
│      → GET /api/agents/abc123   (refresh lastCleanOutput final)
│
│  Reçoit le résultat, continue son raisonnement
```

---

## Tableau des fichiers clés

| Fichier | Rôle |
|---|---|
| `src-tauri/src/commands/orchestrator.rs` | Gère `~/.claude/mcp.json` (setup/remove/status) |
| `src-tauri/src/api_server.rs` | API REST Axum `:31415` + `build_cli_command` |
| `src-tauri/src/lib.rs` | Démarre l'API au boot + écrit `super-agent-instructions.md` |
| `src-tauri/src/state.rs` | État partagé des agents (fields `is_super_agent`, `lastCleanOutput`...) |
| `mcp-orchestrator/src/index.ts` | Point d'entrée du serveur MCP Node.js |
| `mcp-orchestrator/src/tools/agents.ts` | Les 9 outils MCP (list, create, delegate...) |
| `mcp-orchestrator/src/tools/scheduler.ts` | Outils de scheduling (launchd/cron) |
| `mcp-orchestrator/src/tools/automations.ts` | Intégrations GitHub/JIRA |
| `mcp-orchestrator/src/utils/api.ts` | Client HTTP vers `:31415` |
| `electron/resources/super-agent-instructions.md` | System prompt embarqué pour le Super Agent |
| `~/.claude/mcp.json` | Config MCP lue par Claude Code au démarrage |
| `~/.dorotoring/api-token` | Token Bearer partagé entre l'API et le serveur MCP |
| `~/.dorotoring/super-agent-instructions.md` | System prompt écrit sur disque au boot |
| `~/.claude/schedules.json` | Tâches planifiées (créées par `create_scheduled_task`) |
