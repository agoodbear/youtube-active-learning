import * as functions from "firebase-functions";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const execAsync = promisify(exec);

// Define response type matching our frontend expectation
interface TranscriptSegment {
    text: string;
    duration: number;
    offset: number;
}

// Mock data for testing
const MOCK_TRANSCRIPTS: Record<string, TranscriptSegment[]> = {
    "dQw4w9WgXcQ": [
        { text: "We're no strangers to love", offset: 0, duration: 4000 },
        { text: "You know the rules and so do I", offset: 4000, duration: 4000 },
        { text: "A full commitment's what I'm thinking of", offset: 8000, duration: 4000 },
        { text: "Never gonna give you up", offset: 26000, duration: 3000 },
        { text: "Never gonna let you down", offset: 29000, duration: 3000 },
    ]
};

// Parse VTT file content to our transcript format
function parseVTT(vttContent: string): TranscriptSegment[] {
    const segments: TranscriptSegment[] = [];
    const lines = vttContent.split('\n');
    let i = 0;

    while (i < lines.length) {
        const line = lines[i].trim();

        // Look for timestamp lines like "00:00:01.520 --> 00:00:04.040"
        const timestampMatch = line.match(/(\d+:\d+:\d+\.\d+)\s*-->\s*(\d+:\d+:\d+\.\d+)/);

        if (timestampMatch) {
            const startTime = parseTimestamp(timestampMatch[1]);
            const endTime = parseTimestamp(timestampMatch[2]);

            // Get the text on the next line(s)
            i++;
            let text = '';
            while (i < lines.length && lines[i].trim() !== '' && !lines[i].match(/\d+:\d+:\d+\.\d+\s*-->/)) {
                if (text) text += ' ';
                text += lines[i].trim().replace(/<[^>]+>/g, ''); // Remove HTML tags
                i++;
            }

            if (text) {
                segments.push({
                    text: text,
                    offset: startTime,
                    duration: endTime - startTime
                });
            }
        } else {
            i++;
        }
    }

    return deduplicateSegments(segments);
}

// Deduplicate segments that are likely intermediate caption states
// (overlaps in time + substring match)
function deduplicateSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
    if (segments.length === 0) return segments;

    const cleanedSegments: TranscriptSegment[] = [];

    // We process sequentially and modify 'next' segments in place if needed (cloning first ideally, but here we just build a new array)
    // Actually, to modify 'next' based on 'current', we can iterate.

    // Process list to remove overlaps
    for (let i = 0; i < segments.length - 1; i++) {
        const current = segments[i];
        const next = segments[i + 1];

        // If they are temporally close (start times within 5 sec? actually VTT lines are sequential)
        // VTT lines usually: 
        // 1. 00:01 -> 00:03 "Hello"
        // 2. 00:03 -> 00:05 "World"
        // 3. 00:03 -> 00:05 "Hello World" (sometimes?)

        // Use a suffix-prefix overlap check
        // We want to remove the Overlap from the START of 'next'.

        const overlapLen = getOverlapLength(current.text, next.text);

        // Threshold: e.g. 5 chars to avoid removing 'a', 'the' coincidentally? 
        // Or punctuation. 
        if (overlapLen > 5) {
            // Trim overlap from next
            next.text = next.text.substring(overlapLen).trim();
        }

        // Also apply the substring deduplication from before (if next became empty or was already substring)
        // Case A: Next is substring of Current -> Next is usually "part 2" in progress? 
        // Actually if next IS substring of current, it might be a glitch? Usually it's the other way.
        // User example:
        // Current: "brand new ... if you"
        // Next: "gone through ... diagnos of"
        // Overlap: "gone through ... if you"
        // Result Next: "still haven't ..."  <-- This is what we want.

        if (current.text.trim().length > 0) {
            cleanedSegments.push(current);
        }
    }

    // Add the last one
    if (segments[segments.length - 1].text.trim().length > 0) {
        cleanedSegments.push(segments[segments.length - 1]);
    }

    return cleanedSegments;
}

function getOverlapLength(str1: string, str2: string): number {
    const s1 = str1.trim().toLowerCase();
    const s2 = str2.trim().toLowerCase();

    // Check if s2 starts with a suffix of s1
    // Optimization: start checking from min(s1.length, s2.length)
    const maxOverlap = Math.min(s1.length, s2.length);

    for (let len = maxOverlap; len > 0; len--) {
        if (s1.endsWith(s2.substring(0, len))) {
            // Double check with original string to preserve casing if needed? 
            // Nah, fuzzy match is fine, but we return length relative to original string logic?
            // We need strictly matching char count from str2's start.

            // Let's verify exact match on the original suffix for safety, 
            // or just rely on the fuzzy match index but return the index.

            // Actually, verify exact source case match to be safe?
            // Or allow case insensitive?
            // User text: "steps if you" (end of A), "gone through ... steps if you" (start of B).
            // Wait, in user example: "steps if you" is at END of A.
            // "gone through... steps if you" is start of B? 
            // NO.
            // Text A: "... steps if you"
            // Text B: "gone through ... steps if you ... diagnos"
            // Overlap: "gone through ... steps if you".
            // A contains the overlap at its END.
            // B contains the overlap at its START.

            // My logic: s1.endsWith(...)
            // Does A end with "gone through ... steps if you"? YES.
            // Does B start with "gone through ... steps if you"? YES.

            return len;
        }
    }
    return 0;
}

// Parse VTT timestamp to milliseconds
function parseTimestamp(timestamp: string): number {
    const parts = timestamp.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const secondsParts = parts[2].split('.');
    const seconds = parseInt(secondsParts[0], 10);
    const milliseconds = parseInt(secondsParts[1], 10);

    return (hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds;
}

// @ts-ignore
export const getTranscript = functions.https.onCall(async (request: any) => {
    const { data, auth } = request;

    if (!auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "The function must be called while authenticated."
        );
    }

    const videoId = data?.videoId;
    if (!videoId) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            "The function must be called with a 'videoId' argument."
        );
    }

    // 1. Check Mock Data First (Always succeed for demo videos)
    if (MOCK_TRANSCRIPTS[videoId]) {
        console.log(`[getTranscript] Returning MOCK data for ${videoId}`);
        return MOCK_TRANSCRIPTS[videoId];
    }

    console.log(`[yt-dlp] Fetching transcript for ${videoId}`);

    // Create temp directory for output - inside try/catch for safety
    let tempDir: string | null = null;
    let outputTemplate: string | null = null;

    try {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-'));
        outputTemplate = path.join(tempDir, '%(id)s');

        // Run yt-dlp to download subtitles only
        const ytdlpCmd = `/opt/homebrew/bin/yt-dlp --write-auto-sub --sub-langs "en.*" --skip-download --sub-format vtt -o "${outputTemplate}" "https://www.youtube.com/watch?v=${videoId}"`;

        console.log(`[yt-dlp] Running: ${ytdlpCmd}`);

        const { stdout, stderr } = await execAsync(ytdlpCmd, { timeout: 30000 });
        console.log(`[yt-dlp] stdout: ${stdout}`);
        if (stderr) console.log(`[yt-dlp] stderr: ${stderr}`);

        // Find the downloaded VTT file
        const files = fs.readdirSync(tempDir);
        const vttFile = files.find(f => f.endsWith('.vtt'));

        if (vttFile) {
            const vttPath = path.join(tempDir, vttFile);
            const vttContent = fs.readFileSync(vttPath, 'utf-8');
            console.log(`[yt-dlp] VTT file found: ${vttFile}, length: ${vttContent.length}`);

            const segments = parseVTT(vttContent);
            console.log(`[yt-dlp] Parsed ${segments.length} segments`);

            if (segments.length > 0) {
                return segments;
            }
        } else {
            console.log(`[yt-dlp] No VTT file found. Files in temp: ${files.join(', ')}`);
        }

    } catch (error: any) {
        console.error(`[yt-dlp] Error: ${error.message}`);

        // Check for Rate Limiting / 429
        if (error.message?.includes('HTTP Error 429') || error.stderr?.includes('HTTP Error 429')) {
            throw new functions.https.HttpsError(
                "resource-exhausted",
                "YouTube is currently rate-limiting requests. Please try again later or upload an SRT file manually."
            );
        }

        // Rethrow other known HttpsErrors
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }

        // For unknown errors, throw internal but with a message?
        // Or let it be handled by default?
        // If we want to avoid "internal" without details:
        throw new functions.https.HttpsError("internal", `Failed to fetch transcript: ${error.message}`);

    } finally {
        // Cleanup
        if (tempDir) {
            try {
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true });
                }
            } catch (e) {
                console.error("Failed to cleanup temp dir:", e);
            }
        }
    }

    throw new functions.https.HttpsError(
        "not-found",
        `No transcript found for video ${videoId}`
    );
});
