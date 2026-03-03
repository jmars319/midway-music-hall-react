import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, RefreshCcw, Save } from 'lucide-react';
import { API_BASE } from '../apiConfig';

const DEFAULT_LIMIT = 6;
const scopeKey = (scope, categoryId) => (scope === 'category' ? `category-${categoryId}` : 'global');
const defaultOverLimitCopy = (limit) => `For parties over ${limit} seats, please contact our staff to arrange payment.`;
const MARKUP_PATTERN = /<[^>]*>/;
const PAYPAL_BUTTON_ID_PATTERN = /^[A-Za-z0-9]{5,64}$/;

const normalizeProviderType = (value) => {
  if (value === 'paypal_hosted_button') return 'paypal_hosted_button';
  if (value === 'paypal_orders') return 'paypal_orders';
  return 'external_link';
};

const normalizeSetting = (setting = {}, scope = 'category', category = null) => {
  const limit = Number(setting.limit_seats) > 0 ? Number(setting.limit_seats) : DEFAULT_LIMIT;
  const providerType = normalizeProviderType(setting.provider_type);
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
    provider_type: providerType,
    payment_url: setting.payment_url || '',
    paypal_hosted_button_id: setting.paypal_hosted_button_id || '',
    paypal_currency: setting.paypal_currency || 'USD',
    paypal_enable_venmo: Boolean(setting.paypal_enable_venmo),
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
  const [capabilities, setCapabilities] = useState({});
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
        setCapabilities({});
        setLoading(false);
        return;
      }
      setHasTable(true);
      setCapabilities(data.capabilities || {});
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
      if (field === 'provider_type') {
        value = normalizeProviderType(nextValue);
      }
      if (field === 'provider_type' || field === 'paypal_hosted_button_id' || field === 'enabled') {
        setError('');
      }
      const next = { ...prev, [key]: { ...current, [field]: value } };
      if (field === 'provider_type') {
        if (value !== 'paypal_hosted_button') {
          next[key].paypal_hosted_button_id = '';
          next[key].paypal_enable_venmo = false;
        }
        if (value !== 'external_link') {
          next[key].payment_url = '';
        }
      }
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

  const isProviderTypeAvailable = capabilities.provider_type !== false;
  const isPaypalModeAvailable =
    capabilities.paypal_hosted_button_id !== false &&
    capabilities.paypal_currency !== false &&
    capabilities.paypal_enable_venmo !== false;
  const handleSave = async (key) => {
    const config = formState[key];
    if (!config) return;
    setSavingKey(key);
    setError('');
    setStatusMessage('');
    try {
      const providerType = isProviderTypeAvailable
        ? normalizeProviderType(config.provider_type)
        : 'external_link';
      if (
        MARKUP_PATTERN.test(config.provider_label || '') ||
        MARKUP_PATTERN.test(config.button_text || '') ||
        MARKUP_PATTERN.test(config.over_limit_message || '') ||
        MARKUP_PATTERN.test(config.fine_print || '')
      ) {
        throw new Error('Payment settings fields cannot contain HTML/script markup.');
      }

      const paypalHostedButtonIdRaw = (config.paypal_hosted_button_id || '').trim();
      const paypalHostedButtonId = paypalHostedButtonIdRaw.replace(/[^A-Za-z0-9]/g, '');
      if (
        Boolean(config.enabled) &&
        providerType === 'paypal_hosted_button' &&
        !PAYPAL_BUTTON_ID_PATTERN.test(paypalHostedButtonId)
      ) {
        throw new Error('PayPal Hosted Button ID must be alphanumeric (5-64 characters).');
      }

      const payload = {
        scope: config.scope,
        category_id: config.scope === 'category' ? config.category_id : null,
        enabled: Boolean(config.enabled),
        provider_type: providerType,
        provider_label: (config.provider_label || '').trim(),
        payment_url: providerType === 'external_link' ? (config.payment_url || '').trim() : '',
        paypal_hosted_button_id: providerType === 'paypal_hosted_button' ? paypalHostedButtonId : '',
        paypal_currency: (config.paypal_currency || 'USD').toUpperCase(),
        paypal_enable_venmo: providerType === 'paypal_hosted_button' ? Boolean(config.paypal_enable_venmo) : false,
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
          <p className="text-sm text-gray-400">Configure optional payment methods shown after seat selection.</p>
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
          {(!isProviderTypeAvailable || !isPaypalModeAvailable) && (
            <div className="rounded-md border border-amber-500/40 bg-amber-900/20 px-4 py-3 text-sm text-amber-200">
              Some PayPal fields are unavailable in this database schema. Run the latest schema migration to enable hosted button settings.
            </div>
          )}
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
                  <label className="block text-sm text-gray-300 mb-1">Provider type</label>
                  <select
                    className="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white"
                    value={data.provider_type || 'external_link'}
                    onChange={(e) => updateField(key, 'provider_type', e.target.value)}
                    disabled={savingKey === key || !isProviderTypeAvailable}
                  >
                    <option value="external_link">External link</option>
                    <option value="paypal_hosted_button" disabled={!isPaypalModeAvailable}>PayPal hosted button</option>
                    <option value="paypal_orders">PayPal Orders (scaffold)</option>
                  </select>
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

                {data.provider_type === 'external_link' ? (
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
                ) : data.provider_type === 'paypal_hosted_button' ? (
                  <>
                    <div>
                      <label className="block text-sm text-gray-300 mb-1">PayPal Hosted Button ID</label>
                      <input
                        type="text"
                        className="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white"
                        value={data.paypal_hosted_button_id}
                        onChange={(e) => updateField(key, 'paypal_hosted_button_id', e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
                        placeholder="U7GKCHLN5VH66"
                        disabled={savingKey === key}
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-300 mb-1">Currency</label>
                      <input
                        type="text"
                        className="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white uppercase"
                        value={data.paypal_currency}
                        onChange={(e) => updateField(key, 'paypal_currency', e.target.value.toUpperCase())}
                        placeholder="USD"
                        maxLength={8}
                        disabled={savingKey === key}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="inline-flex items-center gap-2 text-sm text-gray-200">
                        <input
                          type="checkbox"
                          className="rounded bg-gray-700"
                          checked={Boolean(data.paypal_enable_venmo)}
                          onChange={(e) => updateField(key, 'paypal_enable_venmo', e.target.checked)}
                          disabled={savingKey === key}
                        />
                        <span>Enable Venmo in PayPal SDK</span>
                      </label>
                    </div>
                    {data.scope === 'global' && (
                      <div className="md:col-span-2 text-xs text-gray-400">
                        PayPal SDK client ID is sourced from backend environment (`PAYPAL_SDK_CLIENT_ID`).
                      </div>
                    )}
                  </>
                ) : (
                  <div className="md:col-span-2 rounded-md border border-indigo-500/40 bg-indigo-900/20 px-3 py-3 text-sm text-indigo-100">
                    PayPal Orders is scaffolded only in this phase. Customer-facing payment capture is not enabled yet.
                  </div>
                )}

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
