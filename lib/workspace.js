/**
 * Workspace data loader.
 *
 * Reads ~/.dsh/storages/workspace.json to map workspace IDs to project
 * paths, titles, and registered session IDs.
 */

import { readFileSync, existsSync } from "node:fs";
import { WORKSPACE_FILE } from "./paths.js";

/**
 * Load workspace.json and return the workspace table.
 * @returns {{workspaces: Map<string, Object>, archivedSessionIds: string[]}}
 */
export function loadWorkspaceData() {
    const result = { workspaces: new Map(), archivedSessionIds: [] };
    if (!existsSync(WORKSPACE_FILE)) return result;
    try {
        const data = JSON.parse(readFileSync(WORKSPACE_FILE, "utf-8"));
        const tables = data?.tables?.workspaces ?? {};
        for (const [id, ws] of Object.entries(tables)) {
            result.workspaces.set(id, {
                workspaceId: id,
                path: ws.path,
                title: ws.title,
                sessionIds: ws.sessionIds ?? [],
                createdAt: ws.createdAt,
                updatedAt: ws.updatedAt,
            });
        }
        result.archivedSessionIds = data?.global?.archivedSessionIds ?? [];
    } catch {
        /* ignore parse errors */
    }
    return result;
}

/**
 * Check whether a session ID is in the archived set.
 */
export function isArchived(sessionId, archivedSet) {
    return (
        archivedSet.has(sessionId) ||
        archivedSet.has(sessionId.replace(/^session-/, ""))
    );
}
