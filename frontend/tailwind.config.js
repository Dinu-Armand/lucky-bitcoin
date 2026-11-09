/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0B0E11',
        card: '#181A20',
        line: '#2B3139',
        gold: '#FCD535',
        up: '#0ECB81',
        down: '#F6465D',
        tx: '#EAECEF',
        tx2: '#848E9C',
      },
      fontFamily: {
        sans: ['Inter', '"SF Pro Display"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
