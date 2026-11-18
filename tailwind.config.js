/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#FAF9F6',
        fresh: {
          50: '#F2FBF0',
          100: '#E1F6DC',
          200: '#C4ECBB',
          300: '#96DC88',
          400: '#62C450',
          500: '#3CA62B',
          600: '#2B871D',
          700: '#246B1A',
          800: '#205519',
          900: '#1B4617',
        },
        citrus: {
          400: '#A3E635',
          500: '#84CC16',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
