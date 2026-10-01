let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
const VBAR = `[...document.querySelectorAll('.find-bar')].find(b => b.offsetWidth || b.offsetHeight)`
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}
const setQ = async (text) => {
  await ev(`(() => { const b = ${VBAR}; if (!b) return 'NO BAR'; const i = b.querySelector('.find-input'); i.focus(); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); return 'set:' + i.value })()`)
  await sleep(500)
}
const label = () => ev(`(() => { const b = ${VBAR}; return b ? b.querySelector('.find-count').textContent : 'NO BAR' })()`)
const domHits = (cls) => ev(`document.querySelectorAll('${cls}').length`)
const clicks = async (txt, cls) => { const r = await ev(`(() => { const b = ${VBAR}; if (!b) return 'NO BAR'; const x = [...b.querySelectorAll('${cls}')].find(e => e.textContent.trim() === '${txt}'); if (!x) return 'MISSING among:' + [...b.querySelectorAll('${cls}')].map(e => e.textContent.trim()).join('|'); x.click(); return 'ok' })()`); console.log('  click', cls, JSON.stringify(txt), '→', r); return r }
const scrollOf = (sel) => ev(`document.querySelector('${sel}')?.scrollTop ?? -1`)

;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }

  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  await ev(`${PINIA}._s.get('documents').newDoc(); 'new'`)
  await sleep(400)
  if ((await ev(`${PINIA}._s.get('documents').active?.path`)) !== null) throw new Error('SAFETY')
  await ev(`(() => {
    const docs = ${PINIA}._s.get('documents')
    const lines = ['cat category catalog cat']
    for (let i = 1; i < 30; i++) lines.push('填充行' + i)
    lines.push('尾部行31')
    for (let i = 32; i < 44; i++) lines.push('尾部行' + i)
    docs.updateContent(docs.active.id, lines.join(String.fromCharCode(10, 10)))
    return 'ok'
  })()`)

  /* A. 即显：可见区全字匹配 + 下方命中自动跳转 */
  await ev(`${PINIA}._s.get('ui').setEditorMode('wysiwyg'); 'm'`)
  await sleep(1600)
  await ev(`${PINIA}._s.get('ui').requestFind(); 'open'`)
  await sleep(400)
  await setQ('cat')
  console.log('[A] label:', await label(), '| visible pm hits:', await domHits('.pm-find-hit'))
  await clicks(String.fromCharCode(92) + 'b', '.find-tg')
  await sleep(500)
  console.log('[A] after \b → label:', await label(), '| visible pm hits:', await domHits('.pm-find-hit'))
  await setQ('尾部')
  await sleep(200)
  console.log('[A] query 尾部 → label:', await label(), '| auto-jump scrollTop:', await scrollOf('.wysiwyg-host'))
  // 关闭（Esc 打在按钮上：根节点接管）
  await clicks('↓', '.find-btn')
  await ev(`(() => { const b = ${VBAR}; const btn = b.querySelector('.find-btn'); btn.focus(); btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); return 'esc' })()`)
  await sleep(350)
  console.log('[A] esc(button focus) →', await ev(`(() => { const b = ${VBAR}; return b ? 'STILL OPEN' : 'closed' })()`))

  /* B. 预览正向查找 */
  await ev(`${PINIA}._s.get('ui').setEditorMode('preview'); 'preview'`)
  await sleep(1000)
  await ev(`${PINIA}._s.get('ui').requestFind(); 'open'`)
  await sleep(400)
  console.log('[B] searchOnly:', await ev(`(() => { const b = ${VBAR}; return !b.querySelector('.find-input-repl') })()`))
  await setQ('尾部')
  console.log('[B] pv hits:', await domHits('.pv-find-hit'), '| label:', await label(), '| auto-jump scroll:', await scrollOf('.preview-scroll'))
  await clicks('↓', '.find-btn'); await sleep(450)
  console.log('[B] after ↓:', await scrollOf('.preview-scroll'), '| active:', await ev(`[...document.querySelectorAll('.pv-find-hit')].findIndex(e => e.classList.contains('pv-find-hit-active'))`))
  await clicks('✕', '.find-btn'); await sleep(350)
  console.log('[B] closed:', await ev(`(() => { const b = ${VBAR}; return b ? 'STILL OPEN' : 'closed' })()`), '| cleared:', (await domHits('.pv-find-hit')) === 0)

  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  await sleep(400)
  console.log('tabs:', await ev(`JSON.stringify(${PINIA}._s.get('documents').tabs.map(t => t.name))`), '| clean:', await ev(`${PINIA}._s.get('documents').tabs.every(t => !t.dirty) ? 'yes' : 'NO'`))
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
