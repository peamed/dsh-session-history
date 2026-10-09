/**
 * Session listing — scan disk and return sessions grouped by workspace.
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SESSIONS_ROOT, projectDir, projectKey } from "./paths.js";
import { loadWorkspaceData, isArchived } from "./workspace.js";
import { getSessionSummary } from "./zstd.js";

/**
 * Gather session info from a project directory on disk.
 * @param {string} cwd - project working directory
 * @param {{withSummary?: boolean}} options
 * @returns {Array<{id, size, modified, summary}>}
 */
export function scanSessionDir(cwd, { withSummary = false } = {}) {
    const pdir = projectDir(cwd);
    if (!existsSync(pdir)) return [];

    const entries = readdirSync(pdir, { withFileTypes: true });
    const sessions = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionPath = join(pdir, entry.name);
        const sessionId = entry.name;

        let size = 0;
        let modified = "";
        let summary = "";
        try {
            const stat = statSync(sessionPath);
            modified = stat.mtime.toISOString();
            for (const file of readdirSync(sessionPath)) {
                const fp = join(sessionPath, file);
                try {
                    const fst = statSync(fp);
                    size += fst.size;
                    if (withSummary && file.endsWith(".zstd") && summary === "") {
                        summary = getSessionSummary(fp);
                    }
                } catch {}
            }
        } catch {}

        sessions.push({ id: sessionId, size, modified, summary });
    }

    sessions.sort((a, b) => b.modified.localeCompare(a.modified));
    return sessions;
}

/**
 * List all sessions across ALL workspaces, grouped by workspace.
 * Also includes "Ungrouped" sessions (on disk but not in any workspace).
 */
export function listAllSessionsGrouped({ withSummary = false } = {}) {
    const { workspaces, archivedSessionIds } = loadWorkspaceData();
    const archivedSet = new Set(archivedSessionIds);
    const groups = [];
    const claimedSessionIds = new Set();

    // 1) Sessions in known workspaces
    for (const [id, ws] of workspaces) {
        const diskSessions = scanSessionDir(ws.path, { withSummary });
        const wsSessions = diskSessions.map(s => ({
            ...s,
            archived: isArchived(s.id, archivedSet),
        }));
        for (const s of wsSessions) claimedSessionIds.add(s.id);

        // Include workspace-registered sessions with no disk entry (orphaned)
        for (const regId of ws.sessionIds) {
            const diskName = regId.startsWith("session-") ? regId : `session-${regId}`;
            if (!claimedSessionIds.has(diskName) && !claimedSessionIds.has(regId)) {
                wsSessions.push({
                    id: diskName,
                    size: 0,
                    modified: "",
                    summary: "",
                    archived: isArchived(regId, archivedSet),
                    orphaned: true,
                });
            }
        }

        wsSessions.sort((a, b) => (b.modified || "").localeCompare(a.modified || ""));
        groups.push({
            workspace: ws.title,
            path: ws.path,
            workspaceId: id,
            sessionCount: wsSessions.length,
            sessions: wsSessions,
        });
    }

    // 2) Sessions on disk but not in any workspace
    const knownProjectDirs = new Set();
    for (const [, ws] of workspaces) knownProjectDirs.add(projectKey(ws.path));

    const allSessionDirs = existsSync(SESSIONS_ROOT)
        ? readdirSync(SESSIONS_ROOT, { withFileTypes: true })
              .filter(e => e.isDirectory())
              .map(e => e.name)
        : [];

    const ungroupedSessions = [];
    for (const dirName of allSessionDirs) {
        if (knownProjectDirs.has(dirName)) continue;
        const fullDir = join(SESSIONS_ROOT, dirName);
        try {
            for (const entry of readdirSync(fullDir, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const sessionId = entry.name;
                if (claimedSessionIds.has(sessionId)) continue;
                const sessionPath = join(fullDir, sessionId);
                let size = 0;
                let modified = "";
                let summary = "";
                try {
                    const stat = statSync(sessionPath);
                    modified = stat.mtime.toISOString();
                    for (const file of readdirSync(sessionPath)) {
                        try {
                            const fst = statSync(join(sessionPath, file));
                            size += fst.size;
                            if (withSummary && file.endsWith(".zstd") && summary === "") {
                                summary = getSessionSummary(join(sessionPath, file));
                            }
                        } catch {}
                    }
                } catch {}
                ungroupedSessions.push({
                    id: sessionId,
                    size,
                    modified,
                    summary,
                    archived: false,
                });
            }
        } catch {}
    }

    if (ungroupedSessions.length > 0) {
        ungroupedSessions.sort((a, b) =>
            (b.modified || "").localeCompare(a.modified || ""),
        );
        groups.push({
            workspace: "Ungrouped",
            path: "",
            workspaceId: null,
            sessionCount: ungroupedSessions.length,
            sessions: ungroupedSessions,
        });
    }

    return {
        groups,
        totalSessions: groups.reduce((n, g) => n + g.sessionCount, 0),
    };
}

/**
 * List sessions for a single project (cwd), grouped by workspace.
 */
export function listSessionsForProject(cwd, { withSummary = false } = {}) {
    const { workspaces, archivedSessionIds } = loadWorkspaceData();
    const archivedSet = new Set(archivedSessionIds);

    let wsInfo = null;
    for (const [id, ws] of workspaces) {
        if (ws.path === cwd) {
            wsInfo = { workspaceId: id, ...ws };
            break;
        }
    }

    const diskSessions = scanSessionDir(cwd, { withSummary });
    const sessions = diskSessions.map(s => ({
        ...s,
        archived: isArchived(s.id, archivedSet),
    }));

    return {
        groups: [
            {
                workspace: wsInfo?.title || "Ungrouped",
                path: cwd,
                workspaceId: wsInfo?.workspaceId || null,
                sessionCount: sessions.length,
                sessions,
            },
        ],
        totalSessions: sessions.length,
    };
}
