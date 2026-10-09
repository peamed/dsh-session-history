/**
 * Formatting utilities for tool output rendering.
 */

/**
 * Format a byte count into a human-readable string.
 */
export function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/**
 * Truncate a string to maxLen, appending "…" if truncated.
 */
export function truncate(str, maxLen) {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + "…";
}

/**
 * Build the text output for a list action result.
 */
export function renderList(value) {
    const lines = [
        `Total: ${value.totalSessions} session(s) across ${value.groups.length} workspace(s)\n`,
    ];
    for (const g of value.groups) {
        lines.push(
            `━━ ${g.workspace} (${g.sessionCount} sessions)${g.path ? `  ${g.path}` : ""} ━━`,
        );
        if (g.sessions.length === 0) {
            lines.push("  (empty)");
        } else {
            for (const s of g.sessions) {
                const flags = [
                    s.archived ? "archived" : "",
                    s.orphaned ? "orphaned" : "",
                ]
                    .filter(Boolean)
                    .join(", ");
                const summary = s.summary
                    ? `  "${truncate(s.summary, 80)}"`
                    : "";
                lines.push(
                    `  • ${s.id}  (${s.sizeHuman}, ${s.modified.slice(0, 19)}${flags ? ` [${flags}]` : ""})${summary}`,
                );
            }
        }
        lines.push("");
    }
    return lines.join("\n");
}

/**
 * Build the text output for a search action result.
 */
export function renderSearch(value) {
    const lines = [`Found ${value.searchResults.length} matching session(s):\n`];
    for (const r of value.searchResults) {
        lines.push(
            `━━ ${r.id}  (${r.workspace}, ${r.matchCount} match(es)) ━━`,
        );
        for (const m of r.matchedMessages) {
            lines.push(`  [seq ${m.seq}] ${truncate(m.preview, 120)}`);
        }
        lines.push("");
    }
    return lines.join("\n");
}

/**
 * Build the text output for a delete action result.
 */
export function renderDelete(value) {
    const lines = ["Session deletion complete."];
    if (value.deleted.length > 0) {
        lines.push(`\nDeleted (${value.deleted.length}):`);
        for (const id of value.deleted) lines.push(`  ✓ ${id}`);
    }
    if (value.notFound.length > 0) {
        lines.push(`\nNot found (${value.notFound.length}):`);
        for (const id of value.notFound) lines.push(`  ✗ ${id}`);
    }
    return lines.join("\n");
}
