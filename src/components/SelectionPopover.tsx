import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { X, Check, Trash2 } from 'lucide-react';
import { TagDropdown } from './TagDropdown';

interface SelectionPopoverProps {
    position: { top: number; left: number } | null;
    onClose: () => void;
    onSave: (comment: string, tag?: string) => void;
    selectedText: string;
    initialComment?: string;
    initialTag?: string; // Tag Name
    userId: string;
    onDelete?: () => void;
}

export function SelectionPopover({ position, onClose, onSave, selectedText, initialComment = '', initialTag = '', userId, onDelete }: SelectionPopoverProps) {
    const [comment, setComment] = useState(initialComment);
    const [tag, setTag] = useState(initialTag);
    const popoverRef = useRef<HTMLDivElement>(null);
    const [adjustedPos, setAdjustedPos] = useState<{ top: number; left: number } | null>(null);

    // Reset comment when position changes (new selection)
    useEffect(() => {
        if (position) {
            setComment(initialComment || '');
            setTag(initialTag || '');
        }
    }, [position, initialComment, initialTag]);

    // Viewport boundary detection — measure popover and adjust if out of bounds
    useLayoutEffect(() => {
        if (!position || !popoverRef.current) {
            setAdjustedPos(null);
            return;
        }

        const el = popoverRef.current;
        const rect = el.getBoundingClientRect();
        const viewH = window.innerHeight;
        const viewW = window.innerWidth;
        const popoverW = Math.min(288, viewW - 16); // w-72 = 288px, but clamp to viewport

        let top = position.top;
        let left = position.left;

        if (top + rect.height > viewH - 8) {
            top = position.top - rect.height - 12;
        }

        // Clamp top to never go above viewport
        if (top < 8) top = 8;

        // Clamp left so popover doesn't overflow right edge
        if (left + popoverW > viewW - 8) {
            left = viewW - popoverW - 8;
        }
        // Clamp left to at least 8px from left edge
        if (left < 8) left = 8;

        setAdjustedPos({ top, left });
    }, [position]);

    // Handle click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        if (position) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [position, onClose]);

    if (!position) return null;

    const finalTop = adjustedPos?.top ?? position.top;
    const finalLeft = adjustedPos?.left ?? position.left;

    return (
        <div
            ref={popoverRef}
            style={{
                top: finalTop,
                left: finalLeft,
            }}
            className="fixed z-50 bg-white rounded-xl shadow-2xl shadow-slate-900/10 border border-slate-200/60 p-4 w-80 max-w-[calc(100vw-1rem)] animate-in fade-in zoom-in-95 duration-200 ring-1 ring-slate-900/5"
        >
            <div className="flex items-start justify-between mb-3">
                <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-brand-500"></div>
                    {onDelete ? 'Edit Highlight' : 'New Highlight'}
                </span>
                <button
                    onClick={onClose}
                    className="text-slate-400 hover:text-slate-600 transition-colors p-0.5 hover:bg-slate-100 rounded"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="bg-slate-50 rounded-lg p-2.5 mb-3 border border-slate-100">
                <p className="text-sm text-slate-700 italic line-clamp-3 leading-relaxed border-l-2 border-brand-300 pl-2">
                    "{selectedText}"
                </p>
            </div>

            <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a note (optional)..."
                className="w-full text-sm p-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 min-h-[80px] resize-none mb-3 placeholder:text-slate-400 text-slate-700 shadow-sm"
                autoFocus
            />

            <div className="flex items-center justify-between gap-2">
                <div className="flex-1">
                    <TagDropdown
                        userId={userId}
                        selectedTagName={tag}
                        onTagChange={setTag}
                    />
                </div>

                <div className="flex gap-2">
                    {onDelete && (
                        <button
                            onClick={onDelete}
                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors mr-auto"
                            title="Delete Highlight"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onSave(comment, tag)}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-all shadow-md shadow-slate-900/10 hover:shadow-xl hover:shadow-slate-900/20 active:scale-95"
                    >
                        <Check className="w-3.5 h-3.5" />
                        Save Highlight
                    </button>
                </div>
            </div>

            {/* Old delete button removed */}
        </div>
    );
}
