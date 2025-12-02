// About: static about section used on the homepage
import React, { useState, useEffect } from 'react';
import { Music, Users, Star, Heart } from 'lucide-react';
import { API_BASE } from '../App';

const features = [
  { icon: Music, color: 'purple', title: 'All Genres', description: 'We host everything from indie to jazz.' },
  { icon: Users, color: 'blue', title: '300+ Capacity', description: 'Intimate but lively—perfect for great sound.' },
  { icon: Star, color: 'orange', title: 'Premium Sound', description: 'High-quality audio for every performance.' },
  { icon: Heart, color: 'green', title: 'Local First', description: 'We prioritize local and emerging artists.' }
];

export default function About(){
  const [aboutTitle, setAboutTitle] = useState('About Midway Music Hall');
  const [aboutDescription, setAboutDescription] = useState('Midway Music Hall is an intimate live music venue dedicated to bringing outstanding local and touring acts to Lexington. We focus on great sound, curated lineups, and an inclusive community experience.\n\nJoin us for weekly shows, private events, and community nights.');

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

  // Split description by newlines for paragraphs
  const descriptionParagraphs = aboutDescription.split('\n').filter(p => p.trim());

  return (
    <section id="about" className="py-20 bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-4xl font-bold">{aboutTitle}</h2>
            {descriptionParagraphs.map((para, idx) => (
              <p key={idx} className="text-gray-300 mt-4 leading-relaxed">{para}</p>
            ))}
          </div>

          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {features.map((f) => (
                <div key={f.title} className="bg-gray-800 rounded-xl p-6 border border-purple-500/20">
                  <div className="flex items-start gap-4">
                    <f.icon className="h-8 w-8 text-purple-400" />
                    <div>
                      <h3 className="text-lg font-semibold">{f.title}</h3>
                      <p className="text-gray-300 text-sm mt-1">{f.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
