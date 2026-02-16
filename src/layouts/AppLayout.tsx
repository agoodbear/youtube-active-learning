import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { VideoPlayer } from '../components/VideoPlayer';
import type { VideoPlayerHandle } from '../components/VideoPlayer';
import { TranscriptView } from '../components/TranscriptView';
import type { TranscriptViewHandle } from '../components/TranscriptView';
import { HighlightsPanel } from '../components/HighlightsPanel';
import { MarkersBar } from '../components/MarkersBar';
import { CategoryDropdown } from '../components/CategoryDropdown';
import { LibraryPage } from '../components/LibraryPage';
import { subscribeHighlights, getVideoCategories, addHighlight, saveVideoMeta, updateHighlight } from '../lib/db';
import { storage } from '../lib/firebase';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { parseStoryboardSpec, getStoryboardData } from '../lib/storyboard';
import { LogOut, Layout, BookOpen, Sparkles, ArrowDownCircle, FileText, Highlighter } from 'lucide-react';
import { cn } from '../lib/utils';

// Extract YouTube Video ID from URL
const getYouTubeID = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : "";
};

interface Highlight {
    id: string;
    text: string;
    timestamp: number;
    type?: string;     // New
    imageUrl?: string; // New
}

// ─── Breakpoint Hook ──────────────────────────────────────────────
type Breakpoint = 'mobile' | 'tablet' | 'desktop';

function useBreakpoint(): Breakpoint {
    const [bp, setBp] = useState<Breakpoint>(() => {
        if (typeof window === 'undefined') return 'desktop';
        if (window.innerWidth < 768) return 'mobile';
        if (window.innerWidth < 1024) return 'tablet';
        return 'desktop';
    });

    useEffect(() => {
        const update = () => {
            const w = window.innerWidth;
            setBp(w < 768 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop');
        };
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);

    return bp;
}

// ─── Main Layout ──────────────────────────────────────────────────

export function AppLayout() {
    const { logout, user } = useAuth();
    const playerRef = useRef<VideoPlayerHandle>(null);
    const transcriptRef = useRef<TranscriptViewHandle>(null);
    const [videoUrl, setVideoUrl] = useState<string>("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    useEffect(() => {
        // Parse URL on mount to check for /video/:id
        const path = window.location.pathname;
        const match = path.match(/\/video\/([^/?]+)/);
        if (match && match[1]) {
            setVideoUrl(`https://www.youtube.com/watch?v=${match[1]}`);
        }
    }, []);

    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [loopRange, setLoopRange] = useState<{ start: number; end: number } | null>(null);
    const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);

    const [highlights, setHighlights] = useState<Highlight[]>([]);
    const [categoryIds, setCategoryIds] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState<'studio' | 'library'>('studio');

    // Mobile sub-tab for Transcript / Highlights toggle
    const [mobileSubTab, setMobileSubTab] = useState<'transcript' | 'highlights'>('transcript');

    const breakpoint = useBreakpoint();

    // Resizable Layout State — only used on desktop
    const [videoHeightPercent, setVideoHeightPercent] = useState(50);
    const [sidebarWidthPercent, setSidebarWidthPercent] = useState(25);
    const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
    const [isDraggingVideo, setIsDraggingVideo] = useState(false);
    const mainContentRef = useRef<HTMLDivElement>(null);

    // Reset resize percentages when breakpoint changes to avoid stale extreme values
    useEffect(() => {
        if (breakpoint === 'desktop') {
            // Clamp to safe range on return to desktop
            setVideoHeightPercent(prev => Math.max(30, Math.min(70, prev)));
            setSidebarWidthPercent(prev => Math.max(20, Math.min(45, prev)));
        }
    }, [breakpoint]);

    // Resize Handlers (desktop only)
    useEffect(() => {
        if (breakpoint !== 'desktop') return;

        const handleMouseMove = (e: MouseEvent) => {
            if (isDraggingSidebar && mainContentRef.current) {
                const containerWidth = mainContentRef.current.getBoundingClientRect().width;
                const containerLeft = mainContentRef.current.getBoundingClientRect().left;
                const sidebarPx = (containerLeft + containerWidth) - e.clientX;
                const newPercent = (sidebarPx / containerWidth) * 100;
                if (newPercent >= 20 && newPercent <= 45) {
                    setSidebarWidthPercent(newPercent);
                }
            }
            if (isDraggingVideo && mainContentRef.current) {
                const containerRect = mainContentRef.current.getBoundingClientRect();
                const containerHeight = containerRect.height;
                const topOffset = containerRect.top;
                const videoPx = e.clientY - topOffset;
                const newPercent = (videoPx / containerHeight) * 100;
                if (newPercent >= 30 && newPercent <= 70) {
                    setVideoHeightPercent(newPercent);
                }
            }
        };

        const handleMouseUp = () => {
            setIsDraggingSidebar(false);
            setIsDraggingVideo(false);
            document.body.style.cursor = 'default';
        };

        if (isDraggingSidebar || isDraggingVideo) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            document.body.style.userSelect = 'none';
        } else {
            document.body.style.userSelect = '';
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDraggingSidebar, isDraggingVideo, breakpoint]);

    const videoId = getYouTubeID(videoUrl);

    useEffect(() => {
        if (!videoId || !user) return;

        setCategoryIds([]);
        getVideoCategories(videoId, user.uid).then(cats => {
            if (cats.length > 0) setCategoryIds(cats);
        });

        fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`)
            .then(r => r.json())
            .then(data => {
                if (data.title) {
                    saveVideoMeta(videoId, user.uid, data.title, videoUrl);
                }
            })
            .catch(() => { });

        const unsubscribe = subscribeHighlights(videoId, user.uid, (data) => {
            const mapped = data.map(h => ({
                id: h.id!,
                text: h.text,
                timestamp: h.startSec,
                type: h.type,        // Map type
                imageUrl: h.imageUrl // Map imageUrl
            }));
            setHighlights(mapped);
        });

        return () => unsubscribe();
    }, [videoId, user]);

    // Listen for 'add-highlight' event
    useEffect(() => {
        if (!user || !videoId) return;

        const handleAddHighlight = async (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (!detail) return;
            try {
                await addHighlight({
                    userId: user.uid,
                    videoId: videoId,
                    text: detail.text,
                    startSec: detail.timestamp,
                    endSec: detail.endTimestamp || detail.timestamp + 5,
                    startSegmentStart: detail.startSegmentStart, // New
                    endSegmentStart: detail.endSegmentStart,     // New
                    startOffset: detail.startOffset,             // New
                    endOffset: detail.endOffset,                 // New
                    type: 'KeyPoint',
                    comment: detail.comment
                });
            } catch (error) {
                console.error("Error saving highlight:", error);
            }
        };

        window.addEventListener('add-highlight', handleAddHighlight);
        return () => window.removeEventListener('add-highlight', handleAddHighlight);
    }, [user, videoId]);

    const handleSeek = useCallback((seconds: number) => {
        playerRef.current?.seekTo(seconds);
    }, []);

    const handleProgress = useCallback((state: { playedSeconds: number }) => {
        setCurrentTime(state.playedSeconds);
        if (loopRange) {
            if (state.playedSeconds >= loopRange.end) {
                playerRef.current?.seekTo(loopRange.start);
            }
        }
    }, [loopRange]);

    const handleStartLoop = useCallback((start: number, end: number) => {
        setLoopRange({ start, end });
        playerRef.current?.seekTo(start);
    }, []);

    const handleStopLoop = useCallback(() => {
        setLoopRange(null);
    }, []);

    const handleSnapshot = useCallback(async (timestamp: number) => {
        if (!user || !videoId) return;

        // Use static thumbnail as immediate placeholder
        const thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

        let docRefId: string | undefined;

        try {
            // 1. Save highlight immediately with placeholder
            const docRef = await addHighlight({
                userId: user.uid,
                videoId: videoId,
                text: '',
                startSec: timestamp,
                endSec: timestamp,
                type: 'Snapshot',
                imageUrl: thumbnail
            });
            docRefId = docRef.id;

            // 2. Client-side Storyboard Capture
            const playerResponse = playerRef.current?.getPlayerResponse();
            if (playerResponse) {
                const specRaw = playerResponse.storyboards?.playerStoryboardSpecRenderer?.spec;
                if (specRaw) {
                    const spec = parseStoryboardSpec(specRaw);
                    if (spec) {
                        const data = getStoryboardData(spec, timestamp);

                        // Load image
                        const img = new Image();
                        img.crossOrigin = "Anonymous";
                        img.src = data.url;

                        await new Promise((resolve, reject) => {
                            img.onload = resolve;
                            img.onerror = reject;
                        });

                        // Crop via Canvas
                        const canvas = document.createElement('canvas');
                        canvas.width = data.width;
                        canvas.height = data.height;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                            ctx.drawImage(
                                img,
                                data.x, data.y, data.width, data.height, // Source crop
                                0, 0, data.width, data.height            // Dest
                            );

                            // Get Data URL
                            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

                            // Upload to Firebase Storage
                            if (storage) {
                                const storageRef = ref(storage, `snapshots/${user.uid}/${videoId}/${timestamp.toFixed(2)}.jpg`);
                                await uploadString(storageRef, dataUrl, 'data_url');
                                const downloadURL = await getDownloadURL(storageRef);

                                // Update Firestore
                                if (docRefId) {
                                    await updateHighlight(docRefId, { imageUrl: downloadURL });
                                    console.log('[Snapshot] Successfully captured and uploaded storyboard frame');
                                }
                                return; // Success!
                            }
                        }
                    }
                }
            }

            console.warn('[Snapshot] Failed to extract storyboard, falling back to thumbnail/backend');
            // If client-side failed, we could optionally try backend, but user wants to avoid backend blocking.
            // For now, if client fails, we stick with the thumbnail (which is already set).

        } catch (error) {
            console.error("Error saving snapshot:", error);
        }
    }, [user, videoId]);

    const handleTogglePlayPause = useCallback(() => {
        playerRef.current?.togglePlayPause();
    }, []);

    // ─── Shared sub-components ────────────────────────────────────

    const videoSection = (
        <div className="space-y-2">
            {/* URL + Category */}
            <div className="flex gap-2">
                <input
                    type="text"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    placeholder="Paste YouTube URL..."
                    className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-transparent shadow-sm transition-all placeholder:text-slate-400"
                />
                {user && (
                    <CategoryDropdown
                        userId={user.uid}
                        videoId={videoId}
                        selectedCategoryIds={categoryIds}
                        onCategoryChange={setCategoryIds}
                    />
                )}
            </div>
            {/* Video */}
            <div className="rounded-2xl overflow-hidden shadow-2xl shadow-slate-200/50 bg-slate-900 ring-1 ring-slate-900/5">
                <VideoPlayer
                    ref={playerRef}
                    url={videoUrl}
                    onProgress={handleProgress}
                    onDuration={setDuration}
                    onSnapshot={handleSnapshot}
                />
            </div>
            {/* Markers */}
            <MarkersBar
                duration={duration}
                currentTime={currentTime}
                highlights={highlights}
                onSeek={handleSeek}
            />
        </div>
    );

    const transcriptSection = (
        <div className="bg-white border border-slate-200/60 rounded-2xl overflow-hidden shadow-sm flex flex-col h-full ring-1 ring-slate-900/5">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 backdrop-blur-sm flex items-center justify-between flex-shrink-0">
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-400" />
                    Transcript
                </h3>
                <div className="flex items-center gap-2">
                    {!isAutoScrollEnabled && (
                        <button
                            onClick={() => transcriptRef.current?.resumeAutoScroll()}
                            className="flex items-center gap-1 text-xs bg-red-50 text-red-500 border border-red-200 px-2 py-0.5 rounded-full hover:bg-red-100 transition-colors animate-fade-in"
                        >
                            <ArrowDownCircle className="w-3 h-3" />
                            Resume Auto-scroll
                        </button>
                    )}
                    <span className="text-xs text-slate-400 bg-white/80 px-2 py-0.5 rounded-full hidden sm:inline">Select text → Auto-save</span>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto">
                <TranscriptView
                    ref={transcriptRef}
                    videoId={videoId}
                    onSeek={handleSeek}
                    currentTime={currentTime}
                    isAutoScrollEnabled={isAutoScrollEnabled}
                    onAutoScrollChange={setIsAutoScrollEnabled}
                    onTogglePlayPause={handleTogglePlayPause}
                />
            </div>
        </div>
    );

    const highlightsSection = (
        <HighlightsPanel
            videoId={videoId}
            onSeek={handleSeek}
            onLoop={handleStartLoop}
            onStopLoop={handleStopLoop}
            currentLoop={loopRange}
        />
    );

    const loopIndicator = loopRange && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-violet-500 text-white px-4 py-1.5 rounded-full text-xs font-semibold shadow-lg shadow-violet-200 flex items-center gap-2">
            <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
            Looping ({loopRange.start.toFixed(0)}s - {loopRange.end.toFixed(0)}s)
            <button onClick={handleStopLoop} className="ml-2 hover:text-violet-200">Stop</button>
        </div>
    );

    // ─── Render ───────────────────────────────────────────────────

    return (
        <div className="h-screen bg-slate-50 text-slate-900 font-sans flex flex-col overflow-hidden selection:bg-brand-100 selection:text-brand-900">
            {/* Top Navigation */}
            <header className="h-16 flex-shrink-0 border-b border-slate-200/50 bg-white/80 backdrop-blur-md flex items-center justify-between px-4 md:px-6 z-20 transition-all duration-300">
                <div className="flex items-center gap-4 md:gap-8">
                    <div className="flex items-center gap-2.5 group cursor-pointer">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-brand-500/20 group-hover:shadow-brand-500/30 transition-all duration-300">
                            <Sparkles className="w-5 h-5 text-white" />
                        </div>
                        <span className="font-bold text-lg tracking-tight text-slate-900">Active<span className="text-brand-600">Learn</span></span>
                    </div>

                    <nav className="flex items-center gap-1">
                        <NavItem icon={<Layout className="w-4 h-4" />} label="Studio" active={activeTab === 'studio'} onClick={() => setActiveTab('studio')} />
                        <NavItem icon={<BookOpen className="w-4 h-4" />} label="Library" active={activeTab === 'library'} onClick={() => setActiveTab('library')} />
                    </nav>
                </div>

                <div className="flex items-center gap-3">
                    {user?.photoURL && (
                        <img src={user.photoURL} alt="User" className="w-8 h-8 rounded-full border-2 border-white shadow-sm" />
                    )}
                    <button
                        onClick={logout}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <LogOut className="w-4 h-4" />
                        <span className="hidden sm:block">Sign Out</span>
                    </button>
                </div>
            </header>

            {/* ═══ STUDIO ═══ */}
            {activeTab === 'studio' && (
                <>
                    {/* ── MOBILE (< 768px) ── */}
                    {breakpoint === 'mobile' && (
                        <div className="flex-1 flex flex-col overflow-hidden relative">
                            {loopIndicator}
                            {/* Video — fixed aspect ratio */}
                            <div className="flex-shrink-0 p-3 pb-1">
                                {videoSection}
                            </div>
                            {/* Sub-tab bar */}
                            <div className="flex-shrink-0 flex gap-1 px-3 py-1.5 bg-slate-50/80 border-b border-slate-200/60">
                                <button
                                    onClick={() => setMobileSubTab('transcript')}
                                    className={cn(
                                        "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all",
                                        mobileSubTab === 'transcript'
                                            ? "bg-white text-violet-700 shadow-sm border border-violet-200"
                                            : "text-slate-500 hover:text-slate-700"
                                    )}
                                >
                                    <FileText className="w-3.5 h-3.5" />
                                    Transcript
                                </button>
                                <button
                                    onClick={() => setMobileSubTab('highlights')}
                                    className={cn(
                                        "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all",
                                        mobileSubTab === 'highlights'
                                            ? "bg-white text-violet-700 shadow-sm border border-violet-200"
                                            : "text-slate-500 hover:text-slate-700"
                                    )}
                                >
                                    <Highlighter className="w-3.5 h-3.5" />
                                    Highlights
                                </button>
                            </div>
                            {/* Content */}
                            <div className="flex-1 overflow-hidden p-3 pt-2">
                                {mobileSubTab === 'transcript' ? (
                                    <div className="h-full">{transcriptSection}</div>
                                ) : (
                                    <div className="h-full bg-white border border-slate-200/60 rounded-2xl overflow-hidden shadow-lg shadow-slate-100">
                                        {highlightsSection}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── TABLET (768–1023px) ── */}
                    {breakpoint === 'tablet' && (
                        <main className="flex-1 flex overflow-hidden relative">
                            {loopIndicator}
                            {/* Left: Video + Transcript */}
                            <div className="flex-1 flex flex-col overflow-hidden min-w-0" style={{ flex: '0 0 60%' }}>
                                <div className="flex-shrink-0 p-3 pb-1">
                                    {videoSection}
                                </div>
                                <div className="flex-1 overflow-hidden px-3 pb-3 pt-1">
                                    <div className="h-full">{transcriptSection}</div>
                                </div>
                            </div>
                            {/* Right: Highlights */}
                            <div
                                className="border-l border-slate-200/60 bg-white/80 backdrop-blur-sm flex flex-col overflow-hidden"
                                style={{ flex: '0 0 40%' }}
                            >
                                {highlightsSection}
                            </div>
                        </main>
                    )}

                    {/* ── DESKTOP (≥ 1024px) ── */}
                    {breakpoint === 'desktop' && (
                        <main ref={mainContentRef} className="flex-1 flex overflow-hidden relative">
                            {loopIndicator}

                            {/* Left: Video + Transcript (resizable split) */}
                            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                                {/* Video */}
                                <div
                                    className="flex-shrink-0 p-3 pb-0 overflow-y-auto bg-slate-50/50"
                                    style={{ height: `${videoHeightPercent}%` }}
                                >
                                    <div className="max-w-[90rem] mx-auto">
                                        {videoSection}
                                    </div>
                                </div>

                                {/* Horizontal Resize Handle */}
                                <div
                                    className="h-2 w-full cursor-row-resize hover:bg-violet-400/50 flex items-center justify-center group flex-shrink-0 transition-colors"
                                    onMouseDown={() => {
                                        setIsDraggingVideo(true);
                                        document.body.style.cursor = 'row-resize';
                                    }}
                                >
                                    <div className="w-12 h-1 bg-slate-300 rounded-full group-hover:bg-violet-500 transition-colors" />
                                </div>

                                {/* Transcript */}
                                <div className="flex-1 overflow-hidden px-3 pb-3 pt-0">
                                    <div className="max-w-[90rem] mx-auto h-full">
                                        {transcriptSection}
                                    </div>
                                </div>
                            </div>

                            {/* Vertical Resize Handle */}
                            <div
                                className="w-1.5 cursor-col-resize hover:bg-violet-400/50 flex items-center justify-center group flex-shrink-0 transition-colors h-full bg-slate-100 border-l border-slate-200"
                                onMouseDown={() => {
                                    setIsDraggingSidebar(true);
                                    document.body.style.cursor = 'col-resize';
                                }}
                            />

                            {/* Right: Highlights */}
                            <div
                                className="border-l border-slate-200/60 bg-white/80 backdrop-blur-sm flex flex-col shadow-inner overflow-hidden flex-shrink-0"
                                style={{ width: `${sidebarWidthPercent}%` }}
                            >
                                {highlightsSection}
                            </div>
                        </main>
                    )}
                </>
            )}

            {activeTab === 'library' && (
                <LibraryPage onOpenVideo={(url) => {
                    setVideoUrl(url);
                    setActiveTab('studio');
                }} />
            )}
        </div>
    );
}

function NavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick?: () => void }) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "flex items-center gap-2 px-3.5 py-2 rounded-full transition-all duration-200 text-sm font-medium",
                active
                    ? "bg-slate-900 text-white shadow-md ring-1 ring-slate-900/10"
                    : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
            )}
        >
            {icon}
            <span>{label}</span>
        </button>
    )
}
