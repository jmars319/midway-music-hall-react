import React, { useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Home,
  Info,
  XCircle,
} from 'lucide-react';
import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import BrandImage from '../components/BrandImage';

const PAYMENT_ROUTE_PREFIX = '/payment';

const CODE_VARIANTS = {
  EVENT_NOT_PUBLIC_FOR_PAYMENT: {
    badge: 'Payment unavailable',
    title: 'This event is not open for public payment.',
    body: 'This usually means the event is not currently published for public checkout. Please go back and confirm you are using the live public event page.',
    tone: 'amber',
    icon: AlertTriangle,
  },
  PAYMENT_NOT_CONFIGURED: {
    badge: 'Payment unavailable',
    title: 'Online payment is not enabled for this request.',
    body: 'This event is not currently set up for online payment. You can go back or contact staff for help with payment.',
    tone: 'amber',
    icon: AlertTriangle,
  },
  PAYMENT_PROVIDER_UNAVAILABLE: {
    badge: 'Square unavailable',
    title: 'Square payment is not configured right now.',
    body: 'If payment was enabled too early or the provider setup is incomplete, the safest next step is to go back or contact Midway Music Hall staff.',
    tone: 'rose',
    icon: AlertTriangle,
  },
  PAYMENT_PROVIDER_REQUEST_FAILED: {
    badge: 'Square unavailable',
    title: 'Square checkout could not be started.',
    body: 'The payment provider did not return a usable checkout session. Please go back and try again, or contact staff if the problem continues.',
    tone: 'rose',
    icon: AlertTriangle,
  },
  PAYMENT_AMOUNT_INVALID: {
    badge: 'Amount unavailable',
    title: 'This request does not have a valid payment total yet.',
    body: 'Payment can only start when the seat request has a valid backend-calculated total. Please go back and try again after staff review if needed.',
    tone: 'amber',
    icon: AlertTriangle,
  },
  PAYMENT_CURRENCY_INVALID: {
    badge: 'Currency unavailable',
    title: 'This request does not have a valid payment currency.',
    body: 'Payment was blocked because the backend request record is missing a valid currency. Please go back or contact staff for help.',
    tone: 'amber',
    icon: AlertTriangle,
  },
  PAYMENT_SEAT_LIMIT_EXCEEDED: {
    badge: 'Staff-assisted payment',
    title: 'This group is too large for online payment.',
    body: 'Your seat request is still valid, but larger parties need staff-assisted payment. Please go back or contact Midway Music Hall for the next step.',
    tone: 'amber',
    icon: AlertTriangle,
  },
  PAYMENT_ALREADY_COMPLETED: {
    badge: 'Already paid',
    title: 'This request has already been paid.',
    body: 'The request should remain held as paid and pending staff confirmation. You can head back or return home if you are done.',
    tone: 'emerald',
    icon: CheckCircle2,
  },
  PAYMENT_ALREADY_IN_PROGRESS: {
    badge: 'Checkout already open',
    title: 'A payment attempt is already in progress.',
    body: 'If you already opened Square in another tab, finish there first. Otherwise go back and try again after a moment.',
    tone: 'indigo',
    icon: Info,
  },
  REQUEST_NOT_OPEN_FOR_PAYMENT: {
    badge: 'Request closed',
    title: 'This request is no longer open for payment.',
    body: 'The seat request is not in a payment-eligible state anymore. Please go back and review the request status with staff if needed.',
    tone: 'amber',
    icon: AlertTriangle,
  },
};

const ROUTE_VARIANTS = {
  '': {
    badge: 'Payment help',
    title: 'This payment page was opened without an active checkout step.',
    body: 'If you arrived here by mistake, go back one step or return to the Midway Music Hall homepage.',
    tone: 'indigo',
    icon: Info,
  },
  help: {
    badge: 'Payment help',
    title: 'This payment page was opened without an active checkout step.',
    body: 'If you arrived here by mistake, go back one step or return to the Midway Music Hall homepage.',
    tone: 'indigo',
    icon: Info,
  },
  unavailable: {
    badge: 'Payment unavailable',
    title: 'Online payment is not available for this request.',
    body: 'This can happen if payment was enabled before setup was complete, if the request is missing a valid total, or if the request is no longer open for payment.',
    tone: 'amber',
    icon: AlertTriangle,
  },
  'provider-unavailable': {
    badge: 'Square unavailable',
    title: 'Square checkout is temporarily unavailable.',
    body: 'This usually means the provider setup is incomplete or Square could not create a checkout session right now. You can go back and try again later or return home.',
    tone: 'rose',
    icon: AlertTriangle,
  },
  'staff-help': {
    badge: 'Staff help needed',
    title: 'This request needs staff-assisted payment.',
    body: 'Your seat request can stay in place, but this payment path is not available for the current request size or setup. Please go back or contact Midway Music Hall staff.',
    tone: 'amber',
    icon: AlertTriangle,
  },
  'in-progress': {
    badge: 'Checkout already open',
    title: 'A Square checkout is already in progress.',
    body: 'If you already opened checkout in another tab, finish there first. If not, go back and try again after a moment.',
    tone: 'indigo',
    icon: Info,
  },
  'pending-confirmation': {
    badge: 'Paid / pending confirmation',
    title: 'Your request is already paid and waiting for staff confirmation.',
    body: 'Payment does not finalize seating automatically. Midway Music Hall staff still confirm the request before seats are fully committed.',
    tone: 'emerald',
    icon: CheckCircle2,
  },
  closed: {
    badge: 'Request closed',
    title: 'This request is not open for payment anymore.',
    body: 'The request is no longer in a payment-eligible state. Please go back or contact staff if you need help with the next step.',
    tone: 'amber',
    icon: AlertTriangle,
  },
  cancelled: {
    badge: 'Checkout canceled',
    title: 'No payment was completed.',
    body: 'Your seat request is not automatically canceled by closing checkout. You can go back and try again or return home.',
    tone: 'amber',
    icon: XCircle,
  },
  return: {
    badge: 'Square checkout',
    title: 'Your checkout was submitted.',
    body: 'If payment completed successfully, your request will move to paid and pending staff confirmation. Payment does not auto-confirm seats.',
    tone: 'emerald',
    icon: CheckCircle2,
  },
};

const TONE_CLASSES = {
  amber: {
    badge: 'border-amber-400/40 bg-amber-500/10 text-amber-100',
    panel: 'border-amber-400/30 bg-amber-500/10',
    icon: 'text-amber-300',
    primaryButton: 'bg-amber-500 text-gray-950 hover:bg-amber-400 focus:ring-amber-300',
    secondaryButton: 'border-amber-400/50 text-amber-100 hover:bg-amber-500/10 focus:ring-amber-300',
  },
  emerald: {
    badge: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100',
    panel: 'border-emerald-400/30 bg-emerald-500/10',
    icon: 'text-emerald-300',
    primaryButton: 'bg-emerald-500 text-gray-950 hover:bg-emerald-400 focus:ring-emerald-300',
    secondaryButton: 'border-emerald-400/50 text-emerald-100 hover:bg-emerald-500/10 focus:ring-emerald-300',
  },
  rose: {
    badge: 'border-rose-400/40 bg-rose-500/10 text-rose-100',
    panel: 'border-rose-400/30 bg-rose-500/10',
    icon: 'text-rose-300',
    primaryButton: 'bg-rose-500 text-white hover:bg-rose-400 focus:ring-rose-300',
    secondaryButton: 'border-rose-400/50 text-rose-100 hover:bg-rose-500/10 focus:ring-rose-300',
  },
  indigo: {
    badge: 'border-indigo-400/40 bg-indigo-500/10 text-indigo-100',
    panel: 'border-indigo-400/30 bg-indigo-500/10',
    icon: 'text-indigo-300',
    primaryButton: 'bg-indigo-500 text-white hover:bg-indigo-400 focus:ring-indigo-300',
    secondaryButton: 'border-indigo-400/50 text-indigo-100 hover:bg-indigo-500/10 focus:ring-indigo-300',
  },
};

const truncateDetail = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return '';
  }
  return normalized.length > 280 ? `${normalized.slice(0, 277)}...` : normalized;
};

const resolveRouteKey = () => {
  if (typeof window === 'undefined') {
    return '';
  }
  const pathname = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
  const normalized = pathname.toLowerCase();
  if (!normalized.startsWith(PAYMENT_ROUTE_PREFIX)) {
    return '';
  }
  return normalized.replace(/^\/payment\/?/, '');
};

const resolveStatusPageCopy = () => {
  if (typeof window === 'undefined') {
    return ROUTE_VARIANTS.help;
  }
  const routeKey = resolveRouteKey();
  const search = new URLSearchParams(window.location.search || '');
  const code = (search.get('code') || '').trim().toUpperCase();
  const detail = truncateDetail(search.get('message') || '');
  const routeVariant = ROUTE_VARIANTS[routeKey] || ROUTE_VARIANTS.help;
  const codeVariant = code ? CODE_VARIANTS[code] : null;
  return {
    ...(codeVariant || routeVariant),
    detail,
    routeKey,
  };
};

export default function PaymentStatusPage({ onAdminClick }) {
  const pageCopy = useMemo(() => resolveStatusPageCopy(), []);
  const tone = TONE_CLASSES[pageCopy.tone] || TONE_CLASSES.indigo;
  const StatusIcon = pageCopy.icon || Info;

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }
    const previousTitle = document.title;
    document.title = `${pageCopy.title} | Midway Music Hall`;
    return () => {
      document.title = previousTitle;
    };
  }, [pageCopy.title]);

  const handleGoBack = () => {
    if (typeof window === 'undefined') {
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.assign('/');
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navigation onAdminClick={onAdminClick} />

      <main
        id="main"
        role="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8"
      >
        <section className="w-full max-w-3xl overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-gray-900 via-black to-gray-950 shadow-[0_40px_120px_rgba(0,0,0,0.45)]">
          <div className="border-b border-white/10 bg-white/[0.03] px-6 py-6 sm:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <BrandImage
                  variant="logo"
                  alt="Midway Music Hall"
                  className="h-16 w-auto object-contain"
                />
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-purple-200">Midway Music Hall</p>
                  <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{pageCopy.title}</h1>
                </div>
              </div>
              <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${tone.badge}`}>
                {pageCopy.badge}
              </span>
            </div>
          </div>

          <div className="space-y-6 px-6 py-8 sm:px-8 sm:py-10">
            <div className={`rounded-2xl border p-5 sm:p-6 ${tone.panel}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-black/20 ${tone.icon}`}>
                  <StatusIcon className="h-7 w-7" aria-hidden="true" />
                </div>
                <div className="space-y-3">
                  <p className="text-base leading-7 text-gray-100">{pageCopy.body}</p>
                  {pageCopy.detail ? (
                    <p className="text-sm leading-6 text-gray-300">{pageCopy.detail}</p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
              <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-gray-300">What to expect</h2>
              <div className="mt-4 grid gap-3 text-sm text-gray-200 sm:grid-cols-3">
                <p className="rounded-xl border border-white/10 bg-black/20 p-4">You are still on an official Midway Music Hall page.</p>
                <p className="rounded-xl border border-white/10 bg-black/20 p-4">Online payment never changes your seat total on the frontend.</p>
                <p className="rounded-xl border border-white/10 bg-black/20 p-4">Successful payment still requires staff confirmation before seating is finalized.</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleGoBack}
                className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold transition focus:outline-none focus:ring-2 ${tone.primaryButton}`}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Go Back
              </button>
              <a
                href="/"
                className={`inline-flex items-center justify-center gap-2 rounded-xl border px-5 py-3 font-semibold transition focus:outline-none focus:ring-2 ${tone.secondaryButton}`}
              >
                <Home className="h-4 w-4" aria-hidden="true" />
                Go Home
              </a>
            </div>
          </div>
        </section>
      </main>

      <Footer onAdminClick={onAdminClick} />
    </div>
  );
}
