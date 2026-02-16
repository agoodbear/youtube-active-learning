"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureSnapshot = exports.getTranscriptPublicAsia = exports.getTranscriptPublic = exports.getTranscript = void 0;
const https_1 = require("firebase-functions/v2/https");
const functions = require("firebase-functions");
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = require("fs");
const os = require("os");
const path = require("path");
const nodeCrypto = require("crypto");
const undici_1 = require("undici");
const youtube_transcript_plus_1 = require("youtube-transcript-plus");
const yt_dlp_wrap_1 = require("yt-dlp-wrap");
const youtubei_js_1 = require("youtubei.js");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const ffmpegPath = require('ffmpeg-static');
const YTDLP_BINARY = 'yt-dlp';
const YTDLP_PATH = path.join(os.tmpdir(), YTDLP_BINARY);
async function ensureYtDlp() {
    if (fs.existsSync(YTDLP_PATH)) {
        return;
    }
    console.log("[Setup] Downloading yt-dlp binary...");
    await yt_dlp_wrap_1.default.downloadFromGithub(YTDLP_PATH);
    fs.chmodSync(YTDLP_PATH, '755'); // Make executable
    console.log("[Setup] yt-dlp downloaded and executable.");
}
function secondsToMs(seconds) {
    return Math.round(seconds * 1000);
}
const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";
// This API key is commonly embedded in YouTube clients. Using it lets us call Innertube
// without first scraping the watch page (which is frequently blocked in server environments).
const INNERTUBE_API_KEYS = [
    "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
];
const TRANSCRIPT_DEBUG_KEY = functions.params.defineSecret("TRANSCRIPT_DEBUG_KEY");
const TRANSCRIPT_PROXY_URL = functions.params.defineSecret("TRANSCRIPT_PROXY_URL");
let cachedProxyAgent = null;
let cachedProxyUrl = null;
function getProxyAgentOrNull() {
    const proxyUrl = (TRANSCRIPT_PROXY_URL.value() || "").trim();
    if (!proxyUrl)
        return null;
    // Allow deploying with a placeholder secret value (e.g. "DISABLED") and only
    // enable proxying when a real URL is configured.
    if (!/^https?:\/\//i.test(proxyUrl) && !/^socks5h?:\/\//i.test(proxyUrl)) {
        return null;
    }
    if (cachedProxyAgent && cachedProxyUrl === proxyUrl)
        return cachedProxyAgent;
    cachedProxyUrl = proxyUrl;
    cachedProxyAgent = new undici_1.ProxyAgent(proxyUrl);
    console.log("[net] Using outbound proxy for YouTube requests");
    return cachedProxyAgent;
}
async function fetchMaybeViaProxy(url, init, proxyAgent) {
    if (!proxyAgent)
        return fetch(url, init);
    // undici fetch supports a per-request dispatcher. We avoid changing global dispatchers.
    const headers = init.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : init.headers;
    const undiciInit = Object.assign(Object.assign({}, init), { headers, dispatcher: proxyAgent });
    return (0, undici_1.fetch)(url, undiciInit);
}
function withYouTubeHeaders(init, url, userAgent = DEFAULT_UA, refererOverride) {
    // YouTube sometimes serves consent/bot walls to datacenter IPs. These headers/cookies
    // improve the chance of receiving the normal watch/player responses.
    const u = new URL(url);
    const referer = refererOverride || (u.origin + "/");
    const headers = new Headers(init.headers || {});
    headers.set("User-Agent", userAgent);
    headers.set("Accept", headers.get("Accept") || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    headers.set("Accept-Language", headers.get("Accept-Language") || "en-US,en;q=0.9");
    headers.set("Referer", headers.get("Referer") || referer);
    headers.set("Origin", headers.get("Origin") || u.origin);
    // Consent cookie avoids some interstitials that omit INNERTUBE_API_KEY.
    // This is a commonly used lightweight bypass; if YouTube requires a CAPTCHA, we still fail gracefully.
    if (!headers.has("Cookie")) {
        headers.set("Cookie", "CONSENT=YES+1");
    }
    return Object.assign(Object.assign({}, init), { headers, redirect: "follow" });
}
function createYoutubeFetch(referer) {
    return async (params) => {
        const { url, method, body, headers, userAgent } = params;
        const init = {
            method: method || "GET",
            headers,
            body,
        };
        const proxyAgent = getProxyAgentOrNull();
        return fetchMaybeViaProxy(url, withYouTubeHeaders(init, url, userAgent, referer), proxyAgent);
    };
}
async function fetchWithHeaders(url, init, userAgent, referer) {
    const normalized = {
        method: init.method || "GET",
        headers: init.headers,
        body: init.body,
    };
    const proxyAgent = getProxyAgentOrNull();
    return fetchMaybeViaProxy(url, withYouTubeHeaders(normalized, url, userAgent, referer), proxyAgent);
}
async function safeReadText(res, maxChars = 512) {
    try {
        const text = await res.text();
        return text.slice(0, maxChars);
    }
    catch (_a) {
        return "";
    }
}
let cachedVisitorData = null;
async function fetchVisitorData(referer, userAgent) {
    const now = Date.now();
    if (cachedVisitorData && now - cachedVisitorData.ts < 60 * 60 * 1000) {
        return cachedVisitorData.value;
    }
    const res = await fetchWithHeaders("https://www.youtube.com/", { headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" } }, userAgent, referer);
    if (!res.ok) {
        const snippet = await safeReadText(res);
        console.warn(`[innertube] visitorData non-OK ${res.status} ${res.headers.get("content-type") || ""} ${snippet}`);
        return null;
    }
    const html = await res.text();
    const match = html.match(/"visitorData":"([^"]+)"/) ||
        html.match(/VISITOR_DATA":"([^"]+)"/) ||
        html.match(/"VISITOR_DATA":"([^"]+)"/);
    if (!match) {
        console.warn("[innertube] visitorData not found in / HTML");
        return null;
    }
    cachedVisitorData = { value: match[1], ts: now };
    return match[1];
}
async function fetchCaptionTracksFromInnertubePlayer(videoId, referer, userAgent) {
    var _a, _b, _c, _d;
    const attempts = [
        {
            name: "WEB",
            userAgent: DEFAULT_UA,
            referer,
            headers: {
                "content-type": "application/json",
                "accept": "application/json",
                "x-youtube-client-name": "1",
                "x-youtube-client-version": "2.20240229.01.00",
            },
            body: {
                context: {
                    client: {
                        clientName: "WEB",
                        clientVersion: "2.20240229.01.00",
                        hl: "en",
                        gl: "US",
                    },
                },
                videoId,
                contentCheckOk: true,
                racyCheckOk: true,
            },
        },
        {
            name: "ANDROID",
            userAgent: ANDROID_UA,
            referer,
            headers: {
                "content-type": "application/json",
                "accept": "application/json",
                "x-youtube-client-name": "3",
                "x-youtube-client-version": "20.10.38",
            },
            body: {
                context: {
                    client: {
                        clientName: "ANDROID",
                        clientVersion: "20.10.38",
                        hl: "en",
                        gl: "US",
                    },
                },
                videoId,
                contentCheckOk: true,
                racyCheckOk: true,
            },
        },
        {
            name: "WEB_EMBED",
            userAgent: DEFAULT_UA,
            referer: `https://www.youtube.com/embed/${videoId}`,
            headers: {
                "content-type": "application/json",
                "accept": "application/json",
                "x-youtube-client-name": "56",
                "x-youtube-client-version": "1.20240229.01.00",
            },
            body: {
                context: {
                    client: {
                        clientName: "WEB_EMBEDDED_PLAYER",
                        clientVersion: "1.20240229.01.00",
                        hl: "en",
                        gl: "US",
                    },
                },
                videoId,
                contentCheckOk: true,
                racyCheckOk: true,
            },
        },
        {
            name: "WEB_EMBED",
            userAgent: DEFAULT_UA,
            referer,
            headers: {
                "content-type": "application/json",
                "accept": "application/json",
                "x-youtube-client-name": "56",
                "x-youtube-client-version": "1.20240228.01.00",
            },
            body: {
                context: {
                    client: {
                        clientName: "WEB_EMBED",
                        clientVersion: "1.20240228.01.00",
                        hl: "en",
                        gl: "US",
                    },
                },
                videoId,
                contentCheckOk: true,
                racyCheckOk: true,
            },
        },
        {
            name: "TV_EMBEDDED",
            userAgent: "Mozilla/5.0 (SmartHub; SMART-TV; U; Linux/SmartTV) AppleWebKit/531.2+ (KHTML, like Gecko) WebBrowser/1.0 SmartHub",
            referer,
            headers: {
                "content-type": "application/json",
                "accept": "application/json",
                "x-youtube-client-name": "55",
                "x-youtube-client-version": "4.20220223.00.00",
            },
            body: {
                context: {
                    client: {
                        clientName: "TV_EMBEDDED",
                        clientVersion: "4.20220223.00.00",
                        hl: "en",
                        gl: "US",
                    },
                },
                videoId,
                contentCheckOk: true,
                racyCheckOk: true,
            },
        }
    ];
    for (const key of INNERTUBE_API_KEYS) {
        for (const attempt of attempts) {
            const visitorData = await fetchVisitorData(attempt.referer, attempt.userAgent);
            const headers = Object.assign({}, attempt.headers);
            if (visitorData) {
                headers["x-goog-visitor-id"] = visitorData;
            }
            const body = visitorData
                ? Object.assign(Object.assign({}, attempt.body), { context: Object.assign(Object.assign({}, attempt.body.context), { client: Object.assign(Object.assign({}, attempt.body.context.client), { visitorData }) }) }) : attempt.body;
            const url = `https://www.youtube.com/youtubei/v1/player?key=${key}&prettyPrint=false`;
            const res = await fetchWithHeaders(url, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
            }, attempt.userAgent, attempt.referer);
            if (!res.ok) {
                const snippet = await safeReadText(res);
                console.warn(`[innertube] player ${attempt.name} non-OK ${res.status} ${res.headers.get("content-type") || ""} ${snippet}`);
                continue;
            }
            const json = await res.json();
            const status = (_a = json === null || json === void 0 ? void 0 : json.playabilityStatus) === null || _a === void 0 ? void 0 : _a.status;
            const reason = (_b = json === null || json === void 0 ? void 0 : json.playabilityStatus) === null || _b === void 0 ? void 0 : _b.reason;
            if (status && status !== "OK") {
                console.warn(`[innertube] player ${attempt.name} playabilityStatus=${status}${reason ? ` reason=${reason}` : ""}`);
            }
            const tracks = (_d = (_c = json === null || json === void 0 ? void 0 : json.captions) === null || _c === void 0 ? void 0 : _c.playerCaptionsTracklistRenderer) === null || _d === void 0 ? void 0 : _d.captionTracks;
            if (!Array.isArray(tracks) || tracks.length === 0) {
                console.warn(`[innertube] player ${attempt.name} returned 0 captionTracks${visitorData ? " (has visitorData)" : ""}`);
                continue;
            }
            const mapped = tracks
                .filter((t) => typeof (t === null || t === void 0 ? void 0 : t.baseUrl) === "string")
                .map((t) => ({
                baseUrl: t.baseUrl,
                languageCode: t.languageCode,
                kind: t.kind,
            }));
            console.log(`[innertube] player ${attempt.name} returned ${mapped.length} captionTracks: ${mapped
                .slice(0, 5)
                .map((t) => `${t.languageCode}${t.kind === "asr" ? "(asr)" : ""}`)
                .join(", ")}`);
            return { tracks: mapped, visitorData: visitorData || undefined, clientName: attempt.name };
        }
    }
    return { tracks: [] };
}
async function fetchTranscriptFromCaptionTrackBaseUrl(baseUrl, referer, userAgent, visitorData) {
    // Try json3 first
    try {
        const json3Url = new URL(baseUrl);
        json3Url.searchParams.set("fmt", "json3");
        json3Url.searchParams.set("ipbypass", "yes");
        const json3Res = await fetchWithHeaders(json3Url.toString(), {
            headers: Object.assign({ accept: "application/json" }, (visitorData ? { "x-goog-visitor-id": visitorData } : {})),
        }, userAgent, referer);
        if (json3Res.ok) {
            const jsonBody = await json3Res.json();
            const fromJson = parseJson3Transcript(jsonBody);
            if (fromJson.length > 0) {
                return fromJson;
            }
            const ct = json3Res.headers.get("content-type") || "";
            console.warn(`[innertube] timedtext json3 parsed 0 segments (content-type=${ct})`);
        }
        else {
            const snippet = await safeReadText(json3Res);
            console.warn(`[innertube] timedtext json3 non-OK ${json3Res.status} ${json3Res.headers.get("content-type") || ""} ${snippet}`);
        }
    }
    catch (_a) {
        // ignore and try XML below
    }
    // Fall back to XML (strip fmt if present)
    const xmlUrl = baseUrl.replace(/&fmt=[^&]+/, "");
    const withBypass = new URL(xmlUrl);
    withBypass.searchParams.set("ipbypass", "yes");
    const xmlRes = await fetchWithHeaders(withBypass.toString(), {
        headers: Object.assign({ accept: "text/xml,application/xml,text/html;q=0.9,*/*;q=0.8" }, (visitorData ? { "x-goog-visitor-id": visitorData } : {})),
    }, userAgent, referer);
    if (!xmlRes.ok) {
        const snippet = await safeReadText(xmlRes);
        console.warn(`[innertube] timedtext xml non-OK ${xmlRes.status} ${xmlRes.headers.get("content-type") || ""} ${snippet}`);
        return [];
    }
    const xmlBody = await xmlRes.text();
    return parseXmlTimedText(xmlBody);
}
async function fetchTranscriptFromInnertube(videoId, referer, userAgent) {
    const result = await fetchCaptionTracksFromInnertubePlayer(videoId, referer, userAgent);
    const selected = selectBestCaptionTrack(result.tracks);
    if (!selected)
        return [];
    return fetchTranscriptFromCaptionTrackBaseUrl(selected.baseUrl, referer, userAgent, result.visitorData);
}
// Mock data for testing
const MOCK_TRANSCRIPTS = {
    "dQw4w9WgXcQ": [
        { text: "We're no strangers to love", offset: 0, duration: 4000 },
        { text: "You know the rules and so do I", offset: 4000, duration: 4000 },
        { text: "A full commitment's what I'm thinking of", offset: 8000, duration: 4000 },
        { text: "Never gonna give you up", offset: 26000, duration: 3000 },
        { text: "Never gonna let you down", offset: 29000, duration: 3000 },
    ]
};
// Parse VTT file content to our transcript format
function parseVTT(vttContent) {
    const segments = [];
    const lines = vttContent.split('\n');
    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();
        // Look for timestamp lines like "00:00:01.520 --> 00:00:04.040"
        const timestampMatch = line.match(/(\d+:\d+:\d+\.\d+)\s*-->\s*(\d+:\d+:\d+\.\d+)/);
        if (timestampMatch) {
            const startTime = parseTimestamp(timestampMatch[1]);
            const endTime = parseTimestamp(timestampMatch[2]);
            // Get the text on the next line(s)
            i++;
            let text = '';
            while (i < lines.length && lines[i].trim() !== '' && !lines[i].match(/\d+:\d+:\d+\.\d+\s*-->/)) {
                if (text)
                    text += ' ';
                text += lines[i].trim().replace(/<[^>]+>/g, ''); // Remove HTML tags
                i++;
            }
            if (text) {
                segments.push({
                    text: text,
                    offset: startTime,
                    duration: endTime - startTime
                });
            }
        }
        else {
            i++;
        }
    }
    return deduplicateSegments(segments);
}
// Deduplicate segments that are likely intermediate caption states
// (overlaps in time + substring match)
function deduplicateSegments(segments) {
    if (segments.length === 0)
        return segments;
    const cleanedSegments = [];
    // We process sequentially and modify 'next' segments in place if needed (cloning first ideally, but here we just build a new array)
    // Actually, to modify 'next' based on 'current', we can iterate.
    // Process list to remove overlaps
    for (let i = 0; i < segments.length - 1; i++) {
        const current = segments[i];
        const next = segments[i + 1];
        // If they are temporally close (start times within 5 sec? actually VTT lines are sequential)
        // VTT lines usually: 
        // 1. 00:01 -> 00:03 "Hello"
        // 2. 00:03 -> 00:05 "World"
        // 3. 00:03 -> 00:05 "Hello World" (sometimes?)
        // Use a suffix-prefix overlap check
        // We want to remove the Overlap from the START of 'next'.
        const overlapLen = getOverlapLength(current.text, next.text);
        // Threshold: e.g. 5 chars to avoid removing 'a', 'the' coincidentally? 
        // Or punctuation. 
        if (overlapLen > 5) {
            // Trim overlap from next
            next.text = next.text.substring(overlapLen).trim();
        }
        // Also apply the substring deduplication from before (if next became empty or was already substring)
        // Case A: Next is substring of Current -> Next is usually "part 2" in progress? 
        // Actually if next IS substring of current, it might be a glitch? Usually it's the other way.
        // User example:
        // Current: "brand new ... if you"
        // Next: "gone through ... diagnos of"
        // Overlap: "gone through ... if you"
        // Result Next: "still haven't ..."  <-- This is what we want.
        if (current.text.trim().length > 0) {
            cleanedSegments.push(current);
        }
    }
    // Add the last one
    if (segments[segments.length - 1].text.trim().length > 0) {
        cleanedSegments.push(segments[segments.length - 1]);
    }
    return cleanedSegments;
}
function getOverlapLength(str1, str2) {
    const s1 = str1.trim().toLowerCase();
    const s2 = str2.trim().toLowerCase();
    // Check if s2 starts with a suffix of s1
    // Optimization: start checking from min(s1.length, s2.length)
    const maxOverlap = Math.min(s1.length, s2.length);
    for (let len = maxOverlap; len > 0; len--) {
        if (s1.endsWith(s2.substring(0, len))) {
            // Double check with original string to preserve casing if needed? 
            // Nah, fuzzy match is fine, but we return length relative to original string logic?
            // We need strictly matching char count from str2's start.
            // Let's verify exact match on the original suffix for safety, 
            // or just rely on the fuzzy match index but return the index.
            // Actually, verify exact source case match to be safe?
            // Or allow case insensitive?
            // User text: "steps if you" (end of A), "gone through ... steps if you" (start of B).
            // Wait, in user example: "steps if you" is at END of A.
            // "gone through... steps if you" is start of B? 
            // NO.
            // Text A: "... steps if you"
            // Text B: "gone through ... steps if you ... diagnos"
            // Overlap: "gone through ... steps if you".
            // A contains the overlap at its END.
            // B contains the overlap at its START.
            // My logic: s1.endsWith(...)
            // Does A end with "gone through ... steps if you"? YES.
            // Does B start with "gone through ... steps if you"? YES.
            return len;
        }
    }
    return 0;
}
// Parse VTT timestamp to milliseconds
function parseTimestamp(timestamp) {
    const parts = timestamp.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const secondsParts = parts[2].split('.');
    const seconds = parseInt(secondsParts[0], 10);
    const milliseconds = parseInt(secondsParts[1], 10);
    return (hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds;
}
function decodeHtmlEntities(value) {
    return value
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
function normalizeCaptionText(value) {
    return decodeHtmlEntities(value)
        .replace(/\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function parseJson3Transcript(json) {
    const events = json.events || [];
    const segments = [];
    for (const event of events) {
        if (!event.segs || event.segs.length === 0)
            continue;
        const text = normalizeCaptionText(event.segs.map((seg) => seg.utf8 || "").join(""));
        if (!text)
            continue;
        const offset = typeof event.tStartMs === "number" ? event.tStartMs : 0;
        const duration = typeof event.dDurationMs === "number" ? event.dDurationMs : 1000;
        segments.push({ text, offset, duration: Math.max(1, duration) });
    }
    return deduplicateSegments(segments);
}
function parseXmlTimedText(xml) {
    const segments = [];
    const regex = /<text start="([^"]+)" dur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;
    for (const match of xml.matchAll(regex)) {
        const offsetSec = Number.parseFloat(match[1]);
        const durationSec = Number.parseFloat(match[2]);
        const text = normalizeCaptionText(match[3]);
        if (!text || Number.isNaN(offsetSec) || Number.isNaN(durationSec))
            continue;
        segments.push({
            text,
            offset: secondsToMs(offsetSec),
            duration: Math.max(1, secondsToMs(durationSec)),
        });
    }
    return deduplicateSegments(segments);
}
function extractCaptionTracksFromWatchHtml(html) {
    var _a;
    const marker = "\"captions\":";
    const markerIndex = html.indexOf(marker);
    if (markerIndex === -1)
        return [];
    const objectStart = html.indexOf("{", markerIndex + marker.length);
    if (objectStart === -1)
        return [];
    let depth = 0;
    let inString = false;
    let escaped = false;
    let objectEnd = -1;
    for (let i = objectStart; i < html.length; i++) {
        const ch = html[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            }
            else if (ch === "\\") {
                escaped = true;
            }
            else if (ch === "\"") {
                inString = false;
            }
            continue;
        }
        if (ch === "\"") {
            inString = true;
            continue;
        }
        if (ch === "{") {
            depth++;
            continue;
        }
        if (ch === "}") {
            depth--;
            if (depth === 0) {
                objectEnd = i;
                break;
            }
        }
    }
    if (objectEnd === -1)
        return [];
    try {
        const captionsJson = JSON.parse(html.slice(objectStart, objectEnd + 1));
        const tracks = (_a = captionsJson === null || captionsJson === void 0 ? void 0 : captionsJson.playerCaptionsTracklistRenderer) === null || _a === void 0 ? void 0 : _a.captionTracks;
        if (!Array.isArray(tracks))
            return [];
        return tracks.filter((track) => Boolean(track === null || track === void 0 ? void 0 : track.baseUrl));
    }
    catch (_b) {
        return [];
    }
}
function selectBestCaptionTrack(tracks) {
    if (tracks.length === 0)
        return null;
    const sorted = [...tracks].sort((a, b) => {
        var _a, _b;
        const aEnglish = ((_a = a.languageCode) === null || _a === void 0 ? void 0 : _a.toLowerCase().startsWith("en")) ? 0 : 1;
        const bEnglish = ((_b = b.languageCode) === null || _b === void 0 ? void 0 : _b.toLowerCase().startsWith("en")) ? 0 : 1;
        if (aEnglish !== bEnglish)
            return aEnglish - bEnglish;
        const aAsr = a.kind === "asr" ? 1 : 0;
        const bAsr = b.kind === "asr" ? 1 : 0;
        return aAsr - bAsr;
    });
    return sorted[0] || null;
}
async function fetchTranscriptFromTimedTextApi(videoId, referer, userAgent) {
    const watchRes = await fetchWithHeaders(`https://www.youtube.com/watch?v=${videoId}`, {}, userAgent, referer);
    if (!watchRes.ok) {
        throw new Error(`Failed to fetch watch page (${watchRes.status})`);
    }
    const watchHtml = await watchRes.text();
    const tracks = extractCaptionTracksFromWatchHtml(watchHtml);
    console.log(`[timedtext] Found ${tracks.length} captionTracks from watch HTML`);
    const selectedTrack = selectBestCaptionTrack(tracks);
    if (!selectedTrack)
        return [];
    const json3Url = new URL(selectedTrack.baseUrl);
    json3Url.searchParams.set("fmt", "json3");
    const json3Res = await fetchWithHeaders(json3Url.toString(), {}, userAgent, referer);
    if (json3Res.ok) {
        try {
            const jsonBody = await json3Res.json();
            const fromJson = parseJson3Transcript(jsonBody);
            if (fromJson.length > 0) {
                return fromJson;
            }
        }
        catch (_a) {
            // Some timedtext responses are XML or empty even with fmt=json3
        }
    }
    const xmlRes = await fetchWithHeaders(selectedTrack.baseUrl, {}, userAgent, referer);
    if (!xmlRes.ok) {
        return [];
    }
    const xmlBody = await xmlRes.text();
    return parseXmlTimedText(xmlBody);
}
// @ts-ignore
exports.getTranscript = (0, https_1.onCall)({ secrets: [TRANSCRIPT_PROXY_URL] }, async (request) => {
    var _a, _b, _c;
    const { data, auth } = request;
    if (!auth) {
        throw new https_1.HttpsError("unauthenticated", "The function must be called while authenticated.");
    }
    const videoId = data === null || data === void 0 ? void 0 : data.videoId;
    if (!videoId) {
        throw new https_1.HttpsError("invalid-argument", "The function must be called with a 'videoId' argument.");
    }
    // 1. Check Mock Data First (Always succeed for demo videos)
    if (MOCK_TRANSCRIPTS[videoId]) {
        console.log(`[getTranscript] Returning MOCK data for ${videoId}`);
        return MOCK_TRANSCRIPTS[videoId];
    }
    // 2. Primary path for deployed environments (no local binaries required)
    const referer = `https://www.youtube.com/watch?v=${videoId}`;
    const youtubeFetch = createYoutubeFetch(referer);
    // 2a. Best-effort Innertube call with a fixed API key (avoids watch-page scraping).
    try {
        console.log(`[innertube] Fetching transcript for ${videoId}`);
        const transcript = await fetchTranscriptFromInnertube(videoId, referer, DEFAULT_UA);
        if (transcript.length > 0) {
            console.log(`[innertube] Parsed ${transcript.length} segments`);
            return transcript;
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[innertube] Failed for ${videoId}: ${message}`);
    }
    try {
        console.log(`[youtube-transcript-plus] Fetching transcript for ${videoId}`);
        // Prefer a configured instance so we can set consent cookie and stable UA/headers.
        // This reduces "not available" false negatives on Cloud Functions egress IPs.
        const yt = new youtube_transcript_plus_1.YoutubeTranscript({
            userAgent: DEFAULT_UA,
            videoFetch: youtubeFetch,
            playerFetch: youtubeFetch,
            transcriptFetch: youtubeFetch,
        });
        const transcript = await yt.fetchTranscript(videoId);
        const mapped = transcript.map((segment) => ({
            text: segment.text,
            offset: secondsToMs(segment.offset),
            duration: Math.max(1, secondsToMs(segment.duration)),
        }));
        if (mapped.length > 0) {
            console.log(`[youtube-transcript-plus] Parsed ${mapped.length} segments`);
            return mapped;
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[youtube-transcript-plus] Failed for ${videoId}: ${message}`);
        if (error instanceof youtube_transcript_plus_1.YoutubeTranscriptTooManyRequestError || message.includes("too many requests") || message.includes("captcha")) {
            throw new https_1.HttpsError("resource-exhausted", "YouTube is currently rate-limiting requests. Please try again later or upload an SRT file manually.");
        }
        // If YouTube returns an interstitial/consent page, youtube-transcript-plus can surface
        // as NotAvailable. Treat that as a transient error rather than a true not-found.
        if (error instanceof youtube_transcript_plus_1.YoutubeTranscriptDisabledError) {
            throw new https_1.HttpsError("not-found", `No transcript found for video ${videoId}`);
        }
    }
    // 3. Secondary fallback: parse timedtext directly
    try {
        console.log(`[timedtext] Fetching transcript for ${videoId}`);
        const transcript = await fetchTranscriptFromTimedTextApi(videoId, referer, DEFAULT_UA);
        if (transcript.length > 0) {
            console.log(`[timedtext] Parsed ${transcript.length} segments`);
            return transcript;
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[timedtext] Failed for ${videoId}: ${message}`);
        if (message.includes("too many requests") || message.includes("captcha")) {
            throw new https_1.HttpsError("resource-exhausted", "YouTube is currently rate-limiting requests. Please try again later or upload an SRT file manually.");
        }
    }
    // 4. Last fallback to yt-dlp where available (mainly local/dev environments)
    console.log(`[yt-dlp] Falling back to yt-dlp for ${videoId}`);
    // Create temp directory for output - inside try/catch for safety
    let tempDir = null;
    let outputTemplate = null;
    try {
        // Ensure yt-dlp binary is ready
        await ensureYtDlp();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-'));
        outputTemplate = path.join(tempDir, '%(id)s');
        // Run yt-dlp to download subtitles only
        let ytdlpCmd = `${YTDLP_PATH} --write-auto-sub --sub-langs "en.*" --skip-download --sub-format vtt -o "${outputTemplate}"`;
        const proxyUrl = TRANSCRIPT_PROXY_URL.value();
        if (proxyUrl) {
            ytdlpCmd += ` --proxy "${proxyUrl}"`;
        }
        ytdlpCmd += ` "https://www.youtube.com/watch?v=${videoId}"`;
        console.log(`[yt-dlp] Running: ${ytdlpCmd}`);
        const { stdout, stderr } = await execAsync(ytdlpCmd, { timeout: 30000 });
        console.log(`[yt-dlp] stdout: ${stdout}`);
        if (stderr)
            console.log(`[yt-dlp] stderr: ${stderr}`);
        // Find the downloaded VTT file
        const files = fs.readdirSync(tempDir);
        const vttFile = files.find(f => f.endsWith('.vtt'));
        if (vttFile) {
            const vttPath = path.join(tempDir, vttFile);
            const vttContent = fs.readFileSync(vttPath, 'utf-8');
            console.log(`[yt-dlp] VTT file found: ${vttFile}, length: ${vttContent.length}`);
            const segments = parseVTT(vttContent);
            console.log(`[yt-dlp] Parsed ${segments.length} segments`);
            if (segments.length > 0) {
                return segments;
            }
        }
        else {
            console.log(`[yt-dlp] No VTT file found. Files in temp: ${files.join(', ')}`);
        }
    }
    catch (error) {
        console.error(`[yt-dlp] Error: ${error.message}`);
        // Check for Rate Limiting / 429
        if (((_a = error.message) === null || _a === void 0 ? void 0 : _a.includes('HTTP Error 429')) || ((_b = error.stderr) === null || _b === void 0 ? void 0 : _b.includes('HTTP Error 429'))) {
            throw new https_1.HttpsError("resource-exhausted", "YouTube is currently rate-limiting requests. Please try again later or upload an SRT file manually.");
        }
        // Rethrow other known HttpsErrors
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        // If binary is missing in runtime, don't surface internal error to user.
        if ((_c = error.message) === null || _c === void 0 ? void 0 : _c.includes("yt-dlp: not found")) {
            throw new https_1.HttpsError("not-found", `No transcript found for video ${videoId}`);
        }
        // For unknown errors, throw internal but with a message?
        // Or let it be handled by default?
        // If we want to avoid "internal" without details:
        throw new https_1.HttpsError("internal", `Failed to fetch transcript: ${error.message}`);
    }
    finally {
        // Cleanup
        if (tempDir) {
            try {
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true });
                }
            }
            catch (e) {
                console.error("Failed to cleanup temp dir:", e);
            }
        }
    }
    throw new https_1.HttpsError("not-found", `No transcript found for video ${videoId}`);
});
// Key-protected HTTP endpoint for smoke testing in production without Firebase Auth.
// Enabled via Secret Manager: TRANSCRIPT_DEBUG_KEY
exports.getTranscriptPublic = (0, https_1.onRequest)({ secrets: [TRANSCRIPT_DEBUG_KEY, TRANSCRIPT_PROXY_URL] }, async (req, res) => {
    try {
        const expected = TRANSCRIPT_DEBUG_KEY.value() || "";
        const key = String(req.query.key || req.header("x-api-key") || "");
        if (!expected) {
            res.status(503).json({ ok: false, error: "TRANSCRIPT_DEBUG_KEY not configured" });
            return;
        }
        if (!key || key !== expected) {
            res.status(401).json({ ok: false, error: "Unauthorized" });
            return;
        }
        const videoId = String(req.query.videoId || "");
        if (!videoId) {
            res.status(400).json({ ok: false, error: "Missing videoId" });
            return;
        }
        const referer = `https://www.youtube.com/watch?v=${videoId}`;
        console.log(`[getTranscriptPublic] Fetching transcript for ${videoId}`);
        const transcript = await fetchTranscriptFromInnertube(videoId, referer, DEFAULT_UA);
        if (transcript.length > 0) {
            res.status(200).json({ ok: true, source: "innertube", segmentsCount: transcript.length });
            return;
        }
        res.status(404).json({ ok: false, error: "No transcript found" });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[getTranscriptPublic] Error: ${message}`);
        res.status(500).json({ ok: false, error: message });
    }
});
exports.getTranscriptPublicAsia = (0, https_1.onRequest)({ region: "asia-east1", secrets: [TRANSCRIPT_DEBUG_KEY, TRANSCRIPT_PROXY_URL] }, async (req, res) => {
    try {
        const expected = TRANSCRIPT_DEBUG_KEY.value() || "";
        const key = String(req.query.key || req.header("x-api-key") || "");
        if (!expected) {
            res.status(503).json({ ok: false, error: "TRANSCRIPT_DEBUG_KEY not configured" });
            return;
        }
        if (!key || key !== expected) {
            res.status(401).json({ ok: false, error: "Unauthorized" });
            return;
        }
        const videoId = String(req.query.videoId || "");
        if (!videoId) {
            res.status(400).json({ ok: false, error: "Missing videoId" });
            return;
        }
        const referer = `https://www.youtube.com/watch?v=${videoId}`;
        console.log(`[getTranscriptPublicAsia] Fetching transcript for ${videoId}`);
        const transcript = await fetchTranscriptFromInnertube(videoId, referer, DEFAULT_UA);
        if (transcript.length > 0) {
            res.status(200).json({ ok: true, source: "innertube", segmentsCount: transcript.length });
            return;
        }
        res.status(404).json({ ok: false, error: "No transcript found" });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[getTranscriptPublicAsia] Error: ${message}`);
        res.status(500).json({ ok: false, error: message });
    }
});
// ─── Snapshot Capture ─────────────────────────────────────────────────
// Uses yt-dlp to download a video segment, ffmpeg to extract a frame,
// then uploads the frame to Firebase Storage.
// @ts-ignore
// Helper to find a direct video URL from InnerTube (Android client preferred)
async function fetchVideoUrlFromInnertube(videoId) {
    var _a, _b, _c, _d;
    const referer = `https://www.youtube.com/watch?v=${videoId}`;
    // Android client 19.x+ often returns raw 'url' in streamingData without signature cipher for some videos.
    // Try Android first.
    const attempts = [
        {
            name: "ANDROID",
            userAgent: ANDROID_UA,
            referer,
            headers: {
                "content-type": "application/json",
                "accept": "application/json",
                "x-youtube-client-name": "3",
                "x-youtube-client-version": "20.10.38",
            },
            body: {
                context: {
                    client: {
                        clientName: "ANDROID",
                        clientVersion: "20.10.38",
                        hl: "en",
                        gl: "US",
                        androidSdkVersion: 30
                    },
                },
                videoId,
                contentCheckOk: true,
                racyCheckOk: true,
            },
        },
        {
            name: "IOS",
            userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
            referer,
            headers: {
                "content-type": "application/json",
                "accept": "application/json",
                "x-youtube-client-name": "5",
                "x-youtube-client-version": "19.29.1",
            },
            body: {
                context: {
                    client: {
                        clientName: "IOS",
                        clientVersion: "19.29.1",
                        hl: "en",
                        gl: "US",
                        deviceMake: "Apple",
                        deviceModel: "iPhone14,5",
                        osName: "iPhone",
                        osVersion: "16.0",
                    },
                },
                videoId,
                contentCheckOk: true,
                racyCheckOk: true,
            }
        },
        {
            name: "WEB_EMBED",
            userAgent: DEFAULT_UA,
            referer,
            headers: {
                "content-type": "application/json",
                "accept": "application/json",
                "x-youtube-client-name": "56",
                "x-youtube-client-version": "1.20240228.01.00",
            },
            body: {
                context: {
                    client: {
                        clientName: "WEB_EMBED",
                        clientVersion: "1.20240228.01.00",
                        hl: "en",
                        gl: "US",
                    },
                },
                videoId,
                contentCheckOk: true,
                racyCheckOk: true,
            },
        },
        {
            name: "TV_EMBEDDED",
            userAgent: "Mozilla/5.0 (SmartHub; SMART-TV; U; Linux/SmartTV) AppleWebKit/531.2+ (KHTML, like Gecko) WebBrowser/1.0 SmartHub",
            referer,
            headers: {
                "content-type": "application/json",
                "accept": "application/json",
                "x-youtube-client-name": "55",
                "x-youtube-client-version": "4.20220223.00.00",
            },
            body: {
                context: {
                    client: {
                        clientName: "TV_EMBEDDED",
                        clientVersion: "4.20220223.00.00",
                        hl: "en",
                        gl: "US",
                    },
                },
                videoId,
                contentCheckOk: true,
                racyCheckOk: true,
            },
        },
        {
            name: "TV",
            userAgent: "Mozilla/5.0 (ChromiumNet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36",
            referer,
            headers: {
                "content-type": "application/json",
                "accept": "application/json",
                "x-youtube-client-name": "38",
                "x-youtube-client-version": "6.20240223.00.00",
            },
            body: {
                context: {
                    client: {
                        clientName: "TV",
                        clientVersion: "6.20240223.00.00",
                        hl: "en",
                        gl: "US",
                    },
                },
                videoId,
                contentCheckOk: true,
                racyCheckOk: true,
            },
        }
    ];
    for (const key of INNERTUBE_API_KEYS) {
        for (const attempt of attempts) {
            try {
                const url = `https://www.youtube.com/youtubei/v1/player?key=${key}&prettyPrint=false`;
                const res = await fetchWithHeaders(url, {
                    method: "POST",
                    headers: attempt.headers,
                    body: JSON.stringify(attempt.body)
                }, attempt.userAgent, attempt.referer);
                if (!res.ok)
                    continue;
                const json = await res.json();
                if (((_a = json.playabilityStatus) === null || _a === void 0 ? void 0 : _a.status) !== "OK") {
                    console.warn(`[innertube-video] ${attempt.name} playability: ${(_b = json.playabilityStatus) === null || _b === void 0 ? void 0 : _b.status}`);
                }
                const formats = [
                    ...(((_c = json.streamingData) === null || _c === void 0 ? void 0 : _c.formats) || []),
                    ...(((_d = json.streamingData) === null || _d === void 0 ? void 0 : _d.adaptiveFormats) || [])
                ];
                // Find a usable MP4/WebM with video, preferably < 720p, AND has 'url' property (no cipher)
                const usable = formats.filter((f) => {
                    var _a, _b;
                    return f.url &&
                        (((_a = f.mimeType) === null || _a === void 0 ? void 0 : _a.includes("video/mp4")) || ((_b = f.mimeType) === null || _b === void 0 ? void 0 : _b.includes("video/webm")));
                }).sort((a, b) => {
                    const ha = a.height || 0;
                    const hb = b.height || 0;
                    return hb - ha; // Descending height
                });
                if (usable.length > 0) {
                    console.log(`[innertube-video] Found ${usable.length} direct URLs via ${attempt.name}`);
                    return { url: usable[0].url, userAgent: attempt.userAgent, referer: attempt.referer };
                }
            }
            catch (e) {
                console.warn(`[innertube-video] Error ${attempt.name}: ${e}`);
            }
        }
    }
    return null;
}
// Manual Storyboard Fetching & Parsing
// Bypass Innertube library which fails on signature extraction when proxy/IP is restricted.
async function fetchStoryboardSpecManual(videoId) {
    var _a, _b, _c, _d, _e, _f, _g;
    const referer = `https://www.youtube.com/watch?v=${videoId}`;
    // Web Embed and TV Embed are often less restricted for metadata
    const attempts = [
        {
            name: "WEB_EMBED",
            userAgent: DEFAULT_UA,
            referer,
            headers: {
                "content-type": "application/json",
                "x-youtube-client-name": "56",
                "x-youtube-client-version": "1.20240228.01.00",
            },
            body: {
                context: {
                    client: {
                        clientName: "WEB_EMBED",
                        clientVersion: "1.20240228.01.00",
                        hl: "en",
                        gl: "US",
                    },
                },
                videoId,
            },
        },
        {
            name: "MWEB",
            userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
            referer,
            headers: {
                "content-type": "application/json",
                "x-youtube-client-name": "2",
                "x-youtube-client-version": "2.20240308.00.00",
            },
            body: {
                context: {
                    client: {
                        clientName: "MWEB",
                        clientVersion: "2.20240308.00.00",
                        hl: "en",
                        gl: "US",
                    },
                },
                videoId,
            },
        },
        {
            name: "WEB",
            userAgent: DEFAULT_UA,
            referer,
            headers: {
                "content-type": "application/json",
                "x-youtube-client-name": "1",
                "x-youtube-client-version": "2.20240308.00.00",
            },
            body: {
                context: {
                    client: {
                        clientName: "WEB",
                        clientVersion: "2.20240308.00.00",
                        hl: "en",
                        gl: "US",
                    },
                },
                videoId,
            },
        },
        {
            name: "TV_EMBEDDED",
            userAgent: "Mozilla/5.0 (SmartHub; SMART-TV; U; Linux/SmartTV) AppleWebKit/531.2+ (KHTML, like Gecko) WebBrowser/1.0 SmartHub",
            referer,
            headers: {
                "content-type": "application/json",
                "x-youtube-client-name": "55",
                "x-youtube-client-version": "4.20220223.00.00",
            },
            body: {
                context: {
                    client: {
                        clientName: "TV_EMBEDDED",
                        clientVersion: "4.20220223.00.00",
                        hl: "en",
                        gl: "US",
                    },
                },
                videoId,
            },
        },
        // Fallback to Android if others fail (though likely blocked)
        {
            name: "ANDROID",
            userAgent: ANDROID_UA,
            referer,
            headers: {
                "content-type": "application/json",
                "x-youtube-client-name": "3",
                "x-youtube-client-version": "20.10.38",
            },
            body: {
                context: {
                    client: {
                        clientName: "ANDROID",
                        clientVersion: "20.10.38",
                        hl: "en",
                        gl: "US",
                        androidSdkVersion: 30
                    },
                },
                videoId,
            },
        }
    ];
    for (const key of INNERTUBE_API_KEYS) {
        for (const attempt of attempts) {
            try {
                const url = `https://www.youtube.com/youtubei/v1/player?key=${key}&prettyPrint=false`;
                const res = await fetchWithHeaders(url, {
                    method: "POST",
                    headers: attempt.headers,
                    body: JSON.stringify(attempt.body)
                }, attempt.userAgent, attempt.referer);
                if (!res.ok)
                    continue;
                const json = await res.json();
                if (((_a = json.playabilityStatus) === null || _a === void 0 ? void 0 : _a.status) !== 'OK') {
                    console.log(`[ManualStoryboard] ${attempt.name} status: ${(_b = json.playabilityStatus) === null || _b === void 0 ? void 0 : _b.status}`);
                }
                console.log(`[ManualStoryboard] ${attempt.name} keys: ${Object.keys(json).join(',')}`);
                if (json.storyboards)
                    console.log(`[ManualStoryboard] storyboards keys: ${Object.keys(json.storyboards).join(',')}`);
                if (json.playerConfig)
                    console.log(`[ManualStoryboard] playerConfig keys: ${Object.keys(json.playerConfig).join(',')}`);
                // Storyboards location varies
                // 1. playerStoryboardSpecRenderer (in storyboards object)
                const spec = ((_d = (_c = json.storyboards) === null || _c === void 0 ? void 0 : _c.playerStoryboardSpecRenderer) === null || _d === void 0 ? void 0 : _d.spec) ||
                    ((_g = (_f = (_e = json.playerConfig) === null || _e === void 0 ? void 0 : _e.storyboardConfig) === null || _f === void 0 ? void 0 : _f.playerStoryboardSpecRenderer) === null || _g === void 0 ? void 0 : _g.spec);
                if (spec && typeof spec === 'string') {
                    console.log(`[ManualStoryboard] Found spec via ${attempt.name}: ${spec}`);
                    return parseStoryboardSpec(spec);
                }
            }
            catch (e) {
                console.warn(`[ManualStoryboard] Error ${attempt.name}: ${e}`);
            }
        }
    }
    return null;
}
function parseStoryboardSpec(spec) {
    // Format: URL|width#height#count#rows#cols#interval#bg#sig
    // Example: https://i.yt.../$L$/$N$.jpg|48#27#100#10#10#0#default#rs$A$...
    const parts = spec.split('|');
    if (parts.length < 2)
        return null;
    const url = parts[0];
    const params = parts[1].split('#');
    // If params length < 7, might be legacy or different, but let's try
    if (params.length < 5)
        return null;
    const width = parseInt(params[0], 10);
    const height = parseInt(params[1], 10);
    const count = parseInt(params[2], 10);
    const rows = parseInt(params[3], 10);
    const cols = parseInt(params[4], 10);
    const interval = parseInt(params[5], 10); // in ms
    // index 6 is bg, 7 is sig (sometimes)
    // Map to Innertube-like object for compatibility
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
// 3. Fallback: Parse from Watch Page HTML (Scraping)
async function fetchStoryboardSpecFromWatchHtml(videoId, userAgent) {
    var _a, _b;
    try {
        const referer = `https://www.youtube.com/watch?v=${videoId}`;
        const res = await fetchWithHeaders(referer, { headers: { accept: "text/html" } }, userAgent, referer);
        if (!res.ok)
            return null;
        const html = await res.text();
        // Method A: Extract from ytInitialPlayerResponse JSON
        const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
        if (match) {
            try {
                const playerResponse = JSON.parse(match[1]);
                const spec = (_b = (_a = playerResponse.storyboards) === null || _a === void 0 ? void 0 : _a.playerStoryboardSpecRenderer) === null || _b === void 0 ? void 0 : _b.spec;
                if (spec) {
                    console.log("[WatchHtml] Found spec in ytInitialPlayerResponse");
                    return parseStoryboardSpec(spec);
                }
            }
            catch (e) { /* ignore */ }
        }
        // Method B: Direct Regex (Robust fallback)
        // Look for "spec":"https://..." pattern
        const specRegex = /"spec":"(https?:[^"]+\|[^"]+)"/;
        const specMatch = html.match(specRegex);
        if (specMatch) {
            console.log("[WatchHtml] Found spec via direct regex");
            // Unescape common JSON escapes if necessary
            const raw = specMatch[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
            return parseStoryboardSpec(raw);
        }
    }
    catch (e) {
        console.warn(`[WatchHtml] Error: ${e}`);
    }
    return null;
}
// 4. Fallback: Parse via AllOrigins Proxy
async function fetchStoryboardSpecFromAllOrigins(videoId) {
    try {
        const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
        // Use standard fetch without custom headers to avoid CORS preflight issues with the proxy
        // (though in Node.js CORS doesn't apply, AllOrigins might filter headers)
        const res = await fetch(proxyUrl);
        if (!res.ok) {
            console.warn(`[AllOrigins] Status ${res.status}`);
            return null;
        }
        const html = await res.text();
        // Direct regex search
        const specRegex = /"spec":"(https?:[^"]+\|[^"]+)"/;
        const match = html.match(specRegex);
        if (match) {
            console.log("[AllOrigins] Found spec!");
            const raw = match[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
            return parseStoryboardSpec(raw);
        }
    }
    catch (e) {
        console.warn(`[AllOrigins] Error: ${e}`);
    }
    return null;
}
// @ts-ignore
// ─── Storyboard Fallback Logic ──────────────────────────────────────────────
// Return type is handled dynamically (base64 string or object with spec)
async function captureSnapshotFromStoryboard(videoId, timestamp, ffmpegPath, totalDuration) {
    console.log(`[Storyboard] Attempting fallback for ${videoId} at ${timestamp}s (total=${totalDuration}s)`);
    let bestBoard = null;
    // 1. Try Innertube Library
    try {
        console.log('[Storyboard] Initializing Innertube...');
        const proxyAgent = getProxyAgentOrNull();
        // Custom fetch wrapper to force proxy usage
        const customFetch = async (input, init) => {
            let url;
            let options = init || {};
            if (typeof input === 'string') {
                url = input;
            }
            else if (input instanceof URL) {
                url = input.toString();
            }
            else {
                url = input.url;
                options = Object.assign({ method: input.method, headers: input.headers, body: input.body }, options);
            }
            return fetchMaybeViaProxy(url, options, proxyAgent);
        };
        const innertubeConfig = {
            cache: new youtubei_js_1.UniversalCache(false),
            generate_session_locally: true,
            fetch: customFetch
        };
        const innertube = await youtubei_js_1.Innertube.create(innertubeConfig);
        console.log('[Storyboard] Innertube initialized. Fetching basic info...');
        const info = await innertube.getBasicInfo(videoId);
        console.log('[Storyboard] Basic info fetched.');
        // Use duration from Innertube if not provided
        if (!totalDuration && info.basic_info.duration) {
            totalDuration = info.basic_info.duration;
            console.log(`[Storyboard] Retrieved totalDuration from Innertube: ${totalDuration}s`);
        }
        const storyboards = info.basic_info.storyboards;
        if (storyboards && Array.isArray(storyboards) && storyboards.length > 0) {
            bestBoard = storyboards.sort((a, b) => (b.thumbnail_height * b.thumbnail_width) - (a.thumbnail_height * a.thumbnail_width))[0];
            console.log(`[Storyboard] Found board via Innertube: ${bestBoard.thumbnail_width}x${bestBoard.thumbnail_height}`);
        }
        else {
            console.log('[Storyboard] No storyboards found from Innertube.');
        }
    }
    catch (e) {
        console.warn(`[Storyboard] Innertube failed: ${e}`);
    }
    // 2. Fallback to Manual Fetch if Innertube failed
    if (!bestBoard) {
        console.log('[Storyboard] Falling back to manual fetch...');
        bestBoard = await fetchStoryboardSpecManual(videoId);
    }
    // 3. Fallback to HTML Scraping
    if (!bestBoard) {
        console.log('[Storyboard] Falling back to HTML scraping...');
        bestBoard = await fetchStoryboardSpecFromWatchHtml(videoId, DEFAULT_UA);
    }
    // 4. Fallback to AllOrigins Proxy
    if (!bestBoard) {
        console.log('[Storyboard] Falling back to AllOrigins Proxy...');
        bestBoard = await fetchStoryboardSpecFromAllOrigins(videoId);
    }
    if (!bestBoard) {
        console.log('[Storyboard] Could not identify best storyboard (All methods failed).');
        return null;
    }
    console.log(`[Storyboard] Selected board: ${bestBoard.thumbnail_width}x${bestBoard.thumbnail_height}, cols=${bestBoard.columns}, rows=${bestBoard.rows}`);
    // Determine duration per tile.
    // If we have totalDuration, we can calculate it: duration / count
    // But sometimes 'interval' from spec is more accurate for the grid.
    let durationPerTile = 0;
    if (bestBoard.interval && parseInt(bestBoard.interval, 10) > 0) {
        durationPerTile = parseInt(bestBoard.interval, 10);
        console.log(`[Storyboard] Using spec interval: ${durationPerTile}ms`);
    }
    // If interval is missing or we suspect it's wrong, and we have totalDuration:
    // If interval is missing or we suspect it's wrong, and we have totalDuration:
    if (totalDuration && bestBoard.storyboard_count > 0) {
        // durationPerTile = (totalDuration * 1000) / storyboard_count
        const calculated = Math.floor((totalDuration * 1000) / bestBoard.storyboard_count);
        console.log(`[Storyboard] Calculated interval from duration: ${calculated}ms (${totalDuration}s / ${bestBoard.storyboard_count} tiles)`);
        // If 'durationPerTile' (from spec) is suspiciously different from calculated (e.g. > 20% diff), 
        // trust the calculated one, as spec interval might be generic.
        if (durationPerTile > 0) {
            const diff = Math.abs(durationPerTile - calculated);
            if (diff > (calculated * 0.2)) {
                console.warn(`[Storyboard] Spec interval (${durationPerTile}) differs significantly from calculated (${calculated}). Using calculated.`);
                durationPerTile = calculated;
            }
        }
        else {
            durationPerTile = calculated;
        }
    }
    if (durationPerTile === 0) {
        console.warn('[Storyboard] No interval found and no duration provided, defaulting to 10000ms');
        durationPerTile = 10000;
    }
    const timeMs = timestamp * 1000;
    const totalTileIndex = Math.floor(timeMs / durationPerTile);
    const tilesPerBoard = bestBoard.rows * bestBoard.columns;
    const boardIndex = Math.floor(totalTileIndex / tilesPerBoard);
    const tileInBoard = totalTileIndex % tilesPerBoard;
    const row = Math.floor(tileInBoard / bestBoard.columns);
    const col = tileInBoard % bestBoard.columns;
    // Construct URL
    let url = bestBoard.template_url;
    url = url.replace('$N$', boardIndex.toString());
    url = url.replace('$M$', '0'); // Usually 0
    // Handle $L$ (Level) substitution
    // Some specs have URLs like ".../storyboard3_L$L$/$N$.jpg"
    // We usually want level 2 (medium) or if unavailable, try to guess.
    // Spec usually implies a specific level, but if the URL is generic template, we must pick one.
    if (url.includes('$L$')) {
        console.log("[Storyboard] URL template requires Level ($L$). Defaulting to L2.");
        url = url.replace('$L$', '2');
    }
    console.log(`[Storyboard] Fetching board URL: ${url}`);
    // Generate unique nonce for temp files to prevent concurrency issues
    const nonce = nodeCrypto.randomBytes(4).toString('hex');
    const uniqueId = `${videoId}_${timestamp}_${nonce}`;
    // Add headers to request (Google Video links can be picky about UA)
    // Use manual redirect to detect if we are being 302'd to a placeholder
    const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: {
            "User-Agent": DEFAULT_UA,
            "Referer": `https://www.youtube.com/watch?v=${videoId}`
        }
    });
    console.log(`[Storyboard] Fetch Response: status=${response.status}, type=${response.headers.get("content-type")}, len=${response.headers.get("content-length")}, loc=${response.headers.get("location")}`);
    if (!response.ok && response.status !== 302 && response.status !== 301) {
        console.error(`[Storyboard] Failed to fetch board (HTT P error): ${response.status} ${response.statusText}`);
        return null;
    }
    // Handle Redirects Manually
    if (response.status === 302 || response.status === 301) {
        const location = response.headers.get("location");
        console.warn(`[Storyboard] REDIRECTED to: ${location}`);
        if (location && (location.includes("hqdefault.jpg") || location.includes("vi/"))) {
            console.error("[Storyboard] Redirected to standard thumbnail! IP likely blocked or invalid URL.");
            return null; // Don't use this, it's garbage
        }
        // If redirected to another apparently valid URL, maybe we follow it? 
        // For now, fail to be safe and visible.
        return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    // Save to temp with UNIQUE path
    const boardPath = `/tmp/sb_${uniqueId}.jpg`;
    const outPath = `/tmp/crop_${uniqueId}.jpg`;
    fs.writeFileSync(boardPath, buffer);
    const tileW = bestBoard.thumbnail_width;
    const tileH = bestBoard.thumbnail_height;
    const x = col * tileW;
    const y = row * tileH;
    // Ensure ffmpeg is executable
    if (fs.existsSync(ffmpegPath)) {
        try {
            fs.chmodSync(ffmpegPath, '755');
        }
        catch (e) { /* ignore */ }
    }
    // Crop with ffmpeg
    const cmd = `"${ffmpegPath}" -y -i "${boardPath}" -vf "crop=${tileW}:${tileH}:${x}:${y}" "${outPath}" -hide_banner -loglevel error`;
    // Log intent for easy debugging
    console.log(`[Storyboard] Cropping: ${tileW}x${tileH} at ${x},${y} -> ${outPath}`);
    try {
        await execAsync(cmd);
        if (fs.existsSync(outPath)) {
            const cropBuffer = fs.readFileSync(outPath);
            const base64 = `data:image/jpeg;base64,${cropBuffer.toString('base64')}`;
            return base64;
        }
        else {
            console.error("[Storyboard] Output file not found after ffmpeg!");
        }
    }
    catch (err) {
        console.error(`[Storyboard] ffmpeg execution failed: ${err.message}`);
        if (err.stderr)
            console.error(`[Storyboard] stderr: ${err.stderr}`);
    }
    finally {
        // Cleanup with correct paths
        try {
            if (fs.existsSync(boardPath))
                fs.unlinkSync(boardPath);
            if (fs.existsSync(outPath))
                fs.unlinkSync(outPath);
        }
        catch (e) { /* ignore */ }
    }
    return null;
}
exports.captureSnapshot = (0, https_1.onCall)({ memory: '1GiB', timeoutSeconds: 300, secrets: [TRANSCRIPT_PROXY_URL] }, async (request) => {
    const { data, auth } = request;
    if (!auth) {
        throw new https_1.HttpsError("unauthenticated", "The function must be called while authenticated.");
    }
    const videoId = data === null || data === void 0 ? void 0 : data.videoId;
    const timestamp = data === null || data === void 0 ? void 0 : data.timestamp; // seconds (float)
    const duration = data === null || data === void 0 ? void 0 : data.duration; // total video seconds (float, optional)
    if (!videoId || timestamp === undefined || timestamp === null) {
        throw new https_1.HttpsError("invalid-argument", "The function must be called with 'videoId' and 'timestamp' arguments.");
    }
    let tempDir = null;
    try {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-'));
        const frameFile = path.join(tempDir, 'frame.jpg');
        // STRATEGY 1: Internal Android API (Direct URL)
        // This bypasses yt-dlp bot detection/sign-in issues by using client emulation
        let strategy = "ytdlp";
        let directData = null;
        // Force fallback if requested (for testing storyboard logic locally)
        // We can pass a special flag in 'data'
        const forceFallback = (data === null || data === void 0 ? void 0 : data.forceFallback) === true;
        if (!forceFallback) {
            try {
                directData = await fetchVideoUrlFromInnertube(videoId);
                if (directData)
                    strategy = "direct";
            }
            catch (e) {
                console.warn("[captureSnapshot] Innertube fetch failed, falling back to yt-dlp", e);
            }
        }
        else {
            console.log("[captureSnapshot] FORCING FALLBACK (skipping direct/ytdlp)");
        }
        if (!forceFallback && strategy === "direct" && directData) {
            console.log("[captureSnapshot] Using DIRECT URL strategy (Android client)");
            try {
                // Using ffmpeg with direct URL headers
                const headersStr = `User-Agent: ${directData.userAgent}\r\nReferer: ${directData.referer}`;
                // Use INPUT seeking (-ss before -i) for speed and to avoid downloading the whole stream
                const ffmpegCmd = `"${ffmpegPath}" ` +
                    `-headers "${headersStr}" ` +
                    `-ss ${timestamp} ` +
                    `-i "${directData.url}" ` +
                    `-frames:v 1 ` +
                    `-q:v 2 ` +
                    `-y "${frameFile}"`;
                // Hide URL in logs
                console.log(`[captureSnapshot] ffmpeg direct cmd: ${ffmpegCmd.replace(directData.url, "URL_HIDDEN")}`);
                await execAsync(ffmpegCmd, { timeout: 30000 });
            }
            catch (e) {
                console.warn(`[captureSnapshot] Direct URL capture failed: ${e.message}. Falling back to yt-dlp.`);
            }
        }
        // 2. Fallback to yt-dlp (if frame not created yet)
        if (!fs.existsSync(frameFile) && !forceFallback) {
            console.log("[captureSnapshot] Fallback to yt-dlp strategy");
            await ensureYtDlp();
            const videoFile = path.join(tempDir, 'segment.mp4');
            const startSec = timestamp;
            const endSec = timestamp + 1.0;
            // Add proxy if available
            try {
                const proxyUrl = TRANSCRIPT_PROXY_URL.value();
                let proxyArgs = "";
                if (proxyUrl && proxyUrl !== "DISABLED") {
                    proxyArgs = `--proxy "${proxyUrl}" `;
                }
                let ytdlpCmd = `"${YTDLP_PATH}" ` +
                    `-f "bv*[vcodec^=avc1][height<=720]" ` +
                    `--download-sections "${startSec}-${endSec}" ` +
                    `--force-keyframes-at-cuts ` +
                    `--extractor-args "youtube:player_client=android" ` +
                    `--ffmpeg-location "${ffmpegPath}" ` +
                    `${proxyArgs}` +
                    `-o "${videoFile}" ` +
                    `--no-part ` +
                    `"https://www.youtube.com/watch?v=${videoId}"`;
                console.log(`[captureSnapshot] Downloading precise segment: ${ytdlpCmd}`);
                const { stdout, stderr } = await execAsync(ytdlpCmd, { timeout: 30000 });
                console.log(`[captureSnapshot] yt-dlp stdout: ${stdout}`);
                if (stderr)
                    console.log(`[captureSnapshot] yt-dlp stderr: ${stderr}`);
                // Check if file exists (yt-dlp might fail)
                if (!fs.existsSync(videoFile)) {
                    // Try finding file with extension if yt-dlp appended one
                    const files = fs.readdirSync(tempDir);
                    const videoFileActual = files.find(f => f.startsWith('segment'));
                    if (videoFileActual) {
                        fs.renameSync(path.join(tempDir, videoFileActual), videoFile);
                    }
                }
                // Extract frame
                const ffmpegCmd = `"${ffmpegPath}" -i "${videoFile}" -frames:v 1 -q:v 2 -update 1 "${frameFile}" -y`;
                await execAsync(ffmpegCmd, { timeout: 15000 });
            }
            catch (dlError) {
                console.warn(`[captureSnapshot] yt-dlp/ffmpeg failed: ${dlError.message}. Proceeding to fallback.`);
            }
        }
        if (!fs.existsSync(frameFile)) {
            console.log("[captureSnapshot] Frame extraction failed. Attempting Storyboard Fallback.");
            // ffmpeg-static require is at top level, stored in ffmpegPath variable? 
            // Yes: const ffmpegPath = require('ffmpeg-static');
            try {
                const sbImage = await captureSnapshotFromStoryboard(videoId, timestamp, ffmpegPath, duration);
                if (sbImage) {
                    return { imageUrl: sbImage };
                }
            }
            catch (e) {
                console.warn("[captureSnapshot] Storyboard fallback exception:", e);
            }
            throw new Error("Failed to extract frame from video segment and storyboard fallback failed.");
        }
        const frameSize = fs.statSync(frameFile).size;
        console.log(`[captureSnapshot] Frame extracted: ${frameSize} bytes`);
        // 3. Read frame and return as base64 data URL
        const frameBuffer = fs.readFileSync(frameFile);
        const base64 = frameBuffer.toString('base64');
        const dataUrl = `data:image/jpeg;base64,${base64}`;
        console.log(`[captureSnapshot] Returning base64 data URL (${base64.length} chars)`);
        return { imageUrl: dataUrl };
    }
    catch (error) {
        console.error(`[captureSnapshot] Error: ${error.message}`);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError("internal", `Failed to capture snapshot: ${error.message}`);
    }
    finally {
        // Cleanup temp dir
        if (tempDir) {
            try {
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true });
                }
            }
            catch (e) {
                console.error("Failed to cleanup temp dir:", e);
            }
        }
    }
});
//# sourceMappingURL=index.js.map