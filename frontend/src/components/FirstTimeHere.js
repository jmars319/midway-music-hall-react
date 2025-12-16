import React from 'react';
import { MapPin, Shield, Ban, PhoneCall, Info, Car } from 'lucide-react';
import useSiteContent from '../hooks/useSiteContent';
import { formatPhoneHref, CONTACT_LINK_CLASSES } from '../utils/contactLinks';

// Short onboarding block for first-time visitors.
export default function FirstTimeHere() {
  const siteContent = useSiteContent();
  const primaryContact = (siteContent.contacts || [])[0];
  const infoCards = [
    {
      id: 'address',
      icon: MapPin,
      title: 'Address',
      description: siteContent.business?.address || '11141 Old US Hwy 52, Winston-Salem, NC 27107',
      detail: siteContent.map?.subtext || 'Midway Town Center · Exit 100',
    },
    {
      id: 'family',
      icon: Shield,
      title: 'Family Policy',
      description: siteContent.policies?.family || 'Family venue. Please keep language respectful.',
      detail: 'We want everyone to feel welcome.',
    },
    {
      id: 'refunds',
      icon: Ban,
      title: 'Refunds',
      description: siteContent.policies?.refunds || 'All ticket sales are final.',
      detail: 'NO REFUNDS',
    },
    {
      id: 'reservations',
      icon: Info,
      title: 'Reservations',
      description: siteContent.box_office_note || 'Seat reservations are request-only for now.',
      detail: 'Staff will call to confirm.',
    },
    {
      id: 'contact',
      icon: PhoneCall,
      title: 'Best Contact',
      description: (
        <div className="space-y-3">
          <p>
            {(primaryContact?.name || 'Donna Cheek')}
            {primaryContact?.title ? ` · ${primaryContact.title}` : ' · Venue Manager'}
          </p>
          <div className="flex flex-col gap-2">
            {primaryContact?.phone && (
              <a
                href={formatPhoneHref(primaryContact.phone)}
                className={CONTACT_LINK_CLASSES}
                aria-label={`Call ${primaryContact.name || 'best contact'} at ${primaryContact.phone}`}
              >
                {primaryContact.phone}
              </a>
            )}
            <a
              href={`mailto:${primaryContact?.email || 'midwayeventcenter@gmail.com'}`}
              className={CONTACT_LINK_CLASSES}
              aria-label={`Email ${primaryContact?.name || 'best contact'} at ${primaryContact?.email || 'midwayeventcenter@gmail.com'}`}
            >
              {primaryContact?.email || 'midwayeventcenter@gmail.com'}
            </a>
          </div>
        </div>
      ),
      detail: 'Main point of contact',
    },
    {
      id: 'parking',
      icon: Car,
      title: 'Parking & Access',
      description: 'Surface lot parking directly in front of the venue.',
      detail: 'Accessible entrance available.',
    },
  ];

  return (
    <section className="py-12 bg-gray-950" aria-labelledby="first-time-here">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <p className="text-sm uppercase tracking-widest text-purple-300">First Time Here?</p>
          <h2 id="first-time-here" className="text-3xl font-bold text-white mt-2">Here’s the quick overview</h2>
          <p className="text-gray-300 mt-3 max-w-3xl mx-auto">
            Everything you need to plan a visit: address, policies, and the best contact, all in one skimmable section.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {infoCards.map((card) => (
            <article key={card.id} className="bg-gray-900 rounded-2xl border border-purple-500/20 p-5 h-full">
              <div className="flex items-start gap-3">
                <card.icon className="h-6 w-6 text-purple-300 flex-shrink-0" aria-hidden="true" />
                <div>
                  <h3 className="text-lg font-semibold text-white">{card.title}</h3>
                  <div className="text-gray-300 mt-2 text-sm space-y-2">
                    {card.description}
                  </div>
                  {card.detail && (
                    <p className="text-xs uppercase tracking-wide text-gray-200 mt-3">{card.detail}</p>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
