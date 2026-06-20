/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Roboto', 'Google Sans', 'ui-sans-serif', 'system-ui', 'Arial', 'sans-serif'],
        display: ['Google Sans', 'Roboto', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        forest: '#1e4d38',
        brass: '#b08d57',
        cream: '#efe9dc',
      },
    },
  },
  plugins: [],
};
