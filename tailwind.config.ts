import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Amzur brand (light mode): violet primary + magenta accent.
        brand: {
          50: "#F5F3FF",
          100: "#EDE9FE",
          200: "#DDD6FE",
          500: "#8B5CF6",
          600: "#7C3AED", // primary
          700: "#6D28D9", // hover
          800: "#5B21B6", // pressed / strong text
        },
        accent: "#C026D3",
      },
    },
  },
  plugins: [],
};

export default config;
