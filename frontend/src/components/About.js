// About: unified section that blends venue overview with location/policy info
import React, { useState, useEffect } from 'react';
import { Music, Users, Star, Heart, MapPin, Shield, Phone, Mail } from 'lucide-react';
import { API_BASE } from '../App';

// TODO: Confirm actual capacity; using neutral phrasing for now.
const features = [
  { icon: Music, title: 'Curated Programming', description: 'Shows focus on Carolina beach music, shag, Americana, classic country, and community dance nights.' },
  { icon: Users, title: 'Intimate Venue Atmosphere', description: 'Room layout keeps performers close to the crowd for easy interaction.' },
  { icon: Star, title: 'Premium Sound', description: 'Engineered audio and lighting for both live bands and DJs.' },
  { icon: Heart, title: 'Local First', description: 'We prioritize regional artists, dance instructors, and community partners.' }
];

const contacts = [
  {
    name: 'Donna Cheek · Venue Manager',
    phone: '336-793-4218',
    email: 'midwayeventcenter@gmail.com',
    role: 'Main contact for all events',
  },
  {
    name: 'Sandra Marshall · Beach Music Coordinator',
    phone: '336-223-5570',
    email: 'mmhbeachbands@gmail.com',
    role: '2026 Carolina Beach Music Series',
  },
];

export default function About(){
  const [aboutTitle, setAboutTitle] = useState('About Midway Music Hall');
  const [aboutDescription, setAboutDescription] = useState('Midway Music Hall is an intimate live music venue in Winston-Salem, North Carolina. We focus on reliable sound, curated dance nights, and a welcoming community experience.\n\nJoin us for weekly shows, private rentals, and community gatherings that celebrate Carolina beach music, shag culture, Americana roots, and classic country with the occasional rock feature.');

  useEffect(() => {
    fetch(`${API_BASE}/settings`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.settings) {
          if (data.settings.about_title) {
            setAboutTitle(data.settings.about_title);
          }
          if (data.settings.about_description) {
            setAboutDescription(data.settings.about_description);
          }
        }
      })
      .catch(() => {});
  }, []);

  const descriptionParagraphs = aboutDescription.split('\n').filter(p => p.trim());

  return (
    <section id="about" className="py-20 bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <header className="text-center space-y-4">
          <h2 className="text-4xl font-bold">{aboutTitle}</h2>
          <p className="text-gray-300 max-w-3xl mx-auto">
            A single home for everything you need to know about Midway Music Hall.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          <div>
            <h3 className="text-2xl font-semibold text-white">Venue Overview</h3>
            {descriptionParagraphs.map((para, idx) => (
              <p key={idx} className="text-gray-300 mt-4 leading-relaxed">{para}</p>
            ))}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-8">
              {features.map((f) => (
                <div key={f.title} className="bg-gray-800 rounded-xl p-6 border border-purple-500/20">
                  <div className="flex items-start gap-4">
                    <f.icon className="h-8 w-8 text-purple-400" />
                    <div>
                      <h4 className="text-lg font-semibold">{f.title}</h4>
                      <p className="text-gray-300 text-sm mt-1">{f.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-2xl font-semibold text-white">Location, Policies & Contacts</h3>
            <div className="mt-6 space-y-6">
              <div className="bg-gray-800 rounded-2xl border border-gray-700 p-5">
                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-purple-300 mt-1" />
                  <div>
                    <h4 className="font-semibold text-white">Address</h4>
                    <p className="text-gray-300">11141 Old US Hwy 52, Winston-Salem, NC 27107</p>
                    <p className="text-gray-400 text-sm mt-1">Midway Town Center Shopping Center - Exit 100 off Hwy 52</p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-800 rounded-2xl border border-gray-700 p-5">
                <div className="flex items-start gap-3">
                  <Shield className="h-5 w-5 text-purple-300 mt-1" />
                  <div>
                    <h4 className="font-semibold text-white">Family Policy</h4>
                    <p className="text-gray-300">Family venue - no profanity or disrespectful behavior.</p>
                    <p className="text-gray-300 mt-2 uppercase tracking-wide">Refunds: NO REFUNDS</p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-800 rounded-2xl border border-gray-700 p-5">
                <h4 className="font-semibold text-white mb-4">Contacts</h4>
                <div className="space-y-4">
                  {contacts.map((contact) => (
                    <div key={contact.email}>
                      <p className="text-white font-semibold">{contact.name}</p>
                      <p className="text-gray-400 text-sm">{contact.role}</p>
                      <div className="flex flex-wrap items-center gap-4 text-sm mt-1">
                        <a href={`tel:${contact.phone.replace(/[^0-9+]/g, '')}`} className="flex items-center gap-1 text-purple-300 hover:text-purple-100">
                          <Phone className="h-4 w-4" /> {contact.phone}
                        </a>
                        <a href={`mailto:${contact.email}`} className="flex items-center gap-1 text-purple-300 hover:text-purple-100">
                          <Mail className="h-4 w-4" /> {contact.email}
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
