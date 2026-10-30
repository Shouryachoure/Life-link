import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig(() => {
  const isHttps = process.env.VITE_HTTPS === 'true' || process.argv.includes('--https')

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(isHttps ? [basicSsl()] : []),
    ],
    server: {
      host: '0.0.0.0',
      port: 5173,
      https: isHttps ? {} : false,
      proxy: {
        '/api': {
          target: 'http://localhost:5001',
          changeOrigin: true,
          secure: false,
        },
        '/socket.io': {
          target: 'http://localhost:5001',
          ws: true,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})
