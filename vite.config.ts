import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const AGNO_DEFAULT = process.env.AGNO_PROXY_TARGET ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 把 /api/* 代理到 AGNO 实例，绕过浏览器 CORS
      // 使用方式: AGNO 默认实例可以用 baseUrl = "/api"
      // 或者用 AGNO_PROXY_TARGET 环境变量切换默认目标
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