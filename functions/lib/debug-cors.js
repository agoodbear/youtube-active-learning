"use strict";
const VIDEO_ID = 'KAasBVVVU6M';
async function fetchWithTimeout(name, url, options = {}, timeout = 15000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        console.log(`[${name}] Fetching ${url}...`);
        const res = await fetch(url, Object.assign(Object.assign({}, options), { signal: controller.signal }));
        clearTimeout(id);
        console.log(`[${name}] Status: ${res.status}`);
        // Handle different responses
        let html = '';
        if (name === 'AllOriginsJSON') {
            const json = await res.json();
            html = json.contents;
        }
        else {
            html = await res.text();
        }
        // Check for spec
        const specRegex = /"spec":"(https?:[^"]+\|[^"]+)"/;
        const match = html.match(specRegex);
        if (match) {
            console.log(`[${name}] SUCCESS: Found spec!`);
            return match[1];
        }
        else {
            if (html.includes('Sign in to confirm'))
                console.log(`[${name}] "Sign in to confirm" detected`);
            throw new Error(`[${name}] No spec found`);
        }
    }
    catch (e) {
        clearTimeout(id);
        console.error(`[${name}] Error:`, e.message);
        return null;
    }
}
async function run() {
    console.log(`Testing CORS Proxies for ${VIDEO_ID}...`);
    const targetUrl = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
    const promises = [
        // CodeTabs
        fetchWithTimeout('CodeTabs', `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`),
        // AllOrigins JSON (might handle large responses better?)
        fetchWithTimeout('AllOriginsJSON', `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`),
        // CorsProxy.io (try raw again just in case)
        fetchWithTimeout('CorsProxyRaw', `https://corsproxy.io/?${targetUrl}`),
    ];
    await Promise.allSettled(promises);
    console.log('Done.');
}
run();
//# sourceMappingURL=debug-cors.js.map