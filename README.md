# dsh-session-history

A session management library and tool plugin for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).
It reads DSH conversation sessions directly from disk and provides three
operations: **list**, **search**, and **delete**.

## Why?

DSH has no "delete session" UI. The sidebar only offers **archive** (hide from
view), and there is no RPC to permanently remove a session. Over time, stale
sessions accumulate on disk. This project fills that gap.

## Features

| Action | Description |
|--------|-------------|
| **list** | List sessions grouped by workspace, with ID, size, modification time, archive status, and optionally the first user message as a summary |
| **search** | Full-text search through user messages across sessions (case-insensitive) |
| **delete** | Permanently remove sessions from disk (cannot be undone) |

These are exposed two ways: as plain library functions in `lib/`, and as a
`manage_sessions` tool for the agent.

## Library usage

The `lib/` modules are plain ESM with no DSH runtime dependency, so they can be
imported directly — this is how the web sidebar consumes them:

```js
import { listAllSessionsGrouped, listSessionsForProject } from "dsh-session-history/lib/list.js";
import { searchSessions } from "dsh-session-history/lib/search.js";
import { deleteSessions } from "dsh-session-history/lib/delete.js";
```

| Module | Exports |
|--------|---------|
| `lib/index.js` | Tool registration and action dispatch (the plugin entry) |
| `lib/paths.js` | `projectKey()`, `projectDir()`, `SESSIONS_ROOT`, `WORKSPACE_FILE` |
| `lib/zstd.js` | `decompressSessionFile()`, `extractUserMessages()`, `getSessionSummary()` |
| `lib/workspace.js` | `loadWorkspaceData()`, `isArchived()` |
| `lib/list.js` | `scanSessionDir()`, `listAllSessionsGrouped()`, `listSessionsForProject()` |
| `lib/search.js` | `searchSessions()` |
| `lib/delete.js` | `deleteSessions()` |
| `lib/format.js` | `formatBytes()`, `truncate()`, `renderList()`, `renderSearch()`, `renderDelete()` |

## Using the `manage_sessions` tool

The tool plugin (`lib/index.js`) requires the agent-only services
`systemPrompt` and `tools`. It is meant for **headless / agent profiles**.

> **Do not register this plugin in a web profile.** Those services do not exist
> in the web environment, and the plugin will throw on load and take down the
> whole plugin tree. The web sidebar should use the library functions above
> instead.

To register it in an agent profile, add to that profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: session-manager
      name: 'dsh-session-history'
      config: {}
```

### Tool parameters

| Parameter | Type | Applies to | Description |
|-----------|------|-----------|-------------|
| `action` | string, required | — | `"list"`, `"search"`, or `"delete"` |
| `all_projects` | boolean | list, search | If true, operate across ALL workspaces. Default false (current project only) |
| `include_summaries` | boolean | list | If true, include the first user message of each session as a preview. Default false |
| `query` | string | search | Keyword to search for in user messages (case-insensitive) |
| `session_ids` | string[] | delete | Session IDs to delete, e.g. `session-0e2bec1e-...` or a bare UUID |

### Example output

Real output from `manage_sessions(action: "list", all_projects: true, include_summaries: true)`:

```
Total: 4 session(s) across 1 workspace(s)

━━ dsh-session-history (4 sessions)  /home/peam/open-projects/dsh-session-history ━━
  • session-9ef251a3-356f-4696-93fe-84948b98e6fe  (91.2 KB, 2026-10-09T09:48:47)  "为什么node_modules为什么也会被git提交"
  • session-bca20195-4395-4925-a3ab-5c17f1d0eed8  (1.2 MB, 2026-10-08T11:08:09)  "dsh中，   "dsh-session-manager": ..."
```

And from `manage_sessions(action: "search", query: "node_modules", all_projects: true)`:

```
Found 1 matching session(s):

━━ session-9ef251a3-356f-4696-93fe-84948b98e6fe  (dsh-session-history, 1 match(es)) ━━
  [seq 8] 为什么node_modules为什么也会被git提交
```

And from `manage_sessions(action: "delete", session_ids: ["session-0e2bec1e-..."])`:

```
Session deletion complete.

Deleted (1):
  ✓ session-0e2bec1e-...
```

## Installation

Clone the repository and link DSH's `node_modules` so the plugin entry can
import `@deepseek-ai/dsh-tools`:

```bash
git clone https://github.com/peamed/dsh-session-history.git ~/open-projects/dsh-session-history

# Point node_modules at the DSH installation that provides @deepseek-ai/dsh-tools.
# If DSH was run via npx:
DSH_NM="$HOME/.npm/_npx/<hash>/node_modules"
ln -s "$DSH_NM" ~/open-projects/dsh-session-history/node_modules
```

Notes:

- Only `lib/index.js` needs `@deepseek-ai/dsh-tools`; the other modules are
  dependency-free.
- `node_modules` is a symlink here, so `.gitignore` lists `node_modules`
  without a trailing slash — a trailing slash would only match a real
  directory and would let the symlink slip into commits.

## How it works

### Session storage format

DSH stores sessions as **multi-frame Zstandard-compressed JSONL**:

```
~/.dsh/sessions/<encoded-cwd>/<session-id>/session.jsonl.zstd
```

Each event batch is appended as a separate Zstandard frame. The plugin locates
frame boundaries by scanning for the Zstandard magic bytes (`28 b5 2f fd`),
decompresses each frame with `zstdDecompressSync`, and concatenates the results.

### Path encoding

The project directory name is derived from the session's `cwd` using the same
`projectKey()` algorithm as `dsh-session-persistence-jsonl`:

```
/home/peam/projects/tf-fly-pc  →  --home-peam-projects-tf-fly-pc--
```

Separators (`/`, `\`, `:`) become `-` (consecutive runs collapse), the leading
run is stripped, non-safe characters become `~XXXX` hex escapes, and the result
is wrapped in `--...--`.

### Workspace grouping

Workspace metadata is read from `~/.dsh/storages/workspace.json`, which maps
workspace IDs to project paths, titles, and registered session IDs. Sessions on
disk that do not belong to any workspace are listed under `Ungrouped`.
Workspace-registered sessions with no directory on disk are flagged
`orphaned`; archived sessions are flagged `archived`.

### Deletion

`deleteSessions()` scans every project directory under the sessions root for a
matching session ID and removes it with `rmSync(recursive: true)`. The tool
entry additionally calls `ctx.workspaces.archiveSession(id)` (best effort) so
the sidebar hides the session immediately.

## Usage examples

Ask the agent in natural language:

- "列出当前项目的所有会话" → `list` current project
- "列出所有工作区的会话，包含摘要" → `list` all projects with summaries
- "搜索包含 'cesium' 的会话" → `search` for "cesium"
- "搜索所有项目中包含 'bug' 的会话" → `search` all projects for "bug"
- "删除会话 session-0e2bec1e-..." → `delete` specific session
- "删除所有已归档的会话" → `list` then `delete`

## Requirements

- Node.js `>= 22` (uses built-in `node:zlib`, which added `zstdDecompressSync`
  in v22.15.0)
- For the tool entry only: `@deepseek-ai/dsh-tools` from a DSH installation

## Limitations

- **Live sessions**: Deleting a session that is currently active may not take
  effect until the session is closed. The plugin does not check if a session is
  live before deleting.
- **Search depth**: Search only scans user messages, not assistant responses or
  tool outputs, to keep results relevant and fast.
- **Search caps**: At most 20 matching sessions are returned, with at most 3
  matched messages shown per session.
- **No undo**: Deletion is permanent. Always `list` or `search` first to verify
  the session IDs.

## License

MIT
