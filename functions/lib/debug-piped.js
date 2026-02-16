"use strict";
const VIDEO_ID = 'KAasBVVVU6M';
async function fetchWithTimeout(name, url, timeout = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        console.log(`[${name}] Fetching ${url}...`);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        if (!res.ok)
            throw new Error(`Status ${res.status}`);
        const json = await res.json();
        if (json.previewFrames && json.previewFrames.length > 0) {
            console.log(`[${name}] SUCCESS: Found ${json.previewFrames.length} previewFrames!`);
            // console.log(JSON.stringify(json.previewFrames[0], null, 2));
            return json.previewFrames;
        }
        else {
            throw new Error(`[${name}] No previewFrames`);
        }
    }
    catch (e) {
        clearTimeout(id);
        console.error(`[${name}] Error:`, e.message);
        throw e;
    }
}
async function run() {
    console.log(`Testing Piped instances for ${VIDEO_ID}...`);
    // List from https://github.com/TeamPiped/Piped/wiki/Instances
    // Reduced to likely stable ones
    const instances = [
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.adminforge.de',
        'https://api.piped.privacy.com.de',
        'https://pipedapi.drgns.space',
        'https://pipedapi.kavin.rocks',
        'https://piped-api.lunar.icu',
        'https://pa.il.ax',
        'https://p.euten.eu',
        'https://pipedapi.smnz.de',
        'https://pipedapi.ducks.party'
    ];
    const promises = instances.map(baseUrl => fetchWithTimeout(new URL(baseUrl).hostname, `${baseUrl}/streams/${VIDEO_ID}`));
    await Promise.allSettled(promises);
    console.log('Done.');
}
run();
//# sourceMappingURL=debug-piped.js.map