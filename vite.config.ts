import { readFileSync } from "node:fs"
import { defineConfig } from "vite"

const apiPort = Number(process.env.API_PORT || 8788)
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  version?: string
}
const appVersion = packageJson.version || "0.0.0"

export default defineConfig({
  root: "src/web",
  base: "/fargoings/",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 8787,
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
    port: 8787,
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
