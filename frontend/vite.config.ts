import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig({
  plugins: [vue()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3000' } },
  build: { rollupOptions: { output: { manualChunks: { vue: ['vue','pinia'], element: ['element-plus','@element-plus/icons-vue'], canvas: ['@antv/x6','@antv/x6-plugin-selection','@antv/x6-plugin-snapline'] } } } }
})
