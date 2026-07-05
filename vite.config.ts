import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const AGNO_DEFAULT = process.env.AGNO_PROXY_TARGET ?? "http://127.0.0.1:8000";

// Tauri dev 通过 TAURI_DEV_PORT 环境变量指定端口,避免与浏览器开发用的 5173 冲突
const VITE_PORT = Number(process.env.TAURI_DEV_PORT ?? 5173);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: VITE_PORT,
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      // 把 /api/* 代理到 AGNO 实例，绕过浏览器 CORS
      // Tauri dev 中 webview 加载 http://localhost:5180(此端口),所以 /api 也走此
      "/api": {
        target: AGNO_DEFAULT,
        changeOrigin: true,
        secure: false,
        ws: false,
        rewrite: (p) => p.replace(/^\/api/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            // 移除 Origin 头，避免服务端 CORS 校验
            proxyReq.removeHeader("origin");
            proxyReq.removeHeader("referer");
          });
          proxy.on("proxyRes", (proxyRes) => {
            // 允许 SSE 流式响应
            proxyRes.headers["x-accel-buffering"] = "no";
          });
        },
      },
    },
  },
});
