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
  await ev(`(() => { const b = ${VBAR}; if (!b) return 'NO BAR'; const i = b.querySelector('.find-input'); i.focus(); i.value = ''; i.dispatchEvent(new Event('input')); i.value = ${JSON.stringify('x')}; return 'r1' })()`)
  await ev(`(() => { const b = ${VBAR}; const i = b.querySelector('.find-input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); return 'set' })()`)
  await sleep(500)
}
const label = () => ev(`(() => { const b = ${VBAR}; return b ? b.querySelector('.find-count').textContent : 'NO BAR' })()`)
const clicks = (txt, cls) => ev(`(() => { const b = ${VBAR}; if (!b) return 'NO BAR'; const x = [...b.querySelectorAll('${cls}')].find(e => e.textContent === '${txt}'); if (!x) return 'MISSING'; x.click(); return 'ok' })()`)
const scrollOf = (sel) => ev(`document.querySelector('${sel}')?.scrollTop ?? -1`)

;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }

  // 清理所有未落盘标签（循环）+ 挂起弹窗
  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  await ev(`${PINIA}._s.get('documents').newDoc(); 'new'`)
  await sleep(400)
  const path = await ev(`${PINIA}._s.get('documents').active?.path`)
  if (path !== null) throw new Error('SAFETY: ' + path)
  await ev(`(() => {
    const docs = ${PINIA}._s.get('documents')
    const lines = Array.from({ length: 30 }, (_, i) => '填充行' + i + ' 普通文本')
    lines.push('cat category catalog cat')
    for (let i = 30; i < 44; i++) lines.push('尾部行' + i + ' 收尾')
    docs.updateContent(docs.active.id, lines.join(String.fromCharCode(10, 10)))
    return 'ok'
  })()`)

  /* ===== 1. 即显：导航滚动定位 ===== */
  await ev(`${PINIA}._s.get('ui').setEditorMode('wysiwyg'); 'm'`)
  await sleep(1600)
  await ev(`${PINIA}._s.get('ui').requestFind(); 'open'`)
  await sleep(400)
  await setQ('行')
  const st0 = await scrollOf('.wysiwyg-host')
  console.log('[1] label:', await label(), '| auto-jump scrollTop:', st0)
  await clicks('↓', '.find-btn'); await sleep(450)
  const st1 = await scrollOf('.wysiwyg-host')
  await clicks('↓', '.find-btn'); await sleep(450)
  const st2 = await scrollOf('.wysiwyg-host')
  await clicks('↑', '.find-btn'); await sleep(450)
  const st3 = await scrollOf('.wysiwyg-host')
  console.log('[1] nav:', st0, '→', st1, '→', st2, '↑', st3, '| moves:', st1 !== st0 || st2 !== st1 || st3 !== st2)

  /* ===== 2. 全字匹配 ===== */
  await setQ('cat')
  const c0 = await ev(`(() => { const b = ${VBAR}; return b.querySelectorAll('.pm-find-hit').length })()`)
  await clicks(String.fromCharCode(92) + 'b', '.find-tg'); await sleep(500)
  const c1 = await ev(`(() => { const b = ${VBAR}; return b.querySelectorAll('.pm-find-hit').length })()`)
  console.log('[2] cat:', c0, '→ whole-word:', c1, '| label:', await label())
  // 按钮焦点下按 Esc（根节点接管验证）
  await clicks('↓', '.find-btn'); await sleep(200)
  await ev(`(() => { const b = ${VBAR}; const btn = b.querySelector('.find-btn'); btn.focus(); btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); return 'esc-on-btn' })()`)
  await sleep(350)
  console.log('[2] esc closed bar:', await ev(`(() => { const b = ${VBAR}; return b ? 'STILL OPEN' : 'closed' })()`))

  /* ===== 3. 源码模式 ===== */
  await ev(`${PINIA}._s.get('ui').setEditorMode('edit'); 'edit'`)
  await sleep(700)
  await ev(`${PINIA}._s.get('ui').requestFind(); 'open'`)
  await sleep(400)
  console.log('[3] bar:', await ev(`!!${VBAR}`), '| replace row:', await ev(`(() => { const b = ${VBAR}; return !!b.querySelector('.find-input-repl') })()`))
  await setQ('行')
  console.log('[3] label:', await label(), '| luci highlights:', await ev(`document.querySelectorAll('.cm-luci-find-hit').length`))
  await clicks('↓', '.find-btn'); await sleep(400)
  console.log('[3] label after nav:', await label(), '| active marks:', await ev(`document.querySelectorAll('.cm-luci-find-hit-active').length`))
  await clicks('✕', '.find-btn'); await sleep(350)
  console.log('[3] closed:', await ev(`(() => { const b = ${VBAR}; return b ? 'STILL OPEN' : 'closed' })()`), '| highlights cleared:', await ev(`document.querySelectorAll('.cm-luci-find-hit').length === 0`))

  /* ===== 4. 预览只读查找 ===== */
  await ev(`${PINIA}._s.get('ui').setEditorMode('preview'); 'preview'`)
  await sleep(1000)
  await ev(`${PINIA}._s.get('ui').requestFind(); 'open'`)
  await sleep(400)
  console.log('[4] bar:', await ev(`!!${VBAR}`), '| searchOnly:', await ev(`(() => { const b = ${VBAR}; return !b.querySelector('.find-input-repl') })()`), '| mode:', await ev(`${PINIA}._s.get('ui').editorMode`))
  await setQ('针')
  const pv0 = await scrollOf('.preview-scroll')
  console.log('[4] pv hits:', await ev(`document.querySelectorAll('.pv-find-hit').length`), '| auto-jump scroll:', pv0, '| label:', await label())
  await clicks('↓', '.find-btn'); await sleep(450)
  const pv1 = await scrollOf('.preview-scroll')
  console.log('[4] after ↓ scroll:', pv0, '→', pv1, '| active:', await ev(`[...document.querySelectorAll('.pv-find-hit')].findIndex(e => e.classList.contains('pv-find-hit-active'))`))
  await clicks('✕', '.find-btn'); await sleep(350)
  console.log('[4] closed:', await ev(`(() => { const b = ${VBAR}; return b ? 'STILL OPEN' : 'closed' })()`), '| highlights cleared:', await ev(`document.querySelectorAll('.pv-find-hit').length === 0`))

  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  await sleep(400)
  console.log('tabs:', await ev(`JSON.stringify(${PINIA}._s.get('documents').tabs.map(t => t.name))`), '| all clean:', await ev(`${PINIA}._s.get('documents').tabs.every(t => !t.dirty) ? 'yes' : 'NO'`))
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
