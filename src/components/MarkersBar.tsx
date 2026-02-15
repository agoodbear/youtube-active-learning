import { useState, useEffect } from 'react';
import { cn } from '../lib/utils';

interface Highlight {
    id: string;
    text: string;
    timestamp: number;
    type?: string; // New
}

interface MarkersBarProps {
    duration: number; // Total video duration in seconds
    highlights: Highlight[];
    onSeek: (seconds: number) => void;
    currentTime: number;
}

export function MarkersBar({ duration, highlights, onSeek, currentTime }: MarkersBarProps) {
    // Show bar even if duration is 0 (as loading state or placeholder)
    const validDuration = duration > 0 ? duration : 1;
    const percent = duration > 0 ? (currentTime / duration) * 100 : 0;

    // Track which marker should pulse
    const [pulsingTimestamp, setPulsingTimestamp] = useState<number | null>(null);

    // Listen for highlight-to-transcript events to pulse the marker
    useEffect(() => {
        const handlePulse = (e: Event) => {
            const customEvent = e as CustomEvent<{ timestamp: number }>;
            setPulsingTimestamp(customEvent.detail.timestamp);

            // Clear pulse after animation
            setTimeout(() => setPulsingTimestamp(null), 2000);
        };

        window.addEventListener('highlight-to-transcript', handlePulse);
        return () => window.removeEventListener('highlight-to-transcript', handlePulse);
    }, []);

    return (
        <div className="relative w-full h-8 mt-2 group select-none">
            {/* Background Track */}
            <div className="absolute top-1/2 -translate-y-1/2 w-full h-1.5 bg-zinc-800 rounded-full overflow-visible">
                {/* Progress Bar */}
                <div
                    className="h-full bg-purple-500/30 transition-all duration-100 ease-linear rounded-full"
                    style={{ width: `${percent}%` }}
                />

                {/* Current Position Arrow */}
                <div
                    className="absolute top-1/2 mt-2.5 w-4 h-4 text-red-500 transform -translate-x-1/2 -translate-y-0 transition-all duration-100 ease-linear z-20 pointer-events-none"
                    style={{ left: `${percent}%` }}
                >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full filter drop-shadow-sm">
                        <path d="M12 2L12 22M12 2L6 10M12 2L18 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </div>
            </div>

            {/* Markers */}
            {highlights.map((h) => {
                const positionPercent = (h.timestamp / validDuration) * 100;
                const isPulsing = pulsingTimestamp !== null && Math.abs(h.timestamp - pulsingTimestamp) < 0.5;
                const isSnapshot = h.type === 'Snapshot';

                return (
                    <div
                        key={h.id}
                        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 -ml-1.5 cursor-pointer z-10 group/marker"
                        style={{ left: `${positionPercent}%` }}
                        onClick={(e) => {
                            onSeek(h.timestamp);
                            window.dispatchEvent(new CustomEvent('highlight-to-transcript', {
                                detail: {
                                    timestamp: h.timestamp,
                                    sourceRect: e.currentTarget.getBoundingClientRect(),
                                    highlightId: h.id
                                }
                            }));
                        }}
                    >
                        {/* Marker Shape */}
                        <div className={cn(
                            "w-full h-full border-2 border-zinc-900 shadow-md transform transition-transform hover:scale-150",
                            isSnapshot
                                ? "bg-cyan-400 group-hover/marker:bg-cyan-300 rounded-sm" // Square for Snapshot
                                : "bg-yellow-400 group-hover/marker:bg-yellow-300 rounded-full", // Circle for Highlights
                            isPulsing && "animate-marker-pulse scale-[2] ring-4",
                            isPulsing && (isSnapshot ? "ring-cyan-400/50" : "ring-yellow-400/50")
                        )} />

                        {/* Tooltip */}
                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-xs px-2 py-1 rounded border border-white/10 opacity-0 group-hover/marker:opacity-100 pointer-events-none whitespace-nowrap z-20 shadow-xl transition-opacity">
                            {isSnapshot ? "Snapshot" : (h.text.length > 30 ? h.text.substring(0, 30) + "..." : h.text)}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
