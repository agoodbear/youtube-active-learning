import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
}

/**
 * 通用 Modal 元件
 * - 半透明 overlay
 * - ESC / 點外部關閉
 * - fade + scale 動畫
 * - Portal 到 document.body
 */
export function Modal({ isOpen, onClose, children }: ModalProps) {
    const overlayRef = useRef<HTMLDivElement>(null);

    // ESC 鍵關閉
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return createPortal(
        <div
            ref={overlayRef}
            onClick={(e) => {
                // 點擊 overlay 背景關閉
                if (e.target === overlayRef.current) onClose();
            }}
            className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fadeIn"
        >
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 animate-scaleIn">
                {children}
            </div>
        </div>,
        document.body
    );
}
