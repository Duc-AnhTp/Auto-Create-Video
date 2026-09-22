import { defineConfig } from "vite";
export default defineConfig({ root: "studio", build: { outDir: "../dist/studio", emptyOutDir: true, assetsDir: "studio-assets" } });
