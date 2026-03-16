import React from 'react';

const TONE_CLASSES = {
  muted: 'text-gray-400',
  danger: 'text-red-200',
  success: 'text-emerald-200',
};

export default function AdminStickyActionBar({
  primaryLabel = 'Save',
  savingLabel = 'Saving…',
  isSaving = false,
  primaryDisabled = false,
  onCancel = null,
  cancelLabel = 'Cancel',
  message = '',
  tone = 'muted',
  className = '',
}) {
  return (
    <div className={`sticky bottom-0 z-20 border-t border-purple-500/20 bg-gray-950/95 px-4 py-3 backdrop-blur ${className}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className={`min-h-[1.25rem] text-xs ${TONE_CLASSES[tone] || TONE_CLASSES.muted}`}>
          {message}
        </div>
        <div className="flex items-center justify-end gap-2">
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded bg-gray-700 px-4 py-2 text-sm text-white hover:bg-gray-600"
            >
              {cancelLabel}
            </button>
          ) : null}
          <button
            type="submit"
            disabled={primaryDisabled || isSaving}
            className="rounded bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? savingLabel : primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
