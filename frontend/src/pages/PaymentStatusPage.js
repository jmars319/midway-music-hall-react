import React, { useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
} from 'lucide-react';
import BrandedStatusPage from '../components/BrandedStatusPage';

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
  const StatusIcon = pageCopy.icon || Info;
  const supportPoints = [
    'You are still on an official Midway Music Hall page.',
    'Online payment never changes your seat total on the frontend.',
    'Successful payment still requires staff confirmation before seating is finalized.',
  ];

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
  return (
    <BrandedStatusPage
      onAdminClick={onAdminClick}
      badge={pageCopy.badge}
      title={pageCopy.title}
      body={pageCopy.body}
      detail={pageCopy.detail}
      tone={pageCopy.tone}
      Icon={StatusIcon}
      supportPoints={supportPoints}
    />
  );
}
