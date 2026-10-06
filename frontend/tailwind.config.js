/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        emerald: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        primary: Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900]
          .map(step => [step, `rgb(var(--palette-primary-${step}) / <alpha-value>)`])),
        dark: Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
          .map(step => [step, `rgb(var(--palette-dark-${step}) / <alpha-value>)`])),
        bull: 'rgb(var(--palette-bull) / <alpha-value>)',
        bear: 'rgb(var(--palette-bear) / <alpha-value>)',
        warning: 'rgb(var(--palette-warning) / <alpha-value>)',
        info: 'rgb(var(--palette-info) / <alpha-value>)',
      },
      // Legacy text utilities need readable foregrounds, independent of fills.
      textColor: {
        bear: 'rgb(var(--palette-bear-text) / <alpha-value>)',
        primary: {
          400: 'rgb(var(--palette-primary-300) / <alpha-value>)',
          500: 'rgb(var(--palette-primary-300) / <alpha-value>)',
        },
        dark: { 600: 'rgb(var(--palette-dark-500) / <alpha-value>)' },
      },
      fontFamily: {
        mono: ['var(--font-mono)'],
        sans: ['var(--font-sans)'],
      },
      fontSize: {
        xs: ['var(--text-small)', { lineHeight: '1rem' }],
        sm: ['var(--text-control)', { lineHeight: '1.25rem' }],
        base: ['var(--text-body)', { lineHeight: '1.25rem' }],
        lg: ['var(--text-section)', { lineHeight: '1.5rem' }],
        xl: ['var(--text-heading)', { lineHeight: '1.75rem' }],
      },
      borderRadius: {
        sm: 'var(--radius-small)',
        DEFAULT: 'var(--radius-small)',
        md: 'var(--radius-control)',
        lg: 'var(--radius-control)',
        xl: 'var(--radius-surface)',
        '2xl': 'var(--radius-surface)',
        '3xl': 'var(--radius-surface)',
      },
      boxShadow: {
        sm: 'none',
        DEFAULT: 'none',
        md: 'var(--shadow-overlay)',
        lg: 'var(--shadow-overlay)',
        xl: 'var(--shadow-overlay)',
        '2xl': 'var(--shadow-overlay)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
