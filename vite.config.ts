import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The Bun server (server/index.ts) does the git work; the browser only talks to /api
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
});