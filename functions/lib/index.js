"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureSnapshot = exports.getTranscriptPublicAsia = exports.getTranscriptPublic = exports.getTranscript = void 0;
const functions = require("firebase-functions");
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = require("fs");
const os = require("os");
const path = require("path");
const undici_1 = require("undici");
const youtube_transcript_plus_1 = require("youtube-transcript-plus");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
function secondsToMs(seconds) {
    return Math.round(seconds * 1000);
}
const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
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
exports.getTranscript = functions.https.onCall({ secrets: [TRANSCRIPT_PROXY_URL] }, async (request) => {
    var _a, _b, _c;
    const { data, auth } = request;
    if (!auth) {
        throw new functions.https.HttpsError("unauthenticated", "The function must be called while authenticated.");
    }
    const videoId = data === null || data === void 0 ? void 0 : data.videoId;
    if (!videoId) {
        throw new functions.https.HttpsError("invalid-argument", "The function must be called with a 'videoId' argument.");
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
            throw new functions.https.HttpsError("resource-exhausted", "YouTube is currently rate-limiting requests. Please try again later or upload an SRT file manually.");
        }
        // If YouTube returns an interstitial/consent page, youtube-transcript-plus can surface
        // as NotAvailable. Treat that as a transient error rather than a true not-found.
        if (error instanceof youtube_transcript_plus_1.YoutubeTranscriptDisabledError) {
            throw new functions.https.HttpsError("not-found", `No transcript found for video ${videoId}`);
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
            throw new functions.https.HttpsError("resource-exhausted", "YouTube is currently rate-limiting requests. Please try again later or upload an SRT file manually.");
        }
    }
    // 4. Last fallback to yt-dlp where available (mainly local/dev environments)
    console.log(`[yt-dlp] Falling back to yt-dlp for ${videoId}`);
    // Create temp directory for output - inside try/catch for safety
    let tempDir = null;
    let outputTemplate = null;
    try {
        // Cloud Functions runtime may not have yt-dlp installed.
        const hasYtDlp = await execAsync("command -v yt-dlp")
            .then(() => true)
            .catch(() => false);
        if (!hasYtDlp) {
            console.warn("[yt-dlp] Binary not available in runtime. Skipping yt-dlp fallback.");
            throw new functions.https.HttpsError("not-found", `No transcript found for video ${videoId}`);
        }
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-'));
        outputTemplate = path.join(tempDir, '%(id)s');
        // Run yt-dlp to download subtitles only
        const ytdlpCmd = `yt-dlp --write-auto-sub --sub-langs "en.*" --skip-download --sub-format vtt -o "${outputTemplate}" "https://www.youtube.com/watch?v=${videoId}"`;
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
            throw new functions.https.HttpsError("resource-exhausted", "YouTube is currently rate-limiting requests. Please try again later or upload an SRT file manually.");
        }
        // Rethrow other known HttpsErrors
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        // If binary is missing in runtime, don't surface internal error to user.
        if ((_c = error.message) === null || _c === void 0 ? void 0 : _c.includes("yt-dlp: not found")) {
            throw new functions.https.HttpsError("not-found", `No transcript found for video ${videoId}`);
        }
        // For unknown errors, throw internal but with a message?
        // Or let it be handled by default?
        // If we want to avoid "internal" without details:
        throw new functions.https.HttpsError("internal", `Failed to fetch transcript: ${error.message}`);
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
    throw new functions.https.HttpsError("not-found", `No transcript found for video ${videoId}`);
});
// Key-protected HTTP endpoint for smoke testing in production without Firebase Auth.
// Enabled via Secret Manager: TRANSCRIPT_DEBUG_KEY
exports.getTranscriptPublic = functions.https.onRequest({ secrets: [TRANSCRIPT_DEBUG_KEY, TRANSCRIPT_PROXY_URL] }, async (req, res) => {
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
exports.getTranscriptPublicAsia = functions.https.onRequest({ region: "asia-east1", secrets: [TRANSCRIPT_DEBUG_KEY, TRANSCRIPT_PROXY_URL] }, async (req, res) => {
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
exports.captureSnapshot = functions.https.onCall(async (request) => {
    const { data, auth } = request;
    if (!auth) {
        throw new functions.https.HttpsError("unauthenticated", "The function must be called while authenticated.");
    }
    const videoId = data === null || data === void 0 ? void 0 : data.videoId;
    const timestamp = data === null || data === void 0 ? void 0 : data.timestamp; // seconds (float)
    if (!videoId || timestamp === undefined || timestamp === null) {
        throw new functions.https.HttpsError("invalid-argument", "The function must be called with 'videoId' and 'timestamp' arguments.");
    }
    const tsRounded = Math.floor(timestamp);
    let tempDir = null;
    try {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-'));
        const videoFile = path.join(tempDir, 'segment.mp4');
        const frameFile = path.join(tempDir, 'frame.jpg');
        // 1. Download a segment around the timestamp using yt-dlp
        //    Wider buffer (3s before, 3s after) for keyframe safety
        const startSec = Math.max(0, tsRounded - 3);
        const endSec = tsRounded + 4;
        const ytdlpCmd = `/opt/homebrew/bin/yt-dlp ` +
            `-f "bv*[height<=720]" ` + // Best video ≤720p for speed
            `--download-sections "*${startSec}-${endSec}" ` +
            `--force-keyframes-at-cuts ` +
            `-o "${videoFile}" ` +
            `--no-part ` +
            `"https://www.youtube.com/watch?v=${videoId}"`;
        console.log(`[captureSnapshot] Downloading segment: ${ytdlpCmd}`);
        const { stdout, stderr } = await execAsync(ytdlpCmd, { timeout: 30000 });
        console.log(`[captureSnapshot] yt-dlp stdout: ${stdout}`);
        if (stderr)
            console.log(`[captureSnapshot] yt-dlp stderr: ${stderr}`);
        // Check if file exists
        if (!fs.existsSync(videoFile)) {
            // yt-dlp sometimes appends format extensions, find the actual file
            const files = fs.readdirSync(tempDir);
            const videoFileActual = files.find(f => f.startsWith('segment'));
            if (!videoFileActual) {
                throw new Error(`Download failed. Files in temp: ${files.join(', ')}`);
            }
            // Rename to expected path
            fs.renameSync(path.join(tempDir, videoFileActual), videoFile);
        }
        // 2. Extract frame using ffmpeg with EXACT fractional offset
        //    The downloaded segment starts at startSec, so the precise seek
        //    offset = timestamp - startSec (preserving fractional seconds)
        const seekOffset = (timestamp - startSec).toFixed(3);
        const ffmpegBin = '/opt/homebrew/bin/ffmpeg';
        const ffmpegCmd = `${ffmpegBin} -i "${videoFile}" -ss ${seekOffset} -frames:v 1 -q:v 2 "${frameFile}" -y`;
        console.log(`[captureSnapshot] Extracting frame: ${ffmpegCmd}`);
        await execAsync(ffmpegCmd, { timeout: 15000 });
        if (!fs.existsSync(frameFile)) {
            throw new Error("Failed to extract frame from video segment.");
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
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError("internal", `Failed to capture snapshot: ${error.message}`);
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