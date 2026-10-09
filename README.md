# dsh-session-history

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的会话管理库与工具插件。
它直接从磁盘读取 DSH 会话，提供三个操作：**list**（列出）、**search**（搜索）、**delete**（删除）。

## 为什么需要它

DSH 没有"删除会话"的界面。侧边栏只提供**归档**（从视图隐藏），也没有可以永久移除会话的 RPC。
时间一长，磁盘上会堆积大量过期会话。本项目填补这一空白。

## 功能

| 操作 | 说明 |
|------|------|
| **list** | 按工作区分组列出会话，包含 ID、大小、修改时间、归档状态，可选附带首条用户消息作为摘要 |
| **search** | 跨会话全文搜索用户消息（不区分大小写） |
| **delete** | 从磁盘永久删除会话（不可撤销） |

这些能力有两种使用方式：`lib/` 下的普通库函数，以及供 agent 使用的 `manage_sessions` 工具。

## 作为库使用

`lib/` 下的模块是纯 ESM，不依赖 DSH 运行时，可以直接导入——web 侧边栏就是这样消费它们的：

```js
import { listAllSessionsGrouped, listSessionsForProject } from "dsh-session-history/lib/list.js";
import { searchSessions } from "dsh-session-history/lib/search.js";
import { deleteSessions } from "dsh-session-history/lib/delete.js";
```

| 模块 | 导出 |
|------|------|
| `lib/index.js` | 工具注册与 action 分发（插件入口） |
| `lib/paths.js` | `projectKey()`、`projectDir()`、`SESSIONS_ROOT`、`WORKSPACE_FILE` |
| `lib/zstd.js` | `decompressSessionFile()`、`extractUserMessages()`、`getSessionSummary()` |
| `lib/workspace.js` | `loadWorkspaceData()`、`isArchived()` |
| `lib/list.js` | `scanSessionDir()`、`listAllSessionsGrouped()`、`listSessionsForProject()` |
| `lib/search.js` | `searchSessions()` |
| `lib/delete.js` | `deleteSessions()` |
| `lib/format.js` | `formatBytes()`、`truncate()`、`renderList()`、`renderSearch()`、`renderDelete()` |

## 使用 `manage_sessions` 工具

工具插件（`lib/index.js`）依赖 agent 专属服务 `systemPrompt` 和 `tools`，
因此**只适用于 headless / agent profile**。

> **不要在 web profile 中注册此插件。** web 环境不存在上述服务，插件会在加载时抛错，
> 并导致整棵插件树崩溃。web 侧边栏应改用上面的库函数。

在 agent profile 中注册时，向该 profile 的 `cordis.patch.yml` 添加：

```yaml
- insert:
    - id: session-manager
      name: 'dsh-session-history'
      config: {}
```

### 工具参数

| 参数 | 类型 | 适用操作 | 说明 |
|------|------|---------|------|
| `action` | string，必填 | — | `"list"`、`"search"` 或 `"delete"` |
| `all_projects` | boolean | list、search | 为 true 时跨**所有**工作区操作。默认 false（仅当前项目） |
| `include_summaries` | boolean | list | 为 true 时附带每个会话的首条用户消息作为预览。默认 false |
| `query` | string | search | 在用户消息中搜索的关键词（不区分大小写） |
| `session_ids` | string[] | delete | 要删除的会话 ID，如 `session-0e2bec1e-...` 或裸 UUID |

### 输出示例

`manage_sessions(action: "list", all_projects: true, include_summaries: true)` 的真实输出：

```
Total: 4 session(s) across 1 workspace(s)

━━ dsh-session-history (4 sessions)  /home/peam/open-projects/dsh-session-history ━━
  • session-9ef251a3-356f-4696-93fe-84948b98e6fe  (91.2 KB, 2026-10-09T09:48:47)  "为什么node_modules为什么也会被git提交"
  • session-bca20195-4395-4925-a3ab-5c17f1d0eed8  (1.2 MB, 2026-10-08T11:08:09)  "dsh中，   "dsh-session-manager": ..."
```

`manage_sessions(action: "search", query: "node_modules", all_projects: true)`：

```
Found 1 matching session(s):

━━ session-9ef251a3-356f-4696-93fe-84948b98e6fe  (dsh-session-history, 1 match(es)) ━━
  [seq 8] 为什么node_modules为什么也会被git提交
```

`manage_sessions(action: "delete", session_ids: ["session-0e2bec1e-..."])`：

```
Session deletion complete.

Deleted (1):
  ✓ session-0e2bec1e-...
```

> 输出文本由 `lib/format.js` 生成，目前为英文，与界面语言无关。

## 安装

克隆仓库，并把 DSH 的 `node_modules` 链接过来，以便插件入口导入 `@deepseek-ai/dsh-tools`：

```bash
git clone https://github.com/peamed/dsh-session-history.git ~/open-projects/dsh-session-history

# 指向提供 @deepseek-ai/dsh-tools 的 DSH 安装目录。
# 若 DSH 是通过 npx 运行的：
DSH_NM="$HOME/.npm/_npx/<hash>/node_modules"
ln -s "$DSH_NM" ~/open-projects/dsh-session-history/node_modules
```

注意：

- 只有 `lib/index.js` 需要 `@deepseek-ai/dsh-tools`，其余模块无任何依赖。
- 这里的 `node_modules` 是符号链接，所以 `.gitignore` 中写的是不带尾斜杠的 `node_modules`。
  带尾斜杠的规则只匹配真正的目录，会让符号链接漏进提交。

## 工作原理

### 会话存储格式

DSH 将会话存为**多帧 Zstandard 压缩的 JSONL**：

```
~/.dsh/sessions/<encoded-cwd>/<session-id>/session.jsonl.zstd
```

每个事件批次作为独立的 Zstandard 帧追加写入。插件通过扫描 Zstandard 魔数
（`28 b5 2f fd`）定位帧边界，用 `zstdDecompressSync` 逐帧解压后再拼接结果。

### 路径编码

项目目录名由会话的 `cwd` 经与 `dsh-session-persistence-jsonl` 相同的 `projectKey()`
算法推导而来：

```
/home/peam/projects/tf-fly-pc  →  --home-peam-projects-tf-fly-pc--
```

分隔符（`/`、`\`、`:`）转为 `-`（连续的分隔符会合并），开头的分隔符被剥除，
非安全字符转为 `~XXXX` 十六进制转义，最终结果用 `--...--` 包裹。

### 工作区分组

工作区元数据读取自 `~/.dsh/storages/workspace.json`，其中记录了工作区 ID 到项目路径、
标题及已注册会话 ID 的映射。磁盘上不属于任何工作区的会话归入 `Ungrouped`。
已注册但磁盘上无对应目录的会话标记为 `orphaned`；已归档会话标记为 `archived`。

### 删除行为

`deleteSessions()` 会遍历会话根目录下的所有项目目录查找匹配的会话 ID，
并用 `rmSync(recursive: true)` 删除。工具入口还会（尽力而为地）调用
`ctx.workspaces.archiveSession(id)`，使侧边栏立即隐藏该会话。

## 使用示例

直接用自然语言让 agent 执行：

- "列出当前项目的所有会话" → `list` 当前项目
- "列出所有工作区的会话，包含摘要" → `list` 所有项目并带摘要
- "搜索包含 'cesium' 的会话" → `search` 关键词 "cesium"
- "搜索所有项目中包含 'bug' 的会话" → `search` 所有项目搜 "bug"
- "删除会话 session-0e2bec1e-..." → `delete` 指定会话
- "删除所有已归档的会话" → 先 `list` 再 `delete`

## 环境要求

- Node.js `>= 22.15.0`（使用内置 `node:zlib`，其 Zstd API 自 v22.15.0 起提供）
- 仅工具入口需要：DSH 安装中的 `@deepseek-ai/dsh-tools`

## 已知限制

- **活动会话**：删除当前正在使用的会话，可能要等该会话关闭后才生效。
  插件在删除前不会检查会话是否处于活动状态。
- **搜索范围**：仅扫描用户消息，不含助手回复与工具输出，以保证结果相关且快速。
- **搜索上限**：最多返回 20 个匹配会话，每个会话最多展示 3 条匹配消息。
- **不可撤销**：删除是永久的。请先 `list` 或 `search` 确认会话 ID。

## 许可证

MIT
