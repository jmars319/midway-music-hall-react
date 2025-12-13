import React, { useState, useEffect } from 'react';
// Footer: small presentational component rendered at bottom of site
import { MapPin, Phone, Mail, Facebook, Instagram, Twitter } from 'lucide-react';
import { API_BASE } from '../App';

const business = {
  name: 'Midway Music Hall',
  address: '11141 Old US Hwy 52 W-S NC 27107',
  phone: '(336) 793-4218',
  email: 'midwayeventcenter@gmail.com',
  boxOffice: 'Contact for event information'
};

const scrollToSection = (id) => {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

export default function Footer({ onAdminClick, onNavigate }){
  const [facebookUrl, setFacebookUrl] = useState('https://facebook.com/midwaymusichall');
  const [instagramUrl, setInstagramUrl] = useState('https://instagram.com/midwaymusichal');
  const [twitterUrl, setTwitterUrl] = useState('https://twitter.com/midwaymusichal');

  useEffect(() => {
    fetch(`${API_BASE}/settings`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.settings) {
          if (data.settings.facebook_url) setFacebookUrl(data.settings.facebook_url);
          if (data.settings.instagram_url) setInstagramUrl(data.settings.instagram_url);
          if (data.settings.twitter_url) setTwitterUrl(data.settings.twitter_url);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <footer className="bg-gray-900 border-t border-purple-500/15 text-gray-300 mt-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <h4 className="text-white font-bold mb-3">{business.name}</h4>
            <div className="text-sm text-gray-400">
              <div className="flex items-center gap-2"><MapPin className="h-4 w-4" /> {business.address}</div>
              <div className="flex items-center gap-2 mt-2">
                <Phone className="h-4 w-4" /> 
                <a href="tel:+13367934218" className="hover:text-purple-400 transition">{business.phone}</a>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Mail className="h-4 w-4" /> 
                <a href="mailto:midwayeventcenter@gmail.com" className="hover:text-purple-400 transition">{business.email}</a>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-white font-bold mb-3">Quick Links</h4>
            <div className="flex flex-col gap-2">
              <button onClick={() => scrollToSection('schedule')} className="text-sm text-gray-300 hover:text-purple-400 transition text-left">Schedule</button>
              <button onClick={() => scrollToSection('recurring-events')} className="text-sm text-gray-300 hover:text-purple-400 transition text-left">Recurring</button>
              <button onClick={() => scrollToSection('lessons')} className="text-sm text-gray-300 hover:text-purple-400 transition text-left">Lessons</button>
              <button onClick={() => scrollToSection('beach-series')} className="text-sm text-gray-300 hover:text-purple-400 transition text-left">Beach Series</button>
              <a href="/thegatheringplace" className="text-sm text-gray-300 hover:text-purple-400 transition text-left">The Gathering Place</a>
              <button onClick={() => onNavigate && onNavigate('privacy')} className="text-sm text-gray-300 hover:text-purple-400 transition text-left">Privacy Policy</button>
              <button onClick={() => onNavigate && onNavigate('terms')} className="text-sm text-gray-300 hover:text-purple-400 transition text-left">Terms of Service</button>
            </div>
          </div>

          <div>
            <h4 className="text-white font-bold mb-3">Box Office & Reservations</h4>
            <div className="text-sm text-gray-400 space-y-1">
              <p>Seat reservations are request-only. Staff will confirm by phone.</p>
              <p className="flex flex-col">
                <span className="text-gray-300 font-medium">Donna Cheek · Venue Manager</span>
                <a href="tel:+13367934218" className="text-purple-300 hover:text-white transition">336-793-4218</a>
                <a href="mailto:midwayeventcenter@gmail.com" className="text-purple-300 hover:text-white transition">midwayeventcenter@gmail.com</a>
              </p>
            </div>
          </div>

          <div>
            <h4 className="text-white font-bold mb-3">Follow Us</h4>
            <div className="flex items-center gap-3">
              <a href={facebookUrl} target="_blank" rel="noreferrer" className="w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center hover:bg-gray-700">
                <Facebook className="h-5 w-5" />
              </a>
              <a href={instagramUrl} target="_blank" rel="noreferrer" className="w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center hover:bg-gray-700">
                <Instagram className="h-5 w-5" />
              </a>
              <a href={twitterUrl} target="_blank" rel="noreferrer" className="w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center hover:bg-gray-700">
                <Twitter className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>

        <div className="mt-8 border-t border-gray-800 pt-6 text-center text-sm text-gray-500 flex flex-col md:flex-row items-center justify-between gap-4">
          <span>© {new Date().getFullYear()} Midway Music Hall - All rights reserved.</span>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            {onAdminClick && (
              <button onClick={onAdminClick} className="hover:text-purple-300 transition">
                Admin Login
              </button>
            )}
            <a href="https://www.jamarq.digital" target="_blank" rel="noreferrer" className="hover:text-purple-300 transition">
              Powered by JAMARQ
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
