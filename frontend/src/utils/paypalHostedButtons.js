const sdkLoadCache = new Map();

const buildQuery = (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    search.set(key, String(value));
  });
  return search.toString();
};

export const loadPayPalHostedButtonsSdk = ({ clientId, currency = 'USD', enableVenmo = false } = {}) => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('PayPal SDK is only available in browser contexts.'));
  }
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) {
    return Promise.reject(new Error('PayPal SDK client ID is required.'));
  }
  const normalizedCurrency = String(currency || 'USD').toUpperCase();
  const query = buildQuery({
    'client-id': normalizedClientId,
    components: 'hosted-buttons',
    currency: normalizedCurrency,
    ...(enableVenmo ? { 'enable-funding': 'venmo' } : {}),
  });
  const sdkSrc = `https://www.paypal.com/sdk/js?${query}`;
  if (window.paypal?.HostedButtons) {
    return Promise.resolve(window.paypal);
  }
  if (sdkLoadCache.has(sdkSrc)) {
    return sdkLoadCache.get(sdkSrc);
  }

  const loadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${sdkSrc}"]`);
    if (existingScript) {
      if (window.paypal?.HostedButtons) {
        resolve(window.paypal);
        return;
      }
      existingScript.addEventListener('load', () => resolve(window.paypal), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load PayPal SDK script.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = sdkSrc;
    script.async = true;
    script.onload = () => {
      if (window.paypal?.HostedButtons) {
        resolve(window.paypal);
      } else {
        reject(new Error('PayPal Hosted Buttons API unavailable after SDK load.'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load PayPal SDK script.'));
    document.head.appendChild(script);
  });

  sdkLoadCache.set(sdkSrc, loadPromise);
  return loadPromise;
};
