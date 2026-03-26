# Design : Super Agent — Test-First Consolidation

**Date :** 2026-03-26
**Statut :** Approuve

---

## Contexte

Le Super Agent a une architecture 4 couches complete (Tauri IPC → API Axum :31415 → MCP Node.js → PTY sub-agents) mais n'a jamais ete teste de bout en bout. L'objectif est d'ecrire des tests bottom-up pour chaque couche, identifier ce qui casse, et consolider.

**Etat actuel :**
- API Axum operationnelle (health check OK)
- MCP bundle compile et demarre en stdio
- `~/.claude/mcp.json` configure
- Hooks installes dans `~/.claude/settings.json`
- 2 agents existent (1 super agent "Lucian", 1 normal "Annie") — jamais demarres
- Changements uncommitted : orchestrator.rs reecrit, hooks.sh implemente, ensure_hooks, debug logging — **pas compiles dans le binaire actuel**

**Approche :** Test-first, bottom-up. Ecrire les tests pour chaque couche, compiler les changements, fixer ce qui casse.

---

## Decisions de design

| Sujet | Decision |
|---|---|
| Framework tests Rust | `#[cfg(test)]` inline + `src-tauri/tests/` pour integration |
| Framework tests TS | vitest (coherent avec l'ecosysteme Vite du projet) |
| Tests E2E | Script shell (`tests/e2e/`) sur API reelle |
| Mocking TS | `vi.stubGlobal('fetch')` + mock `fs.readFileSync` pour le token |
| Mocking Rust | Aucun mock — `build_cli_command` est pure, orchestrator utilise tempdir |
| Testabilite orchestrator.rs | Extraire les chemins en parametres (ou env var) pour eviter `~/.claude/mcp.json` reel |

---

## Layer 1 — Tests unitaires Rust : State & Config

**Fichier :** `src-tauri/src/commands/orchestrator.rs` (inline `#[cfg(test)]`)

### Refactoring prealable

`orchestrator_setup`, `orchestrator_remove`, `orchestrator_get_status` lisent/ecrivent `~/.claude/mcp.json` en dur via `mcp_config_path()`. Pour tester :
- Extraire les fonctions internes qui acceptent un `&Path` pour le config path
- Les commandes Tauri restent des wrappers qui appellent `mcp_config_path()` puis delegent
- Les tests passent un chemin temporaire

### Tests (5)

| Test | Verifie |
|---|---|
| `test_setup_creates_valid_mcp_json` | Setup sur fichier vide → JSON valide avec cle `claude-mgr-orchestrator`, `command: "node"`, args contient bundle path |
| `test_setup_preserves_existing_servers` | Setup quand d'autres MCP servers existent → ils ne sont pas ecrases |
| `test_remove_cleans_entry` | Setup puis remove → cle supprimee, JSON reste valide, autres serveurs preserves |
| `test_get_status_configured` | Apres setup → `configured == true` |
| `test_get_status_not_configured` | Fichier vide ou absent → `configured == false` |

---

## Layer 2 — Tests unitaires Rust : API Server

**Fichier :** `src-tauri/src/api_server.rs` (inline `#[cfg(test)]`)

### Tests build_cli_command (6)

`build_cli_command(agent, prompt, settings) -> String` est une pure function.

| Test | Verifie |
|---|---|
| `test_normal_agent_no_mcp_flags` | `is_super_agent=false` → pas de `--mcp-config` ni `--append-system-prompt-file` |
| `test_super_agent_injects_mcp_config` | `is_super_agent=true` → contient `--mcp-config` suivi du chemin `~/.claude/mcp.json` |
| `test_super_agent_injects_instructions` | `is_super_agent=true` → contient `--append-system-prompt-file` suivi du chemin instructions |
| `test_super_agent_with_skip_permissions` | `is_super_agent=true` + `skip_permissions=true` → `--dangerously-skip-permissions` + flags MCP |
| `test_prompt_escapes_single_quotes` | prompt `it's done` → single quotes echappees dans la commande |
| `test_codex_provider_uses_full_auto` | `provider="codex"` + `skip_permissions=true` → `--full-auto` au lieu de `--dangerously-skip-permissions` |

### Tests integration Axum : hooks & auth (4)

**Fichier :** `src-tauri/tests/api_hooks.rs`

On cree un vrai serveur Axum en memoire avec `axum::test` et un `AppState` reel.

| Test | Verifie |
|---|---|
| `test_hook_status_updates_agent` | `POST /api/hooks/status {"agent_id":"x","status":"completed"}` → `agent.process_state == Completed` |
| `test_hook_status_broadcasts` | Spawn un receiver sur `status_tx.subscribe()` → POST hook → receiver recoit `(id, "completed")` |
| `test_auth_rejects_bad_token` | `GET /api/agents` avec mauvais Bearer → 401 |
| `test_auth_accepts_valid_token` | `GET /api/agents` avec bon token → 200 |

---

## Layer 3 — Tests unitaires TypeScript : MCP Tools

**Fichier tests :** `mcp-orchestrator/src/tools/__tests__/agents.test.ts`, `mcp-orchestrator/src/utils/__tests__/api.test.ts`

**Framework :** vitest
**Setup :** `vitest.config.ts` dans `mcp-orchestrator/`
**Mocking :** `vi.stubGlobal('fetch', mockFetch)` + `vi.mock('fs')` pour `readFileSync` (token)

### Tests api.ts (3)

| Test | Verifie |
|---|---|
| `test_sends_auth_header` | Mock fetch → verifie `Authorization: Bearer {token}` present |
| `test_long_poll_timeout` | Endpoint contient `/wait` → `AbortSignal.timeout(600_000)` |
| `test_http_error_throws` | Mock fetch 500 → throw avec message lisible |

### Tests agents.ts (8)

| Test | Verifie |
|---|---|
| `test_list_agents_no_tab_filter` | Pas de `DOROTORING_TAB_ID` → `GET /api/agents` sans query param |
| `test_list_agents_with_tab_filter` | `DOROTORING_TAB_ID=abc` → `GET /api/agents?tabId=abc` |
| `test_create_agent_passes_tab_id` | `DOROTORING_TAB_ID=abc` → body POST contient `tabId: "abc"` |
| `test_delegate_task_chains_start_wait_output` | Mock start→wait→get → verifie le chainage et le resultat `lastCleanOutput` |
| `test_delegate_task_sends_message_if_running` | Agent status `running` → `POST /message` au lieu de `/start` |
| `test_send_message_starts_idle_agent` | Agent status `idle` → fait `POST /start` |
| `test_send_message_writes_to_waiting` | Agent status `waiting` → fait `POST /message` |
| `test_wait_passes_timeout_param` | `timeoutSeconds=120` → `GET /wait?timeout=120` |

---

## Layer 4 — Test d'integration E2E

**Fichier :** `tests/e2e/test_super_agent_flow.sh`

**Prerequis :** App Dorotoring doit tourner (API sur `:31415`).

### Scenario (7 etapes)

```
1. HEALTH CHECK
   GET /api/health → {"status":"ok"}

2. CREATE WORKER AGENT
   POST /api/agents {"name":"e2e-worker","cwd":"/tmp","isSuperAgent":false}
   → capture worker_id

3. CREATE SUPER AGENT
   POST /api/agents {"name":"e2e-super","cwd":"/tmp","isSuperAgent":true,
                      "superAgentScope":"tab","tabId":"e2e-tab"}
   → capture super_id, verifie isSuperAgent==true

4. TAB FILTERING
   GET /api/agents?tabId=e2e-tab → retourne uniquement agents du tab
   GET /api/agents → retourne tous les agents (>= 2)

5. HOOK STATUS LIFECYCLE
   POST /api/hooks/status {"agent_id":"<worker_id>","status":"running"}
   GET /api/agents/<worker_id> → processState == "running"
   POST /api/hooks/status {"agent_id":"<worker_id>","status":"completed"}
   GET /api/agents/<worker_id> → processState == "completed"

6. WAIT BROADCAST
   GET /api/agents/<worker_id>/wait?timeout=5 & (background)
   sleep 1
   POST /api/hooks/status {"agent_id":"<worker_id>","status":"waiting"}
   wait $PID → verifie retour avec status "waiting"

7. CLEANUP
   DELETE /api/agents/<worker_id> → 200
   DELETE /api/agents/<super_id> → 200
```

### Test hooks.sh isole

**Fichier :** `tests/e2e/test_hooks_sh.sh`

```bash
# Cree un agent temporaire via API
# export DOROTORING_AGENT_ID=<agent_id>
# Appelle hooks.sh completed
# Verifie via GET que l'agent a status completed
# Cleanup
```

### Ce que le E2E ne couvre PAS

- Spawn PTY reel (pas de Claude Code dans les tests)
- MCP server en stdio (couvert Layer 3)
- Frontend UI (hors scope)

---

## Fichiers a creer/modifier

| Action | Fichier |
|---|---|
| Modifier | `src-tauri/src/commands/orchestrator.rs` — extraire fonctions internes testables |
| Ajouter tests | `src-tauri/src/commands/orchestrator.rs` — `#[cfg(test)] mod tests` |
| Ajouter tests | `src-tauri/src/api_server.rs` — `#[cfg(test)] mod tests` |
| Creer | `src-tauri/tests/api_hooks.rs` — tests integration Axum |
| Creer | `mcp-orchestrator/vitest.config.ts` |
| Creer | `mcp-orchestrator/src/utils/__tests__/api.test.ts` |
| Creer | `mcp-orchestrator/src/tools/__tests__/agents.test.ts` |
| Creer | `tests/e2e/test_super_agent_flow.sh` |
| Creer | `tests/e2e/test_hooks_sh.sh` |

**Total : ~27 tests** couvrant les 4 couches de la stack Super Agent.

---

## Ordre d'execution

1. Compiler les changements uncommitted (orchestrator.rs, hooks.sh, ensure_hooks, etc.)
2. Layer 1 : refactorer orchestrator.rs pour testabilite + ecrire 5 tests
3. Layer 2 : ecrire 6 tests build_cli_command + 4 tests hooks/auth
4. Layer 3 : setup vitest + ecrire 11 tests MCP
5. Layer 4 : ecrire scripts E2E + executer
6. Fixer tout ce qui casse
7. Commit
