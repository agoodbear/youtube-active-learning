export interface StoryboardSpec {
    baseUrl: string;
    width: number;
    height: number;
    rowCount: number;
    colCount: number;
    step: number; // Duration per frame in ms (approx) or seconds depending on spec
    frameCount: number;
}

/**
 * Parses the raw storyboard spec string from YouTube player response.
 * Example spec: "http://...|48#27#100#10#10#0#default#434"
 * Format: URL|width#height#frameCount#rowCount#colCount#step#...?
 */
export function parseStoryboardSpec(spec: string): StoryboardSpec | null {
    if (!spec) return null;

    try {
        const parts = spec.split('|');
        const baseUrl = parts[0];
        const params = parts[1]?.split('#');

        if (!baseUrl || !params || params.length < 5) return null;

        const width = parseInt(params[0], 10);
        const height = parseInt(params[1], 10);
        const frameCount = parseInt(params[2], 10);
        const rowCount = parseInt(params[3], 10);
        const colCount = parseInt(params[4], 10);
        const step = parseInt(params[5], 10); // Usually in ms

        // Sometimes the URL doesn't have the protocol
        const finalUrl = baseUrl.startsWith('//') ? `https:${baseUrl}` : baseUrl;

        return {
            baseUrl: finalUrl,
            width,
            height,
            frameCount,
            rowCount,
            colCount,
            step
        };
    } catch (e) {
        console.error("Error parsing storyboard spec:", e);
        return null;
    }
}

/**
 * Calculates the sprite sheet URL and coordinates for a given timestamp.
 */
export function getStoryboardData(spec: StoryboardSpec, timestampSeconds: number) {
    const timestampMs = timestampSeconds * 1000;

    // Step is usually in ms. If it's 0 or very small, might be seconds, but usually ms for storyboard.
    // However, if the spec step is 0, we can't calculate.
    const step = spec.step === 0 ? 2000 : spec.step; // Fallback 2s

    let frameIndex = Math.floor(timestampMs / step);
    if (frameIndex >= spec.frameCount) frameIndex = spec.frameCount - 1;

    // Calculate which sheet this frame is on
    const framesPerSheet = spec.rowCount * spec.colCount;
    const sheetIndex = Math.floor(frameIndex / framesPerSheet);

    // Calculate position within the sheet
    const localFrameIndex = frameIndex % framesPerSheet;
    const row = Math.floor(localFrameIndex / spec.colCount);
    const col = localFrameIndex % spec.colCount;

    // Construct the URL for the specific sheet
    // URL format often has $M or just needs the M param appended/replaced
    let sheetUrl = spec.baseUrl;
    if (sheetUrl.includes('$M')) {
        sheetUrl = sheetUrl.replace('$M', sheetIndex.toString());
    } else {
        // Fallback or simple case
        if (framesPerSheet < spec.frameCount && !sheetUrl.includes('$M')) {
            // Potential future logic for non-$M multi-sheet
        }
    }

    const x = col * spec.width;
    const y = row * spec.height;

    return {
        url: sheetUrl,
        x,
        y,
        width: spec.width,
        height: spec.height
    };
}

// ─── CORS Proxy Fallback ─────────────────────────────────────────────

async function fetchFromCorsProxy(videoId: string): Promise<StoryboardSpec | null> {
    const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // 1. Try CodeTabs (Primary)
    try {
        const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`;
        console.log(`[Storyboard] Fetching via CodeTabs: ${proxyUrl}`);
        const res = await fetch(proxyUrl);
        if (res.ok) {
            const html = await res.text();

            // Regex variations
            // 1. Direct "spec": "..."
            // 2. ytInitialPlayerResponse = { ... }

            const specRegex = /"spec":"(https?:[^"]+\|[^"]+)"/;
            const match = html.match(specRegex);
            if (match && match[1]) {
                // Clean up string
                const specRaw = match[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
                const spec = parseStoryboardSpec(specRaw);
                if (spec) return spec;
            }
        }
    } catch (e) {
        console.warn('[Storyboard] CodeTabs fetch failed', e);
    }

    // 2. Try AllOrigins (Backup)
    try {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
        console.log(`[Storyboard] Fetching via AllOrigins: ${proxyUrl}`);
        const res = await fetch(proxyUrl);
        if (res.ok) {
            const html = await res.text();
            const specRegex = /"spec":"(https?:[^"]+\|[^"]+)"/;
            const match = html.match(specRegex);
            if (match && match[1]) {
                const specRaw = match[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
                const spec = parseStoryboardSpec(specRaw);
                if (spec) return spec;
            }
        }
    } catch (e) {
        console.warn('[Storyboard] AllOrigins fetch failed', e);
    }

    return null;
}

/**
 * Main entry point: tries local player response first, then falls back to CORS proxy.
 */
export async function getCombinedStoryboardSpec(videoId: string, playerResponse?: any): Promise<StoryboardSpec | null> {
    // 1. Try Local Player Response
    if (playerResponse?.storyboards?.playerStoryboardSpecRenderer?.spec) {
        const spec = parseStoryboardSpec(playerResponse.storyboards.playerStoryboardSpecRenderer.spec);
        if (spec) {
            console.log('[Storyboard] Found local player spec');
            return spec;
        }
    }

    // 2. Try CORS Proxy
    console.log('[Storyboard] Local spec missing, trying CORS proxy fallback...');
    const proxySpec = await fetchFromCorsProxy(videoId);
    if (proxySpec) {
        console.log('[Storyboard] Found proxy spec');
        return proxySpec;
    }

    return null;
}
