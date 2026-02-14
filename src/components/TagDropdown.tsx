import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Trash2, Plus, Hash } from 'lucide-react';
import { Modal } from './Modal';
import {
    subscribeTags,
    addTag,
    deleteTag,
    type Tag
} from '../lib/db';

interface TagDropdownProps {
    userId: string;
    selectedTagId?: string; // ID of the tag
    onTagChange: (tagName: string) => void; // Passing name back since highlight stores tag name/string usually, or ID? User said "#Question", implying string. 
    // Plan said "tag?: string". Let's stick to storing the Tag Name/String on the highlight for simplicity in display, 
    // BUT maintaining IDs for the tags themselves is good. 
    // Wait, if I delete a tag, should it disappear from highlights?
    // User request: "製作方法和剛剛你製作影片分類的方式一樣". Categories are stored as ID in `videos`.
    // However, for highlights, storing ID is cleaner but requires looking up the tag name.
    // Storing the name (e.g. "#Question") is easier for rendering but harder for renaming. 
    // Since user explicitly asked for "#问题" etc, maybe just store the name?
    // Actually, "製作方法...一樣" implies relational.
    // Let's store TAG ID on the highlight. 
    // Wait, if I filter by "#Question", I need to know which ID corresponds to it.
    // Let's stick to storing TAG NAME for now as it's easier to verify "tag #Question" requirement.
    // If I store ID, I need to fetch all tags to render a highlight. That might be slow for a list of 100 highlights.
    // Storing the literal tag string on the highlight is robust for read-heavy.
    // BUT the dropdown manages "Tags" which have IDs. 
    // Let's pass back the *Name* to `onTagChange`.
    // And `selectedTagId`? Maybe `selectedTagName` is better?
    // Let's use `selectedTagName`.
    selectedTagName?: string;
    align?: 'left' | 'right';
    trigger?: React.ReactNode;
    extraOptions?: { id: string; name: string; color?: string }[];
}

export function TagDropdown({
    userId,
    selectedTagName,
    onTagChange,
    align = 'left',
    trigger,
    extraOptions = []
}: TagDropdownProps) {
    // ─── State ────────────────────────────────────────────
    const [tags, setTags] = useState<Tag[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    // Create Modal
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newTagName, setNewTagName] = useState('');
    const [createError, setCreateError] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const createInputRef = useRef<HTMLInputElement>(null);

    // Delete Modal
    const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // Click outside ref
    const containerRef = useRef<HTMLDivElement>(null);

    // ─── Subscribe to tags ────────────────────────────────
    useEffect(() => {
        if (!userId) return;
        const unsub = subscribeTags(userId, (fetchedTags) => {
            setTags(fetchedTags);
            // Optional: Seed default tags if empty?
            // For now, let's just let user create them.
        });
        return () => unsub();
    }, [userId]);

    // ─── Click outside ────────────────────────────────────
    useEffect(() => {
        if (!isOpen) return;
        const handleClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [isOpen]);

    // ─── Focus input ──────────────────────────────────────
    useEffect(() => {
        if (isCreateOpen) {
            setTimeout(() => createInputRef.current?.focus(), 100);
        }
    }, [isCreateOpen]);

    // ─── Handlers ─────────────────────────────────────────
    const handleSelect = (tagName: string) => {
        onTagChange(tagName);
        setIsOpen(false);
    };

    const handleCreate = async () => {
        const trimmed = newTagName.trim();
        if (!trimmed) {
            setCreateError('標籤名稱不可為空');
            return;
        }
        // Add # if missing? User said "選項有: #問題". So maybe they type "問題" and we add #?
        // Or they type "#問題".
        // Let's just use what they type.

        if (tags.some(t => t.name.toLowerCase() === trimmed.toLowerCase())) {
            setCreateError(`「${trimmed}」已存在`);
            return;
        }
        setIsCreating(true);
        setCreateError('');
        try {
            const newTag = await addTag(userId, trimmed);
            onTagChange(newTag.name);
            setIsCreateOpen(false);
            setIsOpen(false);
            setNewTagName('');
        } catch (err: any) {
            setCreateError(err.message || '新增失敗');
        } finally {
            setIsCreating(false);
        }
    };

    const handleDeleteConfirm = async () => {
        if (!deleteTarget) return;
        setIsDeleting(true);
        try {
            const wasSelected = selectedTagName === deleteTarget.name;
            await deleteTag(deleteTarget.id);
            if (wasSelected) {
                onTagChange('');
            }
            setDeleteTarget(null);
        } catch (err) {
            console.error('Failed to delete tag:', err);
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div ref={containerRef} className="relative inline-block text-left">
            {trigger ? (
                <div onClick={() => setIsOpen(!isOpen)}>{trigger}</div>
            ) : (
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex items-center gap-1.5 px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
                    title="Add Tag"
                >
                    <Hash className="w-3 h-3 text-slate-400" />
                    <span className={selectedTagName ? "text-violet-600 font-medium" : "text-slate-400"}>
                        {selectedTagName || "Tag"}
                    </span>
                    <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
            )}

            {/* Dropdown */}
            {isOpen && (
                <div className={`absolute top-full mt-1 ${align === 'right' ? 'right-0' : 'left-0'} w-48 bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden text-sm animate-in fade-in zoom-in-95 duration-200`}>
                    <div className="max-h-48 overflow-y-auto">
                        {/* Clear Option */}
                        <div
                            onClick={() => handleSelect('')}
                            className="px-3 py-2 cursor-pointer hover:bg-slate-50 text-slate-500 italic text-xs border-b border-slate-50"
                        >
                            None
                        </div>

                        {/* Extra Options (e.g. Snapshot Filter) */}
                        {extraOptions.map(opt => (
                            <div
                                key={opt.id}
                                onClick={() => handleSelect(opt.id)}
                                className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${selectedTagName === opt.id
                                    ? 'bg-cyan-50 text-cyan-700'
                                    : 'text-slate-700 hover:bg-slate-50'
                                    }`}
                            >
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: opt.color || '#cbd5e1' }}></div>
                                {opt.name}
                            </div>
                        ))}

                        {tags.map(tag => (
                            <div
                                key={tag.id}
                                onMouseEnter={() => setHoveredId(tag.id)}
                                onMouseLeave={() => setHoveredId(null)}
                                className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors ${tag.name === selectedTagName
                                    ? 'bg-violet-50 text-violet-700'
                                    : 'text-slate-700 hover:bg-slate-50'
                                    }`}
                            >
                                <button
                                    onClick={() => handleSelect(tag.name)}
                                    className="flex-1 text-left truncate flex items-center gap-1.5"
                                >
                                    <Hash className="w-3 h-3 opacity-50" />
                                    {tag.name}
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setDeleteTarget(tag);
                                    }}
                                    className={`ml-1 p-1 rounded hover:bg-red-50 hover:text-red-500 transition-all ${hoveredId === tag.id ? 'opacity-100' : 'opacity-0'
                                        }`}
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="border-t border-slate-100 p-1">
                        <button
                            onClick={() => {
                                setIsCreateOpen(true);
                                setNewTagName('');
                                setCreateError('');
                            }}
                            className="w-full flex items-center gap-2 px-2 py-2 text-violet-600 hover:bg-violet-50 rounded transition-colors font-medium text-xs"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Create new tag
                        </button>
                    </div>
                </div>
            )}

            {/* ─── Create Modal ──────────────────────────── */}
            <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)}>
                <div className="p-5 w-80">
                    <h3 className="text-base font-semibold text-slate-800 mb-3">Create Tag</h3>
                    <input
                        ref={createInputRef}
                        type="text"
                        value={newTagName}
                        onChange={(e) => {
                            setNewTagName(e.target.value);
                            setCreateError('');
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCreate();
                            if (e.key === 'Escape') setIsCreateOpen(false);
                        }}
                        placeholder="e.g. #Important"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    />
                    {createError && (
                        <p className="text-red-500 text-xs mt-2">{createError}</p>
                    )}
                    <div className="flex justify-end gap-2 mt-4">
                        <button
                            onClick={() => setIsCreateOpen(false)}
                            className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleCreate}
                            disabled={isCreating}
                            className="px-3 py-1.5 text-xs bg-violet-600 text-white rounded-md hover:bg-violet-700 transition-colors disabled:opacity-50"
                        >
                            {isCreating ? 'Creating...' : 'Create'}
                        </button>
                    </div>
                </div>
            </Modal>

            {/* ─── Delete Modal ─────────────────────────── */}
            <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
                <div className="p-5 w-80">
                    <h3 className="text-base font-semibold text-slate-800 mb-2">Delete Tag</h3>
                    <p className="text-sm text-slate-600 mb-4">
                        Delete "{deleteTarget?.name}"?
                    </p>
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={() => setDeleteTarget(null)}
                            className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleDeleteConfirm}
                            disabled={isDeleting}
                            className="px-3 py-1.5 text-xs bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors disabled:opacity-50"
                        >
                            {isDeleting ? 'Deleting...' : 'Delete'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
