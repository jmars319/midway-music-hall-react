import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, RefreshCcw, Save } from 'lucide-react';
import { API_BASE } from '../apiConfig';

const DEFAULT_LIMIT = 2;
const scopeKey = (scope, categoryId) => (scope === 'category' ? `category-${categoryId}` : 'global');
const defaultOverLimitCopy = (limit) => `For parties over ${limit} seats, please contact our staff to arrange payment.`;

const normalizeSetting = (setting = {}, scope = 'category', category = null) => {
  const limit = Number(setting.limit_seats) > 0 ? Number(setting.limit_seats) : DEFAULT_LIMIT;
  const categoryId = scope === 'category'
    ? (category?.id ?? setting.category_id ?? null)
    : null;
  const baseName = scope === 'global' ? 'Global default' : (category?.name ?? setting.category_name ?? 'Category');
  return {
    scope,
    category_id: categoryId,
    category_name: baseName,
    enabled: Boolean(setting.enabled),
    provider_label: setting.provider_label || '',
    payment_url: setting.payment_url || '',
    button_text: setting.button_text || 'Pay Online',
    limit_seats: limit,
    over_limit_message: setting.over_limit_message || defaultOverLimitCopy(limit),
    fine_print: setting.fine_print || '',
    updated_at: setting.updated_at || null,
    updated_by: setting.updated_by || null,
  };
};

export default function PaymentSettingsModule(){
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasTable, setHasTable] = useState(true);
  const [formState, setFormState] = useState({});
  const [categories, setCategories] = useState([]);
  const [savingKey, setSavingKey] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const fetchSettings = async () => {
    setLoading(true);
    setError('');
    setStatusMessage('');
    try {
      const res = await fetch(`${API_BASE}/admin/payment-settings`);
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || 'Unable to load payment settings');
      }
      if (!data.has_table) {
        setHasTable(false);
        setFormState({});
        setCategories([]);
        setLoading(false);
        return;
      }
      setHasTable(true);
      const categoryList = Array.isArray(data.categories) ? data.categories : [];
      const mapped = {};
      const byCategory = new Map();
      (data.payment_settings || []).forEach((setting) => {
        if (!setting || typeof setting !== 'object') return;
        if (setting.scope === 'global') {
          mapped.global = normalizeSetting(setting, 'global');
          return;
        }
        if (setting.category_id) {
          byCategory.set(String(setting.category_id), setting);
        }
      });
      categoryList.forEach((category) => {
        const key = scopeKey('category', category.id);
        const existing = byCategory.get(String(category.id));
        mapped[key] = normalizeSetting(existing, 'category', category);
      });
      if (!mapped.global) {
        mapped.global = normalizeSetting({}, 'global');
      }
      setCategories(categoryList);
      setFormState(mapped);
    } catch (err) {
      console.error('Failed to load payment settings', err);
      setError(err instanceof Error ? err.message : 'Unable to load payment settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const updateField = (key, field, nextValue) => {
    setFormState((prev) => {
      const current = prev[key] || { scope: key === 'global' ? 'global' : 'category' };
      let value = nextValue;
      if (field === 'limit_seats') {
        const parsed = Number(nextValue);
        value = Number.isFinite(parsed) && parsed > 0 ? parsed : '';
      }
      const next = { ...prev, [key]: { ...current, [field]: value } };
      if (field === 'limit_seats') {
        const limit = Number(value) > 0 ? Number(value) : DEFAULT_LIMIT;
        const defaultMessage = defaultOverLimitCopy(limit);
        const prevMessage = current.over_limit_message || defaultOverLimitCopy(current.limit_seats || DEFAULT_LIMIT);
        if (!current.over_limit_message || current.over_limit_message === prevMessage) {
          next[key].over_limit_message = defaultMessage;
        }
      }
      return next;
    });
  };

  const handleSave = async (key) => {
    const config = formState[key];
    if (!config) return;
    setSavingKey(key);
    setError('');
    setStatusMessage('');
    try {
      const payload = {
        scope: config.scope,
        category_id: config.scope === 'category' ? config.category_id : null,
        enabled: Boolean(config.enabled),
        provider_label: (config.provider_label || '').trim(),
        payment_url: (config.payment_url || '').trim(),
        button_text: (config.button_text || '').trim() || 'Pay Online',
        limit_seats: Number(config.limit_seats) > 0 ? Number(config.limit_seats) : DEFAULT_LIMIT,
        over_limit_message: (config.over_limit_message || '').trim(),
        fine_print: (config.fine_print || '').trim(),
      };
      const res = await fetch(`${API_BASE}/admin/payment-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || 'Unable to save payment settings');
      }
      const updatedSetting = normalizeSetting(data.payment_setting, config.scope, config.scope === 'category' ? { id: config.category_id, name: config.category_name } : null);
      setFormState((prev) => ({ ...prev, [key]: updatedSetting }));
      setStatusMessage(`Saved ${config.category_name || (config.scope === 'global' ? 'global default' : 'category')} payment settings.`);
    } catch (err) {
      console.error('Failed to save payment settings', err);
      setError(err instanceof Error ? err.message : 'Unable to save payment settings.');
    } finally {
      setSavingKey('');
    }
  };

  const configList = useMemo(() => {
    const entries = [];
    if (formState.global) {
      entries.push({ key: 'global', data: formState.global });
    }
    categories.forEach((category) => {
      const key = scopeKey('category', category.id);
      entries.push({ key, data: formState[key] || normalizeSetting({}, 'category', category) });
    });
    return entries;
  }, [categories, formState]);

  if (!hasTable) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 text-amber-300 bg-amber-900/30 border border-amber-500/40 px-4 py-3 rounded-lg">
          <AlertCircle className="h-6 w-6" aria-hidden="true" />
          <div>
            <p className="font-semibold">Payment settings table missing</p>
            <p className="text-sm">Run the migration <code className="bg-black/40 px-1 rounded">database/20250326_payment_settings.sql</code> to enable this feature.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Payment Settings</h1>
          <p className="text-sm text-gray-400">Configure optional payment links shown after seat selection.</p>
        </div>
        <button
          type="button"
          onClick={fetchSettings}
          className="inline-flex items-center gap-2 px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-500/60 bg-red-900/30 px-4 py-3 text-sm text-red-200 flex items-center gap-2">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {statusMessage && (
        <div className="mb-4 rounded-md border border-emerald-500/40 bg-emerald-900/30 px-4 py-3 text-sm text-emerald-100">
          {statusMessage}
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-gray-400">Loading payment configuration…</div>
      ) : (
        <div className="space-y-6">
          {configList.map(({ key, data }) => (
            <div key={key} className="border border-gray-700 rounded-xl p-5 bg-gray-900/60 shadow-inner">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">{data.category_name}</h2>
                  <p className="text-xs uppercase tracking-wide text-gray-500">
                    {data.scope === 'global' ? 'Global default' : 'Category configuration'}
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-gray-200">
                  <input
                    type="checkbox"
                    className="rounded bg-gray-700"
                    checked={Boolean(data.enabled)}
                    onChange={(e) => updateField(key, 'enabled', e.target.checked)}
                  />
                  <span>Enable payment option</span>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Provider label</label>
                  <input
                    type="text"
                    className="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white"
                    value={data.provider_label}
                    onChange={(e) => updateField(key, 'provider_label', e.target.value)}
                    placeholder="PayPal, Square, etc."
                    disabled={savingKey === key}
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Button text</label>
                  <input
                    type="text"
                    className="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white"
                    value={data.button_text}
                    onChange={(e) => updateField(key, 'button_text', e.target.value)}
                    placeholder="Pay Online"
                    disabled={savingKey === key}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm text-gray-300 mb-1">Payment URL</label>
                  <input
                    type="url"
                    className="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white"
                    value={data.payment_url}
                    onChange={(e) => updateField(key, 'payment_url', e.target.value)}
                    placeholder="https://example.com/pay"
                    disabled={savingKey === key}
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Seat limit for payment link</label>
                  <input
                    type="number"
                    min={1}
                    className="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white"
                    value={data.limit_seats}
                    onChange={(e) => updateField(key, 'limit_seats', e.target.value)}
                    disabled={savingKey === key}
                  />
                  <p className="text-xs text-gray-500 mt-1">Payment button hides when selection exceeds this count.</p>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Fine print (optional)</label>
                  <textarea
                    rows={2}
                    className="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white"
                    value={data.fine_print}
                    onChange={(e) => updateField(key, 'fine_print', e.target.value)}
                    placeholder="Fees apply…"
                    disabled={savingKey === key}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm text-gray-300 mb-1">Over-limit message</label>
                  <textarea
                    rows={3}
                    className="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white"
                    value={data.over_limit_message}
                    onChange={(e) => updateField(key, 'over_limit_message', e.target.value)}
                    placeholder={defaultOverLimitCopy(data.limit_seats || DEFAULT_LIMIT)}
                    disabled={savingKey === key}
                  />
                  <p className="text-xs text-gray-500 mt-1">Shown when the guest selects more seats than allowed for online payment.</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mt-4 gap-3">
                <div className="text-xs text-gray-500">
                  {data.updated_at ? (
                    <>Updated {new Date(data.updated_at).toLocaleString()} {data.updated_by ? `by ${data.updated_by}` : ''}</>
                  ) : (
                    'Not saved yet'
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleSave(key)}
                  disabled={savingKey === key}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700"
                >
                  <Save className="h-4 w-4" />
                  {savingKey === key ? 'Saving…' : 'Save Settings'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
