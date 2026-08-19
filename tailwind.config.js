/**
 * Two looks live in this file, and they do not mix.
 *
 * The workshop pages — tutorBench, faceKit, liveTrial — are dark and built from
 * Tailwind's own slate palette. /eleve is the first page aimed at a student
 * rather than at the maintainer, and it wears the LingoLabo look the rest of
 * the family wears, so ScriptoMondo and LingoLecto and this read as one product
 * (see sciptomondo/STYLE_GUIDE.md §3).
 *
 * Everything below is namespaced `lingo-` rather than extending Tailwind's own
 * scales, and that is deliberate: nothing here can change how an existing dark
 * page looks. `fontFamily.sans` in particular is left alone — overriding it
 * would silently restyle every page in the app to buy one page a default it can
 * just as easily ask for by name.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        lingo: {
          ink: '#13063b',
          paper: '#fff2e2',
          cream: '#fffaf1',
          surface: '#ffffff',
          /** Orange means "this is the thing to press". See the note in index.html. */
          accent: '#f64718',
          'accent-light': '#e99c8a',
          'accent-deep': '#b83612',
          'accent-glow': 'rgba(246,71,24,0.14)',
          /** The "world" counterpart to accent's warmth: information, not action. */
          info: '#466577',
          'info-light': '#a5def2',
          'info-deep': '#1a3254',
          'info-glow': 'rgba(70,101,119,0.14)',
          muted: '#5f3e37',
          border: '#e6d8c2',
          'border-light': '#f1e9db',
          /**
           * The outline on every card. Warm tan, not terracotta — the guide
           * reserves clay-pink for the editor frame, and using it here puts a
           * saturated edge on everything at once.
           */
          'border-strong': '#c4a882',
          error: '#b83612',
          'error-bg': '#fdf0f0',
          success: '#35916c',
          'success-bg': '#edf7f0',
          /** Header lockup: sky-deep bar, rust rule, dark stroke on the wordmark. */
          bar: '#466577',
          rule: '#b83612',
          stroke: '#311706',
          gold: '#f2d016',
        },
      },
      fontFamily: {
        lingo: ['DM Sans', 'sans-serif'],
        'lingo-display': ['Fredoka', 'sans-serif'],
        'lingo-brand': ['Chelsea Market', 'cursive'],
        'lingo-hand': ['Patrick Hand', 'cursive'],
        'lingo-block': ['Chock A Block', 'cursive'],
        'lingo-mono': ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'lingo-pop': '0 4px 14px -2px rgba(0,0,0,0.15), 0 2px 6px -1px rgba(0,0,0,0.1)',
        'lingo-pop-sm': '0 2px 8px -1px rgba(0,0,0,0.12), 0 1px 3px -1px rgba(0,0,0,0.08)',
      },
    },
  },
  plugins: [],
};
