import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@thaloroot/engine": fileURLToPath(new URL("../engine/src/index.ts", import.meta.url)) } },
  test: { testTimeout: 60_000 },
});
