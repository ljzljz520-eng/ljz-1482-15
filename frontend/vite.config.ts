import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@timeline/shared": path.resolve(__dirname, "../shared/src/index.ts")
    }
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (pathValue) => pathValue.replace(/^\/api/, "")
      }
    }
  },
  preview: {
    port: 4173
  },
  worker: {
    format: "es"
  }
});
