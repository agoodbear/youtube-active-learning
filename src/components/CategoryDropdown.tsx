import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, Trash2, Plus, Check } from 'lucide-react';
import { Modal } from './Modal';
import {
    subscribeCategories,
    addCategory,
    deleteCategory,
    saveVideoCategories,
    type Category
} from '../lib/db';

interface CategoryDropdownProps {
    userId: string;
    videoId: string;
    selectedCategoryIds: string[];
    onCategoryChange: (categoryIds: string[]) => void;
}

/**
 * 影片分類 Dropdown 元件（多選）
 *
 * 功能：
 * - 下拉多選分類（checkbox toggle）
 * - 新增類別（Modal + 驗證）
 * - 刪除類別（二次確認 Modal）
 * - 點擊外部自動關閉
 */
export function CategoryDropdown({
    userId,
    videoId,
    selectedCategoryIds,
    onCategoryChange
}: CategoryDropdownProps) {
    // ─── State ────────────────────────────────────────────
    const [categories, setCategories] = useState<Category[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    // Create Modal
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [createError, setCreateError] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const createInputRef = useRef<HTMLInputElement>(null);

    // Delete Modal
    const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // Click outside ref
    const containerRef = useRef<HTMLDivElement>(null);

    // ─── Subscribe to categories (real-time) ──────────────
    useEffect(() => {
        if (!userId) return;
        const unsub = subscribeCategories(userId, setCategories);
        return () => unsub();
    }, [userId]);

    // ─── Click outside to close dropdown ──────────────────
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

    // ─── Focus create input when modal opens ─────────────
    useEffect(() => {
        if (isCreateOpen) {
            setTimeout(() => createInputRef.current?.focus(), 100);
        }
    }, [isCreateOpen]);

    // ─── Derived ──────────────────────────────────────────
    const selectedCategories = categories.filter(c => selectedCategoryIds.includes(c.id));

    const displayText = () => {
        if (selectedCategories.length === 0) return null;
        if (selectedCategories.length <= 2) return selectedCategories.map(c => c.name).join(', ');
        return `${selectedCategories.length} 個分類`;
    };

    // ─── Handlers ─────────────────────────────────────────
    const handleToggle = useCallback((cat: Category) => {
        const isSelected = selectedCategoryIds.includes(cat.id);
        const next = isSelected
            ? selectedCategoryIds.filter(id => id !== cat.id)
            : [...selectedCategoryIds, cat.id];
        onCategoryChange(next);
        saveVideoCategories(videoId, userId, next).catch(console.error);
    }, [videoId, userId, selectedCategoryIds, onCategoryChange]);

    const handleCreate = async () => {
        const trimmed = newCategoryName.trim();
        if (!trimmed) {
            setCreateError('名稱不可為空');
            return;
        }
        if (categories.some(c => c.name.toLowerCase() === trimmed.toLowerCase())) {
            setCreateError(`「${trimmed}」已存在`);
            return;
        }
        setIsCreating(true);
        setCreateError('');
        try {
            const newCat = await addCategory(userId, trimmed);
            // Auto-add the new category to selection
            const next = [...selectedCategoryIds, newCat.id];
            onCategoryChange(next);
            await saveVideoCategories(videoId, userId, next);
            setIsCreateOpen(false);
            setNewCategoryName('');
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
            const wasSelected = selectedCategoryIds.includes(deleteTarget.id);
            await deleteCategory(userId, deleteTarget);
            if (wasSelected) {
                onCategoryChange(selectedCategoryIds.filter(id => id !== deleteTarget.id));
            }
            setDeleteTarget(null);
        } catch (err) {
            console.error('Failed to delete category:', err);
        } finally {
            setIsDeleting(false);
        }
    };

    // ─── Render ───────────────────────────────────────────
    return (
        <div ref={containerRef} className="relative w-56">
            {/* Trigger Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm flex items-center justify-between hover:bg-slate-50 transition-colors shadow-sm group"
            >
                <span className={displayText() ? 'text-slate-700 truncate' : 'text-slate-400'}>
                    {displayText() || '選擇分類'}
                </span>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ml-2 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute top-full mt-2 left-0 w-full bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden text-sm animate-fadeIn">
                    {/* Category List */}
                    <div className="max-h-52 overflow-y-auto">
                        {categories.length === 0 && (
                            <div className="px-4 py-3 text-slate-400 italic text-xs text-center">
                                尚未建立分類
                            </div>
                        )}
                        {categories.map(cat => {
                            const isSelected = selectedCategoryIds.includes(cat.id);
                            return (
                                <div
                                    key={cat.id}
                                    onMouseEnter={() => setHoveredId(cat.id)}
                                    onMouseLeave={() => setHoveredId(null)}
                                    className={`flex items-center justify-between px-4 py-2.5 cursor-pointer transition-colors ${isSelected
                                        ? 'bg-violet-50 text-violet-700'
                                        : 'text-slate-700 hover:bg-slate-50'
                                        }`}
                                >
                                    {/* Checkbox + Category Name */}
                                    <button
                                        onClick={() => handleToggle(cat)}
                                        className="flex-1 flex items-center gap-2 text-left truncate"
                                    >
                                        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${isSelected
                                            ? 'bg-violet-600 border-violet-600'
                                            : 'border-slate-300 hover:border-violet-400'
                                            }`}>
                                            {isSelected && <Check className="w-3 h-3 text-white" />}
                                        </div>
                                        {cat.name}
                                    </button>
                                    {/* Delete icon — hover only */}
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setDeleteTarget(cat);
                                        }}
                                        className={`ml-2 p-1 rounded-md hover:bg-red-50 hover:text-red-500 transition-all ${hoveredId === cat.id ? 'opacity-100' : 'opacity-0'
                                            }`}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    {/* ＋ 新增類別 */}
                    <div className="border-t border-slate-100 p-1">
                        <button
                            onClick={() => {
                                setIsCreateOpen(true);
                                setNewCategoryName('');
                                setCreateError('');
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-violet-600 hover:bg-violet-50 rounded-lg transition-colors font-medium text-sm"
                        >
                            <Plus className="w-4 h-4" />
                            新增類別
                        </button>
                    </div>
                </div>
            )}

            {/* ─── 新增類別 Modal ──────────────────────────── */}
            <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)}>
                <div className="p-6">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4">新增類別</h3>
                    <input
                        ref={createInputRef}
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => {
                            setNewCategoryName(e.target.value);
                            setCreateError('');
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCreate();
                            if (e.key === 'Escape') setIsCreateOpen(false);
                        }}
                        placeholder="例如：ECG"
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-transparent placeholder:text-slate-400"
                    />
                    {createError && (
                        <p className="text-red-500 text-xs mt-2">{createError}</p>
                    )}
                    <div className="flex justify-end gap-2 mt-5">
                        <button
                            onClick={() => setIsCreateOpen(false)}
                            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleCreate}
                            disabled={isCreating}
                            className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 font-medium"
                        >
                            {isCreating ? '建立中...' : '確認'}
                        </button>
                    </div>
                </div>
            </Modal>

            {/* ─── 刪除確認 Modal ─────────────────────────── */}
            <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
                <div className="p-6">
                    <h3 className="text-lg font-semibold text-slate-800 mb-2">刪除類別</h3>
                    <p className="text-sm text-slate-600 mb-5">
                        你確定要刪除「<span className="font-semibold text-slate-800">{deleteTarget?.name}</span>」嗎？
                        <br />
                        <span className="text-xs text-slate-400">所有使用此分類的影片將會移除此分類。</span>
                    </p>
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={() => setDeleteTarget(null)}
                            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleDeleteConfirm}
                            disabled={isDeleting}
                            className="px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 font-medium"
                        >
                            {isDeleting ? '刪除中...' : '刪除'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
