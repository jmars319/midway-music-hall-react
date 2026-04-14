import React, { useEffect } from 'react';
import { Compass } from 'lucide-react';
import BrandedStatusPage from '../components/BrandedStatusPage';

export default function NotFoundPage({
  onAdminClick,
  badge = 'Page not found',
  title = 'We couldn’t find that page.',
  body = 'The URL may be mistyped, outdated, or no longer available on the public site.',
  supportPoints = [
    'You are still on an official Midway Music Hall page.',
    'Go back if you followed a bad link, or return home to start fresh.',
    'Public routes like /thegatheringplace and /archive still work.',
  ],
}) {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }
    const previousTitle = document.title;
    document.title = `${title} | Midway Music Hall`;
    return () => {
      document.title = previousTitle;
    };
  }, [title]);

  return (
    <BrandedStatusPage
      onAdminClick={onAdminClick}
      badge={badge}
      title={title}
      body={body}
      tone="indigo"
      Icon={Compass}
      supportPoints={supportPoints}
      backLabel="Go Back"
      homeLabel="Go Home"
      homeHref="/"
    />
  );
}
