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
        primary: {
          50: '#e7ebff',
          100: '#cfd7ff',
          200: '#9facff',
          300: '#6f81eb',
          400: '#072ac8',
          500: '#072ac8',
          600: '#0623a9',
          700: '#051c87',
          800: '#041566',
          900: '#030f47',
        },
        dark: {
          50: '#eef3fb',
          100: '#e6edf7',
          200: '#c9d4e6',
          300: '#aebcd3',
          400: '#94a3b8',
          500: '#7386a3',
          600: '#4f607d',
          700: '#27324a',
          800: '#121a2b',
          900: '#0f172a',
          950: '#070b16',
        },
        bull: '#22c55e',
        bear: '#ef4444',
        warning: '#f59e0b',
        info: '#38bdf8',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Pretendard', 'Inter', 'system-ui', 'sans-serif'],
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
