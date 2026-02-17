import { defineConfig } from "vite"

const apiPort = Number(process.env.API_PORT || 8788)

export default defineConfig({
  root: "src/web",
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
