const GA_MEASUREMENT_ID = process.env.REACT_APP_GA_MEASUREMENT_ID || '';
const PLAUSIBLE_DOMAIN = process.env.REACT_APP_PLAUSIBLE_DOMAIN || '';

let initialized = false;

function appendScript(src, attributes = {}) {
  if (typeof document === 'undefined' || document.querySelector(`script[src="${src}"]`)) {
    return;
  }

  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  script.defer = true;

  Object.entries(attributes).forEach(([key, value]) => {
    script.setAttribute(key, value);
  });

  document.head.appendChild(script);
}

function schedule(callback) {
  if (typeof window === 'undefined') {
    return;
  }

  const run = () => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(callback, { timeout: 2000 });
    } else {
      window.setTimeout(callback, 1200);
    }
  };

  if (document.readyState === 'complete') {
    run();
  } else {
    window.addEventListener('load', run, { once: true });
  }
}

export function initAnalytics() {
  if (initialized || typeof window === 'undefined') {
    return;
  }

  initialized = true;

  schedule(() => {
    if (GA_MEASUREMENT_ID) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function gtag() {
        window.dataLayer.push(arguments);
      };
      window.gtag('js', new Date());
      window.gtag('config', GA_MEASUREMENT_ID, { send_page_view: true });
      appendScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`);
    }

    if (PLAUSIBLE_DOMAIN) {
      window.plausible = window.plausible || function plausible() {
        (window.plausible.q = window.plausible.q || []).push(arguments);
      };
      appendScript('https://plausible.io/js/script.js', {
        'data-domain': PLAUSIBLE_DOMAIN,
      });
    }
  });
}

export function trackSiteEvent(name, props = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  if (typeof window.gtag === 'function') {
    window.gtag('event', name, props);
  }

  if (typeof window.plausible === 'function') {
    window.plausible(name, { props });
  }
}
