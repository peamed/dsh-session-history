# DSH Session Manager

A plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) that adds a `manage_sessions` tool for listing, searching, and deleting conversation sessions directly from disk.

## Why?

DSH `0.1.0-rc.x` has no "delete session" UI. The sidebar menu only offers **archive** (hide from view), and there is no RPC to permanently remove a session. Over time, stale sessions accumulate on disk — this plugin fills that gap.

## Features

| Action | Description |
|--------|-------------|
| **list** | List sessions grouped by workspace, with ID, size, modification time, archive status, and optionally the first user message as a summary |
| **search** | Full-text search through all user messages across sessions (case-insensitive) |
| **delete** | Permanently remove sessions from disk (cannot be undone) |

### List with workspace grouping

```
manage_sessions(action: "list", all_projects: true, include_summaries: true)
```

Returns sessions organized by workspace:

```
━━ tf-fly-pc (5 sessions)  /home/peam/projects/tf-fly-pc ━━
  • session-2944295c-...  (1.0 MB, 2026-08-21T00:22)  "为什么不是先发给mcp..."
  • session-8949b236-...  (490.0 KB, 2026-08-20T15:01)  "帮我确定是那个环节的问题"
  ...

━━ tf-scape-ad (6 sessions)  /home/peam/projects/tf-scape-ad ━━
  • session-bb990a8f-...  (...)
  ...
```

### Search session content

```
manage_sessions(action: "search", query: "cesium", all_projects: true)
```

Searches through all user messages across all sessions:

```
Found 1 matching session(s):

━━ session-0e2bec1e-...  (tf-fly-pc, 1 match(es)) ━━
  [seq 726] DeveloperError: normalized result is not a number...
```

### Delete sessions

```
manage_sessions(action: "delete", session_ids: ["session-0e2bec1e-..."])
```

Permanently removes the session files from disk and archives from the workspace registry so the sidebar updates:

```
Session deletion complete.

Deleted (1):
  ✓ session-0e2bec1e-...
```

## Installation

### 1. Clone or copy the plugin

```bash
git clone https://github.com/your-username/dsh-session-manager.git ~/open-projects/dsh-session-manager
```

### 2. Link DSH node_modules

The plugin imports `@deepseek-ai/dsh-tools` from DSH's own `node_modules`. Create a symlink:

```bash
# Find your DSH node_modules path
DSH_NM="$(dirname $(node -e "console.log(require.resolve('@deepseek-ai/dsh'))"))/.."
# Or if installed via npx:
DSH_NM="$HOME/.npm/_npx/<hash>/node_modules"

ln -s "$DSH_NM" ~/open-projects/dsh-session-manager/node_modules
```

### 3. Register in DSH profile

Edit `~/.dsh/profiles/web/cordis.patch.yml` and add the plugin:

```yaml
- insert:
    # ... your existing entries ...
    - id: session-manager
      name: 'dsh-session-manager'
      config: {}
```

### 4. Restart DSH

Restart the DSH web server or refresh the page. The `manage_sessions` tool will be available in the next conversation.

## Project Structure

```
dsh-session-manager/
├── lib/
│   ├── index.js       Tool registration, parameter schema, and action dispatch
│   ├── paths.js       DSH path encoding (projectKey / projectDir)
│   ├── zstd.js        Multi-frame Zstandard decompression + content extraction
│   ├── workspace.js   Workspace.json loader
│   ├── list.js        Session listing (grouped by workspace)
│   ├── search.js      Session content search
│   ├── delete.js      Session deletion from disk
│   └── format.js      Output rendering helpers
├── package.json
├── LICENSE
└── README.md
```

| Module | Responsibility | Lines |
|--------|---------------|-------|
| `index.js` | Tool registration, JSON schema, action dispatch | ~265 |
| `paths.js` | `projectKey()` / `projectDir()` — mirrors DSH source | ~50 |
| `zstd.js` | Multi-frame zstd decompression, user message extraction | ~130 |
| `workspace.js` | Loads `workspace.json`, archive-set helpers | ~46 |
| `list.js` | `listAllSessionsGrouped()` / `listSessionsForProject()` | ~197 |
| `search.js` | `searchSessions()` — keyword search across user messages | ~102 |
| `delete.js` | `deleteSessions()` — permanent disk removal | ~58 |
| `format.js` | `formatBytes()`, `renderList/Search/Delete()` | ~88 |

## How It Works

### Session storage format

DSH stores sessions as **multi-frame Zstandard-compressed JSONL** files:

```
~/.dsh/sessions/<encoded-cwd>/<session-id>/session.jsonl.zstd
```

Each event batch is appended as a separate Zstandard frame. The plugin detects frame boundaries by scanning for the Zstandard magic bytes (`28 b5 2f fd`), decompresses each frame individually, and concatenates the results.

### Path encoding

The project directory name is derived from the session's `cwd` using the same `projectKey()` algorithm as `dsh-session-persistence-jsonl`:

```
/home/peam/projects/tf-fly-pc  →  --home-peam-projects-tf-fly-pc--
```

Separators (`/`, `\`, `:`) become `-` (consecutive runs collapse), the leading run is stripped, and the result is wrapped in `--...--`.

### Workspace grouping

Workspace metadata is read from `~/.dsh/storages/workspace.json`, which maps workspace IDs to project paths, titles, and registered session IDs. Sessions on disk that don't belong to any workspace are listed under "Ungrouped".

### Deletion

Deletion removes the session directory from disk via `rmSync(recursive: true)`. It also calls `ctx.workspaces.archiveSession(id)` so the sidebar hides the session immediately without waiting for a restart.

## Usage Examples

Ask the agent in natural language:

- "列出当前项目的所有会话" → `list` current project
- "列出所有工作区的会话，包含摘要" → `list` all projects with summaries
- "搜索包含 'cesium' 的会话" → `search` for "cesium"
- "搜索所有项目中包含 'bug' 的会话" → `search` all projects for "bug"
- "删除会话 session-0e2bec1e-..." → `delete` specific session
- "删除所有已归档的会话" → `list` then `delete`

## Configuration

The plugin accepts an empty config (`config: {}`) in `cordis.patch.yml`. No additional configuration is required.

## Requirements

- DeepSeek Harness `>= 0.1.0-rc.8`
- Node.js `>= 22` (uses built-in `node:zlib`)

## Limitations

- **Live sessions**: Deleting a session that is currently active may not take effect until the session is closed. The plugin does not check if a session is live before deleting.
- **Search depth**: Search only scans user messages (not assistant responses or tool outputs) to keep results relevant and fast.
- **No undo**: Deletion is permanent. Always `list` or `search` first to verify the correct session IDs.

## License

MIT
