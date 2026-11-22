/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // "Fantasy FGO" theme: night blue grounds and text, gold accents.
        night: {
          50: '#f1f0f7', 100: '#e8e6f0', 200: '#d3d4e4', 300: '#b9bdd6', 400: '#9ea4c2', 500: '#7a82a6',
          600: '#555e86', 700: '#2e3a6e', 800: '#1b2550', 900: '#111936', 950: '#0a0f24',
        },
        gold: {
          50: '#fdf8ea', 100: '#f9edcc', 200: '#f6dfa4', 300: '#f0d08a', 400: '#e6c67e', 500: '#d9b86c',
          600: '#c99d4c', 700: '#a67c35', 800: '#7d5c27', 900: '#57401c', 950: '#2e220f',
        },
        // Command card colours, used as accents only.
        arts: '#4f8cff', buster: '#ff5a5a', quick: '#3fd17a',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['Cinzel', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
