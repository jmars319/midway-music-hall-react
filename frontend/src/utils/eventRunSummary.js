const isMultiDayEventRun = (value = {}) => (
  Number(value?.event_is_multi_day) === 1
  || Number(value?.is_multi_day) === 1
  || Number(value?.event_occurrence_count || value?.occurrence_count || 0) > 1
);

const resolveEventRunStartValue = (value = {}) => {
  if (value?.event_run_start_datetime) return value.event_run_start_datetime;
  if (value?.run_start_datetime) return value.run_start_datetime;
  if (value?.start_datetime) return value.start_datetime;
  if (value?.event_date) {
    return `${value.event_date}${value.event_time ? ` ${value.event_time}` : ''}`.trim();
  }
  return '';
};

const resolveEventRunSummary = (value = {}) => {
  const summary = value?.event_run_summary || value?.run_summary || '';
  return typeof summary === 'string' ? summary.trim() : '';
};

const formatEventRunText = (value = {}, { formatSingleDay } = {}) => {
  const singleDayFormatter = typeof formatSingleDay === 'function'
    ? formatSingleDay
    : (rawValue) => rawValue || 'N/A';

  if (isMultiDayEventRun(value)) {
    return resolveEventRunSummary(value) || 'Multi-day run';
  }

  const startValue = resolveEventRunStartValue(value);
  return startValue ? singleDayFormatter(startValue) : 'N/A';
};

const buildEventRunDisplayLabel = (value = {}, options = {}) => {
  const runText = formatEventRunText(value, options);
  if (!isMultiDayEventRun(value)) {
    return runText;
  }
  return runText === 'Multi-day run' ? runText : `Multi-day run - ${runText}`;
};

export {
  buildEventRunDisplayLabel,
  formatEventRunText,
  isMultiDayEventRun,
  resolveEventRunStartValue,
  resolveEventRunSummary,
};
