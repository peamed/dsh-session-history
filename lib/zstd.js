/**
 * Multi-frame Zstandard decompression + session content extraction.
 *
 * DSH appends each event batch as a separate Zstandard frame, so a single
 * .jsonl.zstd file may contain hundreds of frames that must be individually
 * decompressed and concatenated.
 */

import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

/**
 * Decompress a multi-frame Zstandard file into a single string.
 */
export function decompressSessionFile(filePath) {
    const buf = readFileSync(filePath);

    // Find all zstd frame magic offsets
    const offsets = [];
    for (let i = 0; i <= buf.length - 4; i++) {
        if (
            buf[i] === ZSTD_MAGIC[0] &&
            buf[i + 1] === ZSTD_MAGIC[1] &&
            buf[i + 2] === ZSTD_MAGIC[2] &&
            buf[i + 3] === ZSTD_MAGIC[3]
        ) {
            offsets.push(i);
        }
    }

    if (offsets.length === 0) {
        // Not multi-frame — try single decompress
        return zstdDecompressSync(buf).toString("utf-8");
    }

    // Decompress each frame and concatenate
    let result = "";
    offsets.push(buf.length);
    for (let i = 0; i < offsets.length - 1; i++) {
        const frame = buf.subarray(offsets[i], offsets[i + 1]);
        try {
            const decompressed = zstdDecompressSync(frame);
            result += decompressed.toString("utf-8");
        } catch {
            // Skip malformed frames (e.g. the last partial frame)
        }
    }
    return result;
}

/**
 * Extract user messages from a decompressed session JSONL.
 * @param {string} text - decompressed JSONL text
 * @param {number} maxPreview - max chars per message preview
 * @returns {{seq: number, time: number, preview: string}[]}
 */
export function extractUserMessages(text, maxPreview = 200) {
    const messages = [];
    for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
            const evt = JSON.parse(line);
            if (evt.data?.role !== "user") continue;

            let preview = "";
            if (typeof evt.data.content === "string") {
                preview = evt.data.content;
            } else if (Array.isArray(evt.data.content)) {
                // Extract text blocks, skip system-reminder and runtime context
                const textParts = evt.data.content
                    .filter(c => c.type === "text" && typeof c.text === "string")
                    .map(c => c.text)
                    .filter(
                        t =>
                            !t.startsWith("<system-reminder>") &&
                            !t.startsWith("Current runtime context"),
                    );
                preview = textParts.join(" ");
            }

            if (preview.trim()) {
                messages.push({
                    seq: evt.seq,
                    time: evt.time,
                    preview: preview.slice(0, maxPreview),
                });
            }
        } catch {
            /* skip malformed lines */
        }
    }
    return messages;
}

/**
 * Get a session's first user message (used as a title/summary).
 * @param {string} filePath - path to the .jsonl.zstd file
 * @returns {string} summary text, or "" if none found
 */
export function getSessionSummary(filePath) {
    try {
        const text = decompressSessionFile(filePath);
        const messages = extractUserMessages(text, 300);
        if (messages.length > 0) return messages[0].preview;

        // Fallback: try agent/inbox/spliced events for seeded conversations
        for (const line of text.split("\n")) {
            if (!line.trim()) continue;
            try {
                const evt = JSON.parse(line);
                if (
                    evt.type === "agent/inbox/spliced" &&
                    Array.isArray(evt.data?.inserted)
                ) {
                    for (const item of evt.data.inserted) {
                        if (Array.isArray(item.content)) {
                            const txt = item.content.find(c => c.type === "text");
                            if (txt?.text) return txt.text.slice(0, 300);
                        }
                    }
                }
            } catch {}
        }
    } catch {
        /* ignore */
    }
    return "";
}
