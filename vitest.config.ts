import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
    // SQLite's synchronous driver and Fastify fixtures must not share a process
    // while files are mutating temporary schemas and server lifecycles.
    fileParallelism: false,
  },
});
