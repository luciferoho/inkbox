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
      listFiles(root: string): Promise<string[]>
    }
    search: {
      run(root: string, query: string, opts: import('@shared/types').SearchOptions): Promise<import('@shared/types').SearchOutcome>
    }
    dialog: {
      openFile(): Promise<string | null>
      openFolder(): Promise<string | null>
      openImage(): Promise<string | null>
      saveFile(defaultName?: string, kind?: 'md' | 'html'): Promise<string | null>
    }
    export: {
      pdf(html: string, opts: import('@shared/types').PdfExportOptions, defaultName?: string): Promise<string | null>
      previewPdf(html: string, opts: import('@shared/types').PdfExportOptions): Promise<string>
      png(html: string, defaultName?: string): Promise<{ path: string; truncated: boolean } | null>
    }
    drafts: {
      save(key: string, payload: import('@shared/types').DraftPayload): Promise<void>
      list(): Promise<{ key: string; draft: import('@shared/types').DraftPayload }[]>
      clear(key: string): Promise<void>
      clearAll(): Promise<void>
    }
    drag: {
      begin(doc: import('@shared/types').DetachDoc): void
      end(): void
      take(): Promise<import('@shared/types').DetachDoc | null>
      onConsumed(cb: () => void): () => void
    }
    doc: {
      tryOpen(path: string): Promise<'ok' | 'elsewhere'>
      acquire(path: string): void
      release(path: string): void
      onActivateTab(cb: (path: string) => void): () => void
    }
    session: {
      save(key: string, payload: import('@shared/types').SessionPayload): Promise<void>
      load(): Promise<{ key: string; session: import('@shared/types').SessionPayload }[]>
      clearOthers(keepKey: string): Promise<void>
    }
    watch: {
      watch(path: string): void
      unwatch(path: string): void
      onFileChanged(cb: (payload: { path: string }) => void): () => void
      watchWorkspace(root: string): void
      unwatchWorkspace(root: string): void
      onWsChanged(cb: (payload: { root: string }) => void): () => void
    }
    app: {
      getConfig(): Promise<import('@shared/types').AppConfig>
      setConfig(patch: Partial<import('@shared/types').AppConfig>): Promise<import('@shared/types').AppConfig>
      setLocale(locale: import('@shared/types').AppConfig['locale']): Promise<void>
      setShortcutsCapture(on: boolean): void
      debugMenuAccels(): Promise<Record<string, string | null>>
      debugMenuInvoke(id: string): Promise<boolean>
      getWindowPrefs(key: string): Promise<import('@shared/types').WindowPrefs>
      setWindowPrefs(key: string, patch: Partial<import('@shared/types').WindowPrefs>): Promise<void>
      onConfigChanged(cb: (cfg: import('@shared/types').AppConfig) => void): () => void
    }
    image: {
      upload(fileName: string, dataUrl: string): Promise<{ ok: boolean; url?: string; error?: string }>
    }
    win: {
      minimize(): void
      toggleMaximize(): void
      close(): void
      openDoc(doc: import('@shared/types').DetachDoc): void
      takeInitialDoc(): Promise<import('@shared/types').InitialDoc>
      closeConfirmed(): Promise<void>
      onRequestClose(cb: () => void): () => void
    }
    onMenuCommand(cb: (cmd: import('@shared/types').MenuCommand) => void): () => void
    onWinState(cb: (state: { maximized: boolean }) => void): () => void
  }
}
