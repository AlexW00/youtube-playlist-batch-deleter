import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEPLOY_BASE_PATH =
  process.env.GITHUB_PAGES === "true"
    ? "/youtube-playlist-bach-deleter/"
    : "/"

// https://vite.dev/config/
export default defineConfig({
  base: DEPLOY_BASE_PATH,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    proxy: {
      "/yt-api": {
        target: "https://www.googleapis.com",
        changeOrigin: true,
        secure: true,
        rewrite: (reqPath) => reqPath.replace(/^\/yt-api/, ""),
      },
      "/yt-inner": {
        target: "https://www.youtube.com",
        changeOrigin: true,
        secure: true,
        rewrite: (reqPath) => reqPath.replace(/^\/yt-inner/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            const headerMappings: Array<[string, string]> = [
              ["x-youtube-proxy-cookie", "cookie"],
              ["x-youtube-proxy-origin", "origin"],
              ["x-youtube-proxy-referer", "referer"],
              ["x-youtube-proxy-user-agent", "user-agent"],
              ["x-youtube-proxy-accept-language", "accept-language"],
            ]

            headerMappings.forEach(([from, to]) => {
              const value = req.headers[from]
              if (typeof value === "string" && value.trim() !== "") {
                proxyReq.setHeader(to, value)
              }
              proxyReq.removeHeader(from)
            })

            if (!proxyReq.getHeader("origin")) {
              proxyReq.setHeader("origin", "https://www.youtube.com")
            }
            if (!proxyReq.getHeader("referer")) {
              proxyReq.setHeader("referer", "https://www.youtube.com/feed/playlists")
            }
          })
        },
      },
    },
  },
})
