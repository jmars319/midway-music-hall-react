import React from 'react';
import { RefreshCw, CalendarDays, Clock, Info, CheckCircle2 } from 'lucide-react';

const formatDateTime = (date) => {
  if (!date) return '';
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  return value.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const formatTime = (date) => {
  if (!date) return '';
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  return value.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const pickBalancedColumns = (count, maxCols = 4) => {
  const safeCount = Math.max(0, count || 0);
  const cap = Math.max(1, maxCols);
  if (safeCount === 0) {
    return 1;
  }
  let best = 1;
  let bestEmpty = Infinity;
  let bestRows = Infinity;
  for (let cols = cap; cols >= 1; cols -= 1) {
    const rows = Math.ceil(safeCount / cols);
    const capacity = rows * cols;
    const empty = capacity - safeCount;
    if (
      empty < bestEmpty
      || (empty === bestEmpty && rows < bestRows)
      || (empty === bestEmpty && rows === bestRows && cols > best)
    ) {
      best = cols;
      bestEmpty = empty;
      bestRows = rows;
    }
  }
  return best;
};

export default function RecurringEvents({ series = [] }) {
  if (!series.length) {
    return null;
  }

  return (
    <section
      className="py-12 bg-gray-950 border-y border-purple-500/20"
      id="recurring-events"
      data-nav-target="recurring-events"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
          <div>
            <p className="text-sm uppercase tracking-widest text-purple-300">Recurring</p>
            <h2 className="text-3xl font-bold text-white mt-1">Weekly & Monthly Favorites</h2>
            <p className="text-gray-400 mt-2">
              These community staples run on a predictable rhythm. Tap any card to preview the next dates.
            </p>
          </div>
        </div>

        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:[grid-template-columns:repeat(var(--recur-cols),minmax(0,1fr))] gap-5"
          style={{ '--recur-cols': String(pickBalancedColumns(series.length, 4)) }}
        >
          {series.map((item, idx) => {
            const { master, nextOccurrence, upcomingOccurrences, happeningThisWeek, scheduleLabel, summary } = item || {};
            const safeMaster = master || {};
            const upcoming = Array.isArray(upcomingOccurrences) ? upcomingOccurrences : [];
            const fallbackKey = [
              item?.key,
              safeMaster.id,
              safeMaster.title || safeMaster.artist_name,
              scheduleLabel,
            ].filter(Boolean).join('|');
            if (process.env.NODE_ENV !== 'production' && idx === 0) {
              // eslint-disable-next-line no-console
              console.debug('[RecurringEvents] render', series.length, 'items. first key=', fallbackKey || `recurring-${idx}`);
            }
            return (
              <article
                key={fallbackKey || `recurring-${idx}`}
                className="bg-gray-900 rounded-2xl border border-purple-500/30 p-5 flex flex-col space-y-4 h-full"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-2xl font-semibold text-white">{safeMaster.title || safeMaster.artist_name || 'Recurring Event'}</h3>
                    <p className="text-gray-300 mt-1">{summary || safeMaster.description || 'Regular gathering at Midway Music Hall.'}</p>
                  </div>
                  <RefreshCw className="h-6 w-6 text-purple-300 flex-shrink-0" />
                </div>

                <div className="bg-gray-800 border border-purple-500/20 rounded-xl p-4 flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <CalendarDays className="h-5 w-5 text-purple-300" />
                    <div>
                      <p className="text-sm uppercase tracking-wide text-purple-300">Typical schedule</p>
                      <p className="text-white font-semibold">{scheduleLabel || 'Recurring schedule TBA'}</p>
                    </div>
                  </div>
                  {nextOccurrence?.start_datetime ? (
                    <div className="flex items-center gap-3">
                      <Clock className="h-5 w-5 text-purple-300" />
                      <div>
                        <p className="text-sm uppercase tracking-wide text-purple-300">Next occurrence</p>
                        <p className="text-white font-semibold">
                          {formatDateTime(nextOccurrence.start_datetime)} · {formatTime(nextOccurrence.start_datetime)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 text-gray-400">
                      <Info className="h-5 w-5" />
                      <p>No upcoming date scheduled yet.</p>
                    </div>
                  )}
                  {happeningThisWeek && (
                    <div className="flex items-center gap-2 text-emerald-300 text-sm font-semibold">
                      <CheckCircle2 className="h-4 w-4" />
                      Happening this week
                    </div>
                  )}
                </div>

                {upcoming.length ? (
                  <div>
                    <p className="text-sm uppercase tracking-widest text-purple-300 mb-2">Next dates</p>
                    <div className="divide-y divide-gray-800 border border-gray-800 rounded-xl overflow-hidden">
                      {upcoming.slice(0, 4).map((occ, occIdx) => {
                        const occKey = occ?.id || `${fallbackKey || 'recurring'}-occ-${occIdx}`;
                        return (
                        <div key={occKey} className="px-4 py-3 flex items-center justify-between bg-gray-900/70">
                          <div>
                            <p className="text-white font-medium">{formatDateTime(occ?.start_datetime)}</p>
                            <p className="text-gray-400 text-sm">{formatTime(occ?.start_datetime)} · {occ?.venue_code || 'MMH'}</p>
                          </div>
                        </div>
                      );})}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
