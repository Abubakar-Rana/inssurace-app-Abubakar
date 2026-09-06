/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fff5f0",
          100: "#ffe6d9",
          200: "#ffc7ad",
          300: "#ffa079",
          400: "#ff7a45",
          500: "#f26522", // Vertafore orange
          600: "#dc4f14",
          700: "#b73c12",
          800: "#933116",
          900: "#772b15",
        },
        ink: {
          900: "#141b2d",
          800: "#1f2a44",
          700: "#33415c",
          600: "#4b5a76",
          500: "#64748b",
          // Meta text — timestamps, hints, the second line of a row. Below
          // ink-500 so a row's supporting detail never competes with its
          // subject.
          400: "#8a94a6",
          300: "#a8b0be",
        },
        accent: {
          500: "#2d6be4", // action blue
          600: "#1f57c3",
        },
        // Rules, not shadows, separate things now. `line` closes a region,
        // `soft` divides rows inside one, `faint` divides finished work.
        line: {
          DEFAULT: "#e6e8ec",
          soft: "#eef0f3",
          faint: "#f2f4f7",
        },
        surface: {
          shell: "#f7f8fa", // sidebar and sticky group headings
          hover: "#f2f4f7", // row hover, document background
          sunken: "#fafbfc", // list footer
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(20,27,45,0.08), 0 1px 2px rgba(20,27,45,0.04)",
        pop: "0 20px 45px -15px rgba(20,27,45,0.35)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: 0, transform: "translateY(8px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: 0, transform: "scale(0.96)" },
          "100%": { opacity: 1, transform: "scale(1)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        // The live feed, alive but not shouting.
        breathe: {
          "0%, 100%": { opacity: 0.35 },
          "50%": { opacity: 1 },
        },
      },
      animation: {
        "fade-up": "fade-up 0.4s ease-out both",
        "scale-in": "scale-in 0.25s ease-out both",
        breathe: "breathe 2.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
