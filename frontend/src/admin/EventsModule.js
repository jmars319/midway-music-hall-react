// EventsModule: admin UI to create and manage events
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Edit, Copy, CheckCircle, XCircle, Archive as ArchiveIcon } from 'lucide-react';
import { API_BASE, getImageUrlSync } from '../apiConfig';
import ResponsiveImage from '../components/ResponsiveImage';
import AdminCollapsibleSection from './AdminCollapsibleSection';
import AdminStickyActionBar from './AdminStickyActionBar';
import { getEventEditorFlags } from './eventEditorFlags';
import useCollapsibleSections from './useCollapsibleSections';
import { formatSeatLabel, isSeatRow, resolveRowHeaderLabels } from '../utils/seatLabelUtils';
import { buildPricingRowKey, getEventPricingConfig, getTieredPriceSummary } from '../utils/eventPricing';
import {
  formatEventDateForInput,
  formatEventTimeForInput,
  parseFriendlyEventDate,
  parseFriendlyEventTime,
} from '../utils/adminEventDateTimeInput';
const SECTION_STORAGE_KEY = 'mmh_event_sections';
const EVENT_EDITOR_SECTION_STORAGE_KEY = 'mmh_event_editor_sections';

const VENUE_LABELS = {
  MMH: 'Midway Music Hall',
  TGP: 'The Gathering Place'
};

const TICKET_TYPE_LABELS = {
  general_admission: 'General Admission',
  reserved_seating: 'Reserved Seating',
  hybrid: 'Hybrid / Mixed'
};

const DEFAULT_STAFF_INBOX = 'midwayeventcenter@gmail.com';
const DEFAULT_PRICING_TIER_COLORS = [
  '#F59E0B',
  '#06B6D4',
  '#10B981',
  '#8B5CF6',
  '#EF4444',
  '#3B82F6',
  '#F97316',
  '#22C55E',
];
const SEAT_ROUTING_SOURCE_LABELS = {
  event: 'Event override for this show',
  category: 'Category-specific inbox',
  category_slug: 'Beach Bands auto-routing',
  default: 'Default staff inbox',
};
const MAX_PREVIEW_SEATS = 50;
const MAX_COMPARISON_SEATS = 20;

const SESSION_TIMEZONE = 'America/New_York';
const DATE_INPUT_ERROR = 'Use MM/DD/YYYY';
const TIME_INPUT_ERROR = 'Use h:mm AM/PM (example: 7:00 PM)';
const SCHEDULE_VALIDATION_SUMMARY = 'Please fix the highlighted fields.';
const MIN_MULTI_DAY_OCCURRENCES = 2;

const SORT_OPTIONS = [
  { value: 'start_asc', label: 'Start date (upcoming first)' },
  { value: 'start_desc', label: 'Start date (recent first)' },
  { value: 'category', label: 'Category' },
  { value: 'venue', label: 'Venue' },
  { value: 'status', label: 'Status' },
  { value: 'title_az', label: 'Title (A–Z)' },
  { value: 'archived_state', label: 'Archived state' },
];

const GROUP_OPTIONS = [
  { value: 'category', label: 'Group by category' },
  { value: 'venue', label: 'Group by venue' },
];

const parseEventDate = (event) => {
  if (event.start_datetime) {
    const normalized = event.start_datetime.replace(' ', 'T');
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (event.event_date) {
    const normalized = `${event.event_date}T${event.event_time || '00:00:00'}`;
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
};

const formatDateDisplay = (event) => {
  const occurrenceRows = Array.isArray(event?.occurrences) ? event.occurrences : [];
  if (Number(event?.is_multi_day) === 1 || occurrenceRows.length > 1 || Number(event?.occurrence_count) > 1) {
    const first = occurrenceRows[0];
    const last = occurrenceRows[occurrenceRows.length - 1];
    const formatOccurrenceDate = (occurrence) => {
      if (!occurrence) return '';
      const date = parseEventDate({
        ...event,
        start_datetime: occurrence.start_datetime,
        event_date: occurrence.event_date || occurrence.occurrence_date,
        event_time: occurrence.event_time || occurrence.start_time,
      });
      if (!date) return occurrence.event_date || occurrence.occurrence_date || 'TBD';
      return new Intl.DateTimeFormat('en-US', {
        timeZone: SESSION_TIMEZONE,
        month: 'short',
        day: 'numeric',
        weekday: 'short',
      }).format(date);
    };
    const firstLabel = formatOccurrenceDate(first);
    const lastLabel = formatOccurrenceDate(last);
    if (firstLabel && lastLabel && firstLabel !== lastLabel) {
      return `${firstLabel} -> ${lastLabel}`;
    }
    if (firstLabel) return `${firstLabel}${occurrenceRows.length > 1 ? ` (${occurrenceRows.length} dates)` : ''}`;
  }
  const date = parseEventDate(event);
  if (!date) return event.event_date || 'TBD';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: SESSION_TIMEZONE,
    month: 'short',
    day: 'numeric',
    weekday: 'short'
  }).format(date);
};

const formatTimeDisplay = (event) => {
  const occurrenceRows = Array.isArray(event?.occurrences) ? event.occurrences : [];
  if (Number(event?.is_multi_day) === 1 || occurrenceRows.length > 1 || Number(event?.occurrence_count) > 1) {
    const labels = occurrenceRows
      .slice(0, 2)
      .map((occurrence) => formatTimeDisplay({
        ...event,
        occurrences: [],
        is_multi_day: 0,
        occurrence_count: 1,
        start_datetime: occurrence.start_datetime,
        event_date: occurrence.event_date || occurrence.occurrence_date,
        event_time: occurrence.event_time || occurrence.start_time,
      }))
      .filter(Boolean);
    if (!labels.length) {
      return 'Multiple times';
    }
    return occurrenceRows.length > 1 ? `${labels.join(' / ')}${occurrenceRows.length > labels.length ? ' +' : ''}` : labels[0];
  }
  const date = parseEventDate(event);
  if (!date) return event.event_time || 'TBD';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: SESSION_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
};

const formatDoorTime = (event) => {
  if (!event.door_time) return 'TBD';
  const normalized = event.door_time.includes('T') ? event.door_time : event.door_time.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return event.door_time;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: SESSION_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
};

const valuesDiffer = (next, original) => {
  const normalize = (val) => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val.trim();
    return String(val).trim();
  };
  const nextVal = normalize(next);
  const originalVal = normalize(original);
  if (!nextVal && !originalVal) return false;
  return nextVal !== originalVal;
};

const normalizeOccurrenceRowsForComparison = (rows = []) => (
  getNonEmptyOccurrenceRows(rows).map((row) => ({
    event_date: String(row.event_date || '').trim(),
    event_time: String(row.event_time || '').trim(),
  }))
);

const occurrenceRowsDiffer = (nextRows = [], originalRows = []) => (
  JSON.stringify(normalizeOccurrenceRowsForComparison(nextRows)) !== JSON.stringify(normalizeOccurrenceRowsForComparison(originalRows))
);

const eventAllowsSeatRequests = (event = {}) => {
  if (!event) return false;
  if (typeof event.seating_enabled !== 'undefined') {
    return Number(event.seating_enabled) === 1;
  }
  return Boolean(event.layout_id || event.layout_version_id);
};

const formatPrice = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return `$${num.toFixed(2).replace(/\.00$/, '')}`;
};

const formatPriceDisplay = (event) => {
  const tieredSummary = getTieredPriceSummary(event);
  if (tieredSummary) {
    return tieredSummary;
  }
  if (event.min_ticket_price && event.max_ticket_price && Number(event.min_ticket_price) !== Number(event.max_ticket_price)) {
    const min = formatPrice(event.min_ticket_price);
    const max = formatPrice(event.max_ticket_price);
    if (min && max) return `${min} - ${max}`;
  }
  return formatPrice(event.ticket_price) || formatPrice(event.door_price) || 'TBD';
};

const formatSnapshotSeatBadgeLabel = (seatId) => {
  const raw = String(seatId || '').trim();
  if (!raw) return '';
  const parts = raw.split('-').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const seatIndex = parts[parts.length - 1];
    const rowPart = parts[parts.length - 2];
    if (/^\d+$/.test(seatIndex)) {
      const tableMatch = rowPart.match(/\d+/);
      const table = tableMatch ? tableMatch[0] : rowPart;
      if (table) return `${table}-${seatIndex}`;
    }
  }
  const normalized = formatSeatLabel(raw, { mode: 'seat' });
  const compact = String(normalized || '').match(/^(\d+)([A-Za-z]+)$/);
  if (compact) return `${compact[1]}-${compact[2].toUpperCase()}`;
  return normalized || raw;
};

const normalizePaymentConfig = (config = {}) => ({
  scope: config.scope || 'category',
  category_id: config.category_id ?? null,
  enabled: Boolean(config.enabled),
  provider_type: config.provider_type === 'paypal_hosted_button'
    ? 'paypal_hosted_button'
    : config.provider_type === 'paypal_orders'
      ? 'paypal_orders'
      : 'external_link',
  provider_label: config.provider_label || '',
  button_text: config.button_text || 'Pay Online',
  payment_url: config.payment_url || '',
  paypal_hosted_button_id: config.paypal_hosted_button_id || '',
  paypal_currency: config.paypal_currency || 'USD',
  paypal_enable_venmo: Boolean(config.paypal_enable_venmo),
  limit_seats: Number(config.limit_seats) > 0 ? Number(config.limit_seats) : 6,
  over_limit_message: config.over_limit_message || '',
  fine_print: config.fine_print || '',
});

const resolveSeatRoutingInfo = (event = {}) => {
  const email = event.seat_request_target_email || DEFAULT_STAFF_INBOX;
  const sourceKey = event.seat_request_target_source || 'default';
  const label = SEAT_ROUTING_SOURCE_LABELS[sourceKey] || SEAT_ROUTING_SOURCE_LABELS.default;
  return { email, sourceKey, label };
};

const normalizePriceInput = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (trimmed === '') return null;
  const num = Number(trimmed);
  if (Number.isNaN(num)) return null;
  return Number(num.toFixed(2));
};

const normalizePricingColorInput = (value, index = 0) => (
  /^#[0-9A-F]{6}$/i.test(String(value || '').trim())
    ? String(value).trim().toUpperCase()
    : DEFAULT_PRICING_TIER_COLORS[index % DEFAULT_PRICING_TIER_COLORS.length]
);

const buildDefaultPricingTier = (existingTiers = []) => {
  let counter = existingTiers.length + 1;
  let candidateId = `tier-${counter}`;
  const existingIds = new Set(existingTiers.map((tier) => String(tier.id || '').trim()));
  while (existingIds.has(candidateId)) {
    counter += 1;
    candidateId = `tier-${counter}`;
  }
  return {
    id: candidateId,
    label: `Tier ${counter}`,
    price: '',
    note: '',
    color: DEFAULT_PRICING_TIER_COLORS[(counter - 1) % DEFAULT_PRICING_TIER_COLORS.length],
  };
};

const buildDefaultPricingTiers = (count = 3) => {
  const tiers = [];
  while (tiers.length < count) {
    tiers.push(buildDefaultPricingTier(tiers));
  }
  return tiers;
};

const clonePricingTier = (tier = {}, index = 0) => ({
  id: String(tier.id || `tier-${index + 1}`).trim() || `tier-${index + 1}`,
  label: String(tier.label || '').trim(),
  price: tier.price ?? '',
  note: String(tier.note || '').trim(),
  color: normalizePricingColorInput(tier.color, index),
});

const normalizePricingFormState = (event = {}) => {
  const config = getEventPricingConfig(event);
  if (!config) {
    return {
      pricing_mode: 'flat',
      pricing_tiers: buildDefaultPricingTiers(),
      pricing_assignments: {},
    };
  }
  return {
    pricing_mode: 'tiered',
    pricing_tiers: config.tiers.map((tier, index) => clonePricingTier(tier, index)),
    pricing_assignments: { ...(config.assignments || {}) },
  };
};

const getPricingRowSeatCount = (row = {}) => {
  const parsed = Number(row.total_seats ?? row.totalSeats ?? row.capacity ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const extractPricingAssignmentRows = (layoutData = []) => (
  Array.isArray(layoutData)
    ? layoutData.filter((row) => row && row.is_active !== false && isSeatRow(row) && getPricingRowSeatCount(row) > 0)
    : []
);

const describePricingAssignmentRow = (row = {}) => {
  const { sectionLabel, rowLabel } = resolveRowHeaderLabels(row);
  const parts = [sectionLabel, rowLabel].filter(Boolean);
  if (parts.length) {
    return parts.join(' - ');
  }
  return String(row.label || row.section_name || row.row_label || row.id || 'Seat group').trim();
};

const pricingAssignmentsMatch = (left = {}, right = {}) => {
  const leftEntries = Object.entries(left || {}).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right || {}).sort(([a], [b]) => a.localeCompare(b));
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([key, value], index) => key === rightEntries[index][0] && value === rightEntries[index][1]);
};

const alignPricingAssignments = (assignments = {}, rows = [], tiers = []) => {
  const normalizedRows = extractPricingAssignmentRows(rows);
  if (!normalizedRows.length || !tiers.length) {
    return {};
  }
  const validTierIds = new Set(tiers.map((tier) => String(tier.id || '').trim()).filter(Boolean));
  const nextAssignments = {};
  normalizedRows.forEach((row) => {
    const rowKey = buildPricingRowKey(row);
    if (!rowKey) return;
    const currentTierId = String(assignments[rowKey] || '').trim();
    nextAssignments[rowKey] = validTierIds.has(currentTierId) ? currentTierId : '';
  });
  return nextAssignments;
};

const isLikelyValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

const isRecurringEvent = (event) => Boolean(event.is_series_master || event.series_master_id);

const normalizeVenueKey = (venueCode) => {
  const key = (venueCode || 'MMH').toUpperCase();
  return VENUE_LABELS[key] ? key : 'MMH';
};

const buildOccurrenceRow = (eventDate = '', eventTime = '', sourceId = null) => ({
  row_id: sourceId ? `occ-${sourceId}` : `occ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  event_date: eventDate,
  event_time: eventTime,
});

const buildOccurrenceRowsFromEvent = (event = {}) => {
  const rawOccurrences = Array.isArray(event.occurrences) && event.occurrences.length
    ? event.occurrences
    : [{
        id: 'single',
        event_date: event.event_date,
        event_time: event.event_time,
      }];
  return rawOccurrences.map((occurrence, index) => buildOccurrenceRow(
    formatEventDateForInput(occurrence.event_date || occurrence.occurrence_date || (index === 0 ? event.event_date : '')),
    formatEventTimeForInput(occurrence.event_time || occurrence.start_time || (index === 0 ? event.event_time : '')),
    occurrence.id || occurrence.occurrence_key || index + 1,
  ));
};

const getNonEmptyOccurrenceRows = (rows = []) => (
  (Array.isArray(rows) ? rows : []).filter((row) => {
    const date = String(row?.event_date || '').trim();
    const time = String(row?.event_time || '').trim();
    return date || time;
  })
);

const initialForm = {
  artist_name: '',
  event_date: '',
  event_time: '',
  door_time: '',
  multi_day_enabled: false,
  occurrence_rows: [buildOccurrenceRow()],
  genre: '',
  description: '',
  series_schedule_label: '',
  series_summary: '',
  series_footer_note: '',
  image_url: '',
  hero_image_id: null,
  poster_image_id: null,
  pricing_mode: 'flat',
  pricing_tiers: buildDefaultPricingTiers(),
  pricing_assignments: {},
  ticket_price: '',
  door_price: '',
  age_restriction: 'All Ages',
  venue_section: '',
  layout_id: '',
  category_id: '',
  seat_request_email_override: '',
  venue_code: 'MMH',
  contact_name: '',
  contact_phone_raw: '',
  contact_email: '',
  contact_notes: '',
  seating_enabled: false,
  payment_enabled: false,
};

const createInitialFormState = () => ({
  ...initialForm,
  pricing_tiers: buildDefaultPricingTiers(),
  pricing_assignments: {},
  occurrence_rows: [buildOccurrenceRow()],
});

const findLayoutName = (layouts, layoutId) => {
  if (!layoutId) return '';
  const match = layouts.find((layout) => String(layout.id) === String(layoutId));
  return match?.name || `Layout #${layoutId}`;
};

const summarizePricingMode = (formData) => {
  if (formData.pricing_mode === 'tiered') {
    const completeTiers = (formData.pricing_tiers || []).filter((tier) => (
      String(tier.label || '').trim() && normalizePriceInput(tier.price) !== null
    ));
    return `Tiered pricing • ${completeTiers.length} tier${completeTiers.length === 1 ? '' : 's'}`;
  }
  const ticket = formatPrice(formData.ticket_price);
  const door = formatPrice(formData.door_price);
  if (ticket && door && ticket !== door) {
    return `Advance ${ticket} • Door ${door}`;
  }
  if (ticket || door) {
    return ticket || door;
  }
  return 'No price set';
};

const summarizeOccurrenceSchedule = (formData) => {
  if (!formData.multi_day_enabled) {
    return [
      formData.event_date || 'Date missing',
      formData.event_time || 'Time missing',
      formData.door_time ? `Doors ${formData.door_time}` : null,
    ].filter(Boolean).join(' • ');
  }
  const rows = getNonEmptyOccurrenceRows(formData.occurrence_rows || []);
  if (!rows.length) {
    return 'Multi-day run • dates missing';
  }
  const labels = rows.slice(0, 2).map((row) => {
    const parts = [row.event_date || 'Date missing', row.event_time || 'Time missing'].filter(Boolean);
    return parts.join(' • ');
  });
  const suffix = rows.length > labels.length ? ` +${rows.length - labels.length} more` : '';
  return [
    `Multi-day run • ${rows.length} date${rows.length === 1 ? '' : 's'}`,
    labels.join(' | ') + suffix,
    formData.door_time ? `Doors ${formData.door_time}` : null,
  ].filter(Boolean).join(' • ');
};

export default function EventsModule(){
  const [events, setEvents] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [paymentConfigs, setPaymentConfigs] = useState({ categories: {}, global: null });
  const [paymentSettingsAvailable, setPaymentSettingsAvailable] = useState(true);
  const [paymentSettingsError, setPaymentSettingsError] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState(createInitialFormState());
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadProgress, setImageUploadProgress] = useState(0);
  const [imageUploadProcessing, setImageUploadProcessing] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState({});
  const [filters, setFilters] = useState({
    status: 'all',
    timeframe: 'upcoming',
    recurringOnly: false,
    seatingOnly: false,
    needsScheduleOnly: false,
    search: '',
    venue: 'all',
    category: 'all',
    sortBy: 'start_asc',
    groupBy: 'category',
  });
  const [listError, setListError] = useState('');
  const [seriesExpanded, setSeriesExpanded] = useState({});
  const [seriesActionId, setSeriesActionId] = useState(null);
  const [refreshingLayout, setRefreshingLayout] = useState(false);
  const [refreshLayoutMessage, setRefreshLayoutMessage] = useState('');
  const [refreshLayoutError, setRefreshLayoutError] = useState('');
  const [layoutConfirmState, setLayoutConfirmState] = useState({ open: false, pendingValue: '' });
  const [layoutChangeToast, setLayoutChangeToast] = useState('');
  const [saveToast, setSaveToast] = useState('');
  const [eventPricingRows, setEventPricingRows] = useState([]);
  const [eventPricingRowsLoading, setEventPricingRowsLoading] = useState(false);
  const [seatingSnapshotsState, setSeatingSnapshotsState] = useState({ loading: false, items: [], error: '', eventId: null });
  const [snapshotCopyMessage, setSnapshotCopyMessage] = useState('');
  const [snapshotRestoreState, setSnapshotRestoreState] = useState({
    restoringId: null,
    message: '',
    error: '',
    conflicts: [],
    lastSnapshotId: null,
  });
  const [snapshotPreviewState, setSnapshotPreviewState] = useState({
    open: false,
    snapshot: null,
    seatFilter: '',
  });
  const previewModalRef = useRef(null);
  const previewCloseButtonRef = useRef(null);
  const scheduleInputRefs = useRef({
    event_date: null,
    event_time: null,
    door_time: null,
  });

  useEffect(() => {
    if (!saveToast) return undefined;
    const timer = setTimeout(() => setSaveToast(''), 4500);
    return () => clearTimeout(timer);
  }, [saveToast]);

  const selectedLayoutTemplateRows = useMemo(() => {
    const selectedLayoutId = String(formData.layout_id || '').trim();
    if (!selectedLayoutId) return [];
    const match = layouts.find((layout) => String(layout.id) === selectedLayoutId);
    return extractPricingAssignmentRows(match?.layout_data || []);
  }, [formData.layout_id, layouts]);

  const pricingAssignmentRows = useMemo(() => {
    const selectedLayoutId = String(formData.layout_id || '').trim();
    const originalLayoutId = String(editing?.layout_id || '').trim();
    if (
      editing?.id &&
      selectedLayoutId &&
      originalLayoutId &&
      selectedLayoutId === originalLayoutId &&
      eventPricingRows.length
    ) {
      return eventPricingRows;
    }
    return selectedLayoutTemplateRows;
  }, [editing?.id, editing?.layout_id, eventPricingRows, formData.layout_id, selectedLayoutTemplateRows]);

  const pricingAssignmentOptions = useMemo(
    () => pricingAssignmentRows
      .map((row) => ({
        row,
        rowKey: buildPricingRowKey(row),
        label: describePricingAssignmentRow(row),
        seatCount: getPricingRowSeatCount(row),
      }))
      .filter((item) => item.rowKey),
    [pricingAssignmentRows]
  );

  const tieredPricingPreview = useMemo(() => {
    if (formData.pricing_mode !== 'tiered') return '';
    const tiers = (formData.pricing_tiers || []).map((tier, index) => ({
      id: String(tier.id || `tier-${index + 1}`).trim() || `tier-${index + 1}`,
      label: String(tier.label || '').trim(),
      price: normalizePriceInput(tier.price),
      note: String(tier.note || '').trim(),
      color: normalizePricingColorInput(tier.color, index),
    })).filter((tier) => tier.label && tier.price !== null);
    if (!tiers.length) return '';
    return getTieredPriceSummary({
      pricing_config: {
        mode: 'tiered',
        tiers,
      },
    }) || '';
  }, [formData.pricing_mode, formData.pricing_tiers]);

  useEffect(() => {
    if (!showForm || !editing?.id) {
      setEventPricingRows([]);
      setEventPricingRowsLoading(false);
      return undefined;
    }
    const selectedLayoutId = String(formData.layout_id || '').trim();
    const originalLayoutId = String(editing.layout_id || '').trim();
    if (!selectedLayoutId || !originalLayoutId || selectedLayoutId !== originalLayoutId) {
      setEventPricingRows([]);
      setEventPricingRowsLoading(false);
      return undefined;
    }
    let cancelled = false;
    setEventPricingRowsLoading(true);
    fetch(`${API_BASE}/seating/event/${editing.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.success) {
          setEventPricingRows(extractPricingAssignmentRows(data.seating || []));
        } else {
          setEventPricingRows([]);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to fetch event pricing rows', err);
          setEventPricingRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setEventPricingRowsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [editing?.id, editing?.layout_id, editing?.layout_version_id, formData.layout_id, showForm]);

  useEffect(() => {
    if (!showForm || formData.pricing_mode !== 'tiered') {
      return;
    }
    setFormData((prev) => {
      const nextAssignments = alignPricingAssignments(prev.pricing_assignments, pricingAssignmentRows, prev.pricing_tiers);
      if (pricingAssignmentsMatch(prev.pricing_assignments, nextAssignments)) {
        return prev;
      }
      return {
        ...prev,
        pricing_assignments: nextAssignments,
      };
    });
  }, [formData.pricing_mode, pricingAssignmentRows, showForm]);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const params = new URLSearchParams({
        limit: '500',
        scope: 'admin',
      });
      params.set('include_series_masters', '1');
      if (filters.status !== 'all') {
        params.set('status', filters.status);
      }
      if (filters.venue && filters.venue !== 'all') {
        params.set('venue', filters.venue);
      }
      if (filters.timeframe === 'archived') {
        params.set('archived', '1');
        params.set('timeframe', 'all');
      } else if (filters.timeframe === 'all') {
        params.set('archived', 'all');
        params.set('timeframe', 'all');
      } else {
        params.set('archived', '0');
        params.set('timeframe', filters.timeframe);
      }
      const res = await fetch(`${API_BASE}/events?${params.toString()}`);
      const responseText = await res.text();
      let data = null;
      if (responseText) {
        try {
          data = JSON.parse(responseText);
        } catch (parseErr) {
          console.error('Failed to parse admin events payload', parseErr, responseText);
        }
      }
      if (!res.ok) {
        console.error('Admin events API returned non-200', { status: res.status, body: responseText });
        setEvents([]);
        setListError(data?.message || data?.error || `Server returned status ${res.status}.`);
        return;
      }
      if (data && data.success && Array.isArray(data.events)) {
        setEvents(data.events);
        setListError('');
      } else {
        console.error('Unexpected admin events payload', data);
        setEvents([]);
        setListError(data?.message || 'Events list is temporarily unavailable.');
      }
    } catch (err) {
      console.error('Failed to fetch events', err);
      setEvents([]);
      setListError('Events list is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.timeframe, filters.venue]);

  const fetchLayouts = async () => {
    try {
      const res = await fetch(`${API_BASE}/seating-layouts`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.layouts)) {
        setLayouts(data.layouts);
      }
    } catch (err) {
      console.error('Failed to fetch layouts', err);
    }
  };

  const fetchSeatingSnapshots = useCallback(async (eventId) => {
    if (!eventId) {
      setSeatingSnapshotsState({ loading: false, items: [], error: '', eventId: null });
      return;
    }
    setSeatingSnapshotsState((prev) => ({
      loading: true,
      error: '',
      eventId,
      items: prev.eventId === eventId ? prev.items : [],
    }));
    try {
      const res = await fetch(`${API_BASE}/events/${eventId}/seating-snapshots?limit=5`);
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || 'Unable to load seating snapshots');
      }
      setSeatingSnapshotsState({ loading: false, items: data.snapshots || [], error: '', eventId });
    } catch (err) {
      console.error('Failed to load seating snapshots', err);
      setSeatingSnapshotsState({
        loading: false,
        items: [],
        error: err instanceof Error ? err.message : 'Unable to load seating snapshots',
        eventId,
      });
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/event-categories`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.categories)) {
        setCategories(data.categories);
        setCategoryError('');
      } else {
        setCategoryError('Unable to load categories');
      }
    } catch (err) {
      console.error('Failed to load categories', err);
      setCategoryError('Unable to load categories');
    }
  }, []);

  const fetchPaymentSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/payment-settings`);
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || 'Unable to load payment settings');
      }
      if (!data.has_table) {
        setPaymentSettingsAvailable(false);
        setPaymentConfigs({ categories: {}, global: null });
        setPaymentSettingsError('');
        return;
      }
      setPaymentSettingsAvailable(true);
      const lookup = { categories: {}, global: null };
      (data.payment_settings || []).forEach((setting) => {
        if (!setting || typeof setting !== 'object') {
          return;
        }
        const normalized = normalizePaymentConfig(setting);
        if (normalized.scope === 'global') {
          lookup.global = normalized;
        } else if (normalized.category_id) {
          lookup.categories[Number(normalized.category_id)] = normalized;
        }
      });
      setPaymentConfigs(lookup);
      setPaymentSettingsError('');
    } catch (err) {
      console.error('Failed to load payment settings', err);
      setPaymentSettingsError(err instanceof Error ? err.message : 'Unable to load payment settings');
      setPaymentConfigs({ categories: {}, global: null });
    }
  }, []);

  useEffect(() => {
    fetchLayouts();
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    fetchPaymentSettings();
  }, [fetchPaymentSettings]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    if (!showForm || !editing?.id) {
      setSeatingSnapshotsState({ loading: false, items: [], error: '', eventId: null });
      setSnapshotCopyMessage('');
      setSnapshotRestoreState({
        restoringId: null,
        message: '',
        error: '',
        conflicts: [],
        lastSnapshotId: null,
      });
      return;
    }
    setSnapshotRestoreState((prev) => ({
      restoringId: null,
      message: '',
      error: '',
      conflicts: [],
      lastSnapshotId: prev.lastSnapshotId,
    }));
    fetchSeatingSnapshots(editing.id);
  }, [showForm, editing, fetchSeatingSnapshots]);

  const closeSnapshotPreview = useCallback(() => {
    setSnapshotPreviewState({ open: false, snapshot: null, seatFilter: '' });
  }, []);

  const openSnapshotPreview = useCallback((snapshot) => {
    if (!snapshot) return;
    setSnapshotPreviewState({ open: true, snapshot, seatFilter: '' });
  }, []);

  useEffect(() => {
    if (!snapshotPreviewState.open) return;
    if (previewCloseButtonRef.current) {
      previewCloseButtonRef.current.focus();
    }
  }, [snapshotPreviewState.open]);

  useEffect(() => {
    if (!snapshotPreviewState.open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSnapshotPreview();
        return;
      }
      if (event.key === 'Tab' && previewModalRef.current) {
        const focusableSelectors = [
          'a[href]',
          'button',
          'textarea',
          'input',
          'select',
          '[tabindex]:not([tabindex="-1"])'
        ].join(',');
        const focusable = previewModalRef.current.querySelectorAll(focusableSelectors);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [snapshotPreviewState.open, closeSnapshotPreview]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SECTION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setCollapsedSections(parsed);
        }
      }
    } catch (err) {
      console.warn('Failed to read section state', err);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(collapsedSections));
    } catch (err) {
      console.warn('Failed to persist section state', err);
    }
  }, [collapsedSections]);

  const categoryLookup = useMemo(() => {
    const map = new Map();
    categories.forEach((cat) => {
      map.set(String(cat.id), cat);
    });
    return map;
  }, [categories]);

  const selectedCategoryId = formData.category_id ? String(formData.category_id) : '';
  const selectedCategory = selectedCategoryId ? categoryLookup.get(selectedCategoryId) : null;
  const editingIsSeriesMaster = Boolean(editing && Number(editing.is_series_master) === 1);
  const effectiveCategorySlug = (selectedCategory?.slug || editing?.category_slug || '').toLowerCase();
  const editorFlags = useMemo(
    () =>
      getEventEditorFlags({
        categorySlug: effectiveCategorySlug,
        isSeriesMaster: editingIsSeriesMaster,
        seatingEnabled: Boolean(formData.seating_enabled),
      }),
    [effectiveCategorySlug, editingIsSeriesMaster, formData.seating_enabled]
  );

  const layoutNameForEvent = (event) => {
    if (!event.layout_id) return 'Not assigned';
    const found = layouts.find((layout) => String(layout.id) === String(event.layout_id));
    return found?.name || `Layout #${event.layout_id}`;
  };

  const categoryLabelForEvent = useCallback((event) => {
    if (!event) return 'Normal';
    if (event.category_name) return event.category_name;
    if (event.category_id && categoryLookup.has(String(event.category_id))) {
      return categoryLookup.get(String(event.category_id)).name;
    }
    if (event.category_slug === 'beach-bands') return 'Beach Bands';
    return 'Normal';
  }, [categoryLookup]);

  const categorySlugForEvent = useCallback((event) => {
    if (!event) return 'normal';
    if (event.category_slug) return event.category_slug;
    if (event.category_id && categoryLookup.has(String(event.category_id))) {
      return categoryLookup.get(String(event.category_id)).slug;
    }
    return 'normal';
  }, [categoryLookup]);

  const toggleSection = (sectionId) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const setAllSectionsState = (sectionIds, collapsed) => {
    setCollapsedSections((prev) => {
      const next = { ...prev };
      sectionIds.forEach((id) => {
        next[id] = collapsed;
      });
      return next;
    });
  };

  const normalizeEventStatus = (event) => (event?.status || 'draft').toLowerCase();
  const isEventArchived = (event) => Boolean(event?.archived_at) || (event?.status || '').toLowerCase() === 'archived';
  const buildSearchText = (event, extras = []) => {
    const haystack = [
      event.artist_name,
      event.title,
      event.genre,
      event.notes,
      event.description,
      event.venue_section,
      event.ticket_url,
      ...extras,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack;
  };
  const occurrenceDateForInstance = (event) => {
    if (event.event_date) return event.event_date;
    if (event.start_datetime) {
      return event.start_datetime.split(' ')[0];
    }
    return null;
  };

  const eventItems = useMemo(() => {
    if (!events.length) return [];
    const seriesMap = new Map();
    const ensureSeriesEntry = (id) => {
      const key = Number(id);
      if (!seriesMap.has(key)) {
        seriesMap.set(key, { master: null, instances: [] });
      }
      return seriesMap.get(key);
    };
    events.forEach((event) => {
      if (Number(event.is_series_master) === 1) {
        ensureSeriesEntry(event.id).master = event;
      }
    });
    events.forEach((event) => {
      if (event.series_master_id) {
        ensureSeriesEntry(event.series_master_id).instances.push(event);
      }
    });
    const items = [];
    const createSingleItem = (event) => {
      const status = normalizeEventStatus(event);
      const archived = isEventArchived(event);
      const bucket = archived ? 'archived' : (status === 'published' ? 'published' : 'drafts');
      const date = parseEventDate(event);
      const hasSeating = eventAllowsSeatRequests(event);
      const titleSortValue = `${event.artist_name || event.title || ''}`.toLowerCase();
      return {
        type: 'event',
        id: `event-${event.id}`,
        event,
        bucket,
        status,
        venueCode: normalizeVenueKey(event.venue_code),
        categorySlug: categorySlugForEvent(event),
        categoryLabel: categoryLabelForEvent(event),
        searchText: buildSearchText(event),
        sortDate: date ? date.getTime() : 0,
        hasSeating,
        needsSchedule: Boolean(event.missing_schedule),
        titleSortValue,
      };
    };
    const createSeriesItem = (entry) => {
      const master = entry.master;
      const sortedInstances = [...entry.instances].sort((a, b) => {
        const aDate = parseEventDate(a);
        const bDate = parseEventDate(b);
        const aVal = aDate ? aDate.getTime() : 0;
        const bVal = bDate ? bDate.getTime() : 0;
        return aVal - bVal;
      });
      let publishedCount = 0;
      let draftCount = 0;
      let archivedCount = 0;
      let skippedCount = 0;
      let hasSeating = false;
      sortedInstances.forEach((instance) => {
        const status = normalizeEventStatus(instance);
        const archived = isEventArchived(instance);
        if (archived || status === 'archived') {
          archivedCount += 1;
        } else if (status === 'published') {
          publishedCount += 1;
        } else {
          draftCount += 1;
        }
        if (instance.skipped_instance_exception_id) {
          skippedCount += 1;
        }
        if (eventAllowsSeatRequests(instance)) {
          hasSeating = true;
        }
      });
      if (!hasSeating && master && eventAllowsSeatRequests(master)) {
        hasSeating = true;
      }
      const nextInstance = sortedInstances.find(
        (instance) => !instance.skipped_instance_exception_id && !isEventArchived(instance)
      ) || sortedInstances[0] || null;
      const nextDate = nextInstance ? parseEventDate(nextInstance) : null;
      const bucket = publishedCount > 0 ? 'published' : (draftCount > 0 ? 'drafts' : 'archived');
      const categorySlug = categorySlugForEvent(master || nextInstance);
      const categoryLabel = categoryLabelForEvent(master || nextInstance);
      const venueCode = normalizeVenueKey((master && master.venue_code) || (nextInstance && nextInstance.venue_code));
      const searchText = buildSearchText(master || nextInstance || {}, sortedInstances.map((inst) => inst.event_date));
      const masterId = master ? master.id : (sortedInstances[0]?.series_master_id ?? `temp-${sortedInstances[0]?.id ?? Date.now()}`);
      const hasMissingInstance = sortedInstances.some((instance) => instance.missing_schedule);
      const needsSchedule = Boolean((master && master.missing_schedule) || hasMissingInstance);
      const masterTitle = master?.artist_name || master?.title || nextInstance?.artist_name || nextInstance?.title || 'Recurring Series';
      return {
        type: 'series',
        id: `series-${masterId}`,
        master,
        instances: sortedInstances,
        bucket,
        categorySlug,
        categoryLabel,
        venueCode,
        searchText,
        sortDate: nextDate ? nextDate.getTime() : 0,
        hasSeating,
        needsSchedule,
        titleSortValue: masterTitle.toLowerCase(),
        summary: {
          publishedCount,
          draftCount,
          archivedCount,
          skippedCount,
          totalInstances: sortedInstances.length,
          nextInstance,
        },
      };
    };
    events.forEach((event) => {
      if (event.series_master_id) {
        return;
      }
      if (Number(event.is_series_master) === 1) {
        const entry = seriesMap.get(Number(event.id)) || { master: event, instances: [] };
        entry.master = event;
        items.push(createSeriesItem(entry));
      } else {
        items.push(createSingleItem(event));
      }
    });
    seriesMap.forEach((entry, masterId) => {
      if (!entry.master && entry.instances.length) {
        const placeholder = { ...entry.instances[0], id: masterId, is_series_master: 1 };
        entry.master = placeholder;
        items.push(createSeriesItem(entry));
      }
    });
    return items;
  }, [events, categoryLabelForEvent, categorySlugForEvent]);

  const filteredItems = useMemo(() => {
    if (!eventItems.length) return [];
    const searchValue = filters.search.trim().toLowerCase();
    return eventItems.filter((item) => {
      if (filters.recurringOnly && item.type !== 'series') {
        return false;
      }
      if (filters.seatingOnly && !item.hasSeating) {
        return false;
      }
      if (filters.needsScheduleOnly && !item.needsSchedule) {
        return false;
      }
      if (filters.category !== 'all' && item.categorySlug !== filters.category) {
        return false;
      }
      if (filters.venue !== 'all' && item.venueCode !== filters.venue) {
        return false;
      }
      if (filters.status !== 'all') {
        const bucketKey = filters.status === 'draft' ? 'drafts' : filters.status;
        if (item.bucket !== bucketKey) {
          return false;
        }
      }
      if (searchValue && item.searchText && !item.searchText.includes(searchValue)) {
        return false;
      }
      return true;
    });
  }, [eventItems, filters]);

  const sortedItems = useMemo(() => {
    const compare = (a, b) => {
      switch (filters.sortBy) {
        case 'start_desc':
          return (b.sortDate || 0) - (a.sortDate || 0);
        case 'category':
          return (a.categoryLabel || '').localeCompare(b.categoryLabel || '');
        case 'venue':
          return (VENUE_LABELS[a.venueCode] || a.venueCode || '').localeCompare(VENUE_LABELS[b.venueCode] || b.venueCode || '');
        case 'status':
          const order = { published: 0, drafts: 1, archived: 2 };
          return (order[a.bucket] ?? 3) - (order[b.bucket] ?? 3);
        case 'title_az':
          return (a.titleSortValue || '').localeCompare(b.titleSortValue || '');
        case 'archived_state':
          return (a.bucket === 'archived' ? 1 : 0) - (b.bucket === 'archived' ? 1 : 0);
        case 'start_asc':
        default:
          return (a.sortDate || 0) - (b.sortDate || 0);
      }
    };
    return [...filteredItems].sort(compare);
  }, [filteredItems, filters.sortBy]);

  const groupedSections = useMemo(() => {
    if (!sortedItems.length) return [];
    const groups = new Map();
    sortedItems.forEach((item) => {
      const groupKey = filters.groupBy === 'venue'
        ? `venue-${item.venueCode || 'unknown'}`
        : `category-${item.categorySlug || 'normal'}`;
      const label = filters.groupBy === 'venue'
        ? (VENUE_LABELS[item.venueCode] || 'Events')
        : (item.categoryLabel || 'Normal');
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          key: groupKey,
          label,
          published: [],
          drafts: [],
          archived: [],
        });
      }
      const bucketKey = item.bucket || 'drafts';
      const target = groups.get(groupKey);
      if (bucketKey === 'published') {
        target.published.push(item);
      } else if (bucketKey === 'archived') {
        target.archived.push(item);
      } else {
        target.drafts.push(item);
      }
    });
    return Array.from(groups.values());
  }, [sortedItems, filters.groupBy]);

  const sectionIds = useMemo(() => groupedSections.flatMap((group) => {
    const ids = [
      `${group.key}-published`,
      `${group.key}-drafts`,
    ];
    if (group.archived.length) {
      ids.push(`${group.key}-archived`);
    }
    return ids;
  }), [groupedSections]);

  const categoryOptions = useMemo(() => {
    if (!categories.length) return [];
    const currentSelection = formData.category_id ? String(formData.category_id) : '';
    return [...categories]
      .filter((cat) => cat.is_active || (currentSelection && String(cat.id) === currentSelection))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [categories, formData.category_id]);

  const categoryFilterOptions = useMemo(() => {
    if (!categories.length) return [];
    return [...categories].sort((a, b) => a.name.localeCompare(b.name));
  }, [categories]);
  const editingSeatRouting = useMemo(() => {
    if (!editing) return null;
    return resolveSeatRoutingInfo(editing);
  }, [editing]);

  const activePaymentConfig = useMemo(() => {
    if (!paymentSettingsAvailable) {
      return null;
    }
    const categoryId = formData.category_id ? Number(formData.category_id) : null;
    if (categoryId && paymentConfigs.categories[categoryId] && paymentConfigs.categories[categoryId].enabled) {
      return paymentConfigs.categories[categoryId];
    }
    if (paymentConfigs.global && paymentConfigs.global.enabled) {
      return paymentConfigs.global;
    }
    return null;
  }, [formData.category_id, paymentConfigs, paymentSettingsAvailable]);

  useEffect(() => {
    if (!activePaymentConfig && formData.payment_enabled) {
      setFormData((prev) => ({ ...prev, payment_enabled: false }));
    }
  }, [activePaymentConfig, formData.payment_enabled]);

  const editorSectionIds = useMemo(() => ([
    'basic-info',
    'audience-venue',
    'schedule',
    'pricing',
    'seating',
    'payment',
    'advanced',
    'contact',
    'media',
  ]), []);
  const editorSectionDefaults = useMemo(() => ({
    'basic-info': false,
    'audience-venue': true,
    schedule: false,
    pricing: true,
    seating: true,
    payment: true,
    advanced: true,
    contact: true,
    media: true,
  }), []);
  const {
    collapsedSections: collapsedEditorSections,
    toggleSection: toggleEditorSection,
    setSectionsState: setEditorSectionsState,
  } = useCollapsibleSections(EVENT_EDITOR_SECTION_STORAGE_KEY, editorSectionDefaults);

  const eventEditorSummaries = useMemo(() => {
    const categoryLabel = selectedCategory?.name || 'Normal';
    const venueLabel = VENUE_LABELS[normalizeVenueKey(formData.venue_code)];
    const layoutLabel = findLayoutName(layouts, formData.layout_id);
    const paymentLabel = activePaymentConfig
      ? (activePaymentConfig.provider_label || 'Configured payment link')
      : null;
    const snapshotCount = seatingSnapshotsState.items?.length || 0;
    return {
      'basic-info': [
        formData.artist_name || 'Artist missing',
        formData.genre || categoryLabel,
      ].filter(Boolean).join(' • '),
      'audience-venue': [
        venueLabel,
        formData.venue_section ? `Section: ${formData.venue_section}` : null,
        formData.age_restriction || 'All Ages',
      ].filter(Boolean).join(' • '),
      schedule: summarizeOccurrenceSchedule(formData),
      pricing: summarizePricingMode(formData),
      seating: formData.seating_enabled || formData.layout_id
        ? [
            formData.seating_enabled ? 'Reservations enabled' : 'Reservations hidden',
            layoutLabel ? `Layout: ${layoutLabel}` : 'No layout assigned',
            editing && snapshotCount ? `${snapshotCount} snapshot${snapshotCount === 1 ? '' : 's'}` : null,
          ].filter(Boolean).join(' • ')
        : 'Seat reservations disabled',
      payment: !paymentSettingsAvailable
        ? 'Migration required'
        : activePaymentConfig
          ? `${formData.payment_enabled ? 'Enabled' : 'Disabled'} • ${paymentLabel}`
          : 'No payment config available',
      advanced: [
        formData.seat_request_email_override ? 'Custom seat inbox' : 'Default seat routing',
        editorFlags.showRecurringPanel && (
          formData.series_schedule_label || formData.series_summary || formData.series_footer_note
        ) ? 'Recurring series copy' : null,
        editorFlags.showBeachBandsPanel ? 'Beach Bands notes visible' : null,
      ].filter(Boolean).join(' • '),
      contact: [
        formData.contact_name || null,
        formData.contact_phone_raw || null,
        formData.contact_email || null,
      ].filter(Boolean).join(' • ') || 'No event contact set',
      media: [
        imagePreview || formData.image_url ? 'Custom image selected' : 'Default image',
        formData.description ? 'Description added' : 'No description yet',
      ].join(' • '),
    };
  }, [
    activePaymentConfig,
    editing,
    editorFlags.showBeachBandsPanel,
    editorFlags.showRecurringPanel,
    formData,
    imagePreview,
    layouts,
    paymentSettingsAvailable,
    seatingSnapshotsState.items,
    selectedCategory?.name,
  ]);

  const snapshotPreviewLists = useMemo(() => {
    if (!snapshotPreviewState.snapshot) return null;
    const seatFilter = snapshotPreviewState.seatFilter.trim().toLowerCase();
    const filterList = (list = []) => {
      const normalized = Array.isArray(list) ? list.filter(Boolean) : [];
      const filtered = seatFilter ? normalized.filter((seat) => seat.toLowerCase().includes(seatFilter)) : normalized;
      return {
        total: normalized.length,
        matchCount: filtered.length,
        seats: filtered.slice(0, MAX_PREVIEW_SEATS),
        remainder: Math.max(filtered.length - MAX_PREVIEW_SEATS, 0),
      };
    };
    return {
      reserved: filterList(snapshotPreviewState.snapshot.reserved_seats || []),
      pending: filterList(snapshotPreviewState.snapshot.pending_seats || []),
      hold: filterList(snapshotPreviewState.snapshot.hold_seats || []),
    };
  }, [snapshotPreviewState]);

  const currentSeatLists = useMemo(() => {
    const summary = editing?.current_seat_summary || editing?.seat_snapshot_summary || editing?.current_seating || null;
    if (!summary) return null;
    const normalize = (list) => (Array.isArray(list) ? list.filter(Boolean) : []);
    const reserved = normalize(summary.reserved_seats);
    const pending = normalize(summary.pending_seats);
    const hold = normalize(summary.hold_seats);
    if (!reserved.length && !pending.length && !hold.length) return null;
    return { reserved, pending, hold };
  }, [editing]);

  const snapshotComparison = useMemo(() => {
    if (!snapshotPreviewState.snapshot) return null;
    const buildSet = (list) => new Set((Array.isArray(list) ? list : []).filter(Boolean));
    const snapshotSets = {
      reserved: buildSet(snapshotPreviewState.snapshot.reserved_seats || []),
      pending: buildSet(snapshotPreviewState.snapshot.pending_seats || []),
      hold: buildSet(snapshotPreviewState.snapshot.hold_seats || []),
    };
    if (!currentSeatLists) {
      return { available: false };
    }
    const comparisonLimit = MAX_COMPARISON_SEATS;
    const diffSets = (snapshotSet, currentSet) => {
      const snapshotOnly = [];
      snapshotSet.forEach((seat) => {
        if (!currentSet.has(seat)) snapshotOnly.push(seat);
      });
      const currentOnly = [];
      currentSet.forEach((seat) => {
        if (!snapshotSet.has(seat)) currentOnly.push(seat);
      });
      return {
        snapshotOnlyCount: snapshotOnly.length,
        snapshotOnlyPreview: snapshotOnly.slice(0, comparisonLimit),
        currentOnlyCount: currentOnly.length,
        currentOnlyPreview: currentOnly.slice(0, comparisonLimit),
      };
    };
    return {
      available: true,
      reserved: diffSets(snapshotSets.reserved, new Set(currentSeatLists.reserved || [])),
      pending: diffSets(snapshotSets.pending, new Set(currentSeatLists.pending || [])),
      hold: diffSets(snapshotSets.hold, new Set(currentSeatLists.hold || [])),
    };
  }, [snapshotPreviewState.snapshot, currentSeatLists]);

  const renderEventCard = (event) => {
    const eventTitle = event.artist_name || event.title || 'Untitled Event';
    const subtitle = event.title && event.title !== eventTitle ? event.title : event.notes;
    const ticketTypeLabel = TICKET_TYPE_LABELS[event.ticket_type] || 'General Admission';
    const priceCopy = formatPriceDisplay(event);
    const eventStatus = event.status || 'draft';
    const isArchived = Boolean(event.archived_at);
    const isPublished = eventStatus === 'published';
    const statusValue = isArchived ? 'archived' : (eventStatus === 'published' ? 'published' : 'draft');
    const statusClasses = isPublished
      ? 'bg-green-500/15 text-green-200 border border-green-500/30'
      : isArchived
        ? 'bg-gray-500/15 text-gray-200 border border-gray-500/30'
        : 'bg-yellow-500/15 text-yellow-200 border border-yellow-500/30';
    const statusLabel = isPublished ? 'Published' : isArchived ? 'Archived' : 'Draft';
    const visibilityBadge = event.visibility === 'private'
      ? <span className="text-xs font-semibold px-2 py-1 rounded-full bg-gray-500/20 text-gray-200 border border-gray-500/30">Private</span>
      : null;
    const recurrenceBadge = isRecurringEvent(event)
      ? <span className="text-xs font-semibold px-2 py-1 rounded-full bg-blue-500/15 text-blue-200 border border-blue-500/30">Recurring Series</span>
      : null;
    const seatingBadge = event.seating_enabled
      ? <span className="text-xs font-semibold px-2 py-1 rounded-full bg-purple-500/15 text-purple-200 border border-purple-500/30">Seating Enabled</span>
      : null;
    const categoryLabel = categoryLabelForEvent(event);
    const categoryInactive = event.category_is_active === 0 && event.category_name;
    const categoryBadge = categoryLabel
      ? (
        <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${categoryInactive ? 'bg-gray-700/40 text-gray-200 border-gray-500/30' : 'bg-cyan-500/15 text-cyan-100 border-cyan-500/30'}`}>
          {categoryInactive ? `${categoryLabel} (inactive)` : categoryLabel}
        </span>
      )
      : null;
    const imageSrc = getImageUrlSync(event.image_url || '');
    const archivedAtCopy = isArchived && event.deleted_at
      ? new Date(event.deleted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null;
    const seatRouting = resolveSeatRoutingInfo(event);
    const hasSeatRequests = eventAllowsSeatRequests(event);
    const missingScheduleBadge = event.missing_schedule
      ? (
        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-500/20 text-amber-100 border border-amber-400/40">
          Needs date &amp; time
        </span>
      )
      : null;

    return (
      <div key={event.id} className="bg-gray-900 rounded-xl border border-gray-700 p-4 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row">
            <div className="w-full md:w-32 flex-shrink-0">
            <div className="w-full aspect-square bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
              <ResponsiveImage src={imageSrc} alt={eventTitle} width={256} height={256} className="w-full h-full object-cover" />
            </div>
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusClasses}`}>
                {statusLabel}
              </span>
              {visibilityBadge}
              {recurrenceBadge}
              {missingScheduleBadge}
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-blue-500/15 text-blue-200 border border-blue-500/30">
                {ticketTypeLabel}
              </span>
              {seatingBadge}
              {categoryBadge}
            </div>
            <h4 className="text-lg font-semibold text-white">{eventTitle}</h4>
            {subtitle && <p className="text-sm text-gray-400">{subtitle}</p>}
            {event.description && (
              <p className="text-sm text-gray-500">
                {event.description.length > 180 ? `${event.description.slice(0, 180)}…` : event.description}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm text-gray-200">
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Date</p>
            <p>{formatDateDisplay(event)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Start Time</p>
            <p>{formatTimeDisplay(event)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Doors</p>
            <p>{event.door_time ? formatDoorTime(event) : 'TBD'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Price</p>
            <p>{priceCopy}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Category</p>
            <p>{categoryLabel}{categoryInactive ? ' (inactive)' : ''}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Venue Section</p>
            <p>{event.venue_section || VENUE_LABELS[normalizeVenueKey(event.venue_code)]}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Layout</p>
            <p>{layoutNameForEvent(event)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Contact</p>
            <p>{event.contact_name || 'Donna Cheek'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Ticket Link</p>
            <p className="truncate">{event.ticket_url || 'Not provided'}</p>
          </div>
          {isArchived && (
            <div>
              <p className="text-xs uppercase text-gray-500 tracking-wide">Archived</p>
              <p>{archivedAtCopy || 'History only'}</p>
            </div>
          )}
        </div>

        <div className="mt-4 p-3 rounded-lg border border-gray-800 bg-gray-950/60 text-sm text-gray-200">
          <p className="text-xs uppercase tracking-wide text-gray-500">Seat requests</p>
          {hasSeatRequests ? (
            <>
              <p className="text-white font-semibold">{seatRouting.email}</p>
              <p className="text-xs text-gray-400">Route: {seatRouting.label}</p>
              {event.seat_request_email_override && (
                <p className="text-xs text-amber-200 mt-1">Event override in effect.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400">Seat reservations are disabled for this event.</p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-2 bg-gray-900/60 border border-gray-800 rounded px-3 py-2">
            <label className="text-[10px] uppercase tracking-wide text-gray-400">Status</label>
            <select
              value={statusValue}
              onChange={(e) => handleStatusChange(event, e.target.value, statusValue, e.target)}
              className="bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700"
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <button
            onClick={() => duplicateEvent(event)}
            className="inline-flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
          >
            <Copy className="h-4 w-4" /> Duplicate
          </button>
          {isArchived ? (
            <button
              onClick={() => handleStatusChange(event, 'draft', statusValue)}
              className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
            >
              <ArchiveIcon className="h-4 w-4" /> Restore Draft
            </button>
          ) : (
            <>
              {isPublished ? (
                <button
                  onClick={() => unpublishEvent(event)}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded"
                >
                  <XCircle className="h-4 w-4" /> Unpublish
                </button>
              ) : (
                <button
                  onClick={() => publishEvent(event)}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded"
                >
                  <CheckCircle className="h-4 w-4" /> Publish
                </button>
              )}
              <button
                onClick={() => archiveEvent(event)}
                className="inline-flex items-center gap-2 px-3 py-2 bg-red-600/80 hover:bg-red-600 text-white rounded"
              >
                <ArchiveIcon className="h-4 w-4" /> Archive
              </button>
              <button
                onClick={() => openEdit(event)}
                className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
              >
                <Edit className="h-4 w-4" /> Edit
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderSeriesInstanceRow = (seriesItem, instance) => {
    const status = normalizeEventStatus(instance);
    const archived = isEventArchived(instance);
    const statusClasses = status === 'published'
      ? 'bg-green-500/15 text-green-200 border border-green-500/30'
      : archived
        ? 'bg-gray-500/15 text-gray-200 border border-gray-500/30'
        : 'bg-yellow-500/15 text-yellow-200 border border-yellow-500/30';
    const statusLabel = archived ? 'Archived' : (status === 'published' ? 'Published' : 'Draft');
    const isSkipped = Boolean(instance.skipped_instance_exception_id);
    const isBusy = seriesActionId === instance.id;
    const missingSchedule = Boolean(instance.missing_schedule);
    return (
      <div key={`series-instance-${instance.id}`} className={`flex flex-col md:flex-row md:items-center justify-between gap-3 border border-gray-800 rounded-lg p-3 ${isSkipped ? 'bg-gray-900/60' : 'bg-gray-900/40'}`}>
        <div>
          <p className="text-base font-medium text-white">{formatDateDisplay(instance)} · {formatTimeDisplay(instance)}</p>
          <div className="flex flex-wrap gap-2 mt-1">
            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusClasses}`}>{statusLabel}</span>
            {isSkipped && (
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-red-500/15 text-red-200 border border-red-500/30">
                Skipped
              </span>
            )}
            {missingSchedule && (
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-500/20 text-amber-100 border border-amber-400/40">
                Needs date &amp; time
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">Slug: {instance.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openEdit(instance)}
            className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm"
          >
            Edit
          </button>
          {isSkipped ? (
            <button
              disabled={isBusy}
              onClick={() => unskipSeriesInstance(instance)}
              className="px-3 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-sm disabled:opacity-50"
            >
              Re-enable
            </button>
          ) : (
            <button
              disabled={isBusy}
              onClick={() => skipSeriesInstance(instance)}
              className="px-3 py-2 rounded bg-red-600 hover:bg-red-700 text-white text-sm disabled:opacity-50"
            >
              Skip Date
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderSeriesCard = (seriesItem) => {
    const master = seriesItem.master || {};
    const eventTitle = master.artist_name || master.title || 'Recurring Series';
    const subtitle = master.title && master.title !== eventTitle ? master.title : master.notes;
    const expanded = !!seriesExpanded[seriesItem.id];
    const toggleSeries = () => {
      setSeriesExpanded((prev) => ({
        ...prev,
        [seriesItem.id]: !expanded,
      }));
    };
    const nextInstance = seriesItem.summary?.nextInstance;
    const instanceCount = seriesItem.summary?.totalInstances || seriesItem.instances.length;
    const skippedCount = seriesItem.summary?.skippedCount || 0;
    const seatRouting = resolveSeatRoutingInfo(master || seriesItem.summary?.nextInstance || {});
    const hasSeatRequests = Boolean(seriesItem.hasSeating);
    const missingScheduleBadge = seriesItem.needsSchedule ? (
      <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-500/20 text-amber-100 border border-amber-400/40">
        Needs date &amp; time
      </span>
    ) : null;
    return (
      <div key={seriesItem.id} className="bg-gray-900 rounded-xl border border-blue-800/50 p-4 shadow-sm">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-blue-500/15 text-blue-200 border border-blue-500/30">
              Recurring Series
            </span>
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-cyan-500/15 text-cyan-100 border border-cyan-500/30">
              {seriesItem.categoryLabel}
            </span>
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-gray-500/15 text-gray-200 border border-gray-600">
              {VENUE_LABELS[seriesItem.venueCode] || 'Venue TBD'}
            </span>
            {missingScheduleBadge}
          </div>
          <div>
            <h4 className="text-lg font-semibold text-white">{eventTitle}</h4>
            {subtitle && <p className="text-sm text-gray-400">{subtitle}</p>}
          </div>
          <p className="text-sm text-gray-400">
            {instanceCount} instances · {skippedCount} skipped · Next: {nextInstance ? `${formatDateDisplay(nextInstance)} (${formatTimeDisplay(nextInstance)})` : 'Not scheduled'}
          </p>
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <button
            type="button"
            onClick={toggleSeries}
            className="px-4 py-2 rounded bg-amber-400 text-gray-900 text-sm font-semibold border border-amber-200 hover:bg-amber-300 transition"
          >
            {expanded ? 'Hide Dates' : 'Show Dates'}
          </button>
          <button
            type="button"
            onClick={() => openEdit(master)}
            className="px-3 py-2 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
          >
            Edit Series
          </button>
        </div>
        <div className="mt-4 p-3 rounded-lg border border-gray-800 bg-gray-950/60 text-sm text-gray-200">
          <p className="text-xs uppercase tracking-wide text-gray-500">Seat requests</p>
          {hasSeatRequests ? (
            <>
              <p className="text-white font-semibold">{seatRouting.email}</p>
              <p className="text-xs text-gray-400">Route: {seatRouting.label}</p>
            </>
          ) : (
            <p className="text-sm text-gray-400">Seat reservations disabled for this series.</p>
          )}
        </div>
        {expanded && (
          <div className="mt-4 space-y-3">
            {seriesItem.instances.length === 0 ? (
              <div className="p-4 bg-gray-900 border border-gray-800 rounded text-sm text-gray-400">
                No upcoming instances. Add dates from the event editor.
              </div>
            ) : (
              seriesItem.instances.map((instance) => renderSeriesInstanceRow(seriesItem, instance))
            )}
          </div>
        )}
      </div>
    );
  };

  const renderListItem = (item) => {
    if (item.type === 'series') {
      return renderSeriesCard(item);
    }
    return renderEventCard(item.event);
  };

  const renderEventSection = (heading, list, sectionId) => {
    const collapsed = !!collapsedSections[sectionId];
    return (
      <div className="mt-6" key={sectionId}>
        <button
          type="button"
          onClick={() => toggleSection(sectionId)}
          aria-expanded={!collapsed}
          className="w-full flex items-center justify-between mb-2 px-4 py-2 rounded-lg border border-gray-700 bg-gray-900/60 text-left focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <span className="text-lg font-semibold text-white">{heading}</span>
          <div className="flex items-center gap-3 text-sm text-gray-300">
            <span>{list.length} {list.length === 1 ? 'event' : 'events'}</span>
            <span className="text-xl leading-none">{collapsed ? '+' : '-'}</span>
          </div>
        </button>
        {collapsed ? null : (
          list.length === 0 ? (
            <div className="p-4 bg-gray-900 border border-dashed border-gray-700 rounded-lg text-sm text-gray-400">
              No events in this section.
            </div>
          ) : (
            <div className="space-y-4">
              {list.map(renderListItem)}
            </div>
          )
        )}
      </div>
    );
  };

  const openAdd = () => {
    setEditing(null);
    setFormData(createInitialFormState());
    setEventPricingRows([]);
    setEventPricingRowsLoading(false);
    setImageFile(null);
    setImagePreview(null);
    setError('');
    setFieldErrors({});
    setSaveToast('');
    setRefreshLayoutError('');
    setRefreshLayoutMessage('');
    setLayoutConfirmState({ open: false, pendingValue: '' });
    setShowForm(true);
  };

  const openEdit = (event) => {
    const pricingState = normalizePricingFormState(event);
    const occurrenceRows = buildOccurrenceRowsFromEvent(event);
    const isMultiDay = Number(event.is_multi_day) === 1
      || Number(event.occurrence_count) > 1
      || occurrenceRows.length > 1;
    const primaryOccurrence = occurrenceRows[0] || buildOccurrenceRow(
      formatEventDateForInput(event.event_date),
      formatEventTimeForInput(event.event_time),
      'primary',
    );
    setEditing(event);
    setError('');
    setFieldErrors({});
    setSaveToast('');
    setRefreshLayoutError('');
    setRefreshLayoutMessage('');
    setFormData({
      artist_name: event.artist_name || '',
      event_date: primaryOccurrence.event_date || formatEventDateForInput(event.event_date),
      event_time: primaryOccurrence.event_time || formatEventTimeForInput(event.event_time),
      door_time: formatEventTimeForInput(event.door_time),
      multi_day_enabled: isMultiDay,
      occurrence_rows: occurrenceRows.length ? occurrenceRows : [buildOccurrenceRow()],
      genre: event.genre || '',
      description: event.description || '',
      series_schedule_label: event.series_schedule_label || '',
      series_summary: event.series_summary || '',
      series_footer_note: event.series_footer_note || '',
      image_url: event.image_url || '',
      hero_image_id: event.hero_image_id || null,
      poster_image_id: event.poster_image_id || null,
      pricing_mode: pricingState.pricing_mode,
      pricing_tiers: pricingState.pricing_tiers,
      pricing_assignments: pricingState.pricing_assignments,
      ticket_price: event.ticket_price || '',
      door_price: event.door_price || '',
      age_restriction: event.age_restriction || 'All Ages',
      venue_section: event.venue_section || '',
      layout_id: event.layout_id ? String(event.layout_id) : '',
      category_id: event.category_id ? String(event.category_id) : '',
      seat_request_email_override: event.seat_request_email_override || '',
      venue_code: event.venue_code || 'MMH',
      contact_name: event.contact_name || '',
      contact_phone_raw: event.contact_phone_raw || event.contact_phone || event.contact_phone_normalized || '',
      contact_email: event.contact_email || '',
      contact_notes: event.contact_notes || '',
      seating_enabled: Boolean(event.seating_enabled),
      payment_enabled: Boolean(event.payment_enabled),
    });
    setImageFile(null);
    setEventPricingRows([]);
    setEventPricingRowsLoading(false);
    const previewSource = event.effective_image?.src
      || event.effective_image?.file_url
      || event.image_url
      || '';
    setImagePreview(previewSource ? getImageUrlSync(previewSource) : null);
    setLayoutConfirmState({ open: false, pendingValue: '' });
    setShowForm(true);
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setFormData(prev => ({ ...prev, image_url: '', hero_image_id: null, poster_image_id: null }));
  };

  const copySnapshotPayload = useCallback(async (snapshot) => {
    if (!snapshot) return;
    const payload = {
      reserved_seats: snapshot.reserved_seats || [],
      pending_seats: snapshot.pending_seats || [],
      hold_seats: snapshot.hold_seats || [],
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setSnapshotCopyMessage(`Snapshot #${snapshot.id} JSON copied.`);
    } catch (err) {
      console.error('Failed to copy seating snapshot JSON', err);
      setSnapshotCopyMessage('Unable to copy snapshot JSON.');
    }
    setTimeout(() => setSnapshotCopyMessage(''), 4000);
  }, []);

  const handleRestoreSnapshot = useCallback(
    async (snapshot) => {
      if (!snapshot || !editing?.id) return;
      const reservedCount = snapshot.reserved_seats?.length || 0;
      const pendingCount = snapshot.pending_seats?.length || 0;
      const holdCount = snapshot.hold_seats?.length || 0;
      const summaryParts = [];
      if (reservedCount) summaryParts.push(`${reservedCount} reserved`);
      if (pendingCount) summaryParts.push(`${pendingCount} pending`);
      if (holdCount) summaryParts.push(`${holdCount} hold`);
      const summaryText = summaryParts.length ? summaryParts.join(', ') : 'no seats';
      if (
        !window.confirm(
          `Restore seating & seat requests from snapshot #${snapshot.id}? This overwrites current seat requests with the ${summaryText} captured in that snapshot.`
        )
      ) {
        return;
      }
      setSnapshotRestoreState({ restoringId: snapshot.id, message: '', error: '', conflicts: [], lastSnapshotId: snapshot.id });
      try {
        const res = await fetch(`${API_BASE}/events/${editing.id}/restore-seating-snapshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snapshot_id: snapshot.id }),
        });
        const data = await res.json();
        if (!res.ok || !data?.success) {
          throw new Error(data?.message || 'Unable to restore snapshot');
        }
        const details = data.details || {};
        setSnapshotRestoreState({
          restoringId: null,
          message: `Snapshot #${snapshot.id} restored. Reserved ${details.restored_reserved || 0} · Pending ${details.restored_pending || 0} · Holds ${details.restored_hold || 0}.`,
          error: '',
          conflicts: Array.isArray(details.conflicts) ? details.conflicts : [],
          lastSnapshotId: snapshot.id,
        });
        const normalizedLayoutId = details.layout_id ? String(details.layout_id) : '';
        setFormData((prev) => ({
          ...prev,
          layout_id: normalizedLayoutId,
          seating_enabled: Boolean(details.seating_enabled),
        }));
        setEditing((prev) =>
          prev
            ? {
                ...prev,
                layout_id: details.layout_id ?? prev.layout_id ?? null,
                layout_version_id: details.layout_version_id ?? prev.layout_version_id ?? null,
                seating_enabled: details.seating_enabled ?? prev.seating_enabled ?? 0,
              }
            : prev
        );
        fetchSeatingSnapshots(editing.id);
      } catch (err) {
        console.error('Failed to restore seating snapshot', err);
        setSnapshotRestoreState({
          restoringId: null,
          message: '',
          error: err instanceof Error ? err.message : 'Unable to restore snapshot',
          conflicts: [],
          lastSnapshotId: snapshot.id,
        });
      }
    },
    [editing, fetchSeatingSnapshots]
  );

  const formatSnapshotTimestamp = (value) => {
    if (!value) return 'Unknown';
    try {
      return new Date(value).toLocaleString();
    } catch (err) {
      return value;
    }
  };

  const describeSnapshotConflict = (conflict) => {
    if (!conflict) return 'Conflict detected';
    if (conflict.type === 'seat_missing' && conflict.seat) {
      return `Seat ${conflict.seat} no longer exists in this map. Follow up manually.`;
    }
    if (conflict.message) {
      return conflict.message;
    }
    if (conflict.type === 'layout_missing') {
      return 'Original layout template was deleted. Layout stayed on the current selection.';
    }
    if (conflict.type === 'layout_version_missing') {
      return 'Original layout version is gone. Requests restored but template stayed on current version.';
    }
    return 'Conflict detected during restore.';
  };

  const requestLayoutChange = (rawValue) => {
    const normalized = rawValue === '' ? '' : String(rawValue);
    const hadLayout = Boolean(editing && (editing.layout_id || editing.layout_version_id));
    const originalValue = editing?.layout_id ? String(editing.layout_id) : '';
    if (!hadLayout || originalValue === normalized) {
      setFormData((prev) => ({ ...prev, layout_id: normalized }));
      return;
    }
    setLayoutConfirmState({ open: true, pendingValue: normalized });
  };

  const clearOccurrenceFieldError = (index, field) => {
    setFieldErrors((prev) => {
      const occurrenceErrors = prev.occurrences || {};
      if (!occurrenceErrors[index]?.[field]) {
        return prev;
      }
      const nextOccurrenceErrors = { ...occurrenceErrors };
      const nextRowErrors = { ...(nextOccurrenceErrors[index] || {}) };
      delete nextRowErrors[field];
      if (Object.keys(nextRowErrors).length) {
        nextOccurrenceErrors[index] = nextRowErrors;
      } else {
        delete nextOccurrenceErrors[index];
      }
      const next = { ...prev };
      if (Object.keys(nextOccurrenceErrors).length) {
        next.occurrences = nextOccurrenceErrors;
      } else {
        delete next.occurrences;
      }
      return next;
    });
    if (error === SCHEDULE_VALIDATION_SUMMARY) {
      setError('');
    }
  };

  const handleMultiDayToggle = (enabled) => {
    setFormData((prev) => {
      const existingRows = getNonEmptyOccurrenceRows(prev.occurrence_rows || []);
      const seedRows = existingRows.length
        ? existingRows.map((row) => ({ ...row }))
        : [buildOccurrenceRow(prev.event_date, prev.event_time)];
      const nextRows = enabled && seedRows.length < MIN_MULTI_DAY_OCCURRENCES
        ? [...seedRows, buildOccurrenceRow('', '')]
        : seedRows;
      const firstRow = nextRows[0] || buildOccurrenceRow(prev.event_date, prev.event_time);
      return {
        ...prev,
        multi_day_enabled: enabled,
        occurrence_rows: nextRows,
        event_date: enabled ? prev.event_date : (firstRow.event_date || prev.event_date),
        event_time: enabled ? prev.event_time : (firstRow.event_time || prev.event_time),
      };
    });
    setFieldErrors((prev) => {
      if (!prev.occurrences) return prev;
      const next = { ...prev };
      delete next.occurrences;
      return next;
    });
  };

  const handleOccurrenceRowChange = (index, field, value) => {
    clearOccurrenceFieldError(index, field);
    setFormData((prev) => ({
      ...prev,
      occurrence_rows: (prev.occurrence_rows || []).map((row, rowIndex) => (
        rowIndex === index
          ? {
              ...row,
              [field]: value,
            }
          : row
      )),
    }));
  };

  const handleOccurrenceBlur = (index, field) => {
    setFormData((prev) => {
      const rows = [...(prev.occurrence_rows || [])];
      const current = rows[index];
      if (!current) {
        return prev;
      }
      const rawValue = String(current[field] || '').trim();
      if (!rawValue) {
        return prev;
      }
      const normalized = field === 'event_date'
        ? formatEventDateForInput(rawValue)
        : formatEventTimeForInput(rawValue);
      if (!normalized || normalized === current[field]) {
        return prev;
      }
      rows[index] = {
        ...current,
        [field]: normalized,
      };
      return {
        ...prev,
        occurrence_rows: rows,
      };
    });
    clearOccurrenceFieldError(index, field);
  };

  const handleAddOccurrenceRow = () => {
    setFormData((prev) => ({
      ...prev,
      multi_day_enabled: true,
      occurrence_rows: [...(prev.occurrence_rows || []), buildOccurrenceRow('', '')],
    }));
  };

  const handleRemoveOccurrenceRow = (index) => {
    setFormData((prev) => {
      const rows = [...(prev.occurrence_rows || [])];
      if (rows.length <= 1) {
        return prev;
      }
      rows.splice(index, 1);
      return {
        ...prev,
        occurrence_rows: rows,
      };
    });
    setFieldErrors((prev) => {
      const occurrenceErrors = prev.occurrences || {};
      if (!Object.keys(occurrenceErrors).length) {
        return prev;
      }
      const nextOccurrenceErrors = {};
      Object.entries(occurrenceErrors).forEach(([key, value]) => {
        const numericIndex = Number(key);
        if (Number.isNaN(numericIndex) || numericIndex === index) {
          return;
        }
        nextOccurrenceErrors[numericIndex > index ? numericIndex - 1 : numericIndex] = value;
      });
      const next = { ...prev };
      if (Object.keys(nextOccurrenceErrors).length) {
        next.occurrences = nextOccurrenceErrors;
      } else {
        delete next.occurrences;
      }
      return next;
    });
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name === 'layout_id') {
      requestLayoutChange(value);
      return;
    }
    const nextValue = type === 'checkbox' ? checked : value;
    if (name === 'image_url') {
      setFormData((prev) => ({ ...prev, image_url: nextValue, poster_image_id: null, hero_image_id: null }));
      return;
    }
    if (
      name === 'event_date' ||
      name === 'event_time' ||
      name === 'door_time' ||
      name === 'seat_request_email_override' ||
      name === 'contact_email'
    ) {
      setFieldErrors((prev) => {
        if (!prev[name]) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
      if (error === SCHEDULE_VALIDATION_SUMMARY) {
        setError('');
      }
    }
    setFormData((prev) => ({ ...prev, [name]: nextValue }));
  };

  const handlePricingModeChange = (value) => {
    const nextMode = value === 'tiered' ? 'tiered' : 'flat';
    setFormData((prev) => ({
      ...prev,
      pricing_mode: nextMode,
      pricing_tiers: nextMode === 'tiered'
        ? (prev.pricing_tiers?.length ? prev.pricing_tiers : buildDefaultPricingTiers())
        : prev.pricing_tiers,
      pricing_assignments: nextMode === 'tiered'
        ? alignPricingAssignments(prev.pricing_assignments, pricingAssignmentRows, prev.pricing_tiers?.length ? prev.pricing_tiers : buildDefaultPricingTiers())
        : prev.pricing_assignments,
    }));
  };

  const handlePricingTierChange = (tierId, field, value) => {
    setFormData((prev) => ({
      ...prev,
      pricing_tiers: (prev.pricing_tiers || []).map((tier) => (
        tier.id === tierId
          ? {
              ...tier,
              [field]: value,
            }
          : tier
      )),
    }));
  };

  const handleAddPricingTier = () => {
    setFormData((prev) => {
      const nextTier = buildDefaultPricingTier(prev.pricing_tiers || []);
      const nextTiers = [...(prev.pricing_tiers || []), nextTier];
      return {
        ...prev,
        pricing_tiers: nextTiers,
        pricing_assignments: alignPricingAssignments(prev.pricing_assignments, pricingAssignmentRows, nextTiers),
      };
    });
  };

  const handleRemovePricingTier = (tierId) => {
    setFormData((prev) => {
      const currentTiers = prev.pricing_tiers || [];
      if (currentTiers.length <= 3) {
        return prev;
      }
      const nextTiers = currentTiers.filter((tier) => tier.id !== tierId);
      return {
        ...prev,
        pricing_tiers: nextTiers,
        pricing_assignments: alignPricingAssignments(prev.pricing_assignments, pricingAssignmentRows, nextTiers),
      };
    });
  };

  const handlePricingAssignmentChange = (rowKey, tierId) => {
    setFormData((prev) => ({
      ...prev,
      pricing_assignments: {
        ...(prev.pricing_assignments || {}),
        [rowKey]: tierId,
      },
    }));
  };

  const handleScheduleBlur = (e) => {
    const { name, value } = e.target;
    const raw = String(value || '').trim();
    if (!raw) return;
    let normalized = '';
    if (name === 'event_date') {
      normalized = formatEventDateForInput(raw);
    } else if (name === 'event_time' || name === 'door_time') {
      normalized = formatEventTimeForInput(raw);
    }
    if (!normalized || normalized === value) {
      return;
    }
    setFormData((prev) => ({ ...prev, [name]: normalized }));
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const confirmLayoutChange = () => {
    setFormData((prev) => ({ ...prev, layout_id: layoutConfirmState.pendingValue }));
    setLayoutConfirmState({ open: false, pendingValue: '' });
  };

  const renderSeatBadges = (seats = []) => {
    if (!seats.length) {
      return <span className="text-xs text-gray-400">None</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {seats.map((seat) => (
          <span key={seat} className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-100 border border-gray-600">
            {formatSnapshotSeatBadgeLabel(seat)}
          </span>
        ))}
      </div>
    );
  };

  const renderSeatListBlock = (title, info) => {
    if (!info) {
      return (
        <div className="rounded border border-gray-700 bg-gray-900/60 p-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-white">{title}</span>
            <span className="text-gray-400">0 seats</span>
          </div>
          <p className="text-xs text-gray-400">No seats recorded in this snapshot.</p>
        </div>
      );
    }
    const showingFilteredMessage = snapshotPreviewState.seatFilter.trim() && info.matchCount !== info.total;
    return (
      <div className="rounded border border-gray-700 bg-gray-900/60 p-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-white">{title}</span>
          <span className="text-gray-400">
            {info.matchCount}/{info.total} seats
          </span>
        </div>
        {info.seats.length ? renderSeatBadges(info.seats) : (
          <p className="text-xs text-gray-400">No seats match this filter.</p>
        )}
        {info.remainder > 0 && (
          <p className="text-xs text-gray-400">+{info.remainder} more not shown.</p>
        )}
        {showingFilteredMessage && (
          <p className="text-xs text-gray-500">Filter matches {info.matchCount} seat(s).</p>
        )}
      </div>
    );
  };

  const renderComparisonBlock = (label, data) => {
    if (!data) return null;
    return (
      <div className="rounded border border-gray-700 bg-gray-900/40 p-3 space-y-2">
        <h5 className="text-sm font-semibold text-white">{label}</h5>
        <div className="text-xs text-gray-300 space-y-1">
          <div>
            <span className="font-semibold text-amber-400">{data.snapshotOnlyCount}</span> in snapshot only
          </div>
          {renderSeatBadges(data.snapshotOnlyPreview)}
          {data.snapshotOnlyCount > data.snapshotOnlyPreview.length && (
            <p className="text-xs text-gray-500">+{data.snapshotOnlyCount - data.snapshotOnlyPreview.length} more</p>
          )}
        </div>
        <div className="text-xs text-gray-300 space-y-1">
          <div>
            <span className="font-semibold text-emerald-300">{data.currentOnlyCount}</span> currently reserved/pending/hold but not in snapshot
          </div>
          {renderSeatBadges(data.currentOnlyPreview)}
          {data.currentOnlyCount > data.currentOnlyPreview.length && (
            <p className="text-xs text-gray-500">+{data.currentOnlyCount - data.currentOnlyPreview.length} more</p>
          )}
        </div>
      </div>
    );
  };

  const cancelLayoutChange = () => {
    setLayoutConfirmState({ open: false, pendingValue: '' });
  };

const parseJsonSafely = (payload) => {
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch (err) {
    const start = payload.indexOf('{');
    const end = payload.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(payload.slice(start, end + 1));
      } catch (innerErr) {
        console.error('Failed to parse JSON payload', innerErr, payload);
        return null;
      }
    }
    console.error('Failed to parse JSON payload', err, payload);
    return null;
  }
};


const uploadImageWithProgress = useCallback((file) => new Promise((resolve, reject) => {
  const formDataUpload = new FormData();
  formDataUpload.append('file', file);
  formDataUpload.append('category', 'gallery');
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${API_BASE}/media`);
  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) {
      const percent = Math.round((event.loaded / event.total) * 100);
      setImageUploadProgress(percent);
    }
  };
  xhr.upload.onload = () => {
    setImageUploadProcessing(true);
    setImageUploadProgress(100);
  };
  xhr.onerror = () => {
    setImageUploadProcessing(false);
    reject(new Error('Image upload failed'));
  };
  xhr.onload = () => {
    setImageUploadProcessing(false);
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch (err) {
        reject(err);
      }
    } else {
      reject(new Error('Image upload failed'));
    }
  };
  xhr.send(formDataUpload);
}), []);

  const refreshLayoutSnapshot = async () => {
    const editingId = editing?.id;
    if (!editingId) {
      setRefreshLayoutError('Open an event to refresh its layout.');
      return;
    }
    if (!editing.layout_id && !(formData.layout_id && String(formData.layout_id).trim() !== '')) {
      setRefreshLayoutError('Assign a seating layout before refreshing.');
      return;
    }
    setRefreshingLayout(true);
    setRefreshLayoutError('');
    setRefreshLayoutMessage('');
    try {
      const res = await fetch(`${API_BASE}/events/${editingId}/refresh-layout`, {
        method: 'POST',
        credentials: 'include',
      });
      const responseText = await res.text();
      const data = parseJsonSafely(responseText) || {};
      if (!res.ok || !data.success) {
        const errorMessage = data?.message || data?.error || `Server returned status ${res.status}.`;
        throw new Error(errorMessage);
      }
      const newVersionId = data.layout_version_id || null;
      setRefreshLayoutMessage('Layout snapshot updated. Public seat pickers now use the latest template.');
      setEditing((prev) => {
        if (!prev || Number(prev.id) !== Number(editingId)) return prev;
        return { ...prev, layout_version_id: newVersionId };
      });
      setEvents((prev) => prev.map((evt) => (Number(evt.id) === Number(editingId) ? { ...evt, layout_version_id: newVersionId } : evt)));
    } catch (err) {
      console.error('Failed to refresh layout snapshot', err);
      setRefreshLayoutError(err.message || 'Unable to refresh layout. Please try again.');
    } finally {
      setRefreshingLayout(false);
    }
  };

  const scheduleInputsRequired = editorFlags.requireScheduleFields;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setFieldErrors({});
    try {
      let finalImageUrl = formData.image_url;
      let posterImageId = formData.poster_image_id || null;
      let heroImageId = formData.hero_image_id || null;

      // If a new image file is selected, upload it
      if (imageFile) {
        try {
          setImageUploading(true);
          setImageUploadProcessing(false);
          setImageUploadProgress(0);
          const uploadData = await uploadImageWithProgress(imageFile);
          if (uploadData.success && uploadData.media) {
            const media = uploadData.media;
            finalImageUrl = media.optimized_path || media.file_url || media.url || finalImageUrl;
            posterImageId = media.id || posterImageId;
            if (!heroImageId && posterImageId) {
              heroImageId = posterImageId;
            }
            const previewUrl = media.optimized_path || media.webp_path || media.file_url || media.url || '';
            if (previewUrl) {
              setImagePreview(getImageUrlSync(previewUrl));
            }
            setFormData((prev) => ({
              ...prev,
              image_url: finalImageUrl,
              poster_image_id: posterImageId,
              hero_image_id: heroImageId,
            }));
          } else if (uploadData.success && uploadData.url) {
            finalImageUrl = uploadData.url;
            setFormData((prev) => ({ ...prev, image_url: finalImageUrl }));
          } else {
            throw new Error('Upload failed');
          }
        } catch (uploadErr) {
          console.error('Image upload error', uploadErr);
          setError('Image upload failed, but event will be saved without image');
        } finally {
          setImageUploading(false);
          setImageUploadProcessing(false);
        }
      }

      const method = editing ? 'PUT' : 'POST';
      const url = editing ? `${API_BASE}/events/${editing.id}` : `${API_BASE}/events`;
      const payload = { ...formData, image_url: finalImageUrl, poster_image_id: posterImageId, hero_image_id: heroImageId };
      const parsedLayoutId = formData.layout_id === '' ? null : Number(formData.layout_id);
      const normalizedLayoutId = Number.isFinite(parsedLayoutId) && parsedLayoutId > 0 ? parsedLayoutId : null;
      payload.layout_id = normalizedLayoutId;
      const parsedCategoryId = payload.category_id && payload.category_id !== '' ? Number(payload.category_id) : null;
      payload.category_id = Number.isFinite(parsedCategoryId) && parsedCategoryId > 0 ? parsedCategoryId : null;
      if (formData.pricing_mode === 'tiered') {
        if (!normalizedLayoutId) {
          setEditorSectionsState(['pricing', 'seating'], false);
          setError('Tiered pricing requires a seating layout.');
          setSubmitting(false);
          return;
        }
        if (!pricingAssignmentRows.length) {
          setEditorSectionsState(['pricing', 'seating'], false);
          setError('Tiered pricing requires seat/table groups in the selected layout.');
          setSubmitting(false);
          return;
        }
        const tierDrafts = (formData.pricing_tiers || []).map((tier, index) => ({
          id: String(tier.id || `tier-${index + 1}`).trim() || `tier-${index + 1}`,
          label: String(tier.label || '').trim(),
          price: normalizePriceInput(tier.price),
          note: String(tier.note || '').trim(),
          color: normalizePricingColorInput(tier.color, index),
          rawPrice: String(tier.price ?? '').trim(),
        }));
        const incompleteTier = tierDrafts.find((tier) => {
          const hasAnyContent = Boolean(tier.label || tier.rawPrice || tier.note);
          return hasAnyContent && (!tier.label || tier.price === null);
        });
        if (incompleteTier) {
          setEditorSectionsState(['pricing'], false);
          setError('Each pricing tier needs a label and price before saving.');
          setSubmitting(false);
          return;
        }
        const normalizedTiers = tierDrafts
          .filter((tier) => tier.label && tier.price !== null)
          .map(({ rawPrice, ...tier }) => tier);
        if (normalizedTiers.length < 3) {
          setEditorSectionsState(['pricing'], false);
          setError('Tiered pricing requires at least 3 complete tiers.');
          setSubmitting(false);
          return;
        }
        const nextAssignments = alignPricingAssignments(formData.pricing_assignments, pricingAssignmentRows, normalizedTiers);
        const allRowsAssigned = pricingAssignmentRows.every((row) => {
          const rowKey = buildPricingRowKey(row);
          if (!rowKey) return false;
          return normalizedTiers.some((tier) => tier.id === nextAssignments[rowKey]);
        });
        if (!allRowsAssigned) {
          setEditorSectionsState(['pricing'], false);
          setError('Assign every seat/table group to a pricing tier before saving.');
          setSubmitting(false);
          return;
        }
        payload.pricing_config = {
          mode: 'tiered',
          tiers: normalizedTiers,
          assignments: nextAssignments,
        };
        payload.ticket_price = null;
        payload.door_price = null;
        delete payload.min_ticket_price;
        delete payload.max_ticket_price;
      } else {
        payload.pricing_config = null;
        payload.ticket_price = normalizePriceInput(payload.ticket_price);
        payload.door_price = normalizePriceInput(payload.door_price);
        if (typeof payload.ticket_price === 'number') {
          payload.min_ticket_price = payload.ticket_price;
        } else if (payload.ticket_price === null) {
          payload.min_ticket_price = null;
        }
        if (typeof payload.door_price === 'number') {
          payload.max_ticket_price = payload.door_price;
        } else if (payload.door_price === null) {
          payload.max_ticket_price = payload.ticket_price ?? null;
        }
      }
      payload.seat_request_email_override = (payload.seat_request_email_override || '').trim() || null;
      payload.seating_enabled = formData.seating_enabled ? 1 : 0;
      payload.payment_enabled = formData.payment_enabled ? 1 : 0;
      payload.multi_day_enabled = formData.multi_day_enabled ? 1 : 0;
      payload.venue_code = (payload.venue_code || 'MMH').toUpperCase();
      const originalLayoutKey = editing?.layout_id ? String(editing.layout_id) : '';
      const newLayoutKey = normalizedLayoutId ? String(normalizedLayoutId) : '';
      const layoutChanged = Boolean(editing) && originalLayoutKey !== newLayoutKey;
      const eventDateValue = String(payload.event_date || '').trim();
      const eventTimeValue = String(payload.event_time || '').trim();
      const doorTimeValue = String(payload.door_time || '').trim();
      const originalEventDate = formatEventDateForInput(editing?.event_date);
      const originalEventTime = formatEventTimeForInput(editing?.event_time);
      const originalDoorTimeValue = formatEventTimeForInput(editing?.door_time);
      const originalOccurrenceRows = editing ? buildOccurrenceRowsFromEvent(editing) : [];
      const originalMultiDay = Boolean(editing && (
        Number(editing.is_multi_day) === 1
        || Number(editing.occurrence_count) > 1
        || getNonEmptyOccurrenceRows(originalOccurrenceRows).length > 1
      ));
      const startOrEndProvided = Boolean(payload.start_datetime || payload.end_datetime);
      const scheduleFieldsChanged = editing
        ? startOrEndProvided ||
          valuesDiffer(eventDateValue, originalEventDate) ||
          valuesDiffer(eventTimeValue, originalEventTime) ||
          valuesDiffer(doorTimeValue, originalDoorTimeValue) ||
          Boolean(formData.multi_day_enabled) !== originalMultiDay ||
          occurrenceRowsDiffer(formData.occurrence_rows, originalOccurrenceRows)
        : Boolean(eventDateValue || eventTimeValue || doorTimeValue || startOrEndProvided);
      const mustRequireSchedule = editorFlags.requireScheduleFields || scheduleFieldsChanged;
      if (mustRequireSchedule) {
        const parsedDoorTime = parseFriendlyEventTime(doorTimeValue);
        const nextFieldErrors = {};
        if (!parsedDoorTime) {
          nextFieldErrors.door_time = TIME_INPUT_ERROR;
        }
        let scheduleErrorMessage = SCHEDULE_VALIDATION_SUMMARY;
        let firstInvalidKey = null;
        if (formData.multi_day_enabled) {
          const occurrenceErrors = {};
          const normalizedOccurrences = [];
          (formData.occurrence_rows || []).forEach((row, index) => {
            const rawDate = String(row?.event_date || '').trim();
            const rawTime = String(row?.event_time || '').trim();
            const hasAnyValue = Boolean(rawDate || rawTime);
            if (!hasAnyValue) {
              return;
            }
            const parsedDate = parseFriendlyEventDate(rawDate);
            const parsedTime = parseFriendlyEventTime(rawTime);
            if (!parsedDate) {
              occurrenceErrors[index] = {
                ...(occurrenceErrors[index] || {}),
                event_date: DATE_INPUT_ERROR,
              };
              firstInvalidKey = firstInvalidKey || `occurrence_${index}_event_date`;
            }
            if (!parsedTime) {
              occurrenceErrors[index] = {
                ...(occurrenceErrors[index] || {}),
                event_time: TIME_INPUT_ERROR,
              };
              firstInvalidKey = firstInvalidKey || `occurrence_${index}_event_time`;
            }
            if (parsedDate && parsedTime) {
              normalizedOccurrences.push({
                event_date: parsedDate,
                event_time: parsedTime,
              });
            }
          });
          if (normalizedOccurrences.length < MIN_MULTI_DAY_OCCURRENCES) {
            const blankIndex = (formData.occurrence_rows || []).findIndex((row) => {
              const rawDate = String(row?.event_date || '').trim();
              const rawTime = String(row?.event_time || '').trim();
              return !rawDate && !rawTime;
            });
            const focusIndex = blankIndex !== -1 ? blankIndex : Math.min(normalizedOccurrences.length, Math.max((formData.occurrence_rows || []).length - 1, 0));
            occurrenceErrors[focusIndex] = {
              ...(occurrenceErrors[focusIndex] || {}),
              event_date: occurrenceErrors[focusIndex]?.event_date || DATE_INPUT_ERROR,
              event_time: occurrenceErrors[focusIndex]?.event_time || TIME_INPUT_ERROR,
            };
            firstInvalidKey = firstInvalidKey || `occurrence_${focusIndex}_event_date`;
            scheduleErrorMessage = `Add at least ${MIN_MULTI_DAY_OCCURRENCES} dated occurrences or turn off Multi-Day Event.`;
          }
          if (Object.keys(occurrenceErrors).length > 0 || Object.keys(nextFieldErrors).length > 0) {
            if (Object.keys(occurrenceErrors).length > 0) {
              nextFieldErrors.occurrences = occurrenceErrors;
            }
            setFieldErrors(nextFieldErrors);
            setError(scheduleErrorMessage);
            setEditorSectionsState(['schedule'], false);
            setSubmitting(false);
            const focusKey = firstInvalidKey || (nextFieldErrors.door_time ? 'door_time' : null);
            if (focusKey) {
              requestAnimationFrame(() => {
                const input = scheduleInputRefs.current[focusKey];
                if (input && typeof input.focus === 'function') {
                  input.focus();
                }
              });
            }
            return;
          }
          payload.event_date = normalizedOccurrences[0].event_date;
          payload.event_time = normalizedOccurrences[0].event_time;
          payload.door_time = `${normalizedOccurrences[0].event_date} ${parsedDoorTime}`;
          payload.occurrences = normalizedOccurrences;
        } else {
          const parsedEventDate = parseFriendlyEventDate(eventDateValue);
          const parsedEventTime = parseFriendlyEventTime(eventTimeValue);
          if (!parsedEventDate) {
            nextFieldErrors.event_date = DATE_INPUT_ERROR;
          }
          if (!parsedEventTime) {
            nextFieldErrors.event_time = TIME_INPUT_ERROR;
          }
          if (Object.keys(nextFieldErrors).length > 0) {
            setFieldErrors(nextFieldErrors);
            setError(SCHEDULE_VALIDATION_SUMMARY);
            setEditorSectionsState(['schedule'], false);
            setSubmitting(false);
            const firstInvalid = ['event_date', 'event_time', 'door_time'].find((field) => nextFieldErrors[field]);
            if (firstInvalid) {
              requestAnimationFrame(() => {
                const input = scheduleInputRefs.current[firstInvalid];
                if (input && typeof input.focus === 'function') {
                  input.focus();
                }
              });
            }
            return;
          }
          payload.event_date = parsedEventDate;
          payload.event_time = parsedEventTime;
          payload.door_time = `${parsedEventDate} ${parsedDoorTime}`;
          delete payload.occurrences;
        }
      } else {
        delete payload.event_date;
        delete payload.event_time;
        delete payload.door_time;
        delete payload.occurrences;
      }
      delete payload.occurrence_rows;
      const seatOverrideValue = String(payload.seat_request_email_override || '').trim();
      const contactEmailValue = String(payload.contact_email || '').trim();
      const emailFieldErrors = {};
      if (seatOverrideValue && !isLikelyValidEmail(seatOverrideValue)) {
        emailFieldErrors.seat_request_email_override = 'Use a valid email (example: name@example.com).';
      }
      if (contactEmailValue && !isLikelyValidEmail(contactEmailValue)) {
        emailFieldErrors.contact_email = 'Use a valid email (example: name@example.com).';
      }
      if (Object.keys(emailFieldErrors).length > 0) {
        setFieldErrors(emailFieldErrors);
        setError(SCHEDULE_VALIDATION_SUMMARY);
        const sectionsToOpen = [];
        if (emailFieldErrors.seat_request_email_override) {
          sectionsToOpen.push('advanced');
        }
        if (emailFieldErrors.contact_email) {
          sectionsToOpen.push('contact');
        }
        if (sectionsToOpen.length) {
          setEditorSectionsState(sectionsToOpen, false);
        }
        setSubmitting(false);
        const firstInvalidEmailField = ['seat_request_email_override', 'contact_email'].find((field) => emailFieldErrors[field]);
        if (firstInvalidEmailField) {
          requestAnimationFrame(() => {
            const input = document.querySelector(`[name="${firstInvalidEmailField}"]`);
            if (input && typeof input.focus === 'function') {
              input.focus();
            }
          });
        }
        return;
      }
      ['contact_name', 'contact_email', 'contact_phone_raw', 'contact_notes', 'series_schedule_label', 'series_summary', 'series_footer_note'].forEach((field) => {
        if (typeof payload[field] === 'string') {
          const trimmed = payload[field].trim();
          payload[field] = trimmed.length ? trimmed : null;
        } else if (!payload[field]) {
          payload[field] = null;
        }
      });

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const responseText = await res.text();
      const data = parseJsonSafely(responseText) || {};
      const treatAsSuccess = Boolean(data?.success) || (res.ok && responseText.trim() === '');
      if (treatAsSuccess) {
        if (layoutChanged) {
          const snapshotId = data.seating_snapshot_id || data.snapshot_id || null;
          const toastCopy = snapshotId
            ? `Seating layout updated. Snapshot #${snapshotId} saved for recovery.`
            : 'Seating layout updated and a recovery snapshot was saved.';
          setLayoutChangeToast(toastCopy);
        }
        const savedName = String(payload.artist_name || payload.title || '').trim();
        const label = savedName || 'event';
        setSaveToast(editing ? `Updated "${label}" successfully.` : `Created "${label}" successfully.`);
        setShowForm(false);
        setSeatingSnapshotsState({ loading: false, items: [], error: '', eventId: null });
        setSnapshotCopyMessage('');
        setLayoutConfirmState({ open: false, pendingValue: '' });
        fetchEvents();
      } else {
        if (typeof data?.message === 'string' && data.message.includes('seat_request_email_override')) {
          setFieldErrors((prev) => ({
            ...prev,
            seat_request_email_override: 'Use a valid email (example: name@example.com).',
          }));
        }
        setError(data?.message || data?.error || `Server returned status ${res.status}.`);
      }
    } catch (err) {
      console.error('Save event error', err);
      setError(err instanceof Error ? err.message : 'Failed to save event');
    } finally {
      setSubmitting(false);
    }
  };

  const updateEventFields = async (id, payload, failureMessage = 'Failed to update event') => {
    try {
      const res = await fetch(`${API_BASE}/events/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data && data.success) {
        fetchEvents();
        return true;
      } else {
        alert(data?.message || failureMessage);
        return false;
      }
    } catch (err) {
      console.error('Event update error', err);
      alert(failureMessage);
      return false;
    }
  };

  const publishEvent = async (event) => {
    await updateEventFields(event.id, { status: 'published', visibility: 'public' }, 'Failed to publish event');
  };

  const unpublishEvent = async (event) => {
    await updateEventFields(
      event.id,
      { status: 'draft', visibility: 'private' },
      'Failed to unpublish event'
    );
  };

  const archiveEvent = async (event) => {
    if (!window.confirm(`Archive "${event.artist_name || event.title || 'this event'}"?`)) {
      return false;
    }
    try {
      const res = await fetch(`${API_BASE}/events/${event.id}/archive`, { method: 'POST' });
      const data = await res.json();
      if (data && data.success) {
        fetchEvents();
        return true;
      } else {
        alert(data?.message || 'Failed to archive event');
        return false;
      }
    } catch (err) {
      console.error('Archive error', err);
      alert('Failed to archive event');
      return false;
    }
  };

  const restoreEvent = async (event, nextStatus = 'draft') => {
    const statusValue = nextStatus === 'published' ? 'published' : 'draft';
    const visibilityValue = statusValue === 'published' ? 'public' : 'private';
    try {
      const res = await fetch(`${API_BASE}/events/${event.id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusValue, visibility: visibilityValue }),
      });
      const data = await res.json();
      if (data && data.success) {
        fetchEvents();
        return true;
      } else {
        alert(data?.message || 'Failed to restore event');
        return false;
      }
    } catch (err) {
      console.error('Restore error', err);
      alert('Failed to restore event');
      return false;
    }
  };

  const handleStatusChange = async (event, nextStatus, currentStatus, selectEl) => {
    if (nextStatus === currentStatus) {
      return;
    }
    const eventTitle = event.artist_name || event.title || 'this event';
    let success = false;
    if (nextStatus === 'archived') {
      success = await archiveEvent(event);
    } else if (currentStatus === 'archived') {
      const targetLabel = nextStatus === 'published' ? 'Published (public)' : 'Draft (private)';
      if (!window.confirm(`Restore "${eventTitle}" to ${targetLabel}?`)) {
        if (selectEl) {
          selectEl.value = currentStatus;
        }
        return;
      }
      success = await restoreEvent(event, nextStatus);
    } else if (nextStatus === 'published') {
      success = await updateEventFields(event.id, { status: 'published', visibility: 'public' }, 'Failed to publish event');
    } else {
      success = await updateEventFields(event.id, { status: 'draft', visibility: 'private' }, 'Failed to unpublish event');
    }
    if (!success && selectEl) {
      selectEl.value = currentStatus;
    }
  };

  const duplicateEvent = async (event) => {
    const baseName = event.artist_name || event.title || 'Untitled Event';
    const occurrenceRows = buildOccurrenceRowsFromEvent(event);
    const activeOccurrences = getNonEmptyOccurrenceRows(occurrenceRows);
    const isMultiDay = Number(event.is_multi_day) === 1
      || Number(event.occurrence_count) > 1
      || activeOccurrences.length > 1;
    const firstOccurrence = activeOccurrences[0] || occurrenceRows[0] || null;
    const startParts = (event.start_datetime || '').split(' ');
    const fallbackDate = startParts[0] || '';
    const fallbackTime = startParts[1] ? startParts[1].slice(0, 5) : '';
    const eventDate = firstOccurrence?.event_date || event.event_date || fallbackDate;
    const eventTime = firstOccurrence?.event_time || event.event_time || fallbackTime;
    if (!eventDate || !eventTime) {
      alert('Please set a date and time before duplicating this event.');
      return;
    }
    if (!event.door_time) {
      alert('Please set a Doors Open time before duplicating this event.');
      return;
    }
    const payload = {
      artist_name: `${baseName} (Copy)`,
      title: event.title || '',
      description: event.description || '',
      notes: event.notes || '',
      genre: event.genre || '',
      event_date: eventDate,
      event_time: eventTime,
      door_time: event.door_time,
      multi_day_enabled: isMultiDay,
      occurrences: isMultiDay
        ? activeOccurrences.map((occurrence) => ({
            event_date: parseFriendlyEventDate(occurrence.event_date) || occurrence.event_date,
            event_time: parseFriendlyEventTime(occurrence.event_time) || occurrence.event_time,
          }))
        : undefined,
      ticket_price: event.ticket_price || '',
      door_price: event.door_price || '',
      min_ticket_price: event.min_ticket_price || '',
      max_ticket_price: event.max_ticket_price || '',
      pricing_config: event.pricing_config || null,
      ticket_type: event.ticket_type || 'general_admission',
      seating_enabled: Boolean(event.seating_enabled),
      venue_code: event.venue_code || 'MMH',
      venue_section: event.venue_section || '',
      layout_id: event.layout_id || null,
      ticket_url: event.ticket_url || '',
      contact_name: event.contact_name || '',
      contact_phone_raw: event.contact_phone_raw || event.contact_phone_normalized || '',
      contact_email: event.contact_email || '',
      contact_notes: event.contact_notes || '',
      age_restriction: event.age_restriction || 'All Ages',
      visibility: event.visibility || 'public',
      image_url: event.image_url || '',
      status: 'draft',
      category_tags: event.category_tags || null,
      category_id: event.category_id || null,
      hero_image_id: event.hero_image_id || null,
      poster_image_id: event.poster_image_id || null,
      seat_request_email_override: event.seat_request_email_override || null,
    };
    try {
      const res = await fetch(`${API_BASE}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data && data.success) {
        fetchEvents();
        alert('Event duplicated as a draft.');
      } else {
        alert(data?.message || 'Failed to duplicate event');
      }
    } catch (err) {
      console.error('Duplicate event error', err);
      alert('Failed to duplicate event');
    }
  };

  const skipSeriesInstance = async (instance) => {
    if (seriesActionId) return;
    if (!instance.series_master_id) {
      alert('This instance is not linked to a recurring series.');
      return;
    }
    const occurrenceDate = occurrenceDateForInstance(instance);
    if (!occurrenceDate) {
      alert('Unable to determine the event date for this instance.');
      return;
    }
    if (!window.confirm(`Hide ${instance.artist_name || instance.title || 'this event'} on ${occurrenceDate}?`)) {
      return;
    }
    setSeriesActionId(instance.id);
    try {
      const res = await fetch(`${API_BASE}/events/${instance.series_master_id}/recurrence/exceptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exception_date: occurrenceDate,
          exception_type: 'skip',
          notes: 'Hidden via admin panel',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to skip instance');
      }
      fetchEvents();
    } catch (err) {
      console.error('skipSeriesInstance error', err);
      alert(err.message || 'Failed to hide this date.');
    } finally {
      setSeriesActionId(null);
    }
  };

  const unskipSeriesInstance = async (instance) => {
    if (seriesActionId) return;
    const exceptionId = instance.skipped_instance_exception_id;
    if (!exceptionId) {
      return;
    }
    setSeriesActionId(instance.id);
    try {
      const res = await fetch(`${API_BASE}/recurrence-exceptions/${exceptionId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to restore date');
      }
      fetchEvents();
    } catch (err) {
      console.error('unskipSeriesInstance error', err);
      alert(err.message || 'Failed to restore this date.');
    } finally {
      setSeriesActionId(null);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Events</h1>
        <div>
          <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded">
            <Plus className="h-4 w-4" /> Add Event
          </button>
        </div>
      </div>

      {listError && (
        <div className="mb-6 p-4 rounded-xl border border-red-500/40 bg-red-900/30 text-red-100 text-sm">
          {listError}
        </div>
      )}
      {categoryError && (
        <div className="mb-6 p-4 rounded-xl border border-amber-500/40 bg-amber-800/30 text-amber-100 text-sm">
          {categoryError}
        </div>
      )}

      {layoutChangeToast && (
        <div className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-900/30 px-4 py-3 text-sm text-emerald-100">
          <span>{layoutChangeToast}</span>
          <button
            type="button"
            onClick={() => setLayoutChangeToast('')}
            className="text-emerald-200 hover:text-white text-xs font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}
      {saveToast && (
        <div className="fixed right-5 top-5 z-[80] w-[min(92vw,34rem)] rounded-xl border border-emerald-300 bg-emerald-500 px-4 py-3 text-emerald-950 shadow-2xl">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.08em]">Success</p>
              <p className="text-sm font-semibold break-words">{saveToast}</p>
            </div>
            <button
              type="button"
              onClick={() => setSaveToast('')}
              className="text-xs font-semibold text-emerald-900 hover:text-emerald-950"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="bg-gray-900 border border-purple-500/20 rounded-xl p-4 mb-6 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col">
            <label className="text-xs uppercase text-gray-400 mb-1">Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
              className="px-3 py-2 bg-gray-800 text-white rounded border border-gray-700 text-sm"
            >
              <option value="published">Published only</option>
              <option value="draft">Draft only</option>
              <option value="all">All statuses</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-xs uppercase text-gray-400 mb-1">Timeframe</label>
            <select
              value={filters.timeframe}
              onChange={(e) => setFilters((prev) => ({ ...prev, timeframe: e.target.value }))}
              className="px-3 py-2 bg-gray-800 text-white rounded border border-gray-700 text-sm"
            >
              <option value="upcoming">Upcoming only</option>
              <option value="past">Past events</option>
              <option value="all">All dates</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-xs uppercase text-gray-400 mb-1">Venue</label>
            <select
              value={filters.venue}
              onChange={(e) => setFilters((prev) => ({ ...prev, venue: e.target.value }))}
              className="px-3 py-2 bg-gray-800 text-white rounded border border-gray-700 text-sm"
            >
              <option value="all">All venues</option>
              <option value="MMH">Midway Music Hall</option>
              <option value="TGP">Gathering Place</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-xs uppercase text-gray-400 mb-1">Category</label>
            <select
              value={filters.category}
              onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value }))}
              className="px-3 py-2 bg-gray-800 text-white rounded border border-gray-700 text-sm"
            >
              <option value="all">All categories</option>
              {categoryFilterOptions.map((cat) => (
                <option key={cat.slug} value={cat.slug}>
                  {cat.name}{cat.is_active ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-600"
              checked={filters.recurringOnly}
              onChange={(e) => setFilters((prev) => ({ ...prev, recurringOnly: e.target.checked }))}
            />
            Recurring only
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-600"
              checked={filters.seatingOnly}
              onChange={(e) => setFilters((prev) => ({ ...prev, seatingOnly: e.target.checked }))}
            />
            With seating only
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-600"
              checked={filters.needsScheduleOnly}
              onChange={(e) => setFilters((prev) => ({ ...prev, needsScheduleOnly: e.target.checked }))}
            />
            Needs date/time only
          </label>
          <div className="flex flex-col">
            <label className="text-xs uppercase text-gray-400 mb-1">Sort</label>
            <select
              value={filters.sortBy}
              onChange={(e) => setFilters((prev) => ({ ...prev, sortBy: e.target.value }))}
              className="px-3 py-2 bg-gray-800 text-white rounded border border-gray-700 text-sm"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-xs uppercase text-gray-400 mb-1">Grouping</label>
            <select
              value={filters.groupBy}
              onChange={(e) => setFilters((prev) => ({ ...prev, groupBy: e.target.value }))}
              className="px-3 py-2 bg-gray-800 text-white rounded border border-gray-700 text-sm"
            >
              {GROUP_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="sr-only" htmlFor="event-search">Search events</label>
          <input
            id="event-search"
            type="search"
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            placeholder="Search artist, title, notes, venue..."
            className="w-full px-3 py-2 bg-gray-800 text-white rounded border border-gray-700 text-sm"
          />
        </div>
        <p className="text-xs text-gray-500">
          Upcoming shows load by default. Switch timeframe to “Past” for recent history or “Archived” to manage cleanups.
        </p>
      </div>

      {filters.timeframe === 'archived' && (
        <div className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-sm text-amber-100">
          Archived events are snapshots for record keeping. Restore to edit or duplicate for new bookings.
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full" />
        </div>
      ) : sortedItems.length === 0 ? (
        <div className="p-6 bg-gray-800 rounded-xl border border-gray-700 text-center text-gray-400">
          {events.length === 0
            ? 'No events yet. Click "Add Event" to create your first listing.'
            : 'No events match the selected filters.'}
        </div>
      ) : (
        <>
          {sectionIds.length > 0 && (
            <div className="flex justify-end gap-2 mb-4">
              <button
                type="button"
                onClick={() => setAllSectionsState(sectionIds, false)}
                className="px-3 py-2 text-sm rounded bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-700"
              >
                Expand All
              </button>
              <button
                type="button"
                onClick={() => setAllSectionsState(sectionIds, true)}
                className="px-3 py-2 text-sm rounded bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-700"
              >
                Collapse All
              </button>
            </div>
          )}
          <div className="space-y-10">
            {groupedSections.map((group) => {
              const viewingArchivedOnly = filters.timeframe === 'archived';
              const includeArchivedInline = filters.timeframe === 'all';
              const groupTotal = viewingArchivedOnly
                ? group.archived.length
                : includeArchivedInline
                  ? group.published.length + group.drafts.length + group.archived.length
                  : group.published.length + group.drafts.length;
              return (
                <section key={group.key} className="bg-gray-800 rounded-2xl border border-purple-500/20 p-6">
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div>
                      <h3 className="text-xl font-bold text-white">{group.label}</h3>
                      <p className="text-sm text-gray-400">Organized by publish state and recurring status.</p>
                    </div>
                    <span className="text-sm text-gray-400">
                      {groupTotal} total
                    </span>
                  </div>
                  {viewingArchivedOnly ? (
                    renderEventSection('Archived / Historical', group.archived, `${group.key}-archived`)
                  ) : (
                    <>
                      {renderEventSection('Published Schedule', group.published, `${group.key}-published`)}
                      {renderEventSection('Draft & Private', group.drafts, `${group.key}-drafts`)}
                      {includeArchivedInline && group.archived.length > 0 && renderEventSection('Archived / Historical', group.archived, `${group.key}-archived`)}
                    </>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      {showForm && (
        <>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-purple-500/30 bg-gray-800 shadow-2xl">
            <div className="shrink-0 border-b border-purple-500/20 px-6 py-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold">{editing ? 'Edit Event' : 'Add Event'}</h2>
                  <p className="mt-1 text-sm text-gray-400">
                    Organize the event into sections, then save without losing sight of the action bar.
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditorSectionsState(editorSectionIds, false)}
                    className="rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600"
                  >
                    Expand All
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorSectionsState(editorSectionIds, true)}
                    className="rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600"
                  >
                    Collapse All
                  </button>
                  <button type="button" onClick={() => setShowForm(false)} className="rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600">
                    Close
                  </button>
                </div>
              </div>
            </div>

            <form noValidate onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                {error && (
                  <div
                    className="rounded border border-red-600 bg-red-600/10 p-3 text-red-400"
                    role="alert"
                    aria-live="assertive"
                  >
                    {error}
                  </div>
                )}

                <AdminCollapsibleSection
                  id="event-editor-basic-info"
                  title="Basic Event Information"
                  description="Core show identity and category metadata."
                  summary={eventEditorSummaries['basic-info']}
                  isCollapsed={Boolean(collapsedEditorSections['basic-info'])}
                  onToggle={() => toggleEditorSection('basic-info')}
                >
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm text-gray-300 mb-1">Artist Name*</label>
                      <input name="artist_name" value={formData.artist_name} onChange={handleChange} required className="w-full rounded bg-gray-700 px-4 py-2 text-white" />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-300 mb-1">Genre</label>
                      <input name="genre" value={formData.genre} onChange={handleChange} className="w-full rounded bg-gray-700 px-4 py-2 text-white" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm text-gray-300 mb-1">Category</label>
                      <select
                        name="category_id"
                        value={formData.category_id}
                        onChange={handleChange}
                        className="w-full rounded bg-gray-700 px-4 py-2 text-white"
                      >
                        <option value="">
                          {categories.length ? 'Select category (defaults to Normal)' : 'Loading categories…'}
                        </option>
                        {categoryOptions.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}{cat.is_active ? '' : ' (inactive)'}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-gray-400">Inactive categories remain selectable if already assigned to this event.</p>
                    </div>
                  </div>
                </AdminCollapsibleSection>

                <AdminCollapsibleSection
                  id="event-editor-audience-venue"
                  title="Audience & Venue"
                  description="Controls age guidance, room labeling, and public venue placement."
                  summary={eventEditorSummaries['audience-venue']}
                  isCollapsed={Boolean(collapsedEditorSections['audience-venue'])}
                  onToggle={() => toggleEditorSection('audience-venue')}
                >
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm text-gray-300 mb-1">Age Restriction</label>
                      <select name="age_restriction" value={formData.age_restriction} onChange={handleChange} className="w-full rounded bg-gray-700 px-4 py-2 text-white">
                        <option>All Ages</option>
                        <option>18+</option>
                        <option>21+</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-300 mb-1">Venue*</label>
                      <select
                        name="venue_code"
                        value={formData.venue_code}
                        onChange={handleChange}
                        required
                        className="w-full rounded bg-gray-700 px-4 py-2 text-white"
                      >
                        <option value="MMH">Midway Music Hall</option>
                        <option value="TGP">The Gathering Place</option>
                      </select>
                      <p className="mt-1 text-xs text-gray-400">Controls which public schedule and filtering bucket this show appears in.</p>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm text-gray-300 mb-1">Venue Section</label>
                      <input name="venue_section" value={formData.venue_section} onChange={handleChange} className="w-full rounded bg-gray-700 px-4 py-2 text-white" />
                    </div>
                  </div>
                </AdminCollapsibleSection>

                <AdminCollapsibleSection
                  id="event-editor-schedule"
                  title="Schedule / Date & Time"
                  description="Primary date, start time, and doors-open time."
                  summary={eventEditorSummaries.schedule}
                  isCollapsed={Boolean(collapsedEditorSections.schedule)}
                  onToggle={() => toggleEditorSection('schedule')}
                >
                  <div className="space-y-5">
                    <div className="rounded-xl border border-purple-500/20 bg-gray-900/40 p-4">
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={Boolean(formData.multi_day_enabled)}
                          onChange={(e) => handleMultiDayToggle(e.target.checked)}
                          className="mt-1 h-4 w-4 rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500"
                        />
                        <span>
                          <span className="block text-sm font-semibold text-white">Multi-Day Event</span>
                          <span className="mt-1 block text-xs text-gray-400">
                            Reveal multiple event dates with their own start times while keeping one shared reservation and pricing context.
                          </span>
                        </span>
                      </label>
                    </div>

                    {!formData.multi_day_enabled ? (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">Event Date*</label>
                          <input
                            type="text"
                            name="event_date"
                            value={formData.event_date}
                            onChange={handleChange}
                            onBlur={handleScheduleBlur}
                            placeholder="MM/DD/YYYY"
                            inputMode="numeric"
                            autoComplete="off"
                            aria-required={scheduleInputsRequired}
                            aria-invalid={fieldErrors.event_date ? 'true' : 'false'}
                            aria-describedby={fieldErrors.event_date ? 'event-date-error' : undefined}
                            ref={(node) => { scheduleInputRefs.current.event_date = node; }}
                            className={`w-full rounded border px-4 py-2 text-white ${
                              fieldErrors.event_date
                                ? 'border-red-500 bg-red-900/25 focus:border-red-500 focus:ring-2 focus:ring-red-500'
                                : 'border-gray-600 bg-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500'
                            }`}
                          />
                          {fieldErrors.event_date && (
                            <p id="event-date-error" className="mt-1 text-xs text-red-300">
                              {fieldErrors.event_date}
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">Event Time*</label>
                          <input
                            type="text"
                            name="event_time"
                            value={formData.event_time}
                            onChange={handleChange}
                            onBlur={handleScheduleBlur}
                            placeholder="h:mm AM/PM"
                            inputMode="text"
                            autoComplete="off"
                            aria-required={scheduleInputsRequired}
                            aria-invalid={fieldErrors.event_time ? 'true' : 'false'}
                            aria-describedby={fieldErrors.event_time ? 'event-time-error' : undefined}
                            ref={(node) => { scheduleInputRefs.current.event_time = node; }}
                            className={`w-full rounded border px-4 py-2 text-white ${
                              fieldErrors.event_time
                                ? 'border-red-500 bg-red-900/25 focus:border-red-500 focus:ring-2 focus:ring-red-500'
                                : 'border-gray-600 bg-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500'
                            }`}
                          />
                          {fieldErrors.event_time && (
                            <p id="event-time-error" className="mt-1 text-xs text-red-300">
                              {fieldErrors.event_time}
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-amber-100">Event run dates</p>
                            <p className="mt-1 text-xs text-amber-50/90">
                              Add each date and start time in this run. Customers will choose seats once and keep those seats for every date listed here.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={handleAddOccurrenceRow}
                            className="inline-flex items-center justify-center rounded bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-500"
                          >
                            Add Date
                          </button>
                        </div>
                        <div className="space-y-3">
                          {(formData.occurrence_rows || []).map((row, index) => {
                            const occurrenceErrors = fieldErrors.occurrences?.[index] || {};
                            return (
                              <div key={row.row_id} className="rounded-xl border border-gray-700 bg-gray-900/50 p-4">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                  <p className="text-sm font-semibold text-white">Occurrence {index + 1}</p>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveOccurrenceRow(index)}
                                    disabled={(formData.occurrence_rows || []).length <= 1}
                                    className="text-xs font-semibold text-red-200 hover:text-white disabled:cursor-not-allowed disabled:text-gray-500"
                                  >
                                    Remove
                                  </button>
                                </div>
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                  <div>
                                    <label className="block text-sm text-gray-300 mb-1">Date*</label>
                                    <input
                                      type="text"
                                      value={row.event_date}
                                      onChange={(e) => handleOccurrenceRowChange(index, 'event_date', e.target.value)}
                                      onBlur={() => handleOccurrenceBlur(index, 'event_date')}
                                      placeholder="MM/DD/YYYY"
                                      inputMode="numeric"
                                      autoComplete="off"
                                      aria-required={scheduleInputsRequired}
                                      aria-invalid={occurrenceErrors.event_date ? 'true' : 'false'}
                                      ref={(node) => { scheduleInputRefs.current[`occurrence_${index}_event_date`] = node; }}
                                      className={`w-full rounded border px-4 py-2 text-white ${
                                        occurrenceErrors.event_date
                                          ? 'border-red-500 bg-red-900/25 focus:border-red-500 focus:ring-2 focus:ring-red-500'
                                          : 'border-gray-600 bg-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500'
                                      }`}
                                    />
                                    {occurrenceErrors.event_date && (
                                      <p className="mt-1 text-xs text-red-300">
                                        {occurrenceErrors.event_date}
                                      </p>
                                    )}
                                  </div>
                                  <div>
                                    <label className="block text-sm text-gray-300 mb-1">Start Time*</label>
                                    <input
                                      type="text"
                                      value={row.event_time}
                                      onChange={(e) => handleOccurrenceRowChange(index, 'event_time', e.target.value)}
                                      onBlur={() => handleOccurrenceBlur(index, 'event_time')}
                                      placeholder="h:mm AM/PM"
                                      inputMode="text"
                                      autoComplete="off"
                                      aria-required={scheduleInputsRequired}
                                      aria-invalid={occurrenceErrors.event_time ? 'true' : 'false'}
                                      ref={(node) => { scheduleInputRefs.current[`occurrence_${index}_event_time`] = node; }}
                                      className={`w-full rounded border px-4 py-2 text-white ${
                                        occurrenceErrors.event_time
                                          ? 'border-red-500 bg-red-900/25 focus:border-red-500 focus:ring-2 focus:ring-red-500'
                                          : 'border-gray-600 bg-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500'
                                      }`}
                                    />
                                    {occurrenceErrors.event_time && (
                                      <p className="mt-1 text-xs text-red-300">
                                        {occurrenceErrors.event_time}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="md:col-span-2">
                      <label className="block text-sm text-gray-300 mb-1">
                        {formData.multi_day_enabled ? 'Doors Open Time (applies to each date)*' : 'Doors Open Time*'}
                      </label>
                      <input
                        type="text"
                        name="door_time"
                        value={formData.door_time}
                        onChange={handleChange}
                        onBlur={handleScheduleBlur}
                        placeholder="h:mm AM/PM"
                        inputMode="text"
                        autoComplete="off"
                        aria-required={scheduleInputsRequired}
                        aria-invalid={fieldErrors.door_time ? 'true' : 'false'}
                        aria-describedby={fieldErrors.door_time ? 'door-time-help door-time-error' : 'door-time-help'}
                        ref={(node) => { scheduleInputRefs.current.door_time = node; }}
                        className={`w-full rounded border px-4 py-2 text-white ${
                          fieldErrors.door_time
                            ? 'border-red-500 bg-red-900/25 focus:border-red-500 focus:ring-2 focus:ring-red-500'
                            : 'border-gray-600 bg-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500'
                        }`}
                      />
                      <p id="door-time-help" className="mt-1 text-xs text-gray-400">
                        {formData.multi_day_enabled
                          ? 'This shared doors-open time is applied to each configured date in the run.'
                          : 'This feeds the “Doors Open” line on the public schedule.'}
                      </p>
                      {fieldErrors.door_time && (
                        <p id="door-time-error" className="mt-1 text-xs text-red-300">
                          {fieldErrors.door_time}
                        </p>
                      )}
                    </div>
                  </div>
                </AdminCollapsibleSection>

                <AdminCollapsibleSection
                  id="event-editor-pricing"
                  title="Pricing"
                  description="Flat or tiered pricing for the event."
                  summary={eventEditorSummaries.pricing}
                  isCollapsed={Boolean(collapsedEditorSections.pricing)}
                  onToggle={() => toggleEditorSection('pricing')}
                >
                  <div className="space-y-4 rounded-xl border border-purple-500/30 bg-gray-900/50 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <label className="mb-1 block text-sm text-gray-200">Pricing</label>
                        <p className="text-xs text-gray-400">
                          Choose flat pricing for standard shows or tiered pricing for special seating-based events.
                        </p>
                      </div>
                      <div className="w-full md:w-56">
                        <label className="mb-1 block text-xs uppercase tracking-wide text-gray-400">Pricing Mode</label>
                        <select
                          value={formData.pricing_mode}
                          onChange={(e) => handlePricingModeChange(e.target.value)}
                          className="w-full rounded bg-gray-700 px-4 py-2 text-white"
                        >
                          <option value="flat">Flat pricing</option>
                          <option value="tiered">Tiered seating pricing</option>
                        </select>
                      </div>
                    </div>

                    {formData.pricing_mode === 'tiered' ? (
                      <div className="space-y-5">
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                          <p className="text-sm font-semibold text-amber-100">
                            Tiered pricing replaces the normal price display for this event.
                          </p>
                          <p className="mt-1 text-xs text-amber-50/90">
                            Assign each seat/table group to a tier. Seat colors stay reserved for availability states, so customers see pricing as a legend/list in the seating flow.
                          </p>
                          {tieredPricingPreview && (
                            <p className="mt-2 text-sm text-amber-100">Preview: {tieredPricingPreview}</p>
                          )}
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-semibold text-white">Price tiers</h3>
                              <p className="text-xs text-gray-400">Minimum 3 tiers. Add more if this event needs them.</p>
                            </div>
                            <button
                              type="button"
                              onClick={handleAddPricingTier}
                              className="inline-flex items-center justify-center rounded bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-500"
                            >
                              Add tier
                            </button>
                          </div>
                          <div className="grid gap-4 lg:grid-cols-2">
                            {(formData.pricing_tiers || []).map((tier, index) => (
                              <div key={tier.id} className="space-y-3 rounded-xl border border-gray-700 bg-gray-950/60 p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-sm font-semibold text-white">Tier {index + 1}</p>
                                  <button
                                    type="button"
                                    onClick={() => handleRemovePricingTier(tier.id)}
                                    disabled={(formData.pricing_tiers || []).length <= 3}
                                    className="text-xs font-semibold text-red-200 hover:text-white disabled:cursor-not-allowed disabled:text-gray-500"
                                  >
                                    Remove
                                  </button>
                                </div>
                                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_9rem_5rem]">
                                  <div>
                                    <label className="mb-1 block text-xs uppercase tracking-wide text-gray-400">Label</label>
                                    <input
                                      type="text"
                                      value={tier.label}
                                      onChange={(e) => handlePricingTierChange(tier.id, 'label', e.target.value)}
                                      className="w-full rounded bg-gray-700 px-4 py-2 text-white"
                                      placeholder="VIP"
                                    />
                                  </div>
                                  <div>
                                    <label className="mb-1 block text-xs uppercase tracking-wide text-gray-400">Price</label>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={tier.price}
                                      onChange={(e) => handlePricingTierChange(tier.id, 'price', e.target.value)}
                                      className="w-full rounded bg-gray-700 px-4 py-2 text-white"
                                      placeholder="25.00"
                                    />
                                  </div>
                                  <div>
                                    <label className="mb-1 block text-xs uppercase tracking-wide text-gray-400">Color</label>
                                    <input
                                      type="color"
                                      value={tier.color || DEFAULT_PRICING_TIER_COLORS[index % DEFAULT_PRICING_TIER_COLORS.length]}
                                      onChange={(e) => handlePricingTierChange(tier.id, 'color', e.target.value)}
                                      className="h-11 w-full rounded bg-gray-700 p-1"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="mb-1 block text-xs uppercase tracking-wide text-gray-400">Optional note</label>
                                  <input
                                    type="text"
                                    value={tier.note}
                                    onChange={(e) => handlePricingTierChange(tier.id, 'note', e.target.value)}
                                    className="w-full rounded bg-gray-700 px-4 py-2 text-white"
                                    placeholder="Closest to the stage"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <h3 className="text-sm font-semibold text-white">Seat/table assignments</h3>
                            <p className="text-xs text-gray-400">
                              Each interactive row or table group in the selected layout needs a tier assignment.
                            </p>
                          </div>
                          {!formData.layout_id ? (
                            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                              Choose a seating layout before enabling tiered pricing.
                            </div>
                          ) : eventPricingRowsLoading ? (
                            <div className="rounded-lg border border-gray-700 bg-gray-950/60 px-4 py-3 text-sm text-gray-300">
                              Loading this event&apos;s current seat groups…
                            </div>
                          ) : pricingAssignmentOptions.length === 0 ? (
                            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                              The selected layout has no active seat/table groups to assign.
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {pricingAssignmentOptions.map(({ rowKey, label, seatCount }) => (
                                <div key={rowKey} className="grid gap-3 rounded-lg border border-gray-700 bg-gray-950/60 p-3 md:grid-cols-[minmax(0,1fr)_16rem] md:items-center">
                                  <div>
                                    <p className="font-medium text-white">{label}</p>
                                    <p className="text-xs text-gray-400">
                                      {seatCount} {seatCount === 1 ? 'seat' : 'seats'}
                                    </p>
                                  </div>
                                  <select
                                    value={formData.pricing_assignments?.[rowKey] || ''}
                                    onChange={(e) => handlePricingAssignmentChange(rowKey, e.target.value)}
                                    className="w-full rounded bg-gray-700 px-4 py-2 text-white"
                                  >
                                    <option value="">Choose tier…</option>
                                    {(formData.pricing_tiers || []).map((tier) => (
                                      <option key={tier.id} value={tier.id}>
                                        {tier.label || 'Untitled tier'}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">Ticket Price</label>
                          <input
                            name="ticket_price"
                            value={formData.ticket_price}
                            onChange={handleChange}
                            type="number"
                            step="0.01"
                            className="w-full rounded bg-gray-700 px-4 py-2 text-white"
                            placeholder="Leave blank for free shows"
                          />
                          <p className="mt-1 text-xs text-gray-400">Leave blank if this event is free or donation-based.</p>
                        </div>

                        <div>
                          <label className="block text-sm text-gray-300 mb-1">Door Price</label>
                          <input
                            name="door_price"
                            value={formData.door_price}
                            onChange={handleChange}
                            type="number"
                            step="0.01"
                            className="w-full rounded bg-gray-700 px-4 py-2 text-white"
                            placeholder="Leave blank if no door cover"
                          />
                          <p className="mt-1 text-xs text-gray-400">If there is no separate door price, leave blank.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </AdminCollapsibleSection>

                <AdminCollapsibleSection
                  id="event-editor-seating"
                  title="Seating Configuration"
                  description="Layout binding, reservation visibility, and recovery snapshots."
                  summary={eventEditorSummaries.seating}
                  isCollapsed={Boolean(collapsedEditorSections.seating)}
                  onToggle={() => toggleEditorSection('seating')}
                >
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm text-gray-300 mb-1">Seat Reservations</label>
                      <label className="inline-flex items-center gap-2 text-gray-200">
                        <input
                          type="checkbox"
                          name="seating_enabled"
                          checked={!!formData.seating_enabled}
                          onChange={handleChange}
                          className="h-4 w-4 rounded border-gray-600"
                        />
                        <span>{formData.seating_enabled ? 'Enabled' : 'Disabled'}</span>
                      </label>
                      <p className="mt-1 text-xs text-gray-400">
                        Toggle to hide or show seating UI without losing layouts or reservations.
                      </p>
                    </div>

                    {editorFlags.showSeatingPanel ? (
                      <div>
                        <label className="block text-sm text-gray-300 mb-1">Seating Layout</label>
                        <select name="layout_id" value={formData.layout_id} onChange={handleChange} className="w-full rounded bg-gray-700 px-4 py-2 text-white">
                          <option value="">None (No seat reservations)</option>
                          {layouts.map((layout) => (
                            <option key={layout.id} value={layout.id}>
                              {layout.name} {layout.is_default === 1 ? '(Default)' : ''}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-400">
                          Select a layout or leave as None. Changing layouts will prompt a confirmation and creates a recovery snapshot.
                        </p>
                        {editing && (formData.layout_id || editing.layout_id) && (
                          <div className="mt-3 space-y-2">
                            <button
                              type="button"
                              onClick={refreshLayoutSnapshot}
                              disabled={refreshingLayout}
                              className="inline-flex items-center justify-center rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {refreshingLayout ? 'Refreshing layout…' : 'Apply latest layout template'}
                            </button>
                            <p className="text-xs text-gray-400">
                              Use this after editing the layout template so the public seating chart stays in sync.
                            </p>
                            {refreshLayoutMessage && <p className="text-xs text-green-400">{refreshLayoutMessage}</p>}
                            {refreshLayoutError && <p className="text-xs text-red-400">{refreshLayoutError}</p>}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-gray-700 bg-gray-900/40 p-4 text-sm text-gray-300">
                        Enable seat reservations to pick a layout and manage seating snapshots for this event.
                      </div>
                    )}

                    {editorFlags.showSeatingPanel && editing && (
                      <div className="md:col-span-2 space-y-3 rounded-2xl border border-gray-700 bg-gray-900/40 p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <h3 className="text-base font-semibold text-white">Seating Snapshots</h3>
                            <p className="text-xs text-gray-400">
                              Latest recovery checkpoints captured before layout changes.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => fetchSeatingSnapshots(editing.id)}
                            disabled={seatingSnapshotsState.loading}
                            className="inline-flex items-center justify-center rounded bg-gray-700 px-3 py-1 text-xs font-semibold text-white hover:bg-gray-600 disabled:opacity-50"
                          >
                            {seatingSnapshotsState.loading ? 'Loading…' : 'Refresh'}
                          </button>
                        </div>
                        {seatingSnapshotsState.error && (
                          <p className="text-xs text-red-400">{seatingSnapshotsState.error}</p>
                        )}
                        {snapshotCopyMessage && (
                          <p className="text-xs text-emerald-300">{snapshotCopyMessage}</p>
                        )}
                        {snapshotRestoreState.error && (
                          <p className="text-xs text-red-400">{snapshotRestoreState.error}</p>
                        )}
                        {snapshotRestoreState.message && (
                          <div
                            className={`rounded px-3 py-2 text-sm ${
                              snapshotRestoreState.conflicts.length > 0
                                ? 'border border-amber-500 bg-amber-900/20 text-amber-100'
                                : 'border border-emerald-600 bg-emerald-900/20 text-emerald-100'
                            }`}
                          >
                            <p>{snapshotRestoreState.message}</p>
                            {snapshotRestoreState.conflicts.length > 0 && (
                              <div className="mt-2">
                                <p className="text-xs font-semibold">Conflicts to follow up:</p>
                                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
                                  {snapshotRestoreState.conflicts.map((conflict, idx) => (
                                    <li key={conflict.seat || conflict.type || idx}>{describeSnapshotConflict(conflict)}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                        {seatingSnapshotsState.loading ? (
                          <p className="text-sm text-gray-400">Loading snapshots…</p>
                        ) : seatingSnapshotsState.items.length === 0 ? (
                          <p className="text-sm text-gray-400">
                            No snapshots yet. A recovery snapshot is saved automatically before each layout change.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {seatingSnapshotsState.items.map((snapshot) => (
                              <div key={snapshot.id} className="flex flex-col gap-2 rounded border border-gray-700 px-3 py-2 md:flex-row md:items-center md:justify-between">
                                <div>
                                  <p className="text-sm font-semibold text-white">Snapshot #{snapshot.id}</p>
                                  <p className="text-xs text-gray-400">
                                    {formatSnapshotTimestamp(snapshot.created_at)} · {snapshot.snapshot_type?.replace(/_/g, ' ')}
                                  </p>
                                  <p className="text-xs text-gray-400">
                                    Reserved: {snapshot.reserved_seats?.length || 0} · Pending: {snapshot.pending_seats?.length || 0} · Holds: {snapshot.hold_seats?.length || 0}
                                  </p>
                                </div>
                                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                                  <button
                                    type="button"
                                    onClick={() => openSnapshotPreview(snapshot)}
                                    className="inline-flex items-center justify-center rounded bg-gray-600 px-3 py-1 text-xs font-semibold text-white hover:bg-gray-500"
                                    aria-label={`Preview snapshot ${snapshot.id}`}
                                  >
                                    Preview
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => copySnapshotPayload(snapshot)}
                                    className="inline-flex items-center justify-center rounded bg-purple-600 px-3 py-1 text-xs font-semibold text-white hover:bg-purple-500"
                                    aria-label={`Copy snapshot ${snapshot.id} JSON`}
                                  >
                                    Copy JSON
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRestoreSnapshot(snapshot)}
                                    disabled={snapshotRestoreState.restoringId === snapshot.id}
                                    className="inline-flex items-center justify-center rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {snapshotRestoreState.restoringId === snapshot.id ? 'Restoring…' : 'Restore layout & seats'}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </AdminCollapsibleSection>

                <AdminCollapsibleSection
                  id="event-editor-payment"
                  title="Payment Settings"
                  description="Category or global payment-link configuration for this event."
                  summary={eventEditorSummaries.payment}
                  isCollapsed={Boolean(collapsedEditorSections.payment)}
                  onToggle={() => toggleEditorSection('payment')}
                >
                  {paymentSettingsAvailable ? (
                    <div className="space-y-3 rounded-2xl border border-indigo-700/40 bg-indigo-950/20 p-4">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-white">Payment Link</h3>
                          <p className="text-sm text-gray-400">
                            {activePaymentConfig
                              ? `Uses the ${activePaymentConfig.provider_label || 'custom'} payment link saved in Payment Settings.`
                              : 'No payment configuration detected for this category.'}
                          </p>
                        </div>
                        <label className="inline-flex items-center gap-2 text-sm text-gray-200">
                          <input
                            type="checkbox"
                            name="payment_enabled"
                            checked={!!formData.payment_enabled}
                            onChange={handleChange}
                            disabled={!activePaymentConfig}
                            className="h-4 w-4 rounded bg-gray-700"
                          />
                          <span>Enable for this event</span>
                        </label>
                      </div>
                      {paymentSettingsError && (
                        <p className="text-xs text-red-400">{paymentSettingsError}</p>
                      )}
                      {activePaymentConfig ? (
                        <div className="grid grid-cols-1 gap-3 text-sm text-gray-300 md:grid-cols-2">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-gray-400">Provider</p>
                            <p className="font-medium text-white">{activePaymentConfig.provider_label || 'Custom link'}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-gray-400">Type</p>
                            <p className="font-medium text-white">
                              {activePaymentConfig.provider_type === 'paypal_hosted_button'
                                ? 'PayPal hosted button'
                                : activePaymentConfig.provider_type === 'paypal_orders'
                                  ? 'PayPal Orders (scaffold)'
                                  : 'External link'}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-gray-400">Seat limit</p>
                            <p className="font-medium text-white">{activePaymentConfig.limit_seats} seats</p>
                          </div>
                          <div className="md:col-span-2">
                            <p className="text-xs uppercase tracking-wide text-gray-400">Button text</p>
                            <p className="font-medium text-white">{activePaymentConfig.button_text}</p>
                          </div>
                          {activePaymentConfig.provider_type === 'paypal_hosted_button' ? (
                            <>
                              <div>
                                <p className="text-xs uppercase tracking-wide text-gray-400">Hosted button ID</p>
                                <p className="font-medium text-white">{activePaymentConfig.paypal_hosted_button_id || 'Not set'}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-wide text-gray-400">Currency</p>
                                <p className="font-medium text-white">{activePaymentConfig.paypal_currency || 'USD'}</p>
                              </div>
                            </>
                          ) : activePaymentConfig.provider_type === 'paypal_orders' ? (
                            <div className="md:col-span-2">
                              <p className="text-xs uppercase tracking-wide text-gray-400">Orders scaffold</p>
                              <p className="text-white">Dynamic amount capture is planned but not enabled in production yet.</p>
                            </div>
                          ) : (
                            <div className="md:col-span-2">
                              <p className="text-xs uppercase tracking-wide text-gray-400">Payment URL</p>
                              <p className="break-all font-mono text-white">{activePaymentConfig.payment_url || 'Not set'}</p>
                            </div>
                          )}
                          {activePaymentConfig.over_limit_message && (
                            <div className="md:col-span-2">
                              <p className="text-xs uppercase tracking-wide text-gray-400">Over-limit message</p>
                              <p className="text-white">{activePaymentConfig.over_limit_message}</p>
                            </div>
                          )}
                          {activePaymentConfig.fine_print && (
                            <div className="md:col-span-2">
                              <p className="text-xs uppercase tracking-wide text-gray-400">Fine print</p>
                              <p className="text-white">{activePaymentConfig.fine_print}</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400">
                          Configure payment links under <span className="font-semibold text-white">Payment Settings</span> to make this option available.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-amber-600/40 bg-amber-950/20 p-4 text-sm text-amber-100">
                      Payment links are unavailable until the Payment Settings migration runs.
                    </div>
                  )}
                </AdminCollapsibleSection>

                <AdminCollapsibleSection
                  id="event-editor-advanced"
                  title="Routing & Advanced"
                  description="Seat request routing and any category-specific admin notes."
                  summary={eventEditorSummaries.advanced}
                  isCollapsed={Boolean(collapsedEditorSections.advanced)}
                  onToggle={() => toggleEditorSection('advanced')}
                >
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-gray-300 mb-1">Seat request email (optional)</label>
                      <input
                        type="text"
                        inputMode="email"
                        autoComplete="email"
                        name="seat_request_email_override"
                        value={formData.seat_request_email_override}
                        onChange={handleChange}
                        aria-invalid={fieldErrors.seat_request_email_override ? 'true' : 'false'}
                        aria-describedby={fieldErrors.seat_request_email_override ? 'seat-request-email-error' : undefined}
                        className={`w-full rounded border px-4 py-2 text-white ${
                          fieldErrors.seat_request_email_override
                            ? 'border-red-500 bg-red-900/25 focus:border-red-500 focus:ring-2 focus:ring-red-500'
                            : 'border-gray-600 bg-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500'
                        }`}
                        placeholder="Leave blank for default routing"
                      />
                      <p className="mt-1 text-xs text-gray-400">
                        {editingSeatRouting
                          ? `Currently routed to ${editingSeatRouting.email} (${editingSeatRouting.label}).`
                          : 'Leave blank to use the Beach Bands inbox for beach shows or the main staff inbox for everything else.'}
                      </p>
                      {fieldErrors.seat_request_email_override && (
                        <p id="seat-request-email-error" className="mt-1 text-xs text-red-300">
                          {fieldErrors.seat_request_email_override}
                        </p>
                      )}
                    </div>

                    {editorFlags.showRecurringPanel ? (
                      <div className="space-y-4 rounded-2xl border border-blue-700/40 bg-blue-950/20 p-4">
                        <div>
                          <h3 className="text-lg font-semibold text-white">Recurring Series Details</h3>
                          <p className="text-sm text-gray-400">Customize the public copy for this series. These fields power the Recurring Events grid on the home page.</p>
                        </div>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <label className="block text-sm text-gray-300 mb-1">Typical schedule label</label>
                            <input
                              name="series_schedule_label"
                              value={formData.series_schedule_label}
                              onChange={handleChange}
                              className="w-full rounded bg-gray-800 px-4 py-2 text-white"
                              placeholder="e.g., Thursdays · 6:00 – 10:00 PM"
                            />
                            <p className="mt-1 text-xs text-gray-400">Shown beneath the “Typical schedule” heading.</p>
                          </div>
                          <div>
                            <label className="block text-sm text-gray-300 mb-1">Highlight summary</label>
                            <textarea
                              name="series_summary"
                              value={formData.series_summary}
                              onChange={handleChange}
                              rows="3"
                              className="w-full rounded bg-gray-800 px-4 py-2 text-white"
                              placeholder="One-line overview that appears near the title."
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">Footer note</label>
                          <textarea
                            name="series_footer_note"
                            value={formData.series_footer_note}
                            onChange={handleChange}
                            rows="2"
                            className="w-full rounded bg-gray-800 px-4 py-2 text-white"
                            placeholder="Optional line that shows at the bottom of the recurring card (e.g., Weekly classic car cruise in)."
                          />
                        </div>
                      </div>
                    ) : null}

                    {editorFlags.showBeachBandsPanel && (
                      <div className="space-y-3 rounded-2xl border border-cyan-600/40 bg-cyan-950/20 p-4">
                        <div>
                          <h3 className="text-lg font-semibold text-white">Beach Bands notes</h3>
                          <p className="text-sm text-gray-300">
                            Beach Bands shows use special routing and promo copy. Double-check pricing, sponsor copy, and imagery before publishing.
                          </p>
                          <p className="mt-1 text-xs text-gray-400">
                            Future Beach Bands-only settings will live here so staff always knows why this section is visible.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </AdminCollapsibleSection>

                <AdminCollapsibleSection
                  id="event-editor-contact"
                  title="Event Contact"
                  description="Public contact details used across schedule, seating, and category-specific surfaces."
                  summary={eventEditorSummaries.contact}
                  isCollapsed={Boolean(collapsedEditorSections.contact)}
                  onToggle={() => toggleEditorSection('contact')}
                >
                  <div className="space-y-4 rounded-2xl border border-gray-700 bg-gray-900/40 p-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-sm text-gray-300 mb-1">Contact Name</label>
                        <input
                          name="contact_name"
                          value={formData.contact_name}
                          onChange={handleChange}
                          className="w-full rounded bg-gray-700 px-4 py-2 text-white"
                          placeholder="Donna Cheek"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-300 mb-1">Contact Phone</label>
                        <input
                          type="tel"
                          name="contact_phone_raw"
                          value={formData.contact_phone_raw}
                          onChange={handleChange}
                          className="w-full rounded bg-gray-700 px-4 py-2 text-white"
                          placeholder="336-793-4218"
                        />
                        <p className="mt-1 text-xs text-gray-400">
                          Used for seat confirmations and Beach Bands price inquiries.
                        </p>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm text-gray-300 mb-1">Contact Email</label>
                        <input
                          type="text"
                          inputMode="email"
                          autoComplete="email"
                          name="contact_email"
                          value={formData.contact_email}
                          onChange={handleChange}
                          aria-invalid={fieldErrors.contact_email ? 'true' : 'false'}
                          aria-describedby={fieldErrors.contact_email ? 'contact-email-error' : undefined}
                          className={`w-full rounded border px-4 py-2 text-white ${
                            fieldErrors.contact_email
                              ? 'border-red-500 bg-red-900/25 focus:border-red-500 focus:ring-2 focus:ring-red-500'
                              : 'border-gray-600 bg-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500'
                          }`}
                          placeholder="events@midwaymusichall.net"
                        />
                        {fieldErrors.contact_email && (
                          <p id="contact-email-error" className="mt-1 text-xs text-red-300">
                            {fieldErrors.contact_email}
                          </p>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-300 mb-1">Contact Notes (optional)</label>
                      <textarea
                        name="contact_notes"
                        value={formData.contact_notes}
                        onChange={handleChange}
                        rows="3"
                        className="w-full rounded bg-gray-700 px-4 py-2 text-white"
                        placeholder="Add call hours, text instructions, or seat request guidance."
                      />
                    </div>
                  </div>
                </AdminCollapsibleSection>

                <AdminCollapsibleSection
                  id="event-editor-media"
                  title="Event Media & Description"
                  description="Poster image, uploads, and public event copy."
                  summary={eventEditorSummaries.media}
                  isCollapsed={Boolean(collapsedEditorSections.media)}
                  onToggle={() => toggleEditorSection('media')}
                >
                  <div className="space-y-4">
                    <div>
                      <label className="mb-2 block text-sm text-gray-300">Event Image</label>
                      <div className="space-y-3">
                        {(imagePreview || formData.image_url) && (
                          <div className="relative inline-block">
                            <ResponsiveImage
                              src={imagePreview || getImageUrlSync(formData.image_url)}
                              alt="Event preview"
                              width={256}
                              height={256}
                              className="h-32 w-32 rounded-lg border-2 border-gray-600 object-cover"
                            />
                            <button
                              type="button"
                              onClick={clearImage}
                              className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white hover:bg-red-700"
                            >
                              ✕
                            </button>
                          </div>
                        )}

                        <div>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleImageChange}
                            className="block w-full cursor-pointer text-sm text-gray-300 file:mr-4 file:cursor-pointer file:rounded file:border-0 file:bg-purple-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-purple-700"
                          />
                          <p className="mt-1 text-xs text-gray-400">Upload a custom image or leave empty to use the default logo</p>
                        </div>

                        <div>
                          <label className="mb-1 block text-xs text-gray-400">Or enter image URL:</label>
                          <input
                            name="image_url"
                            value={formData.image_url}
                            onChange={handleChange}
                            className="w-full rounded bg-gray-700 px-3 py-2 text-sm text-white"
                            placeholder="https://example.com/image.jpg"
                          />
                        </div>
                      </div>

                      {(imageUploading || imageUploadProcessing) && (
                        <div className="mt-3 space-y-2" aria-live="polite">
                          {imageUploading && (
                            <>
                              <div className="flex justify-between text-xs text-gray-300">
                                <span>Uploading image</span>
                                <span>{imageUploadProgress}%</span>
                              </div>
                              <div
                                className="h-2 w-full rounded-full bg-gray-600"
                                role="progressbar"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={imageUploadProgress}
                              >
                                <div
                                  className="h-2 rounded-full bg-purple-500 transition-all"
                                  style={{ width: `${imageUploadProgress}%` }}
                                />
                              </div>
                            </>
                          )}
                          {imageUploadProcessing && (
                            <div className="flex items-center gap-2 text-xs text-gray-200">
                              <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />
                              <span>Processing images…</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm text-gray-300 mb-1">Description</label>
                      <textarea name="description" value={formData.description} onChange={handleChange} rows="4" className="w-full rounded bg-gray-700 px-4 py-2 text-white" />
                    </div>
                  </div>
                </AdminCollapsibleSection>
              </div>

              <AdminStickyActionBar
                primaryLabel={editing ? 'Save Event' : 'Create Event'}
                savingLabel="Saving..."
                isSaving={submitting}
                primaryDisabled={submitting}
                onCancel={() => setShowForm(false)}
                message={error || 'Save stays visible while you move through the editor.'}
                tone={error ? 'danger' : 'muted'}
              />
            </form>
          </div>
        </div>
        {layoutConfirmState.open && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
            <div className="bg-gray-800 rounded-xl max-w-lg w-full p-6 border border-amber-500/40 shadow-xl">
              <h3 className="text-lg font-semibold text-white mb-2">Change seating layout?</h3>
              <p className="text-sm text-gray-300">
                Existing seat requests and holds are preserved, but they may no longer align with the new seating map. A
                recovery snapshot will be saved automatically before this change is applied.
              </p>
              <ul className="mt-3 text-xs text-gray-400 list-disc list-inside space-y-1">
                <li>Nothing is deleted automatically.</li>
                <li>You can copy the reserved seat list from the snapshots panel at any time.</li>
              </ul>
              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={cancelLayoutChange}
                  className="px-4 py-2 rounded bg-gray-700 text-white hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmLayoutChange}
                  className="px-4 py-2 rounded bg-amber-600 text-white hover:bg-amber-500"
                >
                  Confirm change
                </button>
              </div>
            </div>
          </div>
        )}
        {snapshotPreviewState.open && snapshotPreviewState.snapshot && (
          <div
            className="fixed inset-0 z-[65] flex items-center justify-center bg-black/80 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="snapshot-preview-heading"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeSnapshotPreview();
              }
            }}
          >
            <div
              ref={previewModalRef}
              className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-purple-500/40 bg-gray-900 p-6 shadow-2xl"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 id="snapshot-preview-heading" className="text-xl font-semibold text-white">
                    Snapshot #{snapshotPreviewState.snapshot.id}
                  </h3>
                  <p className="text-xs text-gray-400 mt-1">
                    Preview does not change anything. Restore Seating applies this snapshot.
                  </p>
                </div>
                <button
                  ref={previewCloseButtonRef}
                  type="button"
                  onClick={closeSnapshotPreview}
                  className="inline-flex items-center justify-center rounded bg-gray-700 px-3 py-1 text-sm font-semibold text-white hover:bg-gray-600"
                  aria-label="Close snapshot preview"
                >
                  Close
                </button>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 text-sm text-gray-200 md:grid-cols-2">
                <div>
                  <span className="text-gray-400 block text-xs uppercase">Created at</span>
                  <p>{formatSnapshotTimestamp(snapshotPreviewState.snapshot.created_at)}</p>
                </div>
                <div>
                  <span className="text-gray-400 block text-xs uppercase">Created by</span>
                  <p>{snapshotPreviewState.snapshot.created_by || 'Unknown'}</p>
                </div>
                <div>
                  <span className="text-gray-400 block text-xs uppercase">Snapshot type</span>
                  <p className="capitalize">{(snapshotPreviewState.snapshot.snapshot_type || 'n/a').replace(/_/g, ' ')}</p>
                </div>
                {snapshotPreviewState.snapshot.notes && (
                  <div className="md:col-span-2">
                    <span className="text-gray-400 block text-xs uppercase">Notes</span>
                    <p>{snapshotPreviewState.snapshot.notes}</p>
                  </div>
                )}
              </div>
              <div className="mt-4">
                <label htmlFor="snapshot-seat-filter" className="block text-sm text-gray-300 mb-1">
                  Seat search/filter
                </label>
                <input
                  id="snapshot-seat-filter"
                  type="text"
                  value={snapshotPreviewState.seatFilter}
                  onChange={(event) =>
                    setSnapshotPreviewState((prev) => ({ ...prev, seatFilter: event.target.value }))
                  }
                  placeholder="Search for a seat id (e.g., Table-1)"
                  className="w-full rounded bg-gray-800 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  aria-label="Filter seats within this snapshot"
                />
                <p className="text-xs text-gray-500 mt-1">Filters reserved, pending, and hold lists below.</p>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                {renderSeatListBlock('Reserved seats', snapshotPreviewLists?.reserved)}
                {renderSeatListBlock('Pending seats', snapshotPreviewLists?.pending)}
                {renderSeatListBlock('Hold seats', snapshotPreviewLists?.hold)}
              </div>
              <div className="mt-5 rounded-2xl border border-gray-700 bg-gray-900/50 p-4 space-y-3">
                <div>
                  <h4 className="text-base font-semibold text-white">Compare to current seating</h4>
                  <p className="text-xs text-gray-400">Highlights differences between this snapshot and the latest saved seat requests.</p>
                </div>
                {snapshotComparison?.available ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {renderComparisonBlock('Reserved seats', snapshotComparison.reserved)}
                    {renderComparisonBlock('Pending seats', snapshotComparison.pending)}
                    {renderComparisonBlock('Hold seats', snapshotComparison.hold)}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">
                    Current seating data isn’t available right now. Preview shows snapshot contents only.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
        </>
      )}
    </div>
  );
}
 
