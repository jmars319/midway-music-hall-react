import React from 'react';
import { Phone } from 'lucide-react';
import useSiteContent from '../hooks/useSiteContent';
import { formatPhoneHref, CONTACT_LINK_CLASSES } from '../utils/contactLinks';

export default function LessonsSection() {
  const siteContent = useSiteContent();
  const lessons = siteContent.lessons || [];
  return (
    <section className="py-12 bg-gray-900 border-t border-b border-purple-500/20" id="lessons">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-10">
          <p className="text-sm uppercase tracking-widest text-purple-300">Learn</p>
          <h2 className="text-3xl font-bold text-white mt-1">Weekly Classes & Lessons</h2>
          <p className="text-gray-400 mt-2">Call ahead to confirm availability; space is limited for each session.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {lessons.map((lesson) => (
            <article key={lesson.id} className="bg-gray-950 rounded-2xl border border-gray-800 p-6 flex flex-col">
              <p className="text-sm uppercase tracking-wide text-purple-300">{lesson.price}</p>
              <h3 className="text-2xl font-semibold text-white mt-2">{lesson.title}</h3>
              <p className="text-gray-300 mt-2">{lesson.schedule}</p>
              <p className="text-gray-400 text-sm mt-4 flex-1">{lesson.description}</p>
              <div className="mt-6 text-sm text-gray-300 flex items-center gap-2">
                <Phone className="h-4 w-4 text-purple-300" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-white">{lesson.instructor}</p>
                  <a
                    href={formatPhoneHref(lesson.phone)}
                    className={CONTACT_LINK_CLASSES}
                    aria-label={`Call ${lesson.instructor || lesson.title} at ${lesson.phone}`}
                  >
                    {lesson.phone}
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
