import React from 'react';
import { MapPin } from 'lucide-react';

export default function MapSection() {
  return (
    <section className="py-12 bg-gray-900 border-t border-b border-gray-800" id="map">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
          <div>
            <p className="text-sm uppercase tracking-widest text-purple-300">Visit</p>
            <h2 className="text-3xl font-bold text-white mt-1">Find Midway Music Hall</h2>
            <p className="text-gray-400 mt-2 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-purple-300" />
              11141 Old U.S. Hwy 52, Winston-Salem, NC 27107
            </p>
          </div>
        </div>

        <div className="rounded-3xl overflow-hidden border border-purple-500/20 shadow-lg aspect-video">
          <iframe
            title="Midway Music Hall map"
            src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3274.058364949036!2d-80.22422352346647!3d35.99506067241762!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x8853e93a2da3c6f3%3A0x7fe2bff7e76bc3ab!2s11141%20Old%20U.S.%2052%2C%20Winston-Salem%2C%20NC%2027107!5e0!3m2!1sen!2sus!4v1734046800!5m2!1sen!2sus"
            width="100%"
            height="100%"
            style={{ border: 0 }}
            allow="fullscreen"
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </div>
    </section>
  );
}
