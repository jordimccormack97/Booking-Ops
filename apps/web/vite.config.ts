import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: `${fileURLToPath(new URL("./src/", import.meta.url))}`,
      },
    ],
  },
  plugins: [react({ fastRefresh: false }), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
