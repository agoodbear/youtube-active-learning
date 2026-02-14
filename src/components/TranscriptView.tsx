import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { Loader2, AlertCircle, Upload } from 'lucide-react';
import { cn } from '../lib/utils';
import { parseSRT } from '../lib/srtParser';
import { subscribeHighlights, updateHighlight, deleteHighlight, saveTranscript, getTranscript, type Highlight } from '../lib/db';
import { useAuth } from '../contexts/AuthContext';
import { SelectionPopover } from './SelectionPopover';

interface TranscriptSegment {
    text: string;
    duration: number;
    offset: number;
}

export interface TranscriptViewHandle {
    resumeAutoScroll: () => void;
}

interface TranscriptViewProps {
    videoId: string;
    onSeek: (seconds: number) => void;
    currentTime: number;
    onAutoScrollChange?: (enabled: boolean) => void;
    isAutoScrollEnabled?: boolean;
    onTogglePlayPause?: () => void;
}

export const TranscriptView = forwardRef<TranscriptViewHandle, TranscriptViewProps>(({ videoId, onSeek, currentTime, onAutoScrollChange, isAutoScrollEnabled = true, onTogglePlayPause }, ref) => {
    const [segments, setSegments] = useState<TranscriptSegment[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [flashingTime, setFlashingTime] = useState<number | null>(null);
    const [highlights, setHighlights] = useState<Highlight[]>([]);
    const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
    const [editingHighlight, setEditingHighlight] = useState<Highlight | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const activeSegmentRef = useRef<HTMLDivElement>(null);
    const { user } = useAuth();

    // Find active segment index based on currentTime
    const activeSegmentIndex = segments.findIndex((prop, index) => {
        const startTime = prop.offset / 1000;
        const nextStartTime = segments[index + 1] ? segments[index + 1].offset / 1000 : Infinity;
        return currentTime >= startTime && currentTime < nextStartTime;
    });

    const isSystemScrolling = useRef(false);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
        resumeAutoScroll: () => {
            if (activeSegmentIndex !== -1 && activeSegmentRef.current) {
                isSystemScrolling.current = true;
                activeSegmentRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Reset system scrolling flag after animation roughly finishes
                setTimeout(() => {
                    isSystemScrolling.current = false;
                }, 1000);
            }
            onAutoScrollChange?.(true);
        }
    }));

    // Auto-scroll to active segment when it changes
    useEffect(() => {
        if (isAutoScrollEnabled && activeSegmentIndex !== -1 && activeSegmentRef.current) {
            isSystemScrolling.current = true;
            activeSegmentRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Reset flag after scroll animation
            setTimeout(() => {
                isSystemScrolling.current = false;
            }, 1000);
        }
    }, [activeSegmentIndex, isAutoScrollEnabled]);

    const handleScroll = () => {
        if (isSystemScrolling.current) {
            // It's a system-triggered scroll, ignore
            return;
        }

        // Check visibility of active segment
        if (activeSegmentRef.current && containerRef.current) {
            const container = containerRef.current;
            const element = activeSegmentRef.current;

            const containerRect = container.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();

            // Check if user has scrolled back to the current segment (it is visible)
            // We consider it visible if it overlaps with the container's visible area
            const isVisible = (
                elementRect.top < containerRect.bottom &&
                elementRect.bottom > containerRect.top
            );

            if (isVisible) {
                if (!isAutoScrollEnabled) {
                    onAutoScrollChange?.(true);
                }
            } else {
                if (isAutoScrollEnabled) {
                    onAutoScrollChange?.(false);
                }
            }
        } else if (isAutoScrollEnabled) {
            // If no active segment, or refs missing, generally implying user is scrolling arbitrarily
            onAutoScrollChange?.(false);
        }
    };

    // ... (existing code for fetching transcript) ...

    // 1. Fetch Transcript
    useEffect(() => {
        if (!videoId || !functions) return;

        const fetchTranscript = async () => {
            setLoading(true);
            setError(null);
            try {
                // Check Firestore for a saved transcript first
                if (user) {
                    const saved = await getTranscript(videoId, user.uid);
                    if (saved && saved.length > 0) {
                        setSegments(saved);
                        setLoading(false);
                        return;
                    }
                }

                // Fallback: call Cloud Function
                const getTranscriptFn = httpsCallable<{ videoId: string }, TranscriptSegment[]>(functions!, 'getTranscript');
                const result = await getTranscriptFn({ videoId });
                setSegments(result.data);
            } catch (err: any) {
                console.error("Failed to fetch transcript - Full Error Object:", err);
                console.error("Error Code:", err.code);
                console.error("Error Message:", err.message);
                console.error("Error Details:", err.details);

                // Check if it's a known error code from Cloud Functions
                if (err.code === 'resource-exhausted') {
                    setError("YouTube is strictly limiting requests. Please try again later or upload an SRT file locally.");
                } else {
                    const message = err instanceof Error ? err.message : "Could not load transcript.";
                    setError(message + (err.code ? ` (Code: ${err.code})` : ''));
                }
            } finally {
                setLoading(false);
            }
        };

        fetchTranscript();
    }, [videoId, user]);

    // 1.5 Subscribe to Highlights
    useEffect(() => {
        if (!videoId || !user) return;
        const unsubscribe = subscribeHighlights(videoId, user.uid, (data) => {
            setHighlights(data);
        });
        return () => unsubscribe();
    }, [videoId, user]);

    // Handle File Upload
    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            const content = e.target?.result as string;
            if (content) {
                const parsedSegments = parseSRT(content);
                if (parsedSegments.length > 0) {
                    setSegments(parsedSegments);
                    setError(null);

                    // Persist to Firestore
                    if (user && videoId) {
                        try {
                            await saveTranscript(videoId, user.uid, parsedSegments);
                        } catch (err) {
                            console.error('Failed to save transcript:', err);
                        }
                    }
                } else {
                    setError("Failed to parse SRT file. Please check the format.");
                }
            }
        };
        reader.readAsText(file);
    };

    // 2. Listen for highlight-to-transcript events
    useEffect(() => {
        const handleHighlightClick = (e: Event) => {
            const customEvent = e as CustomEvent<{ timestamp: number; sourceRect: DOMRect; highlightId: string }>;
            const { timestamp } = customEvent.detail;

            // Find the segment closest to this timestamp
            const targetTime = timestamp;
            const targetElement = containerRef.current?.querySelector(`[data-time="${targetTime}"]`) as HTMLElement;

            if (!targetElement) {
                // Try to find closest match
                const allElements = containerRef.current?.querySelectorAll('[data-time]');
                let closestEl: HTMLElement | null = null;
                let closestDiff = Infinity;

                allElements?.forEach((el) => {
                    const elTime = parseFloat((el as HTMLElement).getAttribute('data-time') || '0');
                    const diff = Math.abs(elTime - targetTime);
                    if (diff < closestDiff) {
                        closestDiff = diff;
                        closestEl = el as HTMLElement;
                    }
                });

                if (closestEl) {
                    scrollAndFlash(closestEl);
                }
            } else {
                scrollAndFlash(targetElement);
            }
        };

        const scrollAndFlash = (element: HTMLElement) => {
            // Scroll into view first
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Delay flash until scroll animation is likely complete (~400ms for smooth scroll)
            setTimeout(() => {
                const time = parseFloat(element.getAttribute('data-time') || '0');
                setFlashingTime(time);

                // Remove flash after animation completes
                setTimeout(() => setFlashingTime(null), 2000);
            }, 400);
        };

        window.addEventListener('highlight-to-transcript', handleHighlightClick);
        return () => window.removeEventListener('highlight-to-transcript', handleHighlightClick);
    }, []);

    // 2. Selection Logic - Show Popover
    const handleMouseUp = useCallback(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const text = selection.toString().trim();
        if (!text || text.length < 1) return;

        // Try to find start and end segments
        const anchorNode = selection.anchorNode;
        const focusNode = selection.focusNode;

        const anchorSegmentEl = anchorNode?.parentElement?.closest('[data-time]') as HTMLElement | null;
        const focusSegmentEl = focusNode?.parentElement?.closest('[data-time]') as HTMLElement | null;

        if (!anchorSegmentEl || !focusSegmentEl) return;

        const anchorTime = parseFloat(anchorSegmentEl.getAttribute('data-time') || '0');
        const focusTime = parseFloat(focusSegmentEl.getAttribute('data-time') || '0');

        // Determine real order
        let startSegmentTime = anchorTime;
        let endSegmentTime = focusTime;
        let startNode = anchorNode!;
        let startOffsetRaw = selection.anchorOffset;
        let endNode = focusNode!;
        let endOffsetRaw = selection.focusOffset;

        // Swap if backward selection
        if (anchorTime > focusTime) {
            startSegmentTime = focusTime;
            endSegmentTime = anchorTime;
            startNode = focusNode!;
            startOffsetRaw = selection.focusOffset;
            endNode = anchorNode!;
            endOffsetRaw = selection.anchorOffset;
        } else if (anchorTime === focusTime) {
            // Same segment, check positions
            const range = selection.getRangeAt(0);
            // Range automatically handles start/end order usually?
            // But we need to be sure about which node is start
            if (range.startContainer !== startNode || range.startOffset !== startOffsetRaw) {
                // Selection was likely backward within segment, or we need to respect range
                startNode = range.startContainer;
                startOffsetRaw = range.startOffset;
                endNode = range.endContainer;
                endOffsetRaw = range.endOffset;
            }
        }

        const startSegmentEl = containerRef.current?.querySelector(`[data-time="${startSegmentTime}"]`) as HTMLElement;
        const endSegmentEl = containerRef.current?.querySelector(`[data-time="${endSegmentTime}"]`) as HTMLElement;

        if (!startSegmentEl || !endSegmentEl) return;

        // Calculate Character Offsets relative to the segments
        // We use the helper `getOffsetInSegment`
        const startOffset = getOffsetInSegment(startSegmentEl.querySelector('p')!, startNode, startOffsetRaw);
        const endOffset = getOffsetInSegment(endSegmentEl.querySelector('p')!, endNode, endOffsetRaw);

        const timestamp = startSegmentTime;
        const endTimestamp = endSegmentTime;

        // Instant Save with empty comment
        window.dispatchEvent(new CustomEvent('add-highlight', {
            detail: {
                text,
                timestamp,
                endTimestamp,
                startSegmentStart: startSegmentTime,
                endSegmentStart: endSegmentTime,
                startOffset,
                endOffset,
                comment: ''
            }
        }));

        // Clear selection
        window.getSelection()?.removeAllRanges();
    }, []);

    const handleHighlightClick = (e: React.MouseEvent, highlight: Highlight) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        setEditingHighlight(highlight);
        setPopoverPosition({
            top: rect.top - 140, // Position above
            left: rect.left + (rect.width / 2) - 144 // Center
        });
    };

    const handleSaveComment = async (comment: string, tag?: string) => {
        if (editingHighlight) {
            try {
                // Update both comment and tag
                await updateHighlight(editingHighlight.id!, { comment, tag });
                setEditingHighlight(null);
                setPopoverPosition(null);
            } catch (err) {
                console.error("Failed to update comment:", err);
            }
        }
    };

    const handleDeleteHighlight = async () => {
        if (editingHighlight && editingHighlight.id) {
            try {
                await deleteHighlight(editingHighlight.id);
                setEditingHighlight(null);
                setPopoverPosition(null);
            } catch (err) {
                console.error("Failed to delete highlight:", err);
            }
        }
    }

    const getOffsetInSegment = (segmentNode: HTMLElement, targetNode: Node, targetOffset: number): number => {
        if (targetNode.nodeType === Node.ELEMENT_NODE) {
            // If target is element, offset is child index. 
            // We'll just approximate to start (0) or end (length) based on offset? 
            // For now, return 0 if at start, length if quite large.
            // Safer: Use Range to get character offset
            const range = document.createRange();
            range.selectNodeContents(segmentNode);
            range.setEnd(targetNode, targetOffset);
            return range.toString().length;
        }

        // For text nodes, use Range to calculate offset relative to container
        const range = document.createRange();
        range.selectNodeContents(segmentNode);
        range.setEnd(targetNode, targetOffset);
        return range.toString().length;
    };

    const renderSegmentText = (text: string, segmentStart: number) => {
        // Filter highlights that overlap with this segment
        // Overlap condition: 
        // 1. Highlight starts in this segment
        // 2. Highlight ends in this segment
        // 3. Highlight covers this segment entirely

        // We use segmentStart (seconds) as the identifier.
        // Current segment interval: [segmentStart, nextSegmentStart)
        // Since we don't know nextSegmentStart easily here without looking at array, 
        // we assume segments are ordered and dense? 
        // Actually we do know segment duration from previous `parseSRT` logic implicitly, 
        // but `renderSegmentText` only gets `text` and `segmentStart`.
        // Let's rely on the Highlight's stored `startSegmentStart` / `endSegmentStart`.

        const relevantHighlights = highlights.filter(h => {
            // Backward compatibility: use loose time matching if offsets missing
            if (h.startOffset === undefined) {
                return h.startSec === segmentStart || (h.startSec >= segmentStart && h.startSec < segmentStart + 5);
            }

            // Granular matching
            const segStart = segmentStart;
            // We need to know if this segment is "between" start and end segment of the highlight.
            // Ideally we compare times.
            // If h.startSegmentStart <= segStart AND h.endSegmentStart >= segStart
            // But we need to be careful about equality.

            // Case 1: Highlight starts here.
            if (h.startSegmentStart === segStart) return true;
            // Case 2: Highlight ends here.
            if (h.endSegmentStart === segStart) return true;
            // Case 3: Highlight spans across this segment.
            if ((h.startSegmentStart || 0) < segStart && (h.endSegmentStart || 0) > segStart) return true;

            return false;
        });

        if (relevantHighlights.length === 0) return text;

        // Build a "mask" of indices to highlight
        // text length
        const charMap = new Array(text.length).fill(null); // stores Highlight object or null

        relevantHighlights.forEach(h => {
            let startIndex = 0;
            let endIndex = text.length;

            if (h.startOffset === undefined) {
                // Fallback for old highlights: match string
                const matchIndex = text.toLowerCase().indexOf(h.text.toLowerCase());
                if (matchIndex !== -1) {
                    startIndex = matchIndex;
                    endIndex = matchIndex + h.text.length;
                } else {
                    return; // Skip if no text match found
                }
            } else {
                // Granular Logic
                if (h.startSegmentStart === segmentStart) {
                    startIndex = h.startOffset;
                } else {
                    startIndex = 0; // Started before
                }

                if (h.endSegmentStart === segmentStart) {
                    endIndex = h.endOffset!;
                } else {
                    endIndex = text.length; // Ends after
                }
            }

            // Apply to map (last writer wins? or merge? Let's just store the last one for now, or lists)
            // We prefer top-most highlight?
            for (let i = startIndex; i < endIndex; i++) {
                if (i >= 0 && i < charMap.length) {
                    charMap[i] = h;
                }
            }
        });

        // Reconstruct nodes
        const nodes: React.ReactNode[] = [];
        let currentHighlight: Highlight | null = null;
        let currentText = "";

        for (let i = 0; i < text.length; i++) {
            const h = charMap[i];
            if (h !== currentHighlight) {
                // Flush current text
                if (currentText) {
                    if (currentHighlight) {
                        nodes.push(
                            <span
                                key={i - currentText.length}
                                className={cn(
                                    "bg-brand-200/50 border-b border-brand-300 transition-colors cursor-pointer hover:bg-brand-300/50",
                                    flashingTime === (currentHighlight as Highlight).startSec && "bg-yellow-200 ring-2 ring-yellow-400"
                                )}
                                onClick={(e) => handleHighlightClick(e, currentHighlight!)}
                            >
                                {currentText}
                            </span>
                        );
                    } else {
                        nodes.push(<span key={i - currentText.length}>{currentText}</span>);
                    }
                }
                currentText = "";
                currentHighlight = h;
            }
            currentText += text[i];
        }

        // Flush last chunk
        if (currentText) {
            if (currentHighlight) {
                nodes.push(
                    <span
                        key={text.length}
                        className={cn(
                            "bg-brand-200/50 border-b border-brand-300 transition-colors cursor-pointer hover:bg-brand-300/50",
                            flashingTime === (currentHighlight as Highlight).startSec && "bg-yellow-200 ring-2 ring-yellow-400"
                        )}
                        onClick={(e) => handleHighlightClick(e, currentHighlight!)}
                    >
                        {currentText}
                    </span>
                );
            } else {
                nodes.push(<span key={text.length}>{currentText}</span>);
            }
        }

        return <>{nodes}</>;
    };

    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    if (loading) return <div className="p-4 text-slate-500 flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" />Loading transcript...</div>;
    if (loading) return <div className="p-4 text-slate-500 flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" />Loading transcript...</div>;

    // Remove early return for error to allow upload UI to show


    return (
        <div
            ref={containerRef}
            className="h-full overflow-y-auto p-4 space-y-1 select-text bg-white relative"
            onMouseUp={handleMouseUp}
            onScroll={handleScroll}
        >
            {/* Always visible Upload Action */}
            <SelectionPopover
                position={popoverPosition}
                onClose={() => {
                    setEditingHighlight(null);
                    setPopoverPosition(null);
                }}
                onSave={handleSaveComment}
                selectedText={editingHighlight?.text || ''}
                initialComment={editingHighlight?.comment}
                initialTag={editingHighlight?.tag}
                userId={user?.uid || ''}
                onDelete={editingHighlight ? handleDeleteHighlight : undefined}
            />
            {/* Always visible Upload Action */}
            <div className="absolute top-3 right-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <label className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 backdrop-blur shadow-sm border border-slate-200/60 rounded-full text-slate-400 hover:text-brand-600 hover:border-brand-200 cursor-pointer transition-all text-xs font-medium" title="Upload SRT">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload SRT</span>
                    <input
                        type="file"
                        accept=".srt"
                        onChange={handleFileUpload}
                        className="hidden"
                    />
                </label>
            </div>
            <div className="space-y-1">
                {segments.map((segment, index) => {
                    const startTime = segment.offset / 1000;
                    const isActive = index === activeSegmentIndex;

                    return (
                        <div
                            key={index}
                            data-time={startTime}
                            ref={isActive ? activeSegmentRef : null}
                            className={cn(
                                "group flex gap-4 p-3 rounded-lg transition-all duration-300 cursor-pointer border-l-4",
                                isActive
                                    ? "bg-brand-50/50 border-brand-500 shadow-sm"
                                    : "border-transparent hover:bg-slate-50",
                                flashingTime === startTime && "animate-flash-yellow bg-yellow-100 ring-2 ring-yellow-400"
                            )}
                            onClick={(e) => {
                                // Don't trigger if user is selecting text or clicking a highlighted span
                                const selection = window.getSelection();
                                if (selection && selection.toString().length > 0) return;
                                if ((e.target as HTMLElement).closest('[data-highlight-id]')) return;

                                if (isActive) {
                                    // Same segment: toggle play/pause
                                    onTogglePlayPause?.();
                                } else {
                                    // Different segment: seek there (seekTo auto-plays)
                                    onSeek(startTime);
                                }
                            }}
                        >
                            {/* Time Stamp */}
                            <span
                                className={cn(
                                    "font-mono text-xs pt-1 select-none cursor-pointer shrink-0 w-10 text-right transition-colors",
                                    isActive ? "text-brand-600 font-medium" : "text-slate-400 group-hover:text-slate-500"
                                )}
                            >
                                {formatTime(segment.offset)}
                            </span>

                            {/* Text Content */}
                            <p
                                className={cn(
                                    "text-base leading-relaxed flex-1 transition-colors",
                                    isActive ? "text-slate-900 font-medium" : "text-slate-600 group-hover:text-slate-800"
                                )}
                                data-time={startTime}
                            >
                                {renderSegmentText(segment.text, startTime)}
                            </p>
                        </div>
                    );
                })}
            </div>

            {segments.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-4">
                    {error ? (
                        <div className="text-red-500 flex items-center gap-2 mb-2 px-4 text-center">
                            <AlertCircle className="w-5 h-5 flex-shrink-0" />
                            <span className="text-sm">{error}</span>
                        </div>
                    ) : (
                        <p className="text-sm">No transcript available for this video.</p>
                    )}

                    <label className="flex items-center gap-2 px-5 py-2.5 bg-white text-brand-600 rounded-xl hover:bg-brand-50 cursor-pointer transition-all text-sm font-medium border border-slate-200 shadow-sm hover:shadow-md group">
                        <Upload className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" />
                        Upload .srt File
                        <input
                            type="file"
                            accept=".srt"
                            onChange={handleFileUpload}
                            className="hidden"
                        />
                    </label>
                </div>
            )}
        </div>
    );
});

TranscriptView.displayName = 'TranscriptView';
