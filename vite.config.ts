// Loads .env so API_PORT/WEB_PORT set there (not just in the shell) reach
// the dev server and `vite preview` alike.
import "dotenv/config"
import { readFileSync } from "node:fs"
import { defineConfig } from "vite"

const apiPort = Number(process.env.API_PORT || 8788)
// Parameterized so two city instances can share one box (e.g. Fargo on 8787,
// Sioux Falls on 8789).
const webPort = Number(process.env.WEB_PORT || 8787)
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  version?: string
}
const appVersion = packageJson.version || "0.0.0"

export default defineConfig({
  root: "src/web",
  base: "/",
  resolve: {
    alias: {
      lucide: "lucide/dist/esm/lucide/src/lucide.js",
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: webPort,
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
      "/health": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: webPort,
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
      "/health": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
})
