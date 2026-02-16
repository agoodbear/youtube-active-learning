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
    // But typically the L2 spec is simpler. 
    // Actually, looking at common YouTube storyboard logic:
    // The base URL often looks like: https://i.ytimg.com/sb/VIDEO_ID/storyboard3_L2/M$M.jpg
    // We need to replace $M with the sheet index.

    let sheetUrl = spec.baseUrl;
    if (sheetUrl.includes('$M')) {
        sheetUrl = sheetUrl.replace('$M', sheetIndex.toString());
    } else {
        // Some specs don't use $M pattern, might just be one big image if frames are few?
        // Or specific query param?
        // Let's assume the $M pattern or exact URL if only 1 sheet.
        // If no $M and multiple sheets, we might need more complex logic, but usually it's $M.
        // Fallback: append `&sq=${sheetIndex}`? No, usually it is part of the path.
        // Investigating "sigh" param... usually baked in.

        // If 0 sheets (just 1), keep url.
        // If we expect multiple sheets but no $M, it's tricky.
        // Common fallback: https://i.ytimg.com/sb/VIDEO_ID/storyboard3_L2/M0.jpg -> M1.jpg

        // Simple heuristic:
        if (framesPerSheet < spec.frameCount && !sheetUrl.includes('$M')) {
            // If we need multiple sheets but don't see template, 
            // it's risky. But let's hope for $M.
        }
    }

    // Sigh parameter is important for access

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

// ─── Invidious Fallback ─────────────────────────────────────────────

const INVIDIOUS_INSTANCES = [
    'https://iv.ggtyler.dev',
    'https://inv.tux.pizza',
    'https://invidious.jing.rocks',
    'https://vid.puffyan.us'
];

interface InvidiousStoryboard {
    url: string;
    templateUrl?: string;
    width: number;
    height: number;
    count: number;
    interval: number; // ms
    storyboardWidth: number;
    storyboardHeight: number;
    storyboardCount: number;
}

/**
 * Tries to fetch storyboard spec from Invidious instances.
 */
async function fetchFromInvidious(videoId: string): Promise<StoryboardSpec | null> {
    for (const instance of INVIDIOUS_INSTANCES) {
        try {
            const res = await fetch(`${instance}/api/v1/storyboards/${videoId}`);
            if (!res.ok) continue;
            const data = await res.json();

            if (data.storyboards && Array.isArray(data.storyboards) && data.storyboards.length > 0) {
                // Pick the best quality (usually the last one or largest width)
                // Invidious usually returns [low, medium, high]
                const best = data.storyboards[data.storyboards.length - 1] as InvidiousStoryboard;

                // Convert to our format
                // Invidious returns individual URLs sometimes, or a template.
                // data.storyboards[i].templateUrl might be "https://.../storyboard_L2/M$M.jpg"

                let baseUrl = best.templateUrl || best.url;

                // Calculate rows/cols from storyboard dimensions
                // Invidious doesn't always give row/col count explicitly in the same way
                // But we can infer or use defaults if standard 5x5 (25 frames) or similar.
                // Actually, Invidious response usually includes enough info.

                // Fallback calculations if strict row/col not present (standard YT is often 5x5 or 10x10)
                // Let's assume standard L2 usually has 5 rows, 5 cols -> 25 images per sheet.
                // We'll calculate columns based on storyboardWidth / width
                const cols = Math.floor(best.storyboardWidth / best.width);
                const rows = Math.floor(best.storyboardHeight / best.height);

                return {
                    baseUrl,
                    width: best.width,
                    height: best.height,
                    frameCount: best.count,
                    step: best.interval,
                    rowCount: rows || 5, // fallback
                    colCount: cols || 5   // fallback
                };
            }
        } catch (e) {
            // console.warn(`Failed to fetch from ${instance}`, e);
            continue;
        }
    }
    return null;
}

/**
 * Main entry point: tries local player response first, then falls back to Invidious.
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

    // 2. Try Invidious
    console.log('[Storyboard] Local spec missing, trying Invidious fallback...');
    const invidiousSpec = await fetchFromInvidious(videoId);
    if (invidiousSpec) {
        console.log('[Storyboard] Found Invidious spec');
        return invidiousSpec;
    }

    return null;
}
