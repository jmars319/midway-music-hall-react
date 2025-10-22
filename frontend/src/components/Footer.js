import React from 'react';
// Footer: small presentational component rendered at bottom of site
import { MapPin, Phone, Mail, Facebook, Instagram, Twitter } from 'lucide-react';

const business = {
  name: 'Midway Music Hall',
  address: '123 Music Lane, Lexington, NC 27292',
  phone: '(336) 555-SHOW',
  email: 'info@midwaymusichal.com',
  boxOffice: 'Mon-Fri: 10am-6pm, Sat: 12pm-8pm'
};

const scrollToSection = (id) => {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

export default function Footer(){
  return (
    <footer className="bg-gray-900 border-t border-purple-500/15 text-gray-300 mt-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <h4 className="text-white font-bold mb-3">{business.name}</h4>
            <div className="text-sm text-gray-400">
              <div className="flex items-center gap-2"><MapPin className="h-4 w-4" /> {business.address}</div>
              <div className="flex items-center gap-2 mt-2"><Phone className="h-4 w-4" /> {business.phone}</div>
              <div className="flex items-center gap-2 mt-2"><Mail className="h-4 w-4" /> {business.email}</div>
            </div>
          </div>

          <div>
            <h4 className="text-white font-bold mb-3">Quick Links</h4>
            <div className="flex flex-col gap-2">
              <button onClick={() => scrollToSection('schedule')} className="text-sm text-gray-300 hover:text-purple-400 transition text-left">Schedule</button>
              <button onClick={() => scrollToSection('seating')} className="text-sm text-gray-300 hover:text-purple-400 transition text-left">Seating Chart</button>
              <button onClick={() => scrollToSection('suggest')} className="text-sm text-gray-300 hover:text-purple-400 transition text-left">Suggest an Artist</button>
              <button onClick={() => scrollToSection('about')} className="text-sm text-gray-300 hover:text-purple-400 transition text-left">About</button>
            </div>
          </div>

          <div>
            <h4 className="text-white font-bold mb-3">Box Office</h4>
            <div className="text-sm text-gray-400">{business.boxOffice}</div>
          </div>

          <div>
            <h4 className="text-white font-bold mb-3">Follow Us</h4>
            <div className="flex items-center gap-3">
              <a href="https://facebook.com/midwaymusichal" target="_blank" rel="noreferrer" className="w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center hover:bg-gray-700">
                <Facebook className="h-5 w-5" />
              </a>
              <a href="https://instagram.com/midwaymusichal" target="_blank" rel="noreferrer" className="w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center hover:bg-gray-700">
                <Instagram className="h-5 w-5" />
              </a>
              <a href="https://twitter.com/midwaymusichal" target="_blank" rel="noreferrer" className="w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center hover:bg-gray-700">
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
