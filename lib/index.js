/**
 * DSH Session Manager Plugin
 *
 * Registers a `manage_sessions` tool that lets the model (or user via the
 * agent) list, search, and delete DSH conversation sessions directly from disk.
 *
 * Module layout:
 *   lib/paths.js    — DSH path encoding (projectKey/projectDir)
 *   lib/zstd.js     — multi-frame Zstandard decompression + content extraction
 *   lib/workspace.js— workspace.json loader
 *   lib/list.js     — session listing (grouped by workspace)
 *   lib/search.js   — session content search
 *   lib/delete.js   — session deletion from disk
 *   lib/format.js   — output rendering helpers
 *   lib/index.js    — tool registration and action dispatch (this file)
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { listAllSessionsGrouped, listSessionsForProject } from "./list.js";
import { searchSessions } from "./search.js";
import { deleteSessions } from "./delete.js";
import { formatBytes, renderList, renderSearch, renderDelete } from "./format.js";

export const name = "dsh-session-manager";

export function apply(ctx, config = {}) {
    // ── System prompt ──────────────────────────────────────────────────────

    ctx.inject(["systemPrompt"], (promptCtx) => {
        promptCtx.systemPrompt.section({
            name: "tool:manage_sessions",
            order: 100,
            text: [
                "Use the manage_sessions tool to list, search, and delete DSH conversation sessions.",
                "Action 'list' returns sessions grouped by workspace, with IDs, sizes, modification times, archive status, and optionally the first user message as a summary.",
                "Set all_projects=true to list sessions across ALL workspaces; otherwise only the current project's sessions are shown.",
                "Set include_summaries=true to include the first user message of each session as a preview.",
                "Action 'search' searches through user messages across sessions for a keyword. Set all_projects=true to search all workspaces.",
                "Action 'delete' permanently removes one or more sessions from disk. Provide session_ids as an array.",
                "Always list or search sessions first to get the correct IDs before deleting.",
            ].join(" "),
        });
    });

    // ── Tool definition ────────────────────────────────────────────────────

    ctx.inject(["tools"], (toolCtx) => {
        toolCtx.tools.register(
        defineTool({
            name: "manage_sessions",
            description: [
                "Manage DSH conversation sessions: list (grouped by workspace), search session content, or permanently delete sessions by ID.",
                "Actions: 'list' to list sessions, 'search' to search session content, 'delete' to delete sessions.",
            ].join(" "),
            parameters: {
                action: {
                    type: "string",
                    required: true,
                    description: "'list', 'search', or 'delete'.",
                    enum: ["list", "search", "delete"],
                },
                all_projects: {
                    type: "boolean",
                    description:
                        "For 'list'/'search': if true, operate across ALL workspaces. Default: false (current project only).",
                },
                include_summaries: {
                    type: "boolean",
                    description:
                        "For 'list': if true, include the first user message of each session as a preview. Default: false.",
                },
                query: {
                    type: "string",
                    description:
                        "For 'search': the keyword to search for in user messages (case-insensitive).",
                },
                session_ids: {
                    type: "array",
                    description:
                        "For 'delete': session IDs to delete. Each is a string like 'session-0e2bec1e-...' or a bare UUID.",
                    items: { type: "string" },
                },
            },

            // ── Output schema ─────────────────────────────────────────────────

            output: {
                schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        action: { type: "string", required: true },
                        groups: {
                            type: "array",
                            items: {
                                type: "object",
                                additionalProperties: false,
                                properties: {
                                    workspace: { type: "string", required: true },
                                    path: { type: "string" },
                                    workspaceId: { type: "string" },
                                    sessionCount: { type: "integer", required: true },
                                    sessions: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            additionalProperties: false,
                                            properties: {
                                                id: { type: "string", required: true },
                                                size: { type: "integer", required: true },
                                                sizeHuman: { type: "string", required: true },
                                                modified: { type: "string", required: true },
                                                archived: { type: "boolean" },
                                                orphaned: { type: "boolean" },
                                                summary: { type: "string" },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        searchResults: {
                            type: "array",
                            items: {
                                type: "object",
                                additionalProperties: false,
                                properties: {
                                    id: { type: "string", required: true },
                                    workspace: { type: "string", required: true },
                                    path: { type: "string" },
                                    modified: { type: "string", required: true },
                                    matchCount: { type: "integer", required: true },
                                    matchedMessages: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            additionalProperties: false,
                                            properties: {
                                                seq: { type: "integer" },
                                                time: {},
                                                preview: { type: "string", required: true },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        deleted: { type: "array", items: { type: "string" } },
                        notFound: { type: "array", items: { type: "string" } },
                        totalSessions: { type: "integer" },
                        count: { type: "integer" },
                    },
                },

                // ── Render ────────────────────────────────────────────────────

                render: (_args, value) => {
                    if (value.action === "list") {
                        return [{ type: "text", text: renderList(value) }];
                    }
                    if (value.action === "search") {
                        return [{ type: "text", text: renderSearch(value) }];
                    }
                    if (value.action === "delete") {
                        return [{ type: "text", text: renderDelete(value) }];
                    }
                    return [
                        { type: "text", text: JSON.stringify(value, null, 2) },
                    ];
                },
            },

            // ── Execute ──────────────────────────────────────────────────────

            async execute(args, exec) {
                const action = args.action;

                if (action === "list") {
                    return executeList(args, exec);
                }

                if (action === "search") {
                    return executeSearch(args, exec);
                }

                if (action === "delete") {
                    return executeDelete(args, exec, ctx);
                }

                throw new Error(
                    `Unknown action: ${action}. Use 'list', 'search', or 'delete'.`,
                );
            },
        }),
        );
    });

    ctx?.logger?.info?.("dsh-session-manager: manage_sessions tool registered");
}

// ── Action handlers ────────────────────────────────────────────────────────

async function executeList(args, exec) {
    const allProjects = args.all_projects === true;
    const withSummary = args.include_summaries === true;
    const cwd = exec?.cwd || process.cwd();

    const result = allProjects
        ? listAllSessionsGrouped({ withSummary })
        : listSessionsForProject(cwd, { withSummary });

    // Add human-readable sizes, clean up empty summaries
    for (const g of result.groups) {
        for (const s of g.sessions) {
            s.sizeHuman = formatBytes(s.size);
            if (!s.summary) delete s.summary;
        }
    }

    return { action: "list", ...result };
}

async function executeSearch(args, exec) {
    const query = args.query;
    if (!query || typeof query !== "string") {
        throw new Error("query is required for action='search'");
    }
    const allProjects = args.all_projects === true;
    const cwd = allProjects ? null : exec?.cwd || process.cwd();

    const results = searchSessions(query, cwd);

    return {
        action: "search",
        searchResults: results,
        count: results.length,
    };
}

async function executeDelete(args, exec, ctx) {
    const sessionIds = args.session_ids;
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
        throw new Error(
            "session_ids is required for action='delete' and must be a non-empty array",
        );
    }

    const result = deleteSessions(sessionIds);

    // Archive from workspace registry so sidebar updates immediately
    try {
        if (ctx.workspaces?.archiveSession) {
            for (const id of result.deleted) {
                await ctx.workspaces.archiveSession(id).catch(() => {});
            }
        }
    } catch {
        /* best effort */
    }

    return {
        action: "delete",
        deleted: result.deleted,
        notFound: result.notFound,
        count: result.deleted.length,
    };
}

export default { name, apply };
