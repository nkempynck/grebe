import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split the big, rarely-changing pieces into their own chunks so a code
        // redeploy doesn't force browsers to re-download them, and no single
        // chunk trips the size warning. Pure caching win — no runtime change,
        // everything is still statically imported and loaded up front.
        manualChunks(id: string) {
          if (id.indexOf("taxonomy.json") !== -1) return "taxonomy";
          if (id.indexOf("node_modules") !== -1) return "vendor";
          return undefined;
        },
      },
    },
  },
});
