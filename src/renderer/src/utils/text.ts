export interface TextStats {
  /** 非空白字符数 */
  chars: number
  /** 词数（CJK 按字计 + 西文按词计） */
  words: number
  /** 预估阅读分钟（300 词/分，向上取整） */
  minutes: number
}

export function textStats(src: string): TextStats {
  const chars = src.replace(/\s/g, '').length
  const cjk = (src.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length
  const latin = (src.match(/[a-zA-Z0-9]+(?:['’\u2010-][a-zA-Z0-9]+)*/g) ?? []).length
  const words = cjk + latin
  const minutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / 300))
  return { chars, words, minutes }
}
