let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)

  const size = await ev(`(() => {
    const docs = ${PINIA}._s.get('documents')
    const ui = ${PINIA}._s.get('ui')
    ui.setEditorMode('split')
    const unit = [
      '## 性能测试章节标题',
      '这是一段正文文字，包含一些中文与 English 混排内容，用来模拟真实笔记的段落密度与长度，测速用。',
      '第二段正文，包含 **加粗**、*斜体*、\`行内代码\` 与 [链接](https://example.com) 的混排。',
      '\`\`\`javascript',
      'function perf(n) {',
      '  let acc = 0',
      '  for (let i = 0; i < n; i++) acc += i * 2',
      '  return acc',
      '}',
      'console.log(perf(100))',
      '\`\`\`',
      '| 列A | 列B | 列C |',
      '| -- | -- | -- |',
      '| 数据 | 123 | 测试 |',
      '- 列表项一',
      '- 列表项二'
    ].join(String.fromCharCode(10))
    const big = Array.from({ length: 2900 }, (_, i) => unit.replace('性能测试章节标题', '章节-' + i)).join(String.fromCharCode(10, 10))
    docs.newDoc()
    docs.updateContent(docs.active.id, big)
    ui.notifyReload()  // CM 只认 activeId/extReloadSeq 两个同步路径
    return big.length
  })()`)
  console.log('doc bytes:', size)

  const t = await ev(`(() => new Promise((resolve) => {
    const t0 = performance.now()
    let cmAt = -1, pvAt = -1
    const id = setInterval(() => {
      const lines = document.querySelectorAll('.cm-line').length
      const pvLen = (document.querySelector('.md-preview')?.textContent ?? '').length
      if (cmAt < 0 && lines > 20) cmAt = performance.now() - t0
      if (pvAt < 0 && pvLen > 500000) pvAt = performance.now() - t0
      if ((cmAt >= 0 && pvAt >= 0) || performance.now() - t0 > 30000) {
        clearInterval(id)
        resolve({ cm_ready_ms: Math.round(cmAt), preview_full_ms: Math.round(pvAt), pvChars: pvLen })
      }
    }, 15)
  }))()`)
  console.log('open→CM ready→preview:', JSON.stringify(t))

  // 输入延迟（CM 事务 → store）
  await ev(`(() => { document.querySelector('.cm-content')?.focus(); window.__t0 = performance.now(); return 'f' })()`)
  await send('Input.insertText', { text: '墨匣测速' })
  const tType = await ev(`(() => new Promise((resolve) => {
    const tab = ${PINIA}._s.get('documents').active
    const id = setInterval(() => {
      if (tab.content.endsWith('墨匣测速')) { clearInterval(id); resolve({ input_to_state_ms: Math.round(performance.now() - window.__t0) }) }
      else if (performance.now() - window.__t0 > 8000) { clearInterval(id); resolve({ timeout: true }) }
    }, 8)
  }))()`)
  console.log('typing:', JSON.stringify(tType))

  // 预览重渲染（120ms 防抖 + 全文渲染）
  const tPv = await ev(`(() => new Promise((resolve) => {
    const t0 = performance.now()
    const id = setInterval(() => {
      const pv = document.querySelector('.md-preview')?.textContent ?? ''
      if (pv.includes('墨匣测速')) { clearInterval(id); resolve({ preview_rerender_ms: Math.round(performance.now() - t0) }) }
      else if (performance.now() - t0 > 20000) { clearInterval(id); resolve({ timeout: true }) }
    }, 20)
  }))()`)
  console.log('preview rerender:', JSON.stringify(tPv))

  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
