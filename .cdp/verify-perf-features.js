let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 400))
  return r.result.value
}
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  const errs = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const s = m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200)
      if (!s.includes('intlify')) errs.push(s)
    }
  })
  await send('Runtime.enable')

  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)

  // 1. 即显模式首次切换（异步 chunk 加载）
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); docs.newDoc(); docs.updateContent(docs.active.id, ['## 异步验证', '', '正文段落 **加粗** 内容。', '', '\`\`\`javascript', 'const a = 1', '\`\`\`', '', '| A | B |', '| - | - |', '| 1 | 2 |'].join(String.fromCharCode(10))); ui_notify = 0; return 'set' })()`.replace('ui_notify = 0', 'void 0'))
  await ev(`${PINIA}._s.get('ui').setEditorMode('wysiwyg'); 'm'`)
  await sleep(2500)
  console.log('[1] wysiwyg mounted:', await ev(`!!document.querySelector('.ProseMirror')`), '| headings:', await ev(`document.querySelectorAll('.ProseMirror h2').length`), '| tables:', await ev(`document.querySelectorAll('.ProseMirror table').length`))
  console.log('[1] content:', await ev(`JSON.stringify(${PINIA}._s.get('documents').active.content.slice(0, 30))`))

  // 2. 富文本粘贴（turndown 懒加载）：合成 paste 事件带 HTML 载荷
  await ev(`${PINIA}._s.get('ui').setEditorMode('edit'); 'edit'`)
  await sleep(800)
  const pasteResult = await ev(`(() => new Promise((resolve) => {
    const cm = document.querySelector('.cm-content')
    if (!cm) { resolve('NO CM'); return }
    cm.focus()
    const before = ${PINIA}._s.get('documents').active.content
    const dt = new DataTransfer()
    dt.setData('text/html', '<h3>粘贴标题</h3><p>带<strong>加粗</strong>与<a href="https://ex.com">链接</a>的段落</p><ul><li>项目一</li><li>项目二</li></ul><table><tr><td>甲</td><td>乙</td></tr></table>')
    dt.setData('text/plain', '粘贴标题 带加粗与链接的段落 项目一 项目二 甲 乙')
    const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    cm.dispatchEvent(evt)
    const id = setTimeout(() => resolve('TIMEOUT content=' + ${PINIA}._s.get('documents').active.content.slice(0, 80)), 4000)
    const poll = setInterval(() => {
      const now = ${PINIA}._s.get('documents').active.content
      if (now !== before) { clearInterval(poll); clearTimeout(id); resolve('PASTED:' + now.slice(0, 150)) }
    }, 50)
  }))()`)
  console.log('[2] rich paste:', pasteResult)

  // 3. 弹窗（异步组件）：设置页 + 导出
  await ev(`${PINIA}._s.get('ui').openSettings(); 's'`)
  await sleep(1200)
  console.log('[3] settings dialog:', await ev(`!!document.querySelector('.settings-dialog, [class*="settings"]')`))
  await ev(`(() => { const ui = ${PINIA}._s.get('ui'); ui.settingsOpen = false; return 'x' })()`)
  await ev(`${PINIA}._s.get('ui').openExport(); 'e'`)
  await sleep(1200)
  console.log('[3] export dialog:', await ev(`!!document.querySelector('[class*="export"], .export-dialog')`))
  await ev(`(() => { const ui = ${PINIA}._s.get('ui'); ui.exportOpen = false; return 'x' })()`)

  // 4. 预览代码高亮（hljs core 注册语言）
  await ev(`${PINIA}._s.get('ui').setEditorMode('preview'); 'p'`)
  await sleep(1500)
  console.log('[4] hljs colored js block:', await ev(`!!document.querySelector('.md-preview .hljs-keyword')`), '| langs sample:', await ev(`[...new Set([...document.querySelectorAll('.md-preview code[class]')].map(c => c.className))].slice(0, 4).join(' | ')`))

  console.log('[5] console errors:', errs.length ? errs.slice(0, 3) : 'none')
  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
