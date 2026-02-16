import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import { subscribeHighlights, deleteHighlight, updateHighlight } from '../lib/db';
import { storage } from '../lib/firebase';
import { ref, getDownloadURL, uploadBytesResumable } from 'firebase/storage';
import { Trash2, Repeat, PauseCircle, PlayCircle, Filter, Highlighter } from 'lucide-react';
import { TagDropdown } from './TagDropdown';
import { cn } from '../lib/utils';

interface Highlight {
    id: string;
    text: string;
    timestamp: number;
    createdAt: number;
    comment?: string;
    tag?: string;
    type?: string;     // New
    imageUrl?: string; // New
}

interface HighlightsPanelProps {
    videoId: string;
    onSeek: (seconds: number) => void;
    onLoop: (start: number, end: number) => void;
    onStopLoop: () => void;
    currentLoop: { start: number; end: number } | null;
}

export function HighlightsPanel({ videoId, onSeek, onLoop, onStopLoop, currentLoop }: HighlightsPanelProps) {
    const { user } = useAuth();
    const [highlights, setHighlights] = useState<Highlight[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState("");
    const [filterTag, setFilterTag] = useState<string>("");
    const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
    const [uploadingSnapshotId, setUploadingSnapshotId] = useState<string | null>(null);
    const [uploadProgressById, setUploadProgressById] = useState<Record<string, number>>({});
    const [snapshotUploadError, setSnapshotUploadError] = useState<string | null>(null);
    const snapshotCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

    const handleStartEdit = (id: string, currentComment: string = "") => {
        setEditingId(id);
        setEditText(currentComment);
    };

    const handleSaveEdit = async (id: string) => {
        if (!editingId) return;
        try {
            await updateHighlight(id, { comment: editText });
            setEditingId(null);
            setEditText("");
        } catch (err) {
            console.error("Failed to update comment:", err);
        }
    };

    const [lightboxImage, setLightboxImage] = useState<string | null>(null);

    const handleUpdateTag = async (id: string, tag: string) => {
        try {
            await updateHighlight(id, { tag });
        } catch (err) {
            console.error("Failed to update tag:", err);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
        if (e.key === 'Enter') {
            handleSaveEdit(id);
        } else if (e.key === 'Escape') {
            setEditingId(null);
            setEditText("");
        }
    };

    useEffect(() => {
        if (!videoId || !user) return;
        const unsubscribe = subscribeHighlights(videoId, user.uid, (data) => {
            console.log("Highlights data:", data); // Debug
            const sorted = data.sort((a, b) => a.startSec - b.startSec);
            const mapped = sorted.map(h => ({
                id: h.id!,
                text: h.text,
                timestamp: h.startSec,
                createdAt: h.createdAt?.seconds * 1000 || Date.now(),
                comment: h.comment,
                tag: h.tag,
                type: h.type,        // Map type
                imageUrl: h.imageUrl // Map imageUrl
            }));
            setHighlights(mapped);
        });
        return () => unsubscribe();
    }, [videoId, user]);

    // Listen for highlight sync events (from markers or transcript)
    useEffect(() => {
        const handleSync = (e: Event) => {
            const customEvent = e as CustomEvent<{ highlightId: string }>;
            const { highlightId } = customEvent.detail;

            if (highlightId) {
                const element = document.getElementById(`highlight - card - ${highlightId} `);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Optional: Add temporary flash class
                    element.classList.add('ring-2', 'ring-yellow-400', 'bg-yellow-50');
                    setTimeout(() => {
                        element.classList.remove('ring-2', 'ring-yellow-400', 'bg-yellow-50');
                    }, 2000);
                }
            }
        };

        window.addEventListener('highlight-to-transcript', handleSync);
        return () => window.removeEventListener('highlight-to-transcript', handleSync);
    }, []);

    const handleDelete = async (id: string) => {
        try {
            await deleteHighlight(id);
        } catch (err) {
            console.error("Failed to delete:", err);
        }
    };

    const groupedHighlights = useMemo(() => {
        const groups: Record<string, Highlight[]> = {};
        highlights.forEach(h => {
            // Filter Logic
            if (filterTag) {
                if (filterTag === 'Snapshot') {
                    if (h.type !== 'Snapshot') return;
                } else if (h.tag !== filterTag) {
                    return;
                }
            }

            const minute = Math.floor(h.timestamp / 60);
            const key = `${minute.toString().padStart(2, '0')}:00`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(h);
        });
        return groups;
    }, [highlights, filterTag]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')} `;
    };

    const isLoopingThis = (h: Highlight) => {
        if (!currentLoop) return false;
        return Math.abs(currentLoop.start - (h.timestamp - 2)) < 0.5;
    };

    const normalizeClipboardImage = useCallback(async (inputBlob: Blob): Promise<Blob> => {
        const maxWidth = 1920;
        const quality = 0.82;
        let width = 0;
        let height = 0;
        let draw: ((ctx: CanvasRenderingContext2D, targetWidth: number, targetHeight: number) => void) | null = null;

        if (typeof createImageBitmap === "function") {
            const bitmap = await createImageBitmap(inputBlob);
            width = bitmap.width;
            height = bitmap.height;
            draw = (ctx, targetWidth, targetHeight) => {
                ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
                bitmap.close();
            };
        } else {
            const imageUrl = URL.createObjectURL(inputBlob);
            const image = await new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = imageUrl;
            });
            width = image.width;
            height = image.height;
            draw = (ctx, targetWidth, targetHeight) => {
                ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
                URL.revokeObjectURL(imageUrl);
            };
        }

        if (!draw || width <= 0 || height <= 0) {
            throw new Error("Failed to decode clipboard image.");
        }

        const scale = width > maxWidth ? maxWidth / width : 1;
        const targetWidth = Math.max(1, Math.round(width * scale));
        const targetHeight = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("Canvas 2D context not available.");
        }
        draw(context, targetWidth, targetHeight);

        const jpegBlob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error("Failed to convert image to JPEG."));
                    return;
                }
                resolve(blob);
            }, "image/jpeg", quality);
        });

        return jpegBlob;
    }, []);

    const handleSnapshotCardSelect = useCallback((highlightId: string) => {
        setSelectedSnapshotId(highlightId);
        setSnapshotUploadError(null);
        const card = snapshotCardRefs.current[highlightId];
        card?.focus();
    }, []);

    const handleSnapshotPaste = useCallback(async (event: React.ClipboardEvent<HTMLDivElement>, highlightId: string) => {
        const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith("image/"));
        if (!imageItem) return;

        event.preventDefault();
        event.stopPropagation();

        if (!user || !videoId || !storage) {
            const message = "Not signed in or Firebase Storage is unavailable.";
            setSnapshotUploadError(message);
            console.error("[SnapshotPaste] " + message);
            return;
        }

        const rawImageFile = imageItem.getAsFile();
        if (!rawImageFile) {
            const message = "Clipboard image item could not be read.";
            setSnapshotUploadError(message);
            console.error("[SnapshotPaste] " + message);
            return;
        }

        setSelectedSnapshotId(highlightId);
        setSnapshotUploadError(null);
        setUploadingSnapshotId(highlightId);
        setUploadProgressById((prev) => ({ ...prev, [highlightId]: 0 }));

        try {
            const normalizedJpeg = await normalizeClipboardImage(rawImageFile);
            const filename = `${Date.now()}-${highlightId}.jpg`;
            const snapshotPath = `snapshots/${user.uid}/${videoId}/${filename}`;
            const snapshotRef = ref(storage, snapshotPath);

            const downloadUrl = await new Promise<string>((resolve, reject) => {
                const metadata = { contentType: "image/jpeg" };
                const task = uploadBytesResumable(snapshotRef, normalizedJpeg, metadata);
                const timeout = window.setTimeout(() => {
                    task.cancel();
                    reject(new Error("Upload timeout (>45s)."));
                }, 45000);

                task.on(
                    "state_changed",
                    (snapshot) => {
                        if (snapshot.totalBytes > 0) {
                            const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                            setUploadProgressById((prev) => ({ ...prev, [highlightId]: progress }));
                        }
                    },
                    (error) => {
                        window.clearTimeout(timeout);
                        reject(error);
                    },
                    async () => {
                        window.clearTimeout(timeout);
                        const url = await getDownloadURL(snapshotRef);
                        resolve(url);
                    }
                );
            });

            await updateHighlight(highlightId, { imageUrl: downloadUrl });
            setUploadProgressById((prev) => ({ ...prev, [highlightId]: 100 }));
        } catch (error) {
            const message = error instanceof Error ? error.message : "Snapshot upload failed.";
            setSnapshotUploadError(message);
            console.error("[SnapshotPaste] Upload failed:", error);
        } finally {
            setUploadingSnapshotId((current) => (current === highlightId ? null : current));
        }
    }, [normalizeClipboardImage, user, videoId]);

    return (
        <div className="flex flex-col h-full bg-slate-50/50 relative">
            {/* Lightbox Overlay */}
            {lightboxImage && createPortal(
                <div
                    className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4 animate-fade-in"
                    onClick={() => setLightboxImage(null)}
                >
                    <div className="relative max-w-7xl max-h-[90vh] w-full h-full flex items-center justify-center">
                        <img
                            src={lightboxImage}
                            alt="Full Snapshot"
                            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        />
                        <button
                            className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors"
                            onClick={() => setLightboxImage(null)}
                        >
                            <span className="sr-only">Close</span>
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                </div>,
                document.body
            )}

            <div className="p-4 border-b border-slate-200/60 flex items-center justify-between bg-white/50 backdrop-blur-sm sticky top-0 z-20">
                <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <Highlighter className="w-4 h-4 text-brand-500" />
                    Highlights <span className="bg-slate-100 text-slate-500 py-0.5 px-2 rounded-full text-xs font-medium">{highlights.length}</span>
                </h3>
                {/* Filter Dropdown */}
                <div className="flex items-center gap-2">
                    <Filter className="w-3.5 h-3.5 text-slate-400" />
                    <TagDropdown
                        userId={user?.uid || ''}
                        selectedTagName={filterTag}
                        onTagChange={setFilterTag}
                        align="right"
                        extraOptions={[{ id: 'Snapshot', name: 'Snapshot Only', color: '#06b6d4' }]}
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4">
                {Object.keys(groupedHighlights).sort().map(groupKey => (
                    <div key={groupKey}>
                        {/* Group Header */}
                        <div className="sticky top-0 bg-white/90 backdrop-blur-sm px-2 py-1.5 mb-2 z-10 border-b border-slate-100 flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-gradient-to-r from-violet-500 to-purple-500"></div>
                            <span className="text-xs font-mono text-slate-500">{groupKey} - {groupKey.replace('00', '59')}</span>
                        </div>

                        {/* Items */}
                        <div className="space-y-2">
                            {groupedHighlights[groupKey].map(h => {
                                const activeLoop = isLoopingThis(h);

                                if (h.type === 'Snapshot') {
                                    const isSelected = selectedSnapshotId === h.id;
                                    const uploadProgress = uploadProgressById[h.id] ?? 0;
                                    const isUploading = uploadingSnapshotId === h.id;
                                    return (
                                        <div
                                            key={h.id}
                                            id={`highlight - card - ${h.id} `}
                                            ref={(node) => { snapshotCardRefs.current[h.id] = node; }}
                                            tabIndex={0}
                                            onClick={() => handleSnapshotCardSelect(h.id)}
                                            onPaste={(event) => { void handleSnapshotPaste(event, h.id); }}
                                            className={cn(
                                                "group relative rounded-xl border bg-white shadow-sm overflow-hidden hover:shadow-md hover:border-cyan-300 transition-all cursor-default outline-none",
                                                isSelected ? "border-cyan-400 ring-2 ring-cyan-200" : "border-slate-200"
                                            )}
                                        >
                                            {/* Image Area - Click to Enlarge */}
                                            <div
                                                className="aspect-video relative bg-slate-100 cursor-zoom-in group/image"
                                                onClick={() => h.imageUrl && setLightboxImage(
                                                    h.imageUrl.includes('img.youtube.com')
                                                        ? h.imageUrl.replace('hqdefault', 'maxresdefault')
                                                        : h.imageUrl
                                                )}
                                            >
                                                {h.imageUrl ? (
                                                    <img src={h.imageUrl} alt="Snapshot" className={cn("w-full h-full object-cover transition-transform duration-500 group-hover/image:scale-105", isUploading && "opacity-50")} loading="lazy" />
                                                ) : (
                                                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-1">
                                                        <span className="text-xs">No Image</span>
                                                        <span className="text-[10px] text-slate-300">Click & Paste (Cmd+V)</span>
                                                    </div>
                                                )}

                                                {/* Paste / Uploading Overlay */}
                                                {isUploading && (
                                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-xs font-medium z-20">
                                                        Uploading...
                                                    </div>
                                                )}

                                                {/* Hover Paste Hint */}
                                                {!isUploading && (
                                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/image:opacity-100 flex items-center justify-center text-white text-xs font-medium transition-opacity pointer-events-none z-10">
                                                        Click & Paste to Replace
                                                    </div>
                                                )}

                                                {/* Loading spinner when image is still placeholder */}
                                                {h.imageUrl?.includes('img.youtube.com') && !isUploading && (
                                                    <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm text-white/90 text-[10px] font-medium px-2 py-1 rounded-full z-10">
                                                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                        Capturing...
                                                    </div>
                                                )}

                                                {/* Manual upload progress */}
                                                {isUploading && (
                                                    <div className="absolute top-2 left-2 right-2 bg-black/70 backdrop-blur-sm rounded-lg p-2 z-20">
                                                        <div className="flex items-center justify-between text-[10px] text-white mb-1">
                                                            <span>Uploading...</span>
                                                            <span>{uploadProgress}%</span>
                                                        </div>
                                                        <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full bg-cyan-400 transition-all duration-200"
                                                                style={{ width: `${uploadProgress}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Overlay Gradient */}
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-60" />

                                                {/* Timestamp Badge (Click to Seek) */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onSeek(h.timestamp);
                                                    }}
                                                    className="absolute bottom-2 right-2 bg-black/70 hover:bg-black/90 backdrop-blur-sm text-white text-[10px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer z-10"
                                                >
                                                    <PlayCircle className="w-3 h-3" />
                                                    {formatTime(h.timestamp)}
                                                </button>

                                                {/* Tag Badge (Top Right) */}
                                                <div className="absolute top-2 left-2 z-10">
                                                    <div onClick={e => e.stopPropagation()}>
                                                        <TagDropdown
                                                            userId={user?.uid || ''}
                                                            selectedTagName={h.tag}
                                                            onTagChange={(newTag) => handleUpdateTag(h.id, newTag)}
                                                            align="left"
                                                            trigger={
                                                                <button className={cn(
                                                                    "px-2 py-1 rounded-md text-[10px] font-medium backdrop-blur-md shadow-sm transition-all flex items-center gap-1",
                                                                    h.tag
                                                                        ? "bg-white/90 text-slate-700"
                                                                        : "bg-black/30 text-white/70 hover:bg-black/50"
                                                                )}>
                                                                    <span className={cn("w-1.5 h-1.5 rounded-full", h.tag ? "bg-cyan-500" : "bg-white/50")} />
                                                                    {h.tag || "Add Tag"}
                                                                </button>
                                                            }
                                                        />
                                                    </div>
                                                </div>

                                                {/* Delete Button */}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDelete(h.id); }}
                                                    className="absolute top-2 right-2 p-1.5 bg-black/50 text-white/80 rounded-lg hover:bg-red-500 hover:text-white transition-all opacity-0 group-hover:opacity-100 backdrop-blur-sm z-10"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>

                                            {/* Comment Section (Editable) */}
                                            <div className="px-3 py-2 border-t border-slate-100 bg-slate-50/50">
                                                <div className="text-[10px] text-slate-400 mb-1">
                                                    Click card then press <span className="font-mono">Cmd/Ctrl + V</span> to paste screenshot.
                                                </div>

                                                {isSelected && snapshotUploadError && (
                                                    <div className="text-[10px] text-red-500 mb-1">
                                                        Upload failed: {snapshotUploadError}
                                                    </div>
                                                )}

                                                {editingId === h.id ? (
                                                    <input
                                                        type="text"
                                                        value={editText}
                                                        onChange={(e) => setEditText(e.target.value)}
                                                        onBlur={() => handleSaveEdit(h.id)}
                                                        onKeyDown={(e) => handleKeyDown(e, h.id)}
                                                        className="w-full text-xs text-slate-700 bg-white border border-cyan-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                                                        autoFocus
                                                        placeholder="Add a caption..."
                                                    />
                                                ) : (
                                                    <div
                                                        onClick={() => handleStartEdit(h.id, h.comment)}
                                                        className={cn(
                                                            "text-xs cursor-text transition-colors truncate",
                                                            h.comment
                                                                ? "text-slate-600 font-medium"
                                                                : "text-slate-400 italic hover:text-slate-500"
                                                        )}
                                                    >
                                                        {h.comment || "Click to add caption..."}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                }

                                return (
                                    <div
                                        key={h.id}
                                        id={`highlight - card - ${h.id} `}
                                        onClick={(e) => {
                                            // Dispatch event to highlight transcript
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            window.dispatchEvent(new CustomEvent('highlight-to-transcript', {
                                                detail: {
                                                    timestamp: h.timestamp,
                                                    sourceRect: rect,
                                                    highlightId: h.id
                                                }
                                            }));
                                        }}
                                        className={cn(
                                            "group relative p-3 rounded-xl border bg-white shadow-sm transition-all hover:shadow-md cursor-pointer",
                                            activeLoop ? "border-violet-300 bg-violet-50" : "border-slate-200 hover:border-slate-300"
                                        )}
                                    >
                                        {/* Header Row */}
                                        <div className="flex items-center justify-between mb-2">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onSeek(h.timestamp);
                                                    // Also scroll transcript to this time
                                                    window.dispatchEvent(new CustomEvent('highlight-to-transcript', {
                                                        detail: {
                                                            timestamp: h.timestamp,
                                                            sourceRect: e.currentTarget.getBoundingClientRect(),
                                                            highlightId: h.id
                                                        }
                                                    }));
                                                }}
                                                className="flex items-center gap-1.5 text-violet-600 hover:text-violet-700 transition-colors bg-violet-100 px-2 py-1 rounded-lg text-xs font-mono font-medium"
                                            >
                                                <PlayCircle className="w-3 h-3" />
                                                {formatTime(h.timestamp)}
                                            </button>

                                            <div className="flex items-center gap-1 opacity-100 xl:opacity-0 group-hover:opacity-100 transition-opacity">
                                                <div onClick={e => e.stopPropagation()}>
                                                    <TagDropdown
                                                        userId={user?.uid || ''}
                                                        selectedTagName={h.tag}
                                                        onTagChange={(newTag) => handleUpdateTag(h.id, newTag)}
                                                        align="right"
                                                    />
                                                </div>

                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (activeLoop) onStopLoop();
                                                        else onLoop(h.timestamp - 2, h.timestamp + 3);
                                                    }}
                                                    className={cn(
                                                        "text-[10px] px-2 py-1 rounded-lg border transition-colors flex items-center gap-1 font-medium",
                                                        activeLoop ? "bg-red-100 text-red-600 border-red-200" : "bg-slate-100 text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700"
                                                    )}
                                                >
                                                    {activeLoop ? <PauseCircle className="w-3 h-3" /> : <Repeat className="w-3 h-3" />}
                                                    {activeLoop ? "Stop" : "5s"}
                                                </button>

                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onLoop(h.timestamp - 2, h.timestamp + 8);
                                                    }}
                                                    className="text-[10px] px-2 py-1 rounded-lg border bg-slate-100 text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700 font-medium"
                                                >
                                                    10s
                                                </button>

                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDelete(h.id); }}
                                                    className="p-1 text-slate-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                                    title="Delete Highlight"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Text Content */}
                                        <div className="pl-1 border-l-2 border-slate-100 mb-2">
                                            <p className="text-sm text-slate-700 leading-relaxed px-2 line-clamp-3 hover:line-clamp-none transition-all">
                                                {h.text}
                                            </p>
                                        </div>

                                        {/* Comment Display / Edit Mode */}
                                        {editingId === h.id ? (
                                            <div className="mt-2">
                                                <input
                                                    type="text"
                                                    value={editText}
                                                    onChange={(e) => setEditText(e.target.value)}
                                                    onBlur={() => handleSaveEdit(h.id)}
                                                    onKeyDown={(e) => handleKeyDown(e, h.id)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="w-full text-xs text-slate-700 bg-white border border-violet-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                                                    autoFocus
                                                    placeholder="Add a note..."
                                                />
                                            </div>
                                        ) : (
                                            <div
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleStartEdit(h.id, h.comment);
                                                }}
                                                className={cn(
                                                    "text-xs mt-1 p-1.5 rounded border transition-colors cursor-text hover:bg-slate-100",
                                                    h.comment
                                                        ? "text-slate-500 italic bg-slate-50 border-slate-100"
                                                        : "text-slate-300 border-transparent hover:border-slate-200"
                                                )}
                                            >
                                                {h.comment || "Click to add note..."}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}

                {highlights.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3 text-center px-6">
                        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-1">
                            <Highlighter className="w-6 h-6 text-slate-300" />
                        </div>
                        <p className="text-sm font-medium text-slate-600">No highlights yet</p>
                        <p className="text-xs text-slate-400 max-w-[200px]">
                            Select any text in the transcript to instantly create a highlight.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
