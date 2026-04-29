import { Inter, Inter_Tight } from "next/font/google";
// import localFont from "next/font/local";

// ─────────────────────────────────────────────────────────────────────────────
// Neue Machina + Neue Montreal — TODO: enable once licensed .woff2 files land.
//
// This repo ships placeholder 48-byte stubs at app/fonts/Neue*.woff2 so the
// directory and naming are pinned. fontkit (used by next/font/local for
// metrics extraction) cannot parse them — so the localFont registration below
// is commented out to keep `npm run dev` green. The Google fallbacks (Inter +
// Inter Tight) drive everything in the meantime.
//
// When the licensed .woff2 files arrive:
//   1. Drop them into app/fonts/, replacing the stubs (same filenames).
//   2. Uncomment the `import localFont` line at the top of this file.
//   3. Uncomment the `neueMachina` and `neueMontreal` blocks below.
//   4. Add `neueMachina.variable, neueMontreal.variable` to `fontVariables`.
//   5. Restart `npm run dev`.
//
// export const neueMachina = localFont({
//   src: [
//     { path: "./fonts/NeueMachina-Regular.woff2", weight: "400", style: "normal" },
//     { path: "./fonts/NeueMachina-Medium.woff2", weight: "500", style: "normal" },
//     { path: "./fonts/NeueMachina-Bold.woff2", weight: "700", style: "normal" },
//   ],
//   variable: "--font-neue-machina",
//   display: "swap",
//   fallback: ["Inter Tight", "system-ui", "sans-serif"],
// });
//
// export const neueMontreal = localFont({
//   src: [
//     { path: "./fonts/NeueMontreal-Regular.woff2", weight: "400", style: "normal" },
//     { path: "./fonts/NeueMontreal-Medium.woff2", weight: "500", style: "normal" },
//     { path: "./fonts/NeueMontreal-Bold.woff2", weight: "700", style: "normal" },
//   ],
//   variable: "--font-neue-montreal",
//   display: "swap",
//   fallback: ["Inter", "system-ui", "sans-serif"],
// });
// ─────────────────────────────────────────────────────────────────────────────

export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
  display: "swap",
});

// Once Neue Machina + Neue Montreal land, prepend their `.variable`s here.
export const fontVariables = [inter.variable, interTight.variable].join(" ");
