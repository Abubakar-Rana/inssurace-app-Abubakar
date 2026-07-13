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
        },
        accent: {
          500: "#2d6be4", // action blue
          600: "#1f57c3",
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
      },
      animation: {
        "fade-up": "fade-up 0.4s ease-out both",
        "scale-in": "scale-in 0.25s ease-out both",
      },
    },
  },
  plugins: [],
};
