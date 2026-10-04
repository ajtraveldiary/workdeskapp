import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src/client",
  build: { outDir: "../../dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api/": "http://localhost:8787" },
  },
});
