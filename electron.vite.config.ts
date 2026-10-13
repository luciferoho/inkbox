import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        /* native 模块（.node）不可打包：动态 import 会把它拆进 chunk，
           运行时加载崩溃（GlobalFonts 'families' in undefined） */
        external: ['@napi-rs/canvas']
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared'),
        '@samples': resolve(__dirname, 'samples')
      }
    },
    plugins: [vue()]
  }
})
