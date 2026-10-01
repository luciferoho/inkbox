let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
const NL = String.fromCharCode(10)
const BS = String.fromCharCode(92)
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}
async function type(text) { await send('Input.insertText', { text }) }
async function key(opts) { await send('Input.dispatchKeyEvent', opts) }
const down = (o) => key({ type: 'keyDown', ...o })
const up = (o) => key({ type: 'keyUp', ...o })
async function ctrl(k, vk, ch) { const text = String.fromCharCode(ch); await down({ modifiers: 2, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: vk, text }); await up({ modifiers: 2, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: vk, text }) }
async function esc() { await down({ key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await up({ key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }) }
const q = (sel) => ev(`(() => { const i = document.querySelector('${sel}'); if (!i) return 'MISSING'; i.focus(); return 'focused' })()`)
const setQuery = async (text) => { await q('.find-bar .find-input'); await ctrl('a', 65, 65); await type(text); await sleep(450) }
const scrollTop = (sel) => ev(`document.querySelector('${sel}')?.scrollTop ?? -1`)
const label = () => ev(`document.querySelector('.find-count')?.textContent`)
const clickBtn = (txt) => ev(`(() => { const b = [...document.querySelectorAll('.find-bar .find-btn')].find(x => x.textContent === '${txt}'); if (!b) return 'MISSING'; b.click(); return 'ok' })()`)
const clickTg = (txt) => ev(`(() => { const b = [...document.querySelectorAll('.find-tg')].find(x => x.textContent.trim() === '${txt}'); if (!b) return 'MISSING'; b.click(); return 'ok' })()`)

;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }

  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); const t = docs.tabs.find(t => !t.path && !t.isHome); if (t) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  await ev(`${PINIA}._s.get('documents').newDoc(); 'new'`)
  await sleep(400)
  const path = await ev(`${PINIA}._s.get('documents').active?.path`)
  if (path !== null) throw new Error('SAFETY: active doc has path ' + path)
  await ev(`(() => {
    const docs = ${PINIA}._s.get('documents')
    const lines = Array.from({ length: 30 }, (_, i) => '填充行' + i + ' 普通文本')
    lines.push('cat category catalog cat')
    lines.push('针在底部针在底部针')
    for (let i = 30; i < 42; i++) lines.push('尾部行' + i + ' 收尾文本')
    docs.updateContent(docs.active.id, lines.join(String.fromCharCode(10, 10)))
    return 'filled'
  })()`)
  await ev(`${PINIA}._s.get('ui').setEditorMode('wysiwyg'); 'm'`)
  await sleep(1600)

  /* 1. 即显导航定位 */
  await ev(`${PINIA}._s.get('ui').requestFind(); 'open'`)
  await sleep(400)
  await setQuery('针')
  console.log('[1] hits:', await ev(`document.querySelectorAll('.pm-find-hit').length`), '| label:', await label())
  const st0 = await scrollTop('.wysiwyg-host')
  await clickBtn('↓'); await sleep(450)
  const st1 = await scrollTop('.wysiwyg-host')
  await clickBtn('↓'); await sleep(450)
  const st2 = await scrollTop('.wysiwyg-host')
  console.log('[1] scrollTop:', st0, '→', st1, '→', st2, '| located:', st1 > st0, '| wrapped back:', st2 < st1)

  /* 2. 全字匹配 */
  await setQuery('cat')
  console.log('[2] cat hits:', await ev(`document.querySelectorAll('.pm-find-hit').length`))
  await clickTg(BS + 'b'); await sleep(450)
  console.log('[2] whole-word hits:', await ev(`document.querySelectorAll('.pm-find-hit').length`), '| label:', await label())
  await q('.find-bar .find-input'); await esc(); await sleep(300)

  /* 3. 源码模式 */
  await ev(`${PINIA}._s.get('ui').setEditorMode('edit'); 'edit'`)
  await sleep(600)
  await ev(`${PINIA}._s.get('ui').requestFind(); 'open'`)
  await sleep(400)
  console.log('[3] bar:', await ev(`!!document.querySelector('.find-bar')`), '| old panel:', await ev(`!!document.querySelector('.cm-panel')`), '| replace row:', await ev(`!!document.querySelector('.find-input-repl')`))
  await setQuery('行')
  console.log('[3] label:', await label(), '| cm highlights:', await ev(`document.querySelectorAll('.cm-searchMatch').length`))
  await clickBtn('↓'); await sleep(400)
  console.log('[3] label after nav:', await label())
  await q('.find-bar .find-input'); await esc(); await sleep(300)
  console.log('[3] closed:', await ev(`!document.querySelector('.find-bar')`), '| highlights cleared:', await ev(`document.querySelectorAll('.cm-searchMatch').length === 0`))

  /* 4. 预览只读查找 */
  await ev(`${PINIA}._s.get('ui').setEditorMode('preview'); 'preview'`)
  await sleep(900)
  const modeBefore = await ev(`${PINIA}._s.get('ui').editorMode`)
  await ev(`${PINIA}._s.get('ui').requestFind(); 'open'`)
  await sleep(400)
  console.log('[4] bar:', await ev(`!!document.querySelector('.find-bar')`), '| searchOnly:', await ev(`!document.querySelector('.find-input-repl')`), '| mode kept:', (await ev(`${PINIA}._s.get('ui').editorMode`)) === modeBefore)
  await setQuery('针')
  const pvHits = await ev(`document.querySelectorAll('.pv-find-hit').length`)
  const ps0 = await scrollTop('.preview-scroll')
  await clickBtn('↓'); await sleep(450)
  const ps1 = await scrollTop('.preview-scroll')
  console.log('[4] pv hits:', pvHits, '| scroll:', ps0, '→', ps1, '| active:', await ev(`[...document.querySelectorAll('.pv-find-hit')].findIndex(e => e.classList.contains('pv-find-hit-active'))`), '| label:', await label())
  await q('.find-bar .find-input'); await esc(); await sleep(300)
  console.log('[4] closed:', await ev(`!document.querySelector('.find-bar')`), '| highlights cleared:', await ev(`document.querySelectorAll('.pv-find-hit').length === 0`))

  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); const t = docs.active; docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id); return 'closed' })()`)
  await sleep(400)
  console.log('tabs:', await ev(`JSON.stringify(${PINIA}._s.get('documents').tabs.map(t => t.name))`), '| all clean:', await ev(`${PINIA}._s.get('documents').tabs.every(t => !t.dirty) ? 'yes' : 'NO'`))
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
