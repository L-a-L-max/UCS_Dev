import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import cesium from "vite-plugin-cesium"
import copy from "rollup-plugin-copy"

export default defineConfig({
  plugins: [
    react(),
    cesium(),
    copy({
      targets: [
        {src: 'node_modules/@baidumap/mapv-three/dist/assets', dest: 'public/mapvthree'},
      ],
      verbose: true,
      hook: 'buildStart',
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})

