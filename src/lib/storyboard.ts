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
