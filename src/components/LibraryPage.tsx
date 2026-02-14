import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { subscribeUserVideos, subscribeCategories, deleteVideo, type VideoRecord, type Category } from '../lib/db';
import { BookOpen, Play, Tag, Filter, Search, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface LibraryPageProps {
    onOpenVideo: (videoUrl: string) => void;
}

export function LibraryPage({ onOpenVideo }: LibraryPageProps) {
    const { user } = useAuth();
    const [videos, setVideos] = useState<VideoRecord[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedFilterIds, setSelectedFilterIds] = useState<string[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        if (!user) return;
        const unsub = subscribeUserVideos(user.uid, setVideos);
        return () => unsub();
    }, [user]);

    useEffect(() => {
        if (!user) return;
        const unsub = subscribeCategories(user.uid, setCategories);
        return () => unsub();
    }, [user]);

    const categoryMap = useMemo(() => {
        const map: Record<string, string> = {};
        categories.forEach(c => { map[c.id] = c.name; });
        return map;
    }, [categories]);

    const filteredVideos = useMemo(() => {
        let result = videos;
        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase();
            result = result.filter(v =>
                (v.title || '').toLowerCase().includes(term) ||
                v.videoId.toLowerCase().includes(term)
            );
        }
        if (selectedFilterIds.length > 0) {
            result = result.filter(v =>
                v.categoryIds.some(cid => selectedFilterIds.includes(cid))
            );
        }
        return result;
    }, [videos, searchTerm, selectedFilterIds]);

    const toggleFilter = (catId: string) => {
        setSelectedFilterIds(prev =>
            prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
        );
    };

    const handleDelete = useCallback(async (videoId: string) => {
        if (!user) return;
        setDeletingId(videoId);
        try {
            await deleteVideo(videoId, user.uid);
        } catch (e) {
            console.error('Failed to delete video:', e);
        } finally {
            setDeletingId(null);
        }
    }, [user]);

    return (
        <div className="flex-1 overflow-hidden flex flex-col bg-gradient-to-br from-slate-50 via-white to-violet-50/30">
            {/* Header */}
            <div className="px-8 pt-8 pb-4 flex-shrink-0">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-200">
                        <BookOpen className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">影片庫</h1>
                        <p className="text-sm text-slate-400">{videos.length} 部影片</p>
                    </div>
                </div>

                {/* Search */}
                <div className="relative mb-4">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="搜尋影片標題..."
                        className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-transparent shadow-sm transition-all placeholder:text-slate-400"
                    />
                </div>

                {/* Category Filter Pills */}
                {categories.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                        <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <button
                            onClick={() => setSelectedFilterIds([])}
                            className={cn(
                                "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                                selectedFilterIds.length === 0
                                    ? "bg-violet-600 text-white shadow-sm"
                                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                            )}
                        >
                            全部
                        </button>
                        {categories.map(cat => (
                            <button
                                key={cat.id}
                                onClick={() => toggleFilter(cat.id)}
                                className={cn(
                                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                                    selectedFilterIds.includes(cat.id)
                                        ? "bg-violet-600 text-white shadow-sm"
                                        : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                                )}
                            >
                                {cat.name}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Video Grid */}
            <div className="flex-1 overflow-y-auto px-8 pb-8">
                {filteredVideos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                        <BookOpen className="w-12 h-12 mb-4 opacity-30" />
                        <p className="text-lg font-medium mb-1">
                            {videos.length === 0 ? '尚無影片' : '無符合條件的影片'}
                        </p>
                        <p className="text-sm">
                            {videos.length === 0
                                ? '在 Studio 中輸入 YouTube 連結即可開始'
                                : '試試調整搜尋或篩選條件'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {filteredVideos.map(video => (
                            <VideoCard
                                key={video.videoId}
                                video={video}
                                categoryMap={categoryMap}
                                isDeleting={deletingId === video.videoId}
                                onOpen={() => onOpenVideo(video.videoUrl || `https://www.youtube.com/watch?v=${video.videoId}`)}
                                onDelete={() => handleDelete(video.videoId)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Video Card ──────────────────────────────────────────────────────

function VideoCard({
    video,
    categoryMap,
    isDeleting,
    onOpen,
    onDelete
}: {
    video: VideoRecord;
    categoryMap: Record<string, string>;
    isDeleting: boolean;
    onOpen: () => void;
    onDelete: () => void;
}) {
    const [showConfirm, setShowConfirm] = useState(false);
    const thumbnail = `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`;
    const displayTitle = video.title || video.videoId;

    return (
        <div
            className={cn(
                "group relative flex flex-col bg-white border border-slate-200/80 rounded-xl overflow-hidden hover:border-violet-300 hover:shadow-lg hover:shadow-violet-100/50 transition-all duration-200",
                isDeleting && "opacity-50 pointer-events-none"
            )}
        >
            {/* Thumbnail */}
            <div
                className="relative w-full aspect-video bg-slate-100 cursor-pointer"
                onClick={onOpen}
            >
                <img
                    src={thumbnail}
                    alt={displayTitle}
                    className="w-full h-full object-cover"
                    loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                    <Play className="w-10 h-10 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" fill="white" />
                </div>
            </div>

            {/* Delete button — top-right, visible on hover */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    setShowConfirm(true);
                }}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/40 text-white/80 hover:bg-red-500 hover:text-white opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm"
                title="刪除影片"
            >
                <Trash2 className="w-4 h-4" />
            </button>

            {/* Delete Confirmation Overlay */}
            {showConfirm && (
                <div className="absolute inset-0 z-10 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center gap-3 p-4">
                    <Trash2 className="w-8 h-8 text-red-500" />
                    <p className="text-sm font-medium text-slate-700 text-center">確定要刪除這部影片嗎？</p>
                    <p className="text-xs text-slate-400 text-center">所有相關的 Highlights 也會一併刪除</p>
                    <div className="flex gap-2 mt-1">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowConfirm(false);
                            }}
                            className="px-4 py-1.5 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                        >
                            取消
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowConfirm(false);
                                onDelete();
                            }}
                            className="px-4 py-1.5 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
                        >
                            刪除
                        </button>
                    </div>
                </div>
            )}

            {/* Info */}
            <div className="p-3 flex-1 flex flex-col cursor-pointer" onClick={onOpen}>
                <h3 className="text-sm font-semibold text-slate-800 line-clamp-2 group-hover:text-violet-700 transition-colors">
                    {displayTitle}
                </h3>

                {video.categoryIds.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                        {video.categoryIds.map(cid => (
                            <span
                                key={cid}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-600 border border-violet-100"
                            >
                                <Tag className="w-3 h-3" />
                                {categoryMap[cid] || cid}
                            </span>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-slate-400 mt-2 italic">未分類</p>
                )}
            </div>
        </div>
    );
}
