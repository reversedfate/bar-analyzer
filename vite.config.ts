/// <reference types="vitest" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  base: '/bar-analyzer/', // For GitHub Pages deployment
  test: {
    globals: true,
    environment: 'node',
  },
})
