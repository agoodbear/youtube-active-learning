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
        const html = await res.text();
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
            if (html.includes('Google Translate'))
                console.log(`[${name}] Google Translate page detected`);
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
    console.log(`Testing Proxies for ${VIDEO_ID}...`);
    const targetUrl = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
    const promises = [
        // Google Translate Website Proxy
        // translate.google.com/website?sl=auto&tl=en&u=<URL>
        fetchWithTimeout('GoogleTranslate', `https://translate.google.com/translate_p?sl=auto&tl=en&u=${encodeURIComponent(targetUrl)}&depth=1&rurl=translate.google.com&sp=nmt4&xid=25657,15700021,15700186,15700190,15700256,15700259,15700262,15700265,15700271,15700283`, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            }
        }),
        // ThingProxy
        fetchWithTimeout('ThingProxy', `https://thingproxy.freeboard.io/fetch/${targetUrl}`),
        // CorsProxy (Raw)
        fetchWithTimeout('CorsProxyRaw', `https://corsproxy.io/?${targetUrl}`),
    ];
    await Promise.allSettled(promises);
    console.log('Done.');
}
run();
//# sourceMappingURL=debug-proxies.js.map