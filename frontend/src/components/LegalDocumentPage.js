import React, { useEffect } from 'react';
import Navigation from './Navigation';
import Footer from './Footer';
import legalContent from '../content/legalContent.json';

function updateHeadTag(selector, tagName, attributes) {
  if (typeof document === 'undefined') {
    return null;
  }
  let element = document.head.querySelector(selector);
  const existing = !!element;
  if (!element) {
    element = document.createElement(tagName);
  }
  const previousAttributes = existing
    ? Object.fromEntries(Object.keys(attributes).map((key) => [key, element.getAttribute(key)]))
    : null;
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
  if (!existing) {
    document.head.appendChild(element);
  }
  return {
    element,
    existing,
    previousAttributes,
  };
}

export default function LegalDocumentPage({ documentKey, onAdminClick }) {
  const documentConfig = legalContent?.[documentKey];
  const title = documentConfig?.title || 'Legal';
  const metaDescription = documentConfig?.metaDescription || '';
  const lastUpdated = documentConfig?.lastUpdated || '';
  const sections = documentConfig?.sections || [];

  useEffect(() => {
    if (!documentConfig) {
      return undefined;
    }
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return undefined;
    }
    const previousTitle = document.title;
    document.title = `${title} | Midway Music Hall`;

    const descriptionState = updateHeadTag('meta[name="description"]', 'meta', {
      name: 'description',
      content: metaDescription,
    });
    const canonicalState = updateHeadTag('link[rel="canonical"]', 'link', {
      rel: 'canonical',
      href: `https://midwaymusichall.net/${documentKey}`,
    });

    return () => {
      document.title = previousTitle;
      if (descriptionState?.element) {
        if (descriptionState.existing) {
          if (descriptionState.previousAttributes?.content === null) {
            descriptionState.element.removeAttribute('content');
          } else {
            descriptionState.element.setAttribute('content', descriptionState.previousAttributes?.content || '');
          }
        } else {
          descriptionState.element.remove();
        }
      }
      if (canonicalState?.element) {
        if (canonicalState.existing) {
          if (canonicalState.previousAttributes?.href === null) {
            canonicalState.element.removeAttribute('href');
          } else {
            canonicalState.element.setAttribute('href', canonicalState.previousAttributes?.href || '');
          }
        } else {
          canonicalState.element.remove();
        }
      }
    };
  }, [documentConfig, documentKey, metaDescription, title]);

  if (!documentConfig) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Navigation onAdminClick={onAdminClick} />

      <main id="main" role="main" tabIndex={-1} className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-4xl font-bold mb-8">{title}</h1>

        <div className="prose prose-invert prose-purple max-w-none space-y-6 text-gray-300">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-2xl font-semibold text-white mb-3">{section.heading}</h2>
              {(section.paragraphs || []).map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {Array.isArray(section.bullets) && section.bullets.length > 0 ? (
                <ul className="list-disc list-inside ml-4 space-y-2">
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
              {(section.followupParagraphs || []).map((paragraph) => (
                <p key={paragraph} className="mt-3">{paragraph}</p>
              ))}
            </section>
          ))}

          <p className="text-sm text-gray-200 mt-8">Last updated: {lastUpdated}</p>
        </div>
      </main>

      <Footer onAdminClick={onAdminClick} />
    </div>
  );
}
