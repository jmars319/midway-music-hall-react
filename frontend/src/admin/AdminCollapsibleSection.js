import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export default function AdminCollapsibleSection({
  id,
  title,
  description = '',
  summary = '',
  isCollapsed = false,
  onToggle = () => {},
  children,
  className = '',
  bodyClassName = '',
}) {
  const panelId = `${id}-panel`;
  const subtitle = isCollapsed ? summary : description || summary;

  return (
    <section className={`rounded-2xl border border-purple-500/20 bg-gray-900/40 ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!isCollapsed}
        aria-controls={panelId}
        className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-inset rounded-2xl"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-purple-200">
              Section
            </span>
            <h3 className="text-lg font-semibold text-white">{title}</h3>
          </div>
          {subtitle ? (
            <p className={`mt-2 text-sm ${isCollapsed ? 'text-gray-300' : 'text-gray-400'}`}>
              {subtitle}
            </p>
          ) : null}
        </div>
        <span className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-700 bg-gray-950/70 text-gray-300">
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>
      <div
        id={panelId}
        hidden={isCollapsed}
        className={`border-t border-purple-500/10 px-5 py-5 ${bodyClassName}`}
      >
        {children}
      </div>
    </section>
  );
}
