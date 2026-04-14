import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, RefreshCcw, Save } from 'lucide-react';
import { API_BASE } from '../apiConfig';

const DEFAULT_LIMIT = 6;
const MARKUP_PATTERN = /<[^>]*>/;
const STANDARD_PROVIDER_TYPES = ['square', 'paypal_orders', 'external_link'];

const normalizeProviderType = (value) => {
  if (value === 'square') return 'square';
  if (value === 'paypal_orders') return 'paypal_orders';
  return 'external_link';
};

const providerGroupKey = (scope, categoryId) => (scope === 'category' ? `category-${categoryId}` : 'global');
const providerCardKey = (scope, categoryId, providerType) => `${scope}:${categoryId || 0}:${providerType}`;
const defaultOverLimitCopy = (limit) => `For parties over ${limit} seats, please contact our staff to arrange payment.`;

const providerPriority = (providerType) => {
  switch (normalizeProviderType(providerType)) {
    case 'square':
      return 10;
    case 'paypal_orders':
      return 20;
    case 'external_link':
      return 30;
    default:
      return 99;
  }
};

const providerDisplayName = (providerType) => {
  switch (normalizeProviderType(providerType)) {
    case 'square':
      return 'Square';
    case 'paypal_orders':
      return 'PayPal';
    default:
      return 'External payment link';
  }
};

const providerTypeLabel = (providerType) => {
  switch (normalizeProviderType(providerType)) {
    case 'square':
      return 'Square hosted checkout';
    case 'paypal_orders':
      return 'PayPal Orders checkout';
    default:
      return 'External payment link';
  }
};

const providerDescription = (providerType) => {
  switch (normalizeProviderType(providerType)) {
    case 'square':
      return 'Creates a Square-hosted checkout after the guest submits the seat request.';
    case 'paypal_orders':
      return 'Creates a PayPal order from the backend-calculated request total and redirects the guest to PayPal.';
    default:
      return 'Opens a fixed payment link after request submission. Use only for manual or legacy fallback flows.';
  }
};

const defaultProviderLabel = (providerType) => {
  switch (normalizeProviderType(providerType)) {
    case 'square':
      return 'Square';
    case 'paypal_orders':
      return 'PayPal';
    default:
      return '';
  }
};

const defaultButtonText = (providerType) => {
  switch (normalizeProviderType(providerType)) {
    case 'square':
      return 'Pay with Square';
    case 'paypal_orders':
      return 'Pay with PayPal';
    default:
      return 'Pay Online';
  }
};

const normalizeSetting = (setting = {}, scope = 'category', category = null, providerTypeOverride = null) => {
  const providerType = normalizeProviderType(providerTypeOverride || setting.provider_type);
  const limit = Number(setting.limit_seats) > 0 ? Number(setting.limit_seats) : DEFAULT_LIMIT;
  const categoryId = scope === 'category' ? (category?.id ?? setting.category_id ?? null) : null;
  const categoryName = scope === 'global'
    ? 'Global default'
    : (category?.name ?? setting.category_name ?? `Category ${categoryId || ''}`.trim());
  return {
    scope,
    category_id: categoryId,
    category_name: categoryName,
    provider_scope_key: setting.provider_scope_key || providerCardKey(scope, categoryId, providerType),
    enabled: Boolean(setting.enabled),
    provider_type: providerType,
    provider_label: setting.provider_label || '',
    payment_url: setting.payment_url || '',
    paypal_currency: setting.paypal_currency || 'USD',
    square_enable_cash_app_pay: Boolean(setting.square_enable_cash_app_pay),
    button_text: setting.button_text || defaultButtonText(providerType),
    limit_seats: limit,
    over_limit_message: setting.over_limit_message || defaultOverLimitCopy(limit),
    fine_print: setting.fine_print || '',
    updated_at: setting.updated_at || null,
    updated_by: setting.updated_by || null,
  };
};

const providerSupportedBySchema = (providerType, capabilities = {}) => {
  const normalized = normalizeProviderType(providerType);
  if (normalized === 'square') return capabilities.provider_type_square !== false;
  if (normalized === 'paypal_orders') return capabilities.provider_type_paypal_orders !== false;
  return true;
};

const missingKeysFromChecklist = (status, checklist) => checklist
  .filter((item) => !status?.[item.key])
  .map((item) => item.label);

export default function PaymentSettingsModule() {
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

      const rawSettings = Array.isArray(data.payment_settings) ? data.payment_settings : [];
      const categoryList = Array.isArray(data.categories) ? [...data.categories] : [];
      const categoryMap = new Map(categoryList.map((category) => [String(category.id), category]));
      rawSettings.forEach((setting) => {
        if (!setting || setting.scope !== 'category' || !setting.category_id) return;
        const idKey = String(setting.category_id);
        if (!categoryMap.has(idKey)) {
          const fallbackCategory = {
            id: setting.category_id,
            name: setting.category_name || `Category ${setting.category_id}`,
            slug: setting.category_slug || '',
            is_active: 0,
          };
          categoryMap.set(idKey, fallbackCategory);
          categoryList.push(fallbackCategory);
        }
      });

      categoryList.sort((left, right) => left.name.localeCompare(right.name));

      const mapped = {};
      const ensureProviderCard = (scope, category, providerType) => {
        const key = providerCardKey(scope, category?.id ?? null, providerType);
        if (!mapped[key]) {
          mapped[key] = normalizeSetting({}, scope, category, providerType);
        }
      };

      rawSettings.forEach((setting) => {
        if (!setting || typeof setting !== 'object') return;
        const scope = setting.scope === 'global' ? 'global' : 'category';
        const providerType = normalizeProviderType(setting.provider_type);
        const category = scope === 'category' ? categoryMap.get(String(setting.category_id)) || null : null;
        const key = providerCardKey(scope, scope === 'category' ? setting.category_id : null, providerType);
        mapped[key] = normalizeSetting(setting, scope, category, providerType);
      });

      STANDARD_PROVIDER_TYPES.forEach((providerType) => ensureProviderCard('global', null, providerType));
      categoryList.forEach((category) => {
        STANDARD_PROVIDER_TYPES.forEach((providerType) => ensureProviderCard('category', category, providerType));
      });

      setHasTable(true);
      setCapabilities(data.capabilities || {});
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
      const current = prev[key];
      if (!current) return prev;
      let value = nextValue;
      if (field === 'limit_seats') {
        const parsed = Number(nextValue);
        value = Number.isFinite(parsed) && parsed > 0 ? parsed : '';
      }
      const next = { ...prev, [key]: { ...current, [field]: value } };
      if (field === 'limit_seats') {
        const limit = Number(value) > 0 ? Number(value) : DEFAULT_LIMIT;
        const defaultMessage = defaultOverLimitCopy(limit);
        const previousDefault = defaultOverLimitCopy(current.limit_seats || DEFAULT_LIMIT);
        if (!current.over_limit_message || current.over_limit_message === previousDefault) {
          next[key].over_limit_message = defaultMessage;
        }
      }
      return next;
    });
    if (field === 'enabled') {
      setError('');
    }
  };

  const handleSave = async (key) => {
    const config = formState[key];
    if (!config) return;
    setSavingKey(key);
    setError('');
    setStatusMessage('');
    try {
      if (!providerSupportedBySchema(config.provider_type, capabilities)) {
        throw new Error(`${providerDisplayName(config.provider_type)} is not supported in this database schema yet.`);
      }
      if (
        MARKUP_PATTERN.test(config.provider_label || '')
        || MARKUP_PATTERN.test(config.button_text || '')
        || MARKUP_PATTERN.test(config.over_limit_message || '')
        || MARKUP_PATTERN.test(config.fine_print || '')
      ) {
        throw new Error('Payment settings fields cannot contain HTML/script markup.');
      }

      const payload = {
        scope: config.scope,
        category_id: config.scope === 'category' ? config.category_id : null,
        enabled: Boolean(config.enabled),
        provider_type: config.provider_type,
        provider_label: (config.provider_label || '').trim(),
        payment_url: config.provider_type === 'external_link' ? (config.payment_url || '').trim() : '',
        paypal_currency: (config.paypal_currency || 'USD').toUpperCase(),
        square_enable_cash_app_pay: config.provider_type === 'square' ? Boolean(config.square_enable_cash_app_pay) : false,
        button_text: (config.button_text || '').trim() || defaultButtonText(config.provider_type),
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

      const category = config.scope === 'category'
        ? categories.find((item) => String(item.id) === String(config.category_id)) || { id: config.category_id, name: config.category_name }
        : null;
      const updatedSetting = normalizeSetting(data.payment_setting, config.scope, category, config.provider_type);
      setFormState((prev) => ({ ...prev, [key]: updatedSetting }));
      setStatusMessage(`Saved ${providerDisplayName(config.provider_type)} settings for ${config.category_name}.`);
    } catch (err) {
      console.error('Failed to save payment settings', err);
      setError(err instanceof Error ? err.message : 'Unable to save payment settings.');
    } finally {
      setSavingKey('');
    }
  };

  const squareStatus = capabilities.square_status || {};
  const paypalStatus = capabilities.paypal_status || {};
  const squareMissingItems = missingKeysFromChecklist(squareStatus, [
    { key: 'access_token_configured', label: 'Access token' },
    { key: 'location_id_configured', label: 'Location ID' },
    { key: 'webhook_signature_key_configured', label: 'Webhook signature key' },
    { key: 'webhook_notification_url_configured', label: 'Webhook URL' },
  ]);
  const paypalMissingItems = missingKeysFromChecklist(paypalStatus, [
    { key: 'client_id_configured', label: 'Client ID' },
    { key: 'client_secret_configured', label: 'Client secret' },
    { key: 'return_url_configured', label: 'Return URL' },
    { key: 'cancel_url_configured', label: 'Cancel URL' },
    { key: 'webhook_id_configured', label: 'Webhook ID' },
    { key: 'webhook_notification_url_configured', label: 'Webhook URL' },
  ]);

  const configGroups = useMemo(() => {
    const groups = [{ key: 'global', scope: 'global', categoryId: null, categoryName: 'Global default' }];
    categories.forEach((category) => {
      groups.push({
        key: providerGroupKey('category', category.id),
        scope: 'category',
        categoryId: category.id,
        categoryName: category.name,
      });
    });

    return groups.map((group) => {
      const providerTypes = [...STANDARD_PROVIDER_TYPES];
      Object.values(formState).forEach((config) => {
        if (!config || config.scope !== group.scope) return;
        if (group.scope === 'category' && String(config.category_id) !== String(group.categoryId)) return;
        if (group.scope === 'global' && config.category_id !== null) return;
        if (!providerTypes.includes(config.provider_type)) {
          providerTypes.push(config.provider_type);
        }
      });
      providerTypes.sort((left, right) => providerPriority(left) - providerPriority(right));
      return { ...group, providerTypes };
    });
  }, [categories, formState]);

  const multiProviderEnabled = capabilities.multi_provider !== false;

  if (!hasTable) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-900/30 px-4 py-3 text-amber-300">
          <AlertCircle className="h-6 w-6" aria-hidden="true" />
          <div>
            <p className="font-semibold">Payment settings table missing</p>
            <p className="text-sm">
              Run the migration <code className="rounded bg-black/40 px-1">database/20250326_payment_settings.sql</code> to enable this feature.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payment Settings</h1>
          <p className="text-sm text-gray-400">
            Configure which payment providers are offered after a guest submits a seat request. Guests only see providers that are both enabled here and fully configured on the backend.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchSettings}
          className="inline-flex items-center gap-2 rounded bg-gray-700 px-3 py-2 text-sm hover:bg-gray-600"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-red-500/60 bg-red-900/30 px-4 py-3 text-sm text-red-200">
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
          {!multiProviderEnabled && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-900/20 px-4 py-3 text-sm text-amber-100">
              Run <code className="rounded bg-black/30 px-1">database/20260414_payment_provider_matrix.sql</code> before using multi-provider payment settings.
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-900/15 px-5 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Square readiness</h2>
                  <p className="mt-1 text-sm text-gray-300">
                    Square is the primary hosted-checkout flow. Secrets stay in backend environment settings, not in this admin form.
                  </p>
                </div>
                <div className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                  squareStatus.ready_to_enable
                    ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-100'
                    : 'border-amber-400/40 bg-amber-500/15 text-amber-100'
                }`}>
                  {squareStatus.ready_to_enable ? 'Ready to enable' : 'Not ready to enable'}
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Environment</p>
                  <p className="mt-1 text-sm font-semibold text-white">{squareStatus.environment || 'sandbox'}</p>
                </div>
                <div className="rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Webhook</p>
                  <p className="mt-1 text-sm font-semibold text-white">{squareStatus.webhook_ready ? 'Configured' : 'Missing required env'}</p>
                </div>
              </div>
              {squareMissingItems.length > 0 ? (
                <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-gray-300">
                  {squareMissingItems.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-emerald-100">
                  Square can be enabled. Customers can also see Cash App Pay inside Square checkout when the Square provider card below turns it on and the buyer/device are eligible.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-blue-500/30 bg-blue-900/15 px-5 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">PayPal readiness</h2>
                  <p className="mt-1 text-sm text-gray-300">
                    PayPal uses the Orders API and the same backend-authoritative seat request totals as Square.
                  </p>
                </div>
                <div className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                  paypalStatus.ready_to_enable
                    ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-100'
                    : 'border-amber-400/40 bg-amber-500/15 text-amber-100'
                }`}>
                  {paypalStatus.ready_to_enable ? 'Ready to enable' : 'Not ready to enable'}
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Environment</p>
                  <p className="mt-1 text-sm font-semibold text-white">{paypalStatus.environment || 'sandbox'}</p>
                </div>
                <div className="rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Webhook</p>
                  <p className="mt-1 text-sm font-semibold text-white">{paypalStatus.webhook_ready ? 'Configured' : 'Missing required env'}</p>
                </div>
              </div>
              {paypalMissingItems.length > 0 ? (
                <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-gray-300">
                  {paypalMissingItems.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-emerald-100">
                  PayPal can be enabled. Guests will be sent to PayPal for approval and returned to Midway Music Hall for final payment finalization.
                </p>
              )}
            </div>
          </div>

          {configGroups.map((group) => (
            <section key={group.key} className="rounded-xl border border-gray-700 bg-gray-900/60 p-5 shadow-inner">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-white">{group.categoryName}</h2>
                <p className="text-xs uppercase tracking-wide text-gray-500">
                  {group.scope === 'global' ? 'Global default provider matrix' : 'Category-specific provider matrix'}
                </p>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                {group.providerTypes.map((providerType) => {
                  const cardKey = providerCardKey(group.scope, group.categoryId, providerType);
                  const data = formState[cardKey] || normalizeSetting({}, group.scope, group.scope === 'category'
                    ? { id: group.categoryId, name: group.categoryName }
                    : null, providerType);
                  const providerSupported = providerSupportedBySchema(providerType, capabilities);
                  const isSaving = savingKey === cardKey;
                  const readinessStatus = normalizeProviderType(providerType) === 'square'
                    ? squareStatus
                    : normalizeProviderType(providerType) === 'paypal_orders'
                      ? paypalStatus
                      : null;
                  return (
                    <div key={cardKey} className="rounded-xl border border-gray-700 bg-gray-950/60 p-4">
                      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold text-white">{providerDisplayName(providerType)}</h3>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                              data.enabled
                                ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
                                : 'border-gray-600 bg-gray-800 text-gray-300'
                            }`}>
                            {data.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                          </div>
                          <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">{providerTypeLabel(providerType)}</p>
                          <p className="mt-2 text-sm text-gray-300">{providerDescription(providerType)}</p>
                        </div>
                        <label className="inline-flex items-center gap-2 text-sm text-gray-200">
                          <input
                            type="checkbox"
                            className="rounded bg-gray-700"
                            checked={Boolean(data.enabled)}
                            onChange={(e) => updateField(cardKey, 'enabled', e.target.checked)}
                            disabled={!providerSupported || isSaving}
                          />
                          <span>Enable provider</span>
                        </label>
                      </div>

                      {!providerSupported && (
                        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-900/20 px-3 py-2 text-sm text-amber-100">
                          This provider is not supported in the current database schema yet.
                        </div>
                      )}

                      {readinessStatus && !readinessStatus.ready_to_enable && (
                        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-900/20 px-3 py-2 text-sm text-amber-100">
                          Backend setup is incomplete. Guests will not see this provider publicly until it is both enabled here and fully configured on the server.
                        </div>
                      )}

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-sm text-gray-300">Display label</label>
                          <input
                            type="text"
                            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white"
                            value={data.provider_label}
                            onChange={(e) => updateField(cardKey, 'provider_label', e.target.value)}
                            placeholder={defaultProviderLabel(providerType)}
                            disabled={!providerSupported || isSaving}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-sm text-gray-300">Button text</label>
                          <input
                            type="text"
                            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white"
                            value={data.button_text}
                            onChange={(e) => updateField(cardKey, 'button_text', e.target.value)}
                            placeholder={defaultButtonText(providerType)}
                            disabled={!providerSupported || isSaving}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-sm text-gray-300">Seat limit for online payment</label>
                          <input
                            type="number"
                            min={1}
                            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white"
                            value={data.limit_seats}
                            onChange={(e) => updateField(cardKey, 'limit_seats', e.target.value)}
                            disabled={!providerSupported || isSaving}
                          />
                          <p className="mt-1 text-xs text-gray-500">The provider hides after submission if the request exceeds this seat count.</p>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm text-gray-300">Fine print (optional)</label>
                          <textarea
                            rows={2}
                            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white"
                            value={data.fine_print}
                            onChange={(e) => updateField(cardKey, 'fine_print', e.target.value)}
                            placeholder="Fees or notes shown under this provider."
                            disabled={!providerSupported || isSaving}
                          />
                        </div>

                        {normalizeProviderType(providerType) === 'external_link' && (
                          <div className="md:col-span-2">
                            <label className="mb-1 block text-sm text-gray-300">Payment URL</label>
                            <input
                              type="url"
                              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white"
                              value={data.payment_url}
                              onChange={(e) => updateField(cardKey, 'payment_url', e.target.value)}
                              placeholder="https://example.com/pay"
                              disabled={!providerSupported || isSaving}
                            />
                          </div>
                        )}

                        {normalizeProviderType(providerType) === 'square' && (
                          <div className="md:col-span-2 rounded-lg border border-emerald-500/30 bg-emerald-900/10 px-4 py-3">
                            <label className="inline-flex items-start gap-3 text-sm text-emerald-100">
                              <input
                                type="checkbox"
                                className="mt-1 rounded bg-gray-700"
                                checked={Boolean(data.square_enable_cash_app_pay)}
                                onChange={(e) => updateField(cardKey, 'square_enable_cash_app_pay', e.target.checked)}
                                disabled={!providerSupported || isSaving}
                              />
                              <span>
                                <span className="block font-semibold text-white">Allow Cash App Pay inside Square checkout</span>
                                <span className="block text-xs text-gray-300">This does not create a separate Cash App provider card. It tells Square checkout to show Cash App Pay when the Square merchant account and buyer device support it.</span>
                              </span>
                            </label>
                          </div>
                        )}

                        {normalizeProviderType(providerType) === 'paypal_orders' && (
                          <div className="md:col-span-2 rounded-lg border border-blue-500/30 bg-blue-900/10 px-4 py-3 text-sm text-blue-100">
                            PayPal checkout is dynamic. The guest submits the seat request first, then MMH creates a PayPal order from the backend total and brings the guest back to MMH to finalize the result.
                          </div>
                        )}

                        <div className="md:col-span-2">
                          <label className="mb-1 block text-sm text-gray-300">Over-limit message</label>
                          <textarea
                            rows={3}
                            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white"
                            value={data.over_limit_message}
                            onChange={(e) => updateField(cardKey, 'over_limit_message', e.target.value)}
                            placeholder={defaultOverLimitCopy(data.limit_seats || DEFAULT_LIMIT)}
                            disabled={!providerSupported || isSaving}
                          />
                        </div>
                      </div>

                      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-xs text-gray-500">
                          {data.updated_at
                            ? `Updated ${new Date(data.updated_at).toLocaleString()}${data.updated_by ? ` by ${data.updated_by}` : ''}`
                            : 'Not saved yet'}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSave(cardKey)}
                          disabled={!providerSupported || isSaving}
                          className="inline-flex items-center gap-2 rounded bg-purple-600 px-4 py-2 disabled:bg-gray-700"
                        >
                          <Save className="h-4 w-4" />
                          {isSaving ? 'Saving…' : 'Save Provider'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
