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
          /**
           * The structural rule, and the warm ground that sits above it.
           *
           * `rule` below is the rust hairline under the brand bar, which is the
           * guide's `--brand-rule`; this terracotta is the guide's `--rule`, the
           * heavier line that says one region of a panel ends and another
           * begins. Two different lines with the same name in the family CSS, so
           * the one that arrived second gets the colour's own name here.
           *
           * `panel-warm` (the guide's `sunny-soft`) is what LingoLecto puts
           * behind its tab strip, and it is why the strip reads as a header
           * rather than as the top of the scroll area.
           */
          terracotta: '#b27467',
          'panel-warm': '#fbec99',
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
      /*
       * Two small motions the student page needs and Tailwind's own do not give.
       *
       * `halo` is a ping that stays inside its parent. Tailwind's `animate-ping`
       * scales to 2x, which on a 64px microphone throws a red wash 32px past
       * every edge of the pill holding it — the exact spread the button was made
       * big enough to replace. 1.28 is the most a 64px circle can grow inside a
       * 92px pill without touching the rim.
       *
       * `nudge` is for the arrow pointing at that button before the first call.
       * Three pixels, once every couple of seconds: enough to be caught by the
       * eye that is not looking at it, small enough not to nag the eye that is.
       */
      keyframes: {
        'lingo-halo': {
          '0%': { transform: 'scale(1)', opacity: '0.5' },
          '100%': { transform: 'scale(1.28)', opacity: '0' },
        },
        'lingo-nudge': {
          '0%, 70%, 100%': { transform: 'translateX(0)' },
          '85%': { transform: 'translateX(-3px)' },
        },
      },
      animation: {
        'lingo-halo': 'lingo-halo 1.5s cubic-bezier(0, 0, 0.2, 1) infinite',
        'lingo-nudge': 'lingo-nudge 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
