import { defineConfig } from "vite";
import { resolve } from "node:path";
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
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        app: resolve(__dirname, "app.html"),
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/favicon.png", "hero-care.svg"],
      manifest: {
        name: "careTalk",
        short_name: "careTalk",
        description: "Digital head nurse for adult care documentation and guidance",
        theme_color: "#3b82d6",
        background_color: "#f4f9ff",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "./app.html",
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
        // Do not precache HTML — always fetch pages from the network so
        // demos pick up new releases (hashed JS/CSS still precached).
        cacheId: "caretalk-v1.1.3",
        globPatterns: ["**/*.{js,css,ico,png,svg,woff2}"],
        navigateFallback: null,
      },
    }),
  ],
});
