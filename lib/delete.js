/**
 * Session deletion — permanently remove session directories from disk.
 */

import { readdirSync, statSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SESSIONS_ROOT } from "./paths.js";

/**
 * Delete sessions by id from disk. Searches across ALL project directories
 * since a session id might belong to any workspace.
 *
 * @param {string[]} sessionIds - session ids to delete
 * @returns {{deleted: string[], notFound: string[]}}
 */
export function deleteSessions(sessionIds) {
    const deleted = [];
    const notFound = [];

    for (const id of sessionIds) {
        const dirCandidates = [
            id.startsWith("session-") ? id : `session-${id}`,
            id,
        ];

        let found = false;

        if (existsSync(SESSIONS_ROOT)) {
            for (const projDirName of readdirSync(SESSIONS_ROOT)) {
                if (found) break;
                const projDirPath = join(SESSIONS_ROOT, projDirName);
                for (const dirName of dirCandidates) {
                    const sessionPath = join(projDirPath, dirName);
                    if (
                        existsSync(sessionPath) &&
                        statSync(sessionPath).isDirectory()
                    ) {
                        try {
                            rmSync(sessionPath, { recursive: true, force: true });
                            deleted.push(id);
                            found = true;
                            break;
                        } catch (e) {
                            console.error(
                                `Failed to delete session ${id}:`,
                                e.message,
                            );
                        }
                    }
                }
            }
        }

        if (!found) notFound.push(id);
    }

    return { deleted, notFound };
}
