"use strict";
const VIDEO_ID = 'KAasBVVVU6M';
async function fetchWithTimeout(url, options = {}, timeout = 15000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        console.log(`Fetching ${url}...`);
        const res = await fetch(url, Object.assign(Object.assign({}, options), { signal: controller.signal }));
        clearTimeout(id);
        console.log(`Status: ${res.status}`);
        const json = await res.json();
        // console.log(JSON.stringify(json, null, 2));
        if (json.status === 'stream' || json.status === 'redirect' || json.url) {
            console.log(`SUCCESS: Found stream URL from ${url}`);
            return json.url;
        }
        return null;
    }
    catch (e) {
        clearTimeout(id);
        console.error(`Error fetching ${url}:`, e.message);
        return null;
    }
}
async function run() {
    console.log(`Testing Cobalt V10 for ${VIDEO_ID}...`);
    const instances = [
        'https://api.cobalt.tools',
        'https://co.wuk.sh',
        'https://cobalt.tools',
        'https://api.cobalt.tools'
    ];
    for (const baseUrl of instances) {
        let url = baseUrl;
        if (!baseUrl.endsWith('/'))
            url += '/';
        // V10 API is often just POST / (no /api/json)
        // Some might use /api/json still?
        // Let's try both if needed, but start with POST / based on docs? 
        // Docs say POST /api/json was v7. 
        // Current docs say POST /
        const result = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
            })
        });
        if (result) {
            console.log(`Working instance found: ${baseUrl}`);
            console.log(`Stream URL: ${result}`);
            break;
        }
    }
    console.log('Done.');
}
run();
//# sourceMappingURL=debug-cobalt.js.map