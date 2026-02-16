"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const youtubei_js_1 = require("youtubei.js");
const VIDEO_ID = 'KAasBVVVU6M';
async function run() {
    var _a;
    console.log(`Testing Innertube for ${VIDEO_ID}...`);
    try {
        const innertube = await youtubei_js_1.Innertube.create({
            cache: new youtubei_js_1.UniversalCache(false),
            generate_session_locally: true
        });
        console.log('Innertube initialized.');
        const info = await innertube.getBasicInfo(VIDEO_ID);
        console.log('Basic info fetched.');
        // Check availability
        console.log('Playability:', (_a = info.basic_info.playability_status) === null || _a === void 0 ? void 0 : _a.status);
        // Check storyboards
        const storyboards = info.basic_info.storyboards; // Or check wherever it is in new version?
        // Actually, let's dump keys just in case structure changed
        // console.log('Keys on basic_info:', Object.keys(info.basic_info));
        if (storyboards && storyboards.length > 0) {
            console.log('SUCCESS: Found storyboards via Innertube:', storyboards.length);
            console.log(storyboards[0]);
        }
        else {
            console.log('FAILURE: No storyboards found via Innertube.');
            // Check if it's somewhere else?
            // console.log(JSON.stringify(info.basic_info, null, 2));
        }
    }
    catch (e) {
        console.error('CRITICAL ERROR (Innertube):', e.message);
        if (e.info)
            console.log('Error info:', e.info);
    }
}
run();
//# sourceMappingURL=debug-local.js.map