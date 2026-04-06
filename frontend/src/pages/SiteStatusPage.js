import React, { useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import BrandedStatusPage from '../components/BrandedStatusPage';

const ROUTE_VARIANTS = {
  '/access-denied': {
    badge: 'Access denied',
    title: 'This page is not available from your current context.',
    body: 'You may have followed a restricted link, an expired admin-only path, or a page that is not meant for public access.',
    tone: 'rose',
    icon: ShieldAlert,
    supportPoints: [
      'You are still on an official Midway Music Hall page.',
      'Go back if you followed a private or outdated link.',
      'Return home if you want to restart from the public site.',
    ],
  },
  '/temporarily-unavailable': {
    badge: 'Temporarily unavailable',
    title: 'This part of the site is temporarily unavailable.',
    body: 'Midway Music Hall may be performing maintenance or recovering from a temporary issue. Please try again in a little while.',
    tone: 'amber',
    icon: Wrench,
    supportPoints: [
      'You are still on an official Midway Music Hall page.',
      'Your best next step is to try again later or return home.',
      'If the issue continues, contact staff for help.',
    ],
  },
  '/maintenance': {
    badge: 'Temporarily unavailable',
    title: 'This part of the site is temporarily unavailable.',
    body: 'Midway Music Hall may be performing maintenance or recovering from a temporary issue. Please try again in a little while.',
    tone: 'amber',
    icon: Wrench,
    supportPoints: [
      'You are still on an official Midway Music Hall page.',
      'Your best next step is to try again later or return home.',
      'If the issue continues, contact staff for help.',
    ],
  },
  '/something-went-wrong': {
    badge: 'Something went wrong',
    title: 'Something went wrong while loading this page.',
    body: 'The safest next step is to go back and try again, or return home if you want to start fresh.',
    tone: 'indigo',
    icon: AlertTriangle,
    supportPoints: [
      'You are still on an official Midway Music Hall page.',
      'This does not necessarily mean your request or payment was lost.',
      'Try the previous step again before contacting staff.',
    ],
  },
  '/server-error': {
    badge: 'Something went wrong',
    title: 'Something went wrong while loading this page.',
    body: 'The safest next step is to go back and try again, or return home if you want to start fresh.',
    tone: 'indigo',
    icon: AlertTriangle,
    supportPoints: [
      'You are still on an official Midway Music Hall page.',
      'This does not necessarily mean your request or payment was lost.',
      'Try the previous step again before contacting staff.',
    ],
  },
};

const resolveVariant = () => {
  if (typeof window === 'undefined') {
    return ROUTE_VARIANTS['/temporarily-unavailable'];
  }
  const pathname = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
  return ROUTE_VARIANTS[pathname.toLowerCase()] || ROUTE_VARIANTS['/temporarily-unavailable'];
};

export default function SiteStatusPage({ onAdminClick }) {
  const pageCopy = useMemo(() => resolveVariant(), []);
  const StatusIcon = pageCopy.icon || AlertTriangle;

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
      tone={pageCopy.tone}
      Icon={StatusIcon}
      supportPoints={pageCopy.supportPoints}
    />
  );
}
