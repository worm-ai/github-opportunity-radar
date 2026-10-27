import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": process.env.RADAR_API_PROXY || "http://127.0.0.1:4317",
    },
  },
  preview: {
    proxy: {
      "/api": process.env.RADAR_API_PROXY || "http://127.0.0.1:4317",
    },
  },
});
