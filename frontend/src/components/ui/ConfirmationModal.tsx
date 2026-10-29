import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, AlertCircle, CheckCircle2, X } from 'lucide-react';

export interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  loading?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  onConfirm: (reason?: string) => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm Action',
  cancelLabel = 'Cancel',
  isDestructive = false,
  loading = false,
  requireReason = false,
  reasonLabel = 'Reason for this administrative action',
  reasonPlaceholder = 'Please specify detailed operational rationale...',
  onConfirm,
  onCancel,
}) => {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setReasonError('');
      // Auto-focus cancel button for safe keyboard navigation
      setTimeout(() => {
        cancelButtonRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Handle ESC key to dismiss
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onCancel]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (requireReason && !reason.trim()) {
      setReasonError('A valid operational reason is required before confirming.');
      return;
    }
    setReasonError('');
    onConfirm(reason.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirmation-modal-title"
      aria-describedby="confirmation-modal-desc"
    >
      <div
        ref={modalRef}
        className="glass-card max-w-md w-full p-6 md:p-7 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150 text-left"
      >
        {/* Header Icon + Title */}
        <div className="flex items-start gap-3.5 mb-4">
          <div
            className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
              isDestructive
                ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                : 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30'
            }`}
          >
            {isDestructive ? (
              <AlertTriangle className="w-5 h-5" aria-hidden="true" />
            ) : (
              <AlertCircle className="w-5 h-5" aria-hidden="true" />
            )}
          </div>

          <div className="flex-1">
            <h2
              id="confirmation-modal-title"
              className="text-lg font-bold text-slate-900 dark:text-white leading-tight"
            >
              {title}
            </h2>
            <p
              id="confirmation-modal-desc"
              className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed"
            >
              {description}
            </p>
          </div>

          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            aria-label="Close modal"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Reason Input (if required, e.g. for super admin suspension/rejection) */}
        {requireReason && (
          <div className="mt-4 mb-5 space-y-1.5">
            <label
              htmlFor="modal-reason-input"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              {reasonLabel} <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="modal-reason-input"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError) setReasonError('');
              }}
              rows={3}
              placeholder={reasonPlaceholder}
              disabled={loading}
              className={`w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-950 border transition-all text-slate-900 dark:text-white placeholder:text-slate-400 ${
                reasonError
                  ? 'border-rose-500 focus:ring-rose-500'
                  : 'border-slate-300 dark:border-slate-700 focus:border-blue-500'
              }`}
            />
            {reasonError && (
              <p className="text-3xs text-rose-500 font-medium">{reasonError}</p>
            )}
          </div>
        )}

        {/* Action Controls */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer touch-target-min"
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold text-white transition-all shadow-md flex items-center gap-2 cursor-pointer touch-target-min ${
              isDestructive
                ? 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800'
                : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
            } ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {loading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <span>{confirmLabel}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;
