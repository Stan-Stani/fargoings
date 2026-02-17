import { defineConfig } from "vite"
import { readFileSync } from "node:fs"

const apiPort = Number(process.env.API_PORT || 8788)
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  version?: string
}
const appVersion = packageJson.version || "0.0.0"

export default defineConfig({
  root: "src/web",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
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
})
