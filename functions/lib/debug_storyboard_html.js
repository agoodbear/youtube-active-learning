"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
function parseStoryboardSpec(spec) {
    const parts = spec.split('|');
    if (parts.length < 2)
        return null;
    const url = parts[0];
    const params = parts[1].split('#');
    if (params.length < 5)
        return null;
    const width = parseInt(params[0], 10);
    const height = parseInt(params[1], 10);
    const count = parseInt(params[2], 10);
    const rows = parseInt(params[3], 10);
    const cols = parseInt(params[4], 10);
    const interval = parseInt(params[5], 10);
    return {
        template_url: url,
        thumbnail_width: width,
        thumbnail_height: height,
        rows: rows,
        columns: cols,
        interval: interval,
        storyboard_count: count
    };
}
async function fetchStoryboardSpecFromWatchHtmlLocal(html) {
    // 1. Look for spec inside playerStoryboardSpecRenderer
    // Usually inside "storyboards": { "playerStoryboardSpecRenderer": { "spec": "..." } }
    var _a, _b;
    // Quick and dirty regex extraction to avoid full JSON parsing (which is huge and complex)
    // "spec":"https://i.ytimg.com/sb/..."
    // Better: extract the ytInitialPlayerResponse object
    const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
    if (match) {
        try {
            const playerResponse = JSON.parse(match[1]);
            const spec = (_b = (_a = playerResponse.storyboards) === null || _a === void 0 ? void 0 : _a.playerStoryboardSpecRenderer) === null || _b === void 0 ? void 0 : _b.spec;
            if (spec) {
                console.log("Found spec in ytInitialPlayerResponse");
                return parseStoryboardSpec(spec);
            }
        }
        catch (e) {
            console.log("Failed to parse ytInitialPlayerResponse", e);
        }
    }
    // Fallback: direct regex search for spec string
    // "spec":"http...|"
    // Be careful not to match other things.
    // The spec always starts with http and contains |
    // "spec":"https://i.ytimg.com/sb/KAasBVVVU6M/storyboard3_L$L$/$N$.jpg|48#27#100#10#10#0#default#rs$A$..."
    const specRegex = /"spec":"(https?:[^"]+\|[^"]+)"/;
    const specMatch = html.match(specRegex);
    if (specMatch) {
        console.log("Found spec via direct regex");
        // Unescape unicode chars if any? Usually URL is clean or basic escaped
        const raw = specMatch[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
        return parseStoryboardSpec(raw);
    }
    return null;
}
async function run() {
    console.log("Reading local video.html...");
    // Use the file we just downloaded
    const html = fs.readFileSync('video.html', 'utf-8');
    const board = await fetchStoryboardSpecFromWatchHtmlLocal(html);
    if (board) {
        console.log("Success! Board:", board);
        // Let's calc logic again
        const duration = 1205;
        let durationPerTile = 10000;
        if (board.interval) {
            durationPerTile = parseInt(board.interval, 10);
            console.log(`Using explicit interval: ${durationPerTile}ms`);
        }
        else if (duration && board.storyboard_count > 0) {
            durationPerTile = Math.floor((duration * 1000) / board.storyboard_count);
            console.log(`Calculated interval: ${durationPerTile}ms`);
        }
        else {
            console.log("Using default 10000ms");
        }
    }
    else {
        console.log("Failed to find spec in HTML");
    }
}
run();
//# sourceMappingURL=debug_storyboard_html.js.map