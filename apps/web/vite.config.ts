import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const engine = fileURLToPath(new URL("../../packages/engine/src/index.ts", import.meta.url));

// "artifact" mode builds one self-contained HTML file with React loaded from a CDN,
// for publishing a playable page. The normal build bundles everything.
export default defineConfig(({ mode }) => {
  const artifact = mode === "artifact";
  return {
    plugins: [react({ jsxRuntime: "classic" }), viteSingleFile()],
    resolve: { alias: { "@thaloroot/engine": engine } },
    // npm run dev: the game server runs separately (npm run dev -w @thaloroot/server)
    server: { proxy: { "/api": "http://localhost:8080", "/ws": { target: "ws://localhost:8080", ws: true } } },
    build: {
      outDir: artifact ? "dist-artifact" : "dist",
      target: "es2022",
      rollupOptions: artifact
        ? {
            external: ["react", "react-dom", "react-dom/client"],
            output: { format: "iife", globals: { react: "React", "react-dom": "ReactDOM", "react-dom/client": "ReactDOM" } },
          }
        : {},
    },
  };
});
