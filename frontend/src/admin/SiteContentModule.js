import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../apiConfig';
import { invalidateSiteContentCache } from '../hooks/useSiteContent';
import AdminCollapsibleSection from './AdminCollapsibleSection';
import AdminStickyActionBar from './AdminStickyActionBar';
import useCollapsibleSections from './useCollapsibleSections';

const SITE_CONTENT_SECTION_STORAGE_KEY = 'mmh_site_content_editor_sections';

const emptyContact = () => ({
  name: '',
  title: '',
  phone: '',
  email: '',
  notes: '',
});

const emptyLesson = () => ({
  id: '',
  title: '',
  schedule: '',
  price: '',
  instructor: '',
  phone: '',
  description: '',
});

const emptyAnnouncement = () => ({
  enabled: false,
  message: '',
  label: '',
  link_url: '',
  link_text: '',
  severity: 'info',
});

const emptyReservationBanner = () => ({
  enabled: false,
  message: '',
  label: '',
  link_url: '',
  link_text: '',
  severity: 'info',
});

const emptyAnnouncementPopup = () => ({
  enabled: false,
  message: '',
  link_url: '',
  link_text: '',
  severity: 'info',
  allow_during_seat_selection: false,
});

const parseJsonSetting = (value, fallback) => {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (err) {
    return fallback;
  }
};

const parseAnnouncementSetting = (value) => {
  if (!value) return emptyAnnouncement();
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') {
      return emptyAnnouncement();
    }
    return {
      ...emptyAnnouncement(),
      ...parsed,
      enabled: Boolean(parsed.enabled),
      severity: ['info', 'warning', 'urgent'].includes(parsed.severity) ? parsed.severity : 'info',
    };
  } catch (err) {
    return emptyAnnouncement();
  }
};

const parseReservationBannerSetting = (value) => {
  if (!value) return emptyReservationBanner();
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') {
      return emptyReservationBanner();
    }
    return {
      ...emptyReservationBanner(),
      ...parsed,
      enabled: Boolean(parsed.enabled),
      severity: ['info', 'warning', 'urgent'].includes(parsed.severity) ? parsed.severity : 'info',
    };
  } catch (err) {
    return emptyReservationBanner();
  }
};

const parseAnnouncementPopupSetting = (value) => {
  if (!value) return emptyAnnouncementPopup();
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') {
      return emptyAnnouncementPopup();
    }
    return {
      ...emptyAnnouncementPopup(),
      ...parsed,
      enabled: Boolean(parsed.enabled),
      severity: ['info', 'warning', 'urgent'].includes(parsed.severity) ? parsed.severity : 'info',
      allow_during_seat_selection: Boolean(parsed.allow_during_seat_selection),
    };
  } catch (err) {
    return emptyAnnouncementPopup();
  }
};

const countFilledItems = (items = [], fields = []) => items.filter((item) => (
  fields.some((field) => String(item?.[field] || '').trim() !== '')
)).length;

export default function SiteContentModule() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [form, setForm] = useState({
    business_name: '',
    business_address: '',
    business_phone: '',
    business_email: '',
    map_address_label: '',
    map_subtext: '',
    map_embed_url: '',
    box_office_note: '',
    policy_family_text: '',
    policy_refund_text: '',
    policy_additional_text: '',
    facebook_url: '',
    instagram_url: '',
    twitter_url: '',
    google_review_url: '',
  });
  const [contacts, setContacts] = useState([emptyContact()]);
  const [lessons, setLessons] = useState([emptyLesson()]);
  const [announcement, setAnnouncement] = useState(emptyAnnouncement());
  const [reservationBanner, setReservationBanner] = useState(emptyReservationBanner());
  const [announcementPopup, setAnnouncementPopup] = useState(emptyAnnouncementPopup());
  const sectionIds = useMemo(() => ([
    'venue-basics',
    'announcement-banner',
    'reservation-banner',
    'announcement-popup',
    'contacts',
    'policies',
    'social-links',
    'lessons',
  ]), []);
  const sectionDefaults = useMemo(() => ({
    'venue-basics': false,
    'announcement-banner': true,
    'reservation-banner': true,
    'announcement-popup': true,
    contacts: true,
    policies: true,
    'social-links': true,
    lessons: true,
  }), []);
  const {
    collapsedSections,
    toggleSection,
    setSectionsState,
  } = useCollapsibleSections(SITE_CONTENT_SECTION_STORAGE_KEY, sectionDefaults);

  const loadSettings = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/settings`);
      const data = await res.json();
      if (data?.success && data.settings) {
        const settings = data.settings;
        setForm((prev) => ({
          ...prev,
          business_name: settings.business_name || '',
          business_address: settings.business_address || '',
          business_phone: settings.business_phone || '',
          business_email: settings.business_email || '',
          map_address_label: settings.map_address_label || '',
          map_subtext: settings.map_subtext || '',
          map_embed_url: settings.map_embed_url || '',
          box_office_note: settings.box_office_note || '',
          policy_family_text: settings.policy_family_text || '',
          policy_refund_text: settings.policy_refund_text || '',
          policy_additional_text: settings.policy_additional_text || '',
          facebook_url: settings.facebook_url || '',
          instagram_url: settings.instagram_url || '',
          twitter_url: settings.twitter_url || '',
          google_review_url: settings.google_review_url || '',
        }));
        const parsedContacts = parseJsonSetting(settings.site_contacts_json, []);
        setContacts(parsedContacts.length ? parsedContacts : [emptyContact()]);
        const parsedLessons = parseJsonSetting(settings.lessons_json, []);
        setLessons(parsedLessons.length ? parsedLessons : [emptyLesson()]);
        setAnnouncement(parseAnnouncementSetting(settings.announcement_banner));
        setReservationBanner(parseReservationBannerSetting(settings.reservation_banner));
        setAnnouncementPopup(parseAnnouncementPopupSetting(settings.announcement_popup));
      } else {
        setError('Unable to load site content settings.');
      }
    } catch (err) {
      console.error('Failed to load site content settings', err);
      setError('Unable to load site content settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleFieldChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const updateContact = (index, field, value) => {
    setContacts((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addContact = () => setContacts((prev) => [...prev, emptyContact()]);
  const removeContact = (index) => {
    setContacts((prev) => prev.filter((_, idx) => idx !== index));
  };

  const updateLesson = (index, field, value) => {
    setLessons((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };
  const addLesson = () => setLessons((prev) => [...prev, emptyLesson()]);
  const removeLesson = (index) => {
    setLessons((prev) => prev.filter((_, idx) => idx !== index));
  };
  const updateAnnouncementField = (field, value) => {
    setAnnouncement((prev) => ({ ...prev, [field]: value }));
  };
  const updateReservationBannerField = (field, value) => {
    setReservationBanner((prev) => ({ ...prev, [field]: value }));
  };
  const updateAnnouncementPopupField = (field, value) => {
    setAnnouncementPopup((prev) => ({ ...prev, [field]: value }));
  };

  const sectionSummaries = useMemo(() => {
    const publicLinksCount = ['facebook_url', 'instagram_url', 'twitter_url', 'google_review_url']
      .filter((field) => String(form[field] || '').trim() !== '')
      .length;
    const contactCount = countFilledItems(contacts, ['name', 'phone', 'email']);
    const lessonCount = countFilledItems(lessons, ['title', 'schedule', 'price']);
    return {
      'venue-basics': [
        form.business_name || 'Venue name missing',
        form.business_phone || form.business_email || 'No public contact set',
      ].filter(Boolean).join(' • '),
      'announcement-banner': announcement.enabled
        ? `${announcement.severity} banner • ${announcement.message || 'Message ready'}`
        : 'Disabled',
      'reservation-banner': reservationBanner.enabled
        ? `${reservationBanner.severity} banner • ${reservationBanner.message || 'Message ready'}`
        : 'Disabled',
      'announcement-popup': announcementPopup.enabled
        ? `${announcementPopup.severity} popup • ${announcementPopup.allow_during_seat_selection ? 'Shows during seat selection' : 'Hidden during seat selection'}`
        : 'Disabled',
      contacts: `${contactCount} contact card${contactCount === 1 ? '' : 's'} configured`,
      policies: [
        form.policy_family_text ? 'Family reminder' : null,
        form.policy_refund_text ? 'Refund policy' : null,
        form.policy_additional_text ? 'Additional notes' : null,
      ].filter(Boolean).join(' • ') || 'No policy copy added',
      'social-links': `${publicLinksCount} public link${publicLinksCount === 1 ? '' : 's'} set`,
      lessons: `${lessonCount} lesson block${lessonCount === 1 ? '' : 's'} configured`,
    };
  }, [announcement, announcementPopup, contacts, form, lessons, reservationBanner]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setStatus('');
    const sanitizedContacts = contacts
      .map((contact) => ({
        ...contact,
        name: contact.name.trim(),
        title: contact.title.trim(),
        phone: contact.phone.trim(),
        email: contact.email.trim(),
        notes: contact.notes.trim(),
      }))
      .filter((contact) => contact.name || contact.email || contact.phone);
    const sanitizedLessons = lessons
      .map((lesson) => ({
        ...lesson,
        id: (lesson.id || lesson.title || '').toString().trim() || '',
        title: lesson.title.trim(),
        schedule: lesson.schedule.trim(),
        price: lesson.price.trim(),
        instructor: lesson.instructor.trim(),
        phone: lesson.phone.trim(),
        description: lesson.description.trim(),
      }))
      .filter((lesson) => lesson.title);
    const cleanedAnnouncement = {
      enabled: Boolean(announcement.enabled),
      message: announcement.message.trim(),
      label: announcement.label.trim(),
      link_url: announcement.link_url.trim(),
      link_text: announcement.link_text.trim(),
      severity: ['info', 'warning', 'urgent'].includes(announcement.severity) ? announcement.severity : 'info',
    };
    const cleanedReservationBanner = {
      enabled: Boolean(reservationBanner.enabled),
      message: reservationBanner.message.trim(),
      label: reservationBanner.label.trim(),
      link_url: reservationBanner.link_url.trim(),
      link_text: reservationBanner.link_text.trim(),
      severity: ['info', 'warning', 'urgent'].includes(reservationBanner.severity) ? reservationBanner.severity : 'info',
    };
    const cleanedAnnouncementPopup = {
      enabled: Boolean(announcementPopup.enabled),
      message: announcementPopup.message.trim(),
      link_url: announcementPopup.link_url.trim(),
      link_text: announcementPopup.link_text.trim(),
      severity: ['info', 'warning', 'urgent'].includes(announcementPopup.severity) ? announcementPopup.severity : 'info',
      allow_during_seat_selection: Boolean(announcementPopup.allow_during_seat_selection),
    };
    if (cleanedAnnouncement.enabled && !cleanedAnnouncement.message) {
      setError('Announcement message is required when enabled.');
      setSaving(false);
      return;
    }
    if (!cleanedAnnouncement.link_url || !cleanedAnnouncement.link_text) {
      cleanedAnnouncement.link_url = '';
      cleanedAnnouncement.link_text = '';
    }
    if (cleanedReservationBanner.enabled && !cleanedReservationBanner.message) {
      setError('Reservation banner message is required when enabled.');
      setSaving(false);
      return;
    }
    if (!cleanedReservationBanner.link_url || !cleanedReservationBanner.link_text) {
      cleanedReservationBanner.link_url = '';
      cleanedReservationBanner.link_text = '';
    }
    if (cleanedAnnouncementPopup.enabled && !cleanedAnnouncementPopup.message) {
      setError('Announcement popup message is required when enabled.');
      setSaving(false);
      return;
    }
    if (!cleanedAnnouncementPopup.link_url || !cleanedAnnouncementPopup.link_text) {
      cleanedAnnouncementPopup.link_url = '';
      cleanedAnnouncementPopup.link_text = '';
    }
    const payload = {
      ...form,
      site_contacts_json: JSON.stringify(sanitizedContacts),
      lessons_json: JSON.stringify(sanitizedLessons),
      announcement_banner: JSON.stringify(cleanedAnnouncement),
      reservation_banner: JSON.stringify(cleanedReservationBanner),
      announcement_popup: JSON.stringify(cleanedAnnouncementPopup),
    };
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data?.success) {
        setStatus('Site content saved successfully.');
        invalidateSiteContentCache();
        loadSettings();
      } else {
        setError(data?.message || 'Failed to save site content.');
      }
    } catch (err) {
      console.error('Failed to save site content', err);
      setError('Failed to save site content.');
    } finally {
      setSaving(false);
      setTimeout(() => setStatus(''), 4000);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Site Content</h1>
          <p className="text-sm text-gray-400">Update contact info, policies, lessons, and map details shown on the public site.</p>
        </div>
        <button
          type="button"
          onClick={loadSettings}
          className="px-3 py-2 rounded bg-gray-800 text-gray-100 border border-gray-600 hover:bg-gray-700 text-sm"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-600/10 border border-red-600 text-red-400 rounded">
          {error}
        </div>
      )}
      {status && (
        <div className="mb-4 p-3 bg-emerald-600/10 border border-emerald-600 text-emerald-300 rounded">
          {status}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-5 pb-4">
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setSectionsState(sectionIds, false)}
              className="rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600"
            >
              Expand All
            </button>
            <button
              type="button"
              onClick={() => setSectionsState(sectionIds, true)}
              className="rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600"
            >
              Collapse All
            </button>
          </div>

          <AdminCollapsibleSection
            id="site-content-venue-basics"
            title="Venue Basics & Map"
            description="Shown in the footer, About section, and map block."
            summary={sectionSummaries['venue-basics']}
            isCollapsed={Boolean(collapsedSections['venue-basics'])}
            onToggle={() => toggleSection('venue-basics')}
          >
            <div className="sr-only">
              <h2 className="text-xl font-semibold text-white">Venue Basics & Map</h2>
              <p className="text-sm text-gray-400">Shown in the footer, About section, and map block.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Venue name</label>
                <input name="business_name" value={form.business_name} onChange={handleFieldChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Public phone number</label>
                <input name="business_phone" value={form.business_phone} onChange={handleFieldChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Public email address</label>
                <input name="business_email" value={form.business_email} onChange={handleFieldChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Street address</label>
                <input name="business_address" value={form.business_address} onChange={handleFieldChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Map label</label>
                <input name="map_address_label" value={form.map_address_label} onChange={handleFieldChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
                <p className="text-xs text-gray-400 mt-1">Shown next to the map pin.</p>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Map subtext</label>
                <input name="map_subtext" value={form.map_subtext} onChange={handleFieldChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
                <p className="text-xs text-gray-400 mt-1">Helpful directions (e.g., “Midway Town Center · Exit 100”).</p>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-300 mb-1">Google Maps embed URL</label>
                <input name="map_embed_url" value={form.map_embed_url} onChange={handleFieldChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
                <p className="text-xs text-gray-400 mt-1">Paste the full embed URL from Google Maps.</p>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-300 mb-1">Box office / reservation note</label>
                <textarea name="box_office_note" value={form.box_office_note} onChange={handleFieldChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" rows="2" />
                <p className="text-xs text-gray-400 mt-1">Displayed in the footer and “First Time Here” section.</p>
              </div>
            </div>
          </AdminCollapsibleSection>

          <AdminCollapsibleSection
            id="site-content-announcement-banner"
            title="Announcement Banner"
            description="Optional banner for weather alerts, ops updates, or major announcements."
            summary={sectionSummaries['announcement-banner']}
            isCollapsed={Boolean(collapsedSections['announcement-banner'])}
            onToggle={() => toggleSection('announcement-banner')}
          >
            <div className="sr-only">
              <h2 className="text-xl font-semibold text-white">Announcement banner</h2>
              <p className="text-sm text-gray-400">Optional banner for weather alerts, ops updates, or major announcements.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={announcement.enabled}
                  onChange={(e) => updateAnnouncementField('enabled', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-800"
                />
                Enable announcement banner
              </label>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Severity</label>
                <select
                  value={announcement.severity}
                  onChange={(e) => updateAnnouncementField('severity', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                >
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Label (optional)</label>
                <input
                  value={announcement.label}
                  onChange={(e) => updateAnnouncementField('label', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="Weather Update"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-300 mb-1">Message</label>
                <textarea
                  value={announcement.message}
                  onChange={(e) => updateAnnouncementField('message', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  rows="2"
                  placeholder="We are opening late tonight due to weather."
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Link URL (optional)</label>
                <input
                  value={announcement.link_url}
                  onChange={(e) => updateAnnouncementField('link_url', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="https://midwaymusichall.net"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Link text (optional)</label>
                <input
                  value={announcement.link_text}
                  onChange={(e) => updateAnnouncementField('link_text', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="Read the update"
                />
              </div>
            </div>
          </AdminCollapsibleSection>

          <AdminCollapsibleSection
            id="site-content-reservation-banner"
            title="Reservation Flow Banner"
            description="Shown only inside the seating request modal."
            summary={sectionSummaries['reservation-banner']}
            isCollapsed={Boolean(collapsedSections['reservation-banner'])}
            onToggle={() => toggleSection('reservation-banner')}
          >
            <div className="sr-only">
              <h2 className="text-xl font-semibold text-white">Reservation flow banner</h2>
              <p className="text-sm text-gray-400">Shown only inside the seating request modal.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={reservationBanner.enabled}
                  onChange={(e) => updateReservationBannerField('enabled', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-800"
                />
                Enable reservation banner
              </label>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Severity</label>
                <select
                  value={reservationBanner.severity}
                  onChange={(e) => updateReservationBannerField('severity', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                >
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Label (optional)</label>
                <input
                  value={reservationBanner.label}
                  onChange={(e) => updateReservationBannerField('label', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="Reservation Notice"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-300 mb-1">Message</label>
                <textarea
                  value={reservationBanner.message}
                  onChange={(e) => updateReservationBannerField('message', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  rows="2"
                  placeholder="Reservation requests are reviewed in submission order."
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Link URL (optional)</label>
                <input
                  value={reservationBanner.link_url}
                  onChange={(e) => updateReservationBannerField('link_url', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="https://midwaymusichall.net"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Link text (optional)</label>
                <input
                  value={reservationBanner.link_text}
                  onChange={(e) => updateReservationBannerField('link_text', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="More details"
                />
              </div>
            </div>
          </AdminCollapsibleSection>

          <AdminCollapsibleSection
            id="site-content-announcement-popup"
            title="Announcement Popup"
            description="Dismissible popup announcement with a 24-hour cooldown."
            summary={sectionSummaries['announcement-popup']}
            isCollapsed={Boolean(collapsedSections['announcement-popup'])}
            onToggle={() => toggleSection('announcement-popup')}
          >
            <div className="sr-only">
              <h2 className="text-xl font-semibold text-white">Announcement popup</h2>
              <p className="text-sm text-gray-400">Dismissible popup announcement with a 24-hour cooldown.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={announcementPopup.enabled}
                  onChange={(e) => updateAnnouncementPopupField('enabled', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-800"
                />
                Enable popup announcement
              </label>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Severity</label>
                <select
                  value={announcementPopup.severity}
                  onChange={(e) => updateAnnouncementPopupField('severity', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                >
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-300 md:col-span-2">
                <input
                  type="checkbox"
                  checked={announcementPopup.allow_during_seat_selection}
                  onChange={(e) => updateAnnouncementPopupField('allow_during_seat_selection', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-800"
                />
                Allow popup while seat selection modal is open
              </label>
              <div className="md:col-span-2">
                <label className="block text-sm text-gray-300 mb-1">Message</label>
                <textarea
                  value={announcementPopup.message}
                  onChange={(e) => updateAnnouncementPopupField('message', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  rows="2"
                  placeholder="Doors open 30 minutes before showtime."
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Link URL (optional)</label>
                <input
                  value={announcementPopup.link_url}
                  onChange={(e) => updateAnnouncementPopupField('link_url', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="https://midwaymusichall.net"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Link text (optional)</label>
                <input
                  value={announcementPopup.link_text}
                  onChange={(e) => updateAnnouncementPopupField('link_text', e.target.value)}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="Read update"
                />
              </div>
            </div>
          </AdminCollapsibleSection>

          <AdminCollapsibleSection
            id="site-content-contacts"
            title="Contact Cards"
            description="Shown on the About page and footer. List each person guests may reach out to."
            summary={sectionSummaries.contacts}
            isCollapsed={Boolean(collapsedSections.contacts)}
            onToggle={() => toggleSection('contacts')}
          >
            <div className="sr-only">
              <h2 className="text-xl font-semibold text-white">Contact cards</h2>
              <p className="text-sm text-gray-400">Shown on the About page and footer. List each person guests may reach out to.</p>
            </div>
            <div className="space-y-4">
              {contacts.map((contact, index) => (
                <div key={`contact-${index}`} className="bg-gray-900 rounded-lg border border-gray-700 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Contact {index + 1}</h3>
                    {contacts.length > 1 && (
                      <button type="button" onClick={() => removeContact(index)} className="text-xs text-red-300 hover:text-red-200">
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Name</label>
                      <input value={contact.name} onChange={(e) => updateContact(index, 'name', e.target.value)} className="w-full px-3 py-2 bg-gray-700 text-white rounded" placeholder="e.g., Donna Cheek" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Role / Title</label>
                      <input value={contact.title} onChange={(e) => updateContact(index, 'title', e.target.value)} className="w-full px-3 py-2 bg-gray-700 text-white rounded" placeholder="Venue Manager" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Phone</label>
                      <input value={contact.phone} onChange={(e) => updateContact(index, 'phone', e.target.value)} className="w-full px-3 py-2 bg-gray-700 text-white rounded" placeholder="336-000-0000" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Email</label>
                      <input value={contact.email} onChange={(e) => updateContact(index, 'email', e.target.value)} className="w-full px-3 py-2 bg-gray-700 text-white rounded" placeholder="name@example.com" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Notes</label>
                    <textarea value={contact.notes} onChange={(e) => updateContact(index, 'notes', e.target.value)} className="w-full px-3 py-2 bg-gray-700 text-white rounded" rows="2" placeholder="e.g., Handles beach series bookings" />
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={addContact} className="px-4 py-2 rounded bg-gray-700 text-white text-sm">
              + Add another contact
            </button>
          </AdminCollapsibleSection>

          <AdminCollapsibleSection
            id="site-content-policies"
            title="Policies"
            description="Displayed in the About and First Time Here sections."
            summary={sectionSummaries.policies}
            isCollapsed={Boolean(collapsedSections.policies)}
            onToggle={() => toggleSection('policies')}
          >
            <div className="sr-only">
              <h2 className="text-xl font-semibold text-white">Policies</h2>
              <p className="text-sm text-gray-400">Displayed in the About and First Time Here sections.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Family-friendly reminder</label>
                <textarea name="policy_family_text" value={form.policy_family_text} onChange={handleFieldChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" rows="2" />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Refund policy</label>
                <textarea name="policy_refund_text" value={form.policy_refund_text} onChange={handleFieldChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" rows="2" />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">Additional notes</label>
              <textarea name="policy_additional_text" value={form.policy_additional_text} onChange={handleFieldChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" rows="3" placeholder="Optional reminders or parking notes." />
            </div>
          </AdminCollapsibleSection>

          <AdminCollapsibleSection
            id="site-content-social-links"
            title="Social & Footer Links"
            description="Used in the footer buttons so guests can follow the venue."
            summary={sectionSummaries['social-links']}
            isCollapsed={Boolean(collapsedSections['social-links'])}
            onToggle={() => toggleSection('social-links')}
          >
            <div className="sr-only">
              <h2 className="text-xl font-semibold text-white">Social & Footer Links</h2>
              <p className="text-sm text-gray-400">Used in the footer buttons so guests can follow the venue.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Facebook URL</label>
                <input
                  name="facebook_url"
                  value={form.facebook_url}
                  onChange={handleFieldChange}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="https://www.facebook.com/midwaymusichall"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Instagram URL</label>
                <input
                  name="instagram_url"
                  value={form.instagram_url}
                  onChange={handleFieldChange}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="https://www.instagram.com/username"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Twitter / X URL</label>
                <input
                  name="twitter_url"
                  value={form.twitter_url}
                  onChange={handleFieldChange}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="https://twitter.com/username"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-sm text-gray-300 mb-1">Google review link</label>
                <input
                  name="google_review_url"
                  value={form.google_review_url}
                  onChange={handleFieldChange}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="https://search.google.com/local/writereview?placeid=..."
                />
                <p className="text-xs text-gray-400 mt-1">Guests see this link beneath the map and in the footer when provided.</p>
              </div>
            </div>
          </AdminCollapsibleSection>

          <AdminCollapsibleSection
            id="site-content-lessons"
            title="Weekly Lessons & Classes"
            description="Shown in the Lessons section. Leave blank if not offered."
            summary={sectionSummaries.lessons}
            isCollapsed={Boolean(collapsedSections.lessons)}
            onToggle={() => toggleSection('lessons')}
          >
            <div className="sr-only">
              <h2 className="text-xl font-semibold text-white">Weekly lessons & classes</h2>
              <p className="text-sm text-gray-400">Shown in the Lessons section. Leave blank if not offered.</p>
            </div>
            <div className="space-y-4">
              {lessons.map((lesson, index) => (
                <div key={`lesson-${index}`} className="bg-gray-900 rounded-lg border border-gray-700 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Lesson {index + 1}</h3>
                    {lessons.length > 1 && (
                      <button type="button" onClick={() => removeLesson(index)} className="text-xs text-red-300 hover:text-red-200">
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Lesson title</label>
                      <input value={lesson.title} onChange={(e) => updateLesson(index, 'title', e.target.value)} className="w-full px-3 py-2 bg-gray-700 text-white rounded" placeholder="Line Dance Lessons - All Skill Levels" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Weekly schedule</label>
                      <input value={lesson.schedule} onChange={(e) => updateLesson(index, 'schedule', e.target.value)} className="w-full px-3 py-2 bg-gray-700 text-white rounded" placeholder="Mondays · 5:30 – 7:30 PM" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Price</label>
                      <input value={lesson.price} onChange={(e) => updateLesson(index, 'price', e.target.value)} className="w-full px-3 py-2 bg-gray-700 text-white rounded" placeholder="$7 / person" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Instructor</label>
                      <input value={lesson.instructor} onChange={(e) => updateLesson(index, 'instructor', e.target.value)} className="w-full px-3 py-2 bg-gray-700 text-white rounded" placeholder="Instructor name" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Instructor phone</label>
                      <input value={lesson.phone} onChange={(e) => updateLesson(index, 'phone', e.target.value)} className="w-full px-3 py-2 bg-gray-700 text-white rounded" placeholder="Phone number" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Short description</label>
                    <textarea value={lesson.description} onChange={(e) => updateLesson(index, 'description', e.target.value)} className="w-full px-3 py-2 bg-gray-700 text-white rounded" rows="2" placeholder="What can guests expect? Space? Experience level?" />
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={addLesson} className="px-4 py-2 rounded bg-gray-700 text-white text-sm">
              + Add another lesson
            </button>
          </AdminCollapsibleSection>

          <AdminStickyActionBar
            primaryLabel="Save Site Content"
            isSaving={saving}
            primaryDisabled={saving}
            message={error || status || 'Save stays visible while you move between sections.'}
            tone={error ? 'danger' : status ? 'success' : 'muted'}
          />
        </form>
      )}
    </div>
  );
}
