import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  server: {
    host: true,
    port: 5173,
    open: false,
  },
  preview: {
    host: true,
    port: 4173,
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/favicon.png"],
      manifest: {
        name: "careTalk",
        short_name: "careTalk",
        description: "Digital head nurse for adult care documentation and guidance",
        theme_color: "#3b82d6",
        background_color: "#f4f9ff",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "./",
        scope: "./",
        lang: "en-GB",
        categories: ["medical", "productivity", "business"],
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        cacheId: "caretalk-v3",
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: "index.html",
      },
    }),
  ],
});
