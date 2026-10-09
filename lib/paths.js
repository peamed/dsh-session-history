/**
 * Path helpers — mirror dsh-session-persistence-jsonl's projectKey().
 *
 * DSH encodes a session's cwd into a filesystem-safe directory name:
 *   "/home/user/projects/my-app"  →  "--home-user-projects-my-app--"
 *
 * Separators (/, \, :) collapse to "-", the leading run is stripped,
 * non-safe chars become "~XXXX" hex escapes, and the result is wrapped
 * in "--...--".
 */

import { join } from "node:path";
import { homedir } from "node:os";

const DSH_ROOT = join(homedir(), ".dsh");
export const SESSIONS_ROOT = join(DSH_ROOT, "sessions");
export const WORKSPACE_FILE = join(DSH_ROOT, "storages", "workspace.json");

/**
 * Encode a cwd path to DSH's project directory name.
 * Mirrors projectKey() from dsh-session-persistence-jsonl exactly.
 */
export function projectKey(cwd) {
    if (cwd.length === 0) throw new Error("cannot encode an empty project path");
    let readable = "";
    let separatorRun = false;
    for (let i = 0; i < cwd.length; i++) {
        const code = cwd.charCodeAt(i);
        const ch = String.fromCharCode(code);
        if (ch === "/" || ch === "\\" || ch === ":") {
            if (!separatorRun) readable += "-";
            separatorRun = true;
        } else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
            readable += ch;
            separatorRun = false;
        } else {
            readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
            separatorRun = false;
        }
    }
    return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

/**
 * Get the project directory under the sessions root for a given cwd.
 */
export function projectDir(cwd) {
    if (cwd === undefined) return join(SESSIONS_ROOT, "_no-cwd");
    return join(SESSIONS_ROOT, projectKey(cwd));
}
