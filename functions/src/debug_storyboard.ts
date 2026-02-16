
import { Innertube, UniversalCache } from 'youtubei.js';

async function runDebug() {
    console.log("Initializing Innertube...");
    const innertube = await Innertube.create({
        cache: new UniversalCache(false),
        generate_session_locally: true
    });

    const videoId = "KAasBVVVU6M";
    const timestamp = 787; // 13:07
    const duration = 1205;

    console.log(`Fetching info for ${videoId}...`);
    const info = await innertube.getBasicInfo(videoId);

    // @ts-ignore
    const storyboards = info.basic_info.storyboards;

    if (!storyboards || storyboards.length === 0) {
        console.error("No storyboards found via Innertube");
        return;
    }

    console.log(`Found ${storyboards.length} storyboard levels`);

    // Pick best board (largest area)
    const bestBoard = storyboards.sort((a: any, b: any) =>
        (b.thumbnail_height * b.thumbnail_width) - (a.thumbnail_height * a.thumbnail_width)
    )[0];

    console.log("Best Board Spec:", bestBoard);

    // Logic Check
    let durationPerTile = 10000;
    // Check if Innertube parsed 'interval'? Innertube usually parses the raw spec.
    // The raw spec string has the interval. Innertube might not expose it in the typed object?
    // Let's check the properties of bestBoard.

    // In `youtubei.js`, the parsed storyboard object might look like:
    // { template_url, thumbnail_width, thumbnail_height, thumbnail_count, interval, columns, rows, ... }
    // Wait, in my original code I looked for `interval`.

    // Let's rely on what we see in the console log of `bestBoard`.

    if (bestBoard.interval) {
        durationPerTile = parseInt(bestBoard.interval, 10);
        console.log(`Using explicit interval: ${durationPerTile}ms`);
    } else {
        console.log(`No interval in object. Using calculation.`);
        // My proposed fix logic:
        // Note: Innertube calls it `storyboard_count` or `thumbnail_count`?
        // In my code I used `storyboard_count`. Let's assume matches parsed spec.

        const count = bestBoard.storyboard_count || bestBoard.thumbnail_count || 0;

        if (duration && count > 0) {
            durationPerTile = Math.floor((duration * 1000) / count);
            console.log(`Calculated interval: ${durationPerTile}ms (from duration ${duration}s / ${count} tiles)`);
        } else {
            console.log("Using default interval: 10000ms");
        }
    }

    const timeMs = timestamp * 1000;
    const totalTileIndex = Math.floor(timeMs / durationPerTile);
    const tilesPerBoard = bestBoard.rows * bestBoard.columns;
    const boardIndex = Math.floor(totalTileIndex / tilesPerBoard);
    const tileInBoard = totalTileIndex % tilesPerBoard;
    const row = Math.floor(tileInBoard / bestBoard.columns);
    const col = tileInBoard % bestBoard.columns;

    console.log(`\n--- Calculation Results ---`);
    console.log(`Total Tile Index: ${totalTileIndex}`);
    console.log(`Board Index: ${boardIndex}`);
    console.log(`Row: ${row}, Col: ${col}`);

    let url = bestBoard.template_url;
    url = url.replace('$N$', boardIndex.toString());
    url = url.replace('$M$', '0');

    console.log(`Final URL: ${url}`);
}

runDebug();
