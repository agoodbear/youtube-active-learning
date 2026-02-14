
export interface TranscriptSegment {
    text: string;
    duration: number;
    offset: number;
}

export function parseSRT(fileContent: string): TranscriptSegment[] {
    // Normalize line endings
    const content = fileContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Split into blocks by double newlines
    const blocks = content.split('\n\n').filter(block => block.trim().length > 0);

    const segments: TranscriptSegment[] = [];

    for (const block of blocks) {
        const lines = block.split('\n');

        // A valid SRT block usually has at least 3 lines: ID, Timing, Text
        if (lines.length < 3) continue;

        // Line 1: Sequence number (we skip this)

        // Line 2: Timing "00:00:01,000 --> 00:00:04,000"
        const timeLine = lines[1];
        const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s-->\s(\d{2}):(\d{2}):(\d{2}),(\d{3})/);

        if (!timeMatch) continue;

        const startMs = timeToMs(parseInt(timeMatch[1]), parseInt(timeMatch[2]), parseInt(timeMatch[3]), parseInt(timeMatch[4]));
        const endMs = timeToMs(parseInt(timeMatch[5]), parseInt(timeMatch[6]), parseInt(timeMatch[7]), parseInt(timeMatch[8]));

        // Line 3+: Text content (join remaining lines)
        const text = lines.slice(2).join(' ').trim();

        if (text) {
            segments.push({
                text,
                offset: startMs,
                duration: endMs - startMs
            });
        }
    }

    return segments;
}

function timeToMs(hours: number, minutes: number, seconds: number, ms: number): number {
    return (hours * 3600000) + (minutes * 60000) + (seconds * 1000) + ms;
}
