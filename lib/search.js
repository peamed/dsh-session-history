/**
 * Session content search — scan decompressed user messages for a keyword.
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SESSIONS_ROOT, projectDir } from "./paths.js";
import { loadWorkspaceData } from "./workspace.js";
import { decompressSessionFile, extractUserMessages } from "./zstd.js";

/**
 * Search session content (user messages) for a keyword.
 *
 * @param {string} query - search keyword (case-insensitive)
 * @param {string|null} cwd - project path to search in; null = all projects
 * @param {number} maxResults - max matching sessions to return
 * @returns {Array<{id, workspace, path, modified, matchCount, matchedMessages}>}
 */
export function searchSessions(query, cwd = null, maxResults = 20) {
    const lowerQuery = query.toLowerCase();
    const results = [];

    // Determine which project dirs to scan
    let projectDirs = [];
    if (cwd) {
        projectDirs = [{ path: cwd, dirName: projectDir(cwd).split("/").pop() }];
    } else {
        if (!existsSync(SESSIONS_ROOT)) return results;
        for (const entry of readdirSync(SESSIONS_ROOT, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                projectDirs.push({ path: null, dirName: entry.name });
            }
        }
    }

    // Load workspace info for grouping
    const { workspaces } = loadWorkspaceData();

    for (const { path: projPath, dirName: projDirName } of projectDirs) {
        const fullDir = join(SESSIONS_ROOT, projDirName);
        if (!existsSync(fullDir)) continue;

        // Resolve workspace title for this project
        let workspaceTitle = "Ungrouped";
        if (projPath) {
            for (const [, ws] of workspaces) {
                if (ws.path === projPath) {
                    workspaceTitle = ws.title;
                    break;
                }
            }
        }

        let sessionDirs;
        try {
            sessionDirs = readdirSync(fullDir, { withFileTypes: true }).filter(
                e => e.isDirectory(),
            );
        } catch {
            continue;
        }

        for (const sessionEntry of sessionDirs) {
            if (results.length >= maxResults) break;

            const sessionId = sessionEntry.name;
            const sessionPath = join(fullDir, sessionId);
            let files;
            try {
                files = readdirSync(sessionPath).filter(f => f.endsWith(".zstd"));
            } catch {
                continue;
            }

            for (const file of files) {
                try {
                    const filePath = join(sessionPath, file);
                    const text = decompressSessionFile(filePath);
                    const messages = extractUserMessages(text, 300);

                    const matched = messages.filter(m =>
                        m.preview.toLowerCase().includes(lowerQuery),
                    );

                    if (matched.length > 0) {
                        const stat = statSync(sessionPath);
                        results.push({
                            id: sessionId,
                            workspace: workspaceTitle,
                            path: projPath || `(dir: ${projDirName})`,
                            modified: stat.mtime.toISOString(),
                            matchCount: matched.length,
                            matchedMessages: matched.slice(0, 3),
                        });
                    }
                } catch {}
            }
        }
    }

    return results;
}
