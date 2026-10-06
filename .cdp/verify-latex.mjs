/* LaTeX 导出（5.5）验证：转换器全要素断言 + 导出弹窗预览 */
const base = 'http://127.0.0.1:9222'
const pages = await (await fetch(`${base}/json`)).json()
const page = pages.find((p) => p.type === 'page' && p.url.includes('localhost:5173'))
if (!page) throw new Error('no page target')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
function send(method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res) => pending.set(id, res))
}
async function evaljs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error('eval fail: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300))
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fs = await import('node:fs')
const pinia = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
const ui = `${pinia}.get('ui')`
const docs = `${pinia}.get('documents')`

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`) }
}

for (let i = 0; i < 40; i++) { if (await evaljs(`!document.getElementById('boot-splash')`)) break; await sleep(500) }
await send('Page.enable')
await send('Page.reload')
await sleep(2500)
for (let i = 0; i < 30; i++) { if (await evaljs(`!document.getElementById('boot-splash')`)) break; await sleep(500) }
await evaljs(`${docs}.activateHome()`)
await evaljs(`${docs}.newDoc()`)
await sleep(300)

/* ---------- 转换器全要素 ---------- */
console.log('\n== 转换器（mdToLaTeX 全要素）==')
const SAMPLE = [
  '# 标题一',
  '',
  '正文段落，含 **加粗**、*斜体*、~~删除线~~、==高亮==、^上标^、~下标~、`行内代码`。',
  '',
  '特殊字符转义：100% & 3_4 #号 $花 {花} ~波浪 ^尖 \\反斜杠',
  '',
  '链接 [墨匣](https://inkbox.app) 与远程图 [占位](https://cdn.example.com/a.png)。',
  '',
  '![示意|60%|center](./示意.assets/pic%20name.png)',
  '',
  '- 无序一',
  '- 无序二',
  '  - 嵌套项',
  '',
  '1. 第一',
  '2. 第二',
  '',
  '- [x] 已完成事项',
  '- [ ] 未完成事项',
  '',
  '> 引用一行',
  '> 引用两行',
  '',
  '| 左 | 中 | 右 |',
  '| --- | :-: | --: |',
  '| a_1 | b&c | d\\|e |',
  '',
  '行内公式 $E=mc^2$ 混排。',
  '',
  '$$',
  '\\\\int_0^1 x^2 \\\\, dx = \\\\frac{1}{3}',
  '$$',
  '',
  '---',
  '',
  '脚注引用[^1]在这里。',
  '',
  '[^1]: 这是脚注的内容说明。',
  '',
  '[TOC]',
  '',
  '```python',
  'def hello():',
  '    print("hi")  # 注释',
  '```',
  '',
  ':smile: emoji'
].join('\n')

await evaljs(`${docs}.updateContent(${docs}.active.id, ${JSON.stringify(SAMPLE)})`)
await sleep(300)
const tex = await evaljs(`import('/src/services/latex.ts').then(m => m.mdToLaTeX(${docs}.active.content))`)
check('转换器可调用且输出 documentclass', typeof tex === 'string' && tex.includes('\\documentclass[UTF8,11pt]{ctexart}'))
check('XeLaTeX 注释头', tex.includes('XeLaTeX'))
const has = (needle) => tex.includes(needle)
check('标题 → \\section', has('\\section{标题一}'))
check('加粗 → \\textbf', has('\\textbf{加粗}'))
check('斜体 → \\emph', has('\\emph{斜体}'))
check('删除线 → \\sout', has('\\sout{删除线}'))
check('高亮 → \\hl', has('\\hl{高亮}'))
check('上标 → \\textsuperscript', has('\\textsuperscript{上标}'))
check('下标 → \\textsubscript', has('\\textsubscript{下标}'))
check('行内代码 → \\texttt', has('\\texttt{行内代码}'))
check('特殊字符全转义', has('100\\%') && has('3\\_4') && has('\\#号') && has('\\$花') && has('\\{花\\}') && has('\\textasciitilde{}波浪') && has('\\textasciicircum{}尖') && has('\\textbackslash{}反斜杠'))
check('链接 → \\href', has('\\href{https://inkbox.app}{墨匣}'))
check('远程图 → href 占位', has('\\href{https://cdn.example.com/a.png}'))
check('本地图 → includegraphics + 解码空格路径', /\\includegraphics\[width=0\.60\\linewidth\]\{"\.\/示意\.assets\/pic name\.png"\}/.test(tex), tex.match(/\\includegraphics[^\n]*/)?.[0])
check('无序列表', has('\\begin{itemize}') && has('\\item 无序一') && has('\\item 嵌套项'))
check('有序列表', has('\\begin{enumerate}') && has('\\item 第一'))
check('任务列表 → \\boxtimes/\\square', has('$\\boxtimes$ 已完成事项') && has('$\\square$ 未完成事项'))
check('引用 → quote', has('\\begin{quote}') && has('引用一行'))
check('表格 tabular 对齐列', has('\\begin{tabular}{|l|c|r|}') && has('a\\_1 & b\\&c') && has('d|e'))
check('行内公式 passthrough', has('$E=mc^2$'))
check('块公式 → \\[ \\]', has('\\[\n\\\\int_0^1 x^2 \\\\, dx = \\\\frac{1}{3}\n\\]'))
check('hr → rule', has('\\noindent\\rule{\\linewidth}{0.4pt}'))
check('脚注内联 \\footnote', has('\\footnote{这是脚注的内容说明。}') && !has('footnote_block'))
check('[TOC] → \\tableofcontents', has('\\tableofcontents'))
check('代码块 → lstlisting + language', /\\begin\{lstlisting\}\[language=Python\]/.test(tex) && has('print("hi")'))
check('emoji 短代码转 unicode', has('😄'))
check('正文不含未转义的裸 &', !/\n[^\\]*[^\\]&/.test(tex.split('\\begin{tabular}')[0] ?? ''))

/* 崩溃检查：列表/表格/脚注混排后的结构完整性 */
check('以 \\end{document} 结尾', tex.trimEnd().endsWith('\\end{document}'))

/* ---------- 导出弹窗预览 ---------- */
console.log('\n== 导出弹窗 ==')
await evaljs(`${ui}.openExport()`)
await sleep(600)
const clicked = await evaljs(`(() => { const b = [...document.querySelectorAll('.seg button')].find(x => x.textContent.trim() === 'LaTeX'); if (!b) return false; b.click(); return true })()`)
check('格式段含 LaTeX 按钮', clicked)
await sleep(1600) // 预览防抖 600ms + 生成
const texView = await evaljs(`document.querySelector('.tex-view')?.textContent?.slice(0, 60) ?? null`)
check('预览区展示 LaTeX 源码', texView !== null && texView.includes('\\documentclass'), String(texView))
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('.cdp/shot-latex.png', Buffer.from(shot.result.data, 'base64'))
await evaljs(`${ui}.exportOpen = false`)
await sleep(300)

/* ---------- 清理：未命名测试标签（脏 → 确认丢弃） ---------- */
await evaljs(`${docs}.closeActive()`)
await sleep(400)
if (await evaljs(`!!${ui}.confirm`)) {
  await evaljs(`${ui}.resolveConfirm(true)`)
  await sleep(300)
}
check('测试标签已清理', await evaljs(`${docs}.active?.isHome === true || !${docs}.tabs.some(t => t.dirty && !t.path)`))

console.log(`\n结果：${pass} 过 / ${fail} 败`)
ws.close()
process.exit(fail > 0 ? 1 : 0)
