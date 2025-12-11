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
  const [facebookUrl, setFacebookUrl] = useState('https://facebook.com/midwaymusichal');
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
              <button onClick={() => scrollToSection('about')} className="text-sm text-gray-300 hover:text-purple-400 transition text-left">About</button>
              <button onClick={() => scrollToSection('suggest')} className="text-sm text-gray-300 hover:text-purple-400 transition text-left">Suggest an Artist</button>
              <button onClick={() => onNavigate && onNavigate('privacy')} className="text-sm text-gray-300 hover:text-purple-400 transition text-left">Privacy Policy</button>
              <button onClick={() => onNavigate && onNavigate('terms')} className="text-sm text-gray-300 hover:text-purple-400 transition text-left">Terms of Service</button>
              {onAdminClick && <button onClick={onAdminClick} className="text-sm text-gray-300 hover:text-purple-400 transition text-left">Admin</button>}
            </div>
          </div>

          <div>
            <h4 className="text-white font-bold mb-3">Box Office</h4>
            <div className="text-sm text-gray-400">{business.boxOffice}</div>
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

        <div className="mt-8 border-t border-gray-800 pt-6 text-center text-sm text-gray-500">© {new Date().getFullYear()} Midway Music Hall — All rights reserved.</div>
      </div>
    </footer>
  );
}
