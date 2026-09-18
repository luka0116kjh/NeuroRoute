/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves the app from /<repo-name>/. Set VITE_BASE (e.g. "/neuroroute/")
// at build time; the default "./" keeps asset URLs relative so any sub-path works.
const base = process.env.VITE_BASE ?? "./";

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    // three.js (~575 kB) lives in its own lazily loaded Scene3D chunk.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/setupTests.ts"],
    css: false,
  },
});
