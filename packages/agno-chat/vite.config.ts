import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: [
        "react", "react-dom", "zustand",
        "react-markdown", "remark-gfm", "remark-breaks",
        "rehype-highlight", "rehype-raw", "highlight.js",
        "@tanstack/react-virtual", "react-resizable-panels",
        "lucide-react", "class-variance-authority", "clsx", "tailwind-merge",
        "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu",
        "@radix-ui/react-label", "@radix-ui/react-popover",
        "@radix-ui/react-scroll-area", "@radix-ui/react-select",
        "@radix-ui/react-separator", "@radix-ui/react-slot",
        "@radix-ui/react-switch", "@radix-ui/react-tabs",
        "@radix-ui/react-toast", "@radix-ui/react-tooltip",
      ],
      output: { dir: "dist", sourcemap: true },
    },
    emptyOutDir: false,
    sourcemap: true,
    target: "es2022",
  },
});
