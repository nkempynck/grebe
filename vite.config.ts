import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Identifies this build. Baked into the bundle as __BUILD_ID__ and written to
// dist/version.json, so a running tab can tell whether it is still the current
// deploy (see src/data/versionCheck.ts). Only equality matters, never ordering.
const BUILD_ID = Date.now().toString(36);

/** Emits version.json at the site root next to index.html. */
function buildIdManifest(): Plugin {
  return {
    name: "grebe-build-id",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ buildId: BUILD_ID }),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), buildIdManifest()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
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
