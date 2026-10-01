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
async function clickAt(x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
}
const st = () => ev(`Math.round(document.querySelector('.cm-scroller')?.scrollTop ?? -1)`)
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  // 等会话恢复稳定
  for (let i = 0; i < 30; i++) {
    const ready = await ev(`(() => { const d = ${PINIA}._s.get('documents'); return d.tabs.length > 0 && !d.tabs.some(t => t.name.includes('未命名')) })()`)
    if (ready) break
    await sleep(500)
  }
  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  await ev(`${PINIA}._s.get('documents').openPath('E:/projects/lucifer/inkbox-workspace/压测-大文档.md').then(() => 'opened')`)
  await sleep(1500)
  // 确认打开成功
  const activeName = await ev(`${PINIA}._s.get('documents').active?.name`)
  if (activeName !== '压测-大文档.md') throw new Error('doc not open: ' + activeName)
  await ev(`${PINIA}._s.get('ui').setEditorMode('split'); 'split'`)
  await ev(`${PINIA}._s.get('ui').jumpTo(800); 'j'`)
  await sleep(700)
  if (!(await ev(`${PINIA}._s.get('ui').typewriterMode`))) { await ev(`${PINIA}._s.get('ui').toggleTypewriter(); 'on'`); await sleep(300) }

  const spots = await ev(`(() => {
    const sc = document.querySelector('.cm-scroller')
    const sr = sc.getBoundingClientRect()
    const lines = [...document.querySelectorAll('.cm-line')].filter(l => { const r = l.getBoundingClientRect(); return r.top > sr.top + 30 && r.bottom < sr.bottom - 30 })
    const a = lines[2], b = lines[lines.length - 3]
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
    return { topY: Math.round(ra.y + 8), bottomY: Math.round(rb.y + 8), x: Math.round(ra.x + 40), count: lines.length }
  })()`)
  console.log('spots:', JSON.stringify(spots))
  const s0 = await st()
  await clickAt(spots.x, spots.bottomY); await sleep(450)
  const s1 = await st()
  await clickAt(spots.x, spots.topY); await sleep(450)
  const s2 = await st()
  await clickAt(spots.x, spots.bottomY); await sleep(450)
  const s3 = await st()
  console.log('[点击不抖动]', s0, '→', s1, '→', s2, '→', s3, '|', [s1, s2, s3].every(v => v === s0) ? 'PASS' : 'FAIL')

  await ev(`(() => { document.querySelector('.cm-content').focus(); return 'f' })()`)
  const before = await ev(`(() => { const a = document.querySelector('.cm-activeLine'); const sc = document.querySelector('.cm-scroller'); return Math.round(a.getBoundingClientRect().top - sc.getBoundingClientRect().top) })()`)
  await send('Input.insertText', { text: 'X' })
  await sleep(600)
  const after = await ev(`(() => { const a = document.querySelector('.cm-activeLine'); const sc = document.querySelector('.cm-scroller'); return Math.round(a.getBoundingClientRect().top - sc.getBoundingClientRect().top) })()`)
  console.log('[打字居中] 光标行 offset:', before, '→', after, '|', before !== after ? 'PASS' : '看数值（点击后光标行若已近中间则不动）')

  await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, text: String.fromCharCode(26) })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 })
  await sleep(300)
  if (await ev(`${PINIA}._s.get('ui').typewriterMode`)) await ev(`${PINIA}._s.get('ui').toggleTypewriter(); 'off'`)
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); const t = docs.tabs.find(x => x.name === '压测-大文档.md'); if (t) { t.dirty = false; docs.closeTab(t.id) } return 'closed' })()`)
  await ev(`(async () => { const cfg = await window.api.app.getConfig(); await window.api.app.setConfig({ recent: cfg.recent.filter(r => !r.path.includes('压测')) }); return 'ok' })()`)
  console.log('tabs:', await ev(`JSON.stringify(${PINIA}._s.get('documents').tabs.map(t => t.name))`))
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
