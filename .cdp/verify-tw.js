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
const st = () => ev(`Math.round(document.querySelector('.cm-scroller').scrollTop)`)
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  await ev(`${PINIA}._s.get('documents').openPath('E:/projects/lucifer/inkbox-workspace/压测-大文档.md').then(() => 'opened')`)
  await sleep(1200)
  await ev(`${PINIA}._s.get('ui').setEditorMode('split'); 'split'`)
  await ev(`${PINIA}._s.get('ui').jumpTo(800); 'j'`)
  await sleep(700)
  if (!(await ev(`${PINIA}._s.get('ui').typewriterMode`))) { await ev(`${PINIA}._s.get('ui').toggleTypewriter(); 'on'`); await sleep(300) }

  // 视口内上下两行的坐标（确保都在视口内）
  const spots = await ev(`(() => {
    const sc = document.querySelector('.cm-scroller')
    const sr = sc.getBoundingClientRect()
    const lines = [...document.querySelectorAll('.cm-line')].filter(l => { const r = l.getBoundingClientRect(); return r.top > sr.top + 30 && r.bottom < sr.bottom - 30 })
    const a = lines[2], b = lines[lines.length - 3]
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
    return { topY: Math.round(ra.y + 8), bottomY: Math.round(rb.y + 8), x: Math.round(ra.x + 40), vh: Math.round(sr.height) }
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

  // 光标在视口底部（点击 bottomY 后光标在底部），按方向键（键盘移动）应滚到中间
  const activeOffset = await ev(`(() => { const a = document.querySelector('.cm-activeLine'); const sc = document.querySelector('.cm-scroller'); return Math.round(a.getBoundingClientRect().top - sc.getBoundingClientRect().top) })()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await sleep(600)
  const s4 = await st()
  const activeOffset2 = await ev(`(() => { const a = document.querySelector('.cm-activeLine'); const sc = document.querySelector('.cm-scroller'); return Math.round(a.getBoundingClientRect().top - sc.getBoundingClientRect().top) })()`)
  console.log('[键盘移动居中] 光标行 offset:', activeOffset, '→', activeOffset2, '| scroll:', s3, '→', s4, '|', activeOffset2 !== activeOffset ? 'PASS' : '需再看（可能本来就近中间）')

  // 输入也居中
  await ev(`(() => { document.querySelector('.cm-content').focus(); return 'f' })()`)
  await send('Input.insertText', { text: 'X' })
  await sleep(600)
  const s5 = await st()
  console.log('[输入居中] scroll:', s4, '→', s5)
  // 撤销输入
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
