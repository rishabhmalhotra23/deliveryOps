import { defineConfig } from "vitest/config";
import * as path from "node:path";

export default defineConfig({
  test: {
    // Run unit + lightweight integration tests by default. Heavier integration
    // tests that touch real Supabase / Salesforce / Monday live under tests/integration
    // and require running `npm run test -- tests/integration` (and a working
    // .env.local).
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    reporters: ["default"],
    testTimeout: 10_000,
  },
  resolve: {
    // Match Next.js's `@/` alias so importing project modules under test works.
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
