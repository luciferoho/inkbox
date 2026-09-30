import { ipcMain } from 'electron'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SearchFileResult, SearchOptions, SearchOutcome } from '@shared/types'

/**
 * 工作区跨文件搜索：
 * - 递归收集文本文件（.md/.markdown/.mdown/.txt），跳过隐藏目录与依赖目录
 * - 纯文本子串匹配（大小写可选）；单文件/总量限流，避免大工作区拖垮 UI
 */

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.idea', '.vscode', '.assets'])
const EXTS = new Set(['.md', '.markdown', '.mdown', '.txt'])
const MAX_DEPTH = 8
const MAX_FILES = 2000
const MAX_PER_FILE = 30
const MAX_TOTAL = 400
const LINE_CLIP = 160

async function collectFiles(dir: string, out: string[], depth = 0): Promise<void> {
  if (out.length >= MAX_FILES || depth > MAX_DEPTH) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      await collectFiles(p, out, depth + 1)
    } else {
      const dot = e.name.lastIndexOf('.')
      if (dot >= 0 && EXTS.has(e.name.slice(dot).toLowerCase())) out.push(p)
    }
  }
}

export function registerSearchIpc(): void {
  ipcMain.handle(
    'search:run',
    async (_e, root: string, query: string, opts: SearchOptions): Promise<SearchOutcome> => {
      const q = opts?.caseSensitive ? query : query.toLowerCase()
      if (!root || !q.trim()) return { files: [], truncated: false, scanned: 0 }
      const files: string[] = []
      await collectFiles(root, files)
      const filesOut: SearchFileResult[] = []
      let total = 0
      let truncated = false
      for (const p of files) {
        let content: string
        try {
          content = await readFile(p, 'utf-8')
        } catch {
          continue // 读取失败（权限/二进制）跳过
        }
        const lines = content.split(/\r?\n/)
        const matches: SearchFileResult['matches'] = []
        for (let i = 0; i < lines.length; i++) {
          const hay = opts?.caseSensitive ? lines[i] : lines[i].toLowerCase()
          if (hay.includes(q)) {
            matches.push({ line: i + 1, text: lines[i].trim().slice(0, LINE_CLIP) })
            if (matches.length >= MAX_PER_FILE) break
          }
        }
        if (matches.length > 0) {
          filesOut.push({
            path: p,
            name: p.split(/[\\/]/).pop() || p,
            matches
          })
          total += matches.length
          if (total >= MAX_TOTAL) {
            truncated = true
            break
          }
        }
      }
      return { files: filesOut, truncated, scanned: files.length }
    }
  )
}
