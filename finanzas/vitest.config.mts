import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 }, // las pruebas de base de datos arrancan PGlite y tardan más si corren varias a la vez
});
