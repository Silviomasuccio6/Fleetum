import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./platform.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1400px" }
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))"
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))"
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))"
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))"
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))"
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))"
        },
        g: {
          bg: "#F0F3FF",
          surf: "#FFFFFF",
          acc: "#6366F1",
          acc2: "#06B6D4",
          acc3: "#F43F5E",
          acc4: "#10B981",
          acc5: "#F59E0B"
        }
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)"
      },
      fontFamily: {
        display: ["Outfit", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"]
      },
      animation: {
        "g-blob1": "gBlob1 18s ease-in-out infinite alternate",
        "g-float": "gFloat1 13s ease-in-out infinite",
        "g-shimmer": "gShimmer 3.5s ease infinite",
        "g-card-in": "gCardIn 0.45s cubic-bezier(0.34,1.2,0.64,1) both"
      }
    }
  },
  plugins: []
} satisfies Config;
