import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Annict API へのリクエストはローカルプロキシ経由にして CORS を回避する
const annictProxy = {
  '/graphql': {
    target: 'https://api.annict.com',
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [react()],
  // 相対パスにしておくと GitHub Pages のサブパス (username.github.io/repo/) でもそのまま動く
  base: './',
  server: { proxy: annictProxy },
  preview: { proxy: annictProxy },
})
