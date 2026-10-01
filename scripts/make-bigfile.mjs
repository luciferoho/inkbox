/**
 * 生成大文档压测样例（输出到仓库外层 inkbox-workspace/压测-大文档.md，
 * 避免提交进 git；不随安装包分发、不进 JS bundle）：
 * 章节化组织的真实感 Markdown——多级标题（大纲面板）、段落、行内标记、
 * 代码块（多语言）、表格、任务列表、引用、脚注、公式、少量 mermaid 与 emoji。
 * 内容按素材池轮换，避免无脑重复导致滚动/大纲分布失真。
 *
 * 用法：node scripts/make-bigfile.mjs [目标字节，默认 1048576]
 */

import { writeFileSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const TARGET = Number(process.argv[2] ?? 1048576)
// inkbox/scripts → inkbox → inkbox-workspace（仓库外层）
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../压测-大文档.md')

const NL = '\n'

/* ---------- 素材池（章主题 → 若干正文段 / 配图块） ---------- */

const CHAPTERS = [
  {
    title: '渲染管线',
    intro:
      '墨匣的渲染管线以 markdown-it 为核心，配合自研的块级映射实现双栏同步滚动。每个顶层块在渲染时都会打上 data-source-line 标记，滚动时据此把视口顶换算回源码行号。',
    paras: [
      '同步滚动的精度取决于块映射的密度：图表渲染完成后高度会变化，因此每轮 mermaid 渲染结束都会重新收集一次块位置，避免滚动错位累积。',
      '代码高亮采用 highlight.js 按需注册语言子集，未注册的语言回退纯文本渲染，兼顾启动体积与常见场景的着色需求。',
      '预览面板对大文档做了自适应防抖：内容超过两百 KB 时把重渲染间隔从 120ms 拉长到 450ms，连续输入不再触发全文重绘风暴。'
    ]
  },
  {
    title: '编辑器内核',
    intro:
      '源码模式基于 CodeMirror 6，即显模式基于 Milkdown（ProseMirror）。两套引擎共享 documents store 作为唯一数据源，切换模式时通过整档替换交接内容。',
    paras: [
      'CodeMirror 的虚拟滚动保证万行文档也只渲染视口内的行；查找替换的自建高亮器同样只覆盖可见区间，计数则由 SearchCursor 全文迭代完成。',
      '即显模式的图片路径转换做在数据层：进入时把相对路径改写为 luci-img 协议，序列化回源码时再还原，绕开 ProseMirror 的 DOM 同步恢复机制。',
      '撤销栈由 ProseMirror history 插件承载，五百毫秒内的连续输入会合并为一个撤销步，全部替换则始终是单事务，一步即可回退。'
    ]
  },
  {
    title: '图表与公式',
    intro:
      'mermaid 图表按需异步加载并按主题缓存渲染结果；KaTeX 公式同样懒加载，货币符号防误判由词法边界规则处理。',
    paras: [
      '主题切换时图表在离屏节点按新配色重绘，完成后原地替换 innerHTML——不重建整页 DOM，滚动位置与双栏对齐都不受影响。',
      '饼图配色向 ECharts 质感看齐：不透明扇区加纸面描边形成间隔，标题与图例字号分别设定，浅深两套主题各自显式设色。',
      '流程图边标签去掉背景块后，箭头中段的文字与版面融合更自然；edgeLabelBackground 使用实际背景色值而非透明色，避免被混成暗底。'
    ]
  },
  {
    title: '文件与工作区',
    intro:
      '文件树监听工作区目录的递归变更，外部增删改自动刷新并保持展开态；外部修改检测以写盘快照识别自身保存的回声。',
    paras: [
      '自动保存采用定时加失焦双触发，计时起点是上次成功保存而非首次编辑，避免「回车换行就提示已保存」的错觉。',
      '草稿恢复做了三重落盘：编辑防抖、周期兜底、失焦即存；写盘走临时文件加原子改名，中断不留半截文件。',
      '多窗口之间标签可互相拖拽，文件占用按窗口登记，跨窗口打开同一文件会提示已在别处打开。'
    ]
  },
  {
    title: '导出矩阵',
    intro: '导出支持 HTML（单文件内联）、PDF（打印管线）与 PNG 长图三种格式，本地图片随 HTML 内联为 base64。',
    paras: [
      'PDF 导出提供页边距三档与横竖向选择，页脚可带页码；产物用 pdf.js 做真实渲染预览，所见即所得。',
      '长图导出在离屏绘制帧上整页截取，绕开 capturePage 在 Windows 离屏窗口下的限制。',
      'Word 导出曾因转换保真度不足被移除——SVG 图表与公式需要整体栅格化，编辑价值有限；需要时可先导 HTML 再用 Word 打开。'
    ]
  },
  {
    title: '界面与主题',
    intro: '界面为自绘一体化标题栏的「墨匣纸面」原创设计，明暗双主题基于 CSS 变量，切换不重建内容 DOM。',
    paras: [
      '选区高亮使用独立的钢蓝色令牌，与琥珀色全文高亮、查找命中在视觉上分层，明暗两档都经过截图校准。',
      '禅模式隐藏标签栏、状态栏与侧栏，Esc 退出并恢复侧栏原状；专注模式淡出非当前段落，打字机模式让光标行居中。',
      '纸宽与侧栏宽是窗口私有偏好：不同尺寸的窗口各自记忆，互不同步；字号与行距则是全局偏好，跨窗口即时跟随。'
    ]
  }
]

const CODE_BLOCKS = [
  { lang: 'javascript', code: ['function scrollSync(line, frac) {', '  const block = blockMap.find(line)', '  if (!block) return', '  const top = block.top + block.height * frac', '  scroller.scrollTop = top - MARGIN', '}'].join(NL) },
  { lang: 'typescript', code: ['interface FindQuery {', '  text: string', '  caseSensitive: boolean', '  regexp: boolean', '  wholeWord: boolean', '}'].join(NL) },
  { lang: 'python', code: ['def word_count(text: str) -> dict:', '    counts = {}', '    for w in text.split():', '        counts[w] = counts.get(w, 0) + 1', '    return counts'].join(NL) },
  { lang: 'bash', code: ['npm run build', 'npm run preview', 'npx electron-vite preview  # 跑打包产物验证'].join(NL) },
  { lang: 'json', code: ['{', '  "theme": "dark",', '  "autosave": { "enabled": true, "intervalMs": 15000 },', '  "editor": { "fontSize": 16, "lineHeight": 1.7 }', '}'].join(NL) },
  { lang: 'yaml', code: ['appId: com.lucifer.inkbox', 'productName: Inkbox', 'files:', '  - out/**', 'asar: true'].join(NL) },
  { lang: 'sql', code: ['SELECT lang, COUNT(*) AS hits', 'FROM code_blocks', 'WHERE doc_id = 42', 'GROUP BY lang', 'ORDER BY hits DESC'].join(NL) }
]

const TABLES = [
  ['| 模式 | 引擎 | 定位 |', '| -- | -- | -- |', '| 即显 | Milkdown | 所见即所得 |', '| 源码 | CodeMirror | 纯文本着色 |', '| 双栏 | CM + markdown-it | 同步滚动 |'],
  ['| 导出格式 | 载体 | 说明 |', '| -- | -- | -- |', '| HTML | 单文件 | 样式与图片内联 |', '| PDF | 打印管线 | 页边距与页码可调 |', '| PNG | 离屏截取 | 长图整页 |'],
  ['| 快捷键 | 作用 | 模式 |', '| -- | -- | -- |', '| Ctrl+F | 查找替换 | 全模式 |', '| Ctrl+Shift+F | 全局搜索 | 工作区 |', '| F8/F9/F10 | 专注/打字机/禅 | 全局 |']
]

const QUOTES = [
  '> 本地优先：文件在磁盘上，工具只是窗口。',
  '> 滚动同步的意义不是像素对齐，而是思路不断。',
  '> 性能优化的第一步永远是测量，第二步才是改动。'
]

const TASKS = [
  ['- [x] 基线测量：启动时间与大文档渲染', '- [ ] 代码签名（待证书）', '- [ ] macOS / Linux 构建'],
  ['- [x] 即显模式查找替换', '- [x] 全字匹配开关', '- [ ] 正则替换预览高亮']
]

const MATH = ['行内公式 $E = mc^2$ 与块级公式：', '', '$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$'].join(NL)

/** mermaid 图按编号差异化（同一份代码会被渲染缓存命中，压测就失去意义） */
function mermaidOf(n) {
  return ['```mermaid', `flowchart LR`, `  A${n}[打开文档] --> B{大小?}`, `  B -- <200KB --> C${n}[短防抖]`, `  B -- 大文档 --> D${n}[长防抖]`, `  C${n} --> E${n}[渲染]`, `  D${n} --> E${n}`, '```'].join(NL)
}

/* ---------- 组装 ---------- */

let out = []
out.push('# 压测大文档')
out.push('')
out.push('> 本文件由 scripts/make-bigfile.mjs 生成（内容为项目纪实素材，非真实笔记），用于大文档下的打开、滚动、渲染与查找性能验证。不随安装包分发。')
out.push('')

let ch = 0
let para = 0
let bytes = 0
let stats = { headings: 0, code: 0, tables: 0, mermaid: 0, quotes: 0, tasks: 0, math: 0 }

while (bytes < TARGET) {
  const c = CHAPTERS[ch % CHAPTERS.length]
  const chNo = Math.floor(ch / CHAPTERS.length) * CHAPTERS.length + (ch % CHAPTERS.length) + 1
  out.push(`## 第 ${chNo} 章 · ${c.title}`)
  out.push('')
  out.push(c.intro)
  out.push('')
  stats.headings++

  for (let s = 1; s <= 3 && bytes < TARGET; s++) {
    out.push(`### ${chNo}.${s} ${c.title}小节`)
    out.push('')
    stats.headings++

    const p1 = c.paras[para++ % c.paras.length]
    out.push(p1.replace(/^/, '其中一点：'))
    out.push('')
    out.push(`行内标记混排：**加粗**、*斜体*、~~删除线~~、\`行内代码\`、==高亮==、[链接](https://example.com/doc-${chNo}-${s})、:memo: 与 :rocket:。`)
    out.push('')

    const cb = CODE_BLOCKS[(ch * 3 + s) % CODE_BLOCKS.length]
    out.push('```' + cb.lang)
    out.push(cb.code)
    out.push('```')
    out.push('')
    stats.code++

    if ((ch + s) % 2 === 0) {
      out.push(TABLES[(ch + s) % TABLES.length].join(NL))
      out.push('')
      stats.tables++
    }
    if ((ch + s) % 3 === 0) {
      out.push(QUOTES[(ch + s) % QUOTES.length])
      out.push('')
      stats.quotes++
    }
    if ((ch + s) % 4 === 0) {
      out.push(TASKS[(ch >> 1) % TASKS.length].join(NL))
      out.push('')
      stats.tasks++
    }
    if ((ch + s) % 5 === 0) {
      out.push(MATH)
      out.push('')
      stats.math++
    }
    if ((ch + s) % 7 === 0) {
      out.push(mermaidOf(ch * 3 + s))
      out.push('')
      stats.mermaid++
    }
    out.push('---')
    out.push('')

    bytes = Buffer.byteLength(out.join(NL), 'utf8')
  }
  // 脚注（少量）
  out.push(`本章脚注[^${chNo}]：内容与素材池轮换相关。`)
    ; (out.__footnotes ??= []).push(`[^${chNo}]: 素材来自项目开发纪实，循环取用。`)
  out.push('')
  ch++
}

// 汇总脚注（若有）
const footnotes = out.__footnotes
if (footnotes?.length) out.push(...footnotes, '')

const content = out.join(NL) + NL
writeFileSync(OUT, content, 'utf8')
const size = statSync(OUT).size
console.log(`生成 ${OUT}`)
console.log(`大小 ${size} 字节（目标 ${TARGET}）｜章 ${ch}｜${JSON.stringify(stats)}`)
