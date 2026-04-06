import React from 'react';
import { ArrowLeft, Home, Info } from 'lucide-react';
import Navigation from './Navigation';
import Footer from './Footer';
import BrandImage from './BrandImage';

const TONE_CLASSES = {
  amber: {
    badge: 'border-amber-400/40 bg-amber-500/10 text-amber-100',
    panel: 'border-amber-400/30 bg-amber-500/10',
    icon: 'text-amber-300',
    primaryButton: 'bg-amber-500 text-gray-950 hover:bg-amber-400 focus:ring-amber-300',
    secondaryButton: 'border-amber-400/50 text-amber-100 hover:bg-amber-500/10 focus:ring-amber-300',
  },
  emerald: {
    badge: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100',
    panel: 'border-emerald-400/30 bg-emerald-500/10',
    icon: 'text-emerald-300',
    primaryButton: 'bg-emerald-500 text-gray-950 hover:bg-emerald-400 focus:ring-emerald-300',
    secondaryButton: 'border-emerald-400/50 text-emerald-100 hover:bg-emerald-500/10 focus:ring-emerald-300',
  },
  rose: {
    badge: 'border-rose-400/40 bg-rose-500/10 text-rose-100',
    panel: 'border-rose-400/30 bg-rose-500/10',
    icon: 'text-rose-300',
    primaryButton: 'bg-rose-500 text-white hover:bg-rose-400 focus:ring-rose-300',
    secondaryButton: 'border-rose-400/50 text-rose-100 hover:bg-rose-500/10 focus:ring-rose-300',
  },
  indigo: {
    badge: 'border-indigo-400/40 bg-indigo-500/10 text-indigo-100',
    panel: 'border-indigo-400/30 bg-indigo-500/10',
    icon: 'text-indigo-300',
    primaryButton: 'bg-indigo-500 text-white hover:bg-indigo-400 focus:ring-indigo-300',
    secondaryButton: 'border-indigo-400/50 text-indigo-100 hover:bg-indigo-500/10 focus:ring-indigo-300',
  },
};

export default function BrandedStatusPage({
  onAdminClick,
  badge,
  title,
  body,
  detail = '',
  tone = 'indigo',
  Icon = Info,
  supportPoints = [],
  backLabel = 'Go Back',
  homeLabel = 'Go Home',
  homeHref = '/',
}) {
  const toneClasses = TONE_CLASSES[tone] || TONE_CLASSES.indigo;

  const handleGoBack = () => {
    if (typeof window === 'undefined') {
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.assign(homeHref);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navigation onAdminClick={onAdminClick} />

      <main
        id="main"
        role="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8"
      >
        <section className="w-full max-w-3xl overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-gray-900 via-black to-gray-950 shadow-[0_40px_120px_rgba(0,0,0,0.45)]">
          <div className="border-b border-white/10 bg-white/[0.03] px-6 py-6 sm:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <BrandImage
                  variant="logo"
                  alt="Midway Music Hall"
                  className="h-16 w-auto object-contain"
                />
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-purple-200">Midway Music Hall</p>
                  <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{title}</h1>
                </div>
              </div>
              <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${toneClasses.badge}`}>
                {badge}
              </span>
            </div>
          </div>

          <div className="space-y-6 px-6 py-8 sm:px-8 sm:py-10">
            <div className={`rounded-2xl border p-5 sm:p-6 ${toneClasses.panel}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-black/20 ${toneClasses.icon}`}>
                  <Icon className="h-7 w-7" aria-hidden="true" />
                </div>
                <div className="space-y-3">
                  <p className="text-base leading-7 text-gray-100">{body}</p>
                  {detail ? (
                    <p className="text-sm leading-6 text-gray-300">{detail}</p>
                  ) : null}
                </div>
              </div>
            </div>

            {supportPoints.length ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
                <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-gray-300">What to expect</h2>
                <div className="mt-4 grid gap-3 text-sm text-gray-200 sm:grid-cols-3">
                  {supportPoints.map((point) => (
                    <p key={point} className="rounded-xl border border-white/10 bg-black/20 p-4">{point}</p>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleGoBack}
                className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold transition focus:outline-none focus:ring-2 ${toneClasses.primaryButton}`}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                {backLabel}
              </button>
              <a
                href={homeHref}
                className={`inline-flex items-center justify-center gap-2 rounded-xl border px-5 py-3 font-semibold transition focus:outline-none focus:ring-2 ${toneClasses.secondaryButton}`}
              >
                <Home className="h-4 w-4" aria-hidden="true" />
                {homeLabel}
              </a>
            </div>
          </div>
        </section>
      </main>

      <Footer onAdminClick={onAdminClick} />
    </div>
  );
}
