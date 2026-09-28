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
      readBinary(path: string): Promise<string>
      create(path: string, isDir: boolean): Promise<void>
      rename(oldPath: string, newPath: string): Promise<void>
      delete(path: string): Promise<void>
      readDir(path: string): Promise<import('@shared/types').DirEntry[]>
    }
    dialog: {
      openFile(): Promise<string | null>
      openFolder(): Promise<string | null>
      saveFile(defaultName?: string, kind?: 'md' | 'html'): Promise<string | null>
    }
    export: {
      pdf(
        html: string,
        opts: { margin: 'normal' | 'narrow' | 'none'; landscape: boolean },
        defaultName?: string
      ): Promise<string | null>
      previewPdf(
        html: string,
        opts: { margin: 'normal' | 'narrow' | 'none'; landscape: boolean }
      ): Promise<string>
    }
    drafts: {
      save(id: number, payload: import('@shared/types').DraftPayload): Promise<void>
      list(): Promise<import('@shared/types').DraftPayload[]>
      clear(id: number): Promise<void>
      clearAll(): Promise<void>
    }
    watch: {
      watch(path: string): void
      unwatch(path: string): void
      onFileChanged(cb: (payload: { path: string }) => void): () => void
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
