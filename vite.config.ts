import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const fromRoot = (relativePath: string) => path.resolve(import.meta.dirname, relativePath)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fromRoot('src'),
      '@app': fromRoot('src/app'),
      '@features': fromRoot('src/features'),
      '@shared': fromRoot('src/shared'),
      '@test': fromRoot('src/test'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    env: {
      VITE_API_BASE_URL: 'http://localhost:3000/api/v1',
      VITE_API_TOKEN: 'test-token',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', '**/*.d.ts'],
    },
  },
})
