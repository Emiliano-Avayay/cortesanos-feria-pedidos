export default {
  content: ['./client/index.html', './client/src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        cort: {
          ink: '#14110f',
          wine: '#681b2b',
          gold: '#b9965a',
          cream: '#faf7f0',
          paper: '#fffdf8',
          smoke: '#ebe5d8'
        }
      },
      boxShadow: {
        premium: '0 24px 70px rgba(28, 18, 10, 0.12)'
      },
      fontFamily: {
        display: ['Cormorant Garamond', 'Georgia', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui']
      }
    }
  },
  plugins: []
};
