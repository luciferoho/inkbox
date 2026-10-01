let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
const VBAR = `[...document.querySelectorAll('.find-bar')].find(b => b.offsetWidth || b.offsetHeight)`
const BS = 'String.fromCharCode(92)'
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}
const setQ = async (text) => {
  await ev(`(() => { const b = ${VBAR}; const i = b.querySelector('.find-input'); i.focus(); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); return 'ok' })()`)
  await sleep(500)
}
const label = () => ev(`(() => { const b = ${VBAR}; return b ? b.querySelector('.find-count').textContent : 'NO BAR' })()`)
const barState = () => ev(`(() => { const b = ${VBAR}; return b ? 'OPEN' : 'closed' })()`)

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
    for (let i = 31; i < 44; i++) lines.push('尾部行' + i)
    docs.updateContent(docs.active.id, lines.join(String.fromCharCode(10, 10)))
    return 'ok'
  })()`)

  /* 即显 */
  await ev(`${PINIA}._s.get('ui').setEditorMode('wysiwyg'); 'm'`)
  await sleep(1600)
  await ev(`${PINIA}._s.get('ui').requestFind(); 'open'`)
  await sleep(400)
  await setQ('cat')
  console.log('[W] cat label:', await label(), '| visible hits:', await ev(`document.querySelectorAll('.pm-find-hit').length`))
  // 全字匹配（页面侧构造反斜杠字符串，绕开转义层）
  console.log('[W] click \b:', await ev(`(() => { const b = ${VBAR}; const t = [...b.querySelectorAll('.find-tg')].find(x => x.textContent.trim() === ${BS} + 'b'); if (!t) return 'MISSING'; t.click(); return 'ok' })()`))
  await sleep(500)
  console.log('[W] whole-word label:', await label(), '| visible hits:', await ev(`document.querySelectorAll('.pm-find-hit').length`))
  // 按钮焦点 Esc（新根节点显式 handler）
  console.log('[W] click ↓:', await ev(`(() => { const b = ${VBAR}; [...b.querySelectorAll('.find-btn')].find(x => x.textContent === '↓').click(); return 'ok' })()`))
  await sleep(250)
  await ev(`(() => { const b = ${VBAR}; const btn = b.querySelector('.find-btn'); btn.focus(); btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); return 'esc' })()`)
  await sleep(350)
  console.log('[W] esc(button focus) →', await barState())

  /* 源码模式复验（含全字匹配 + 面板不出现） */
  await ev(`${PINIA}._s.get('ui').setEditorMode('edit'); 'edit'`)
  await sleep(700)
  await ev(`${PINIA}._s.get('ui').requestFind(); 'open'`)
  await sleep(400)
  await setQ('cat')
  console.log('[CM] label:', await label(), '| hits:', await ev(`document.querySelectorAll('.cm-luci-find-hit').length`))
  console.log('[CM] click \b:', await ev(`(() => { const b = ${VBAR}; const t = [...b.querySelectorAll('.find-tg')].find(x => x.textContent.trim() === ${BS} + 'b'); t.click(); return 'ok' })()`))
  await sleep(500)
  console.log('[CM] whole-word label:', await label(), '| hits:', await ev(`document.querySelectorAll('.cm-luci-find-hit').length`))
  await ev(`(() => { const b = ${VBAR}; [...b.querySelectorAll('.find-btn')].find(x => x.textContent === '✕').click(); return 'ok' })()`)
  await sleep(300)
  console.log('[CM] closed:', await barState())

  /* 清理 */
  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  await sleep(400)
  console.log('tabs:', await ev(`JSON.stringify(${PINIA}._s.get('documents').tabs.map(t => t.name))`), '| clean:', await ev(`${PINIA}._s.get('documents').tabs.every(t => !t.dirty) ? 'yes' : 'NO'`))
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
