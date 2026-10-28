/**
 * 自研拼写检查（4.2 的引擎替换）：
 * Chromium/Electron 原生拼写服务在本机不可用（Windows OS 拼写引擎对中文
 * 系统环境不检查英文；hunspell 词典依赖 Electron 已禁用的组件更新器，
 * bdic 不会下载）——改用 nspell + dictionary-en 词表自研，行为完全可控：
 * - 引擎懒加载：开启拼写检查后才拉词典（552KB），查词结果 Map 缓存
 * - 只检查 ≥2 字母的英文词；中文/数字/符号天然跳过
 * - 三端共用：即显（PM 装饰）、源码（CM 装饰）、预览（DOM 包装）
 */

export interface SpellHit {
  start: number
  end: number
  word: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engine: any = null
let loading: Promise<void> | null = null

/** 懒加载词典引擎；失败返回 false（开关仍开但不出波浪线，不反复重试）。
 *  词表经 ?raw 构建期内联（dictionary-en 主入口是 Node 专用、内部读文件，
 *  浏览器端不可用）；552KB 走独立 chunk，开启拼写才拉取 */
export function ensureSpellEngine(): Promise<boolean> {
  if (engine) return Promise.resolve(true)
  loading ??= (async () => {
    try {
      const [{ default: Nspell }, { default: aff }, { default: dic }] = await Promise.all([
        import('nspell'),
        import('@/assets/dict/en.aff?raw'),
        import('@/assets/dict/en.dic?raw')
      ])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      engine = new (Nspell as any)({ aff, dic })
    } catch (err) {
      console.error('[spellcheck] dictionary load failed:', err)
    }
  })()
  return loading.then(() => engine !== null)
}

export function spellEngineReady(): boolean {
  return engine !== null
}

const queryCache = new Map<string, boolean>()

function isWrong(word: string): boolean {
  const key = word.toLowerCase()
  const hit = queryCache.get(key)
  if (hit !== undefined) return hit
  const bad = !engine.correct(key)
  queryCache.set(key, bad)
  if (queryCache.size > 20000) queryCache.clear()
  return bad
}

// 词正则不含弯引号（’ 是智能标点的排版产物，粘进来会让 quoted’ 这类
// 词查不到而误报）；行内码等非自然语言由调用方按结构跳过
const WORD_RE = /[A-Za-z][A-Za-z'-]*/g

/** 找出一段文本中的错词（偏移按 UTF-16 code unit，与 JS/PM 位置一致） */
export function findMisspells(text: string): SpellHit[] {
  if (!engine) return []
  const hits: SpellHit[] = []
  WORD_RE.lastIndex = 0
  for (let m = WORD_RE.exec(text); m; m = WORD_RE.exec(text)) {
    if (m[0].length < 2) continue
    if (isWrong(m[0])) hits.push({ start: m.index, end: m.index + m[0].length, word: m[0] })
  }
  return hits
}
