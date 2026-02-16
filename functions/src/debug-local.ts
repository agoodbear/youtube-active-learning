
const VIDEO_ID = 'KAasBVVVU6M';

async function run() {
    console.log(`Testing AllOrigins for ${VIDEO_ID}...`);
    try {
        const targetUrl = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
        console.log(`Fetching ${proxyUrl}...`);

        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const res = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(id);

        console.log(`Status: ${res.status}`);
        if (!res.ok) throw new Error(`Status ${res.status}`);

        const html = await res.text();
        const specRegex = /"spec":"(https?:[^"]+\|[^"]+)"/;
        const match = html.match(specRegex);

        if (match) {
            console.log("SUCCESS: Found spec!");
            console.log(match[1].substring(0, 50));
        } else {
            console.log("FAILURE: No spec found.");
        }
    } catch (e: any) {
        console.error("Error:", e.message);
    }
}

run();
