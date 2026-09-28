/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

// 与 src/preload/index.ts 暴露的 window.api 保持同步（M1 抽到 @shared 统一）
interface Window {
  api: {
    fs: {
      readFile(path: string): Promise<string>
      writeFile(path: string, content: string): Promise<void>
      writeFileBinary(path: string, base64: string): Promise<void>
      create(path: string, isDir: boolean): Promise<void>
      rename(oldPath: string, newPath: string): Promise<void>
      delete(path: string): Promise<void>
      readDir(path: string): Promise<import('@shared/types').DirEntry[]>
    }
    dialog: {
      openFile(): Promise<string | null>
      openFolder(): Promise<string | null>
      saveFile(defaultName?: string): Promise<string | null>
    }
    app: {
      getConfig(): Promise<import('@shared/types').AppConfig>
      setConfig(patch: Partial<import('@shared/types').AppConfig>): Promise<import('@shared/types').AppConfig>
    }
    win: {
      minimize(): void
      toggleMaximize(): void
      close(): void
    }
    onMenuCommand(cb: (cmd: import('@shared/types').MenuCommand) => void): () => void
    onWinState(cb: (state: { maximized: boolean }) => void): () => void
  }
}
