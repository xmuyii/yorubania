import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      // libsodium-wrappers' published ESM entry references a file that
      // doesn't actually exist in the package (a known upstream packaging
      // issue) — point at the CommonJS build instead, which Vite handles
      // fine via its built-in commonjs interop.
      "libsodium-wrappers": resolve(
        __dirname,
        "node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js"
      ),
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        claim: resolve(__dirname, "claim.html"),
        dashboard: resolve(__dirname, "dashboard.html"),
        vault: resolve(__dirname, "vault.html"),
        familyTree: resolve(__dirname, "family-tree.html"),
        familyMedia: resolve(__dirname, "family-media.html"),
        council: resolve(__dirname, "council.html"),
        families: resolve(__dirname, "families.html"),
        directory: resolve(__dirname, "directory.html"),
        admin: resolve(__dirname, "admin.html"),
      },
    },
  },
});
