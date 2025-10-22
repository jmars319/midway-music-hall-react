// Tailwind configuration used by the frontend build.
// Edit theme extensions and content globs here.
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  theme: {
    extend: {
      colors: {
        purple: {
          400: '#c084fc',
          500: '#a855f7',
          600: '#9333ea',
          700: '#7e22ce'
        },
        blue: {
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb'
        },
        orange: {
          400: '#fb923c',
          500: '#f59e0b'
        },
        green: {
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a'
        },
        red: {
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626'
        },
        yellow: {
          400: '#facc15',
          500: '#eab308'
        },
        gray: {
          900: '#111827',
          800: '#1f2937',
          700: '#374151',
          600: '#4b5563'
        }
      }
    }
  },
  plugins: []
};
