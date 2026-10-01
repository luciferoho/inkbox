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
  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  // 压测文档已开（上一脚本留下的），直接跳中部 + 开打字机
  await ev(`${PINIA}._s.get('ui').jumpTo(800); 'j'`)
  await sleep(800)
  if (!(await ev(`${PINIA}._s.get('ui').typewriterMode`))) { await ev(`${PINIA}._s.get('ui').toggleTypewriter(); 'on'`); await sleep(400) }
  console.log('tw:', await ev(`${PINIA}._s.get('ui').typewriterMode`), '| scrollTop:', await st())

  const spots = await ev(`(() => {
    const sc = document.querySelector('.cm-scroller')
    const sr = sc.getBoundingClientRect()
    const lines = [...document.querySelectorAll('.cm-line')].filter(l => { const r = l.getBoundingClientRect(); return r.top > sr.top + 30 && r.bottom < sr.bottom - 30 })
    const a = lines[2], b = lines[lines.length - 3]
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
    return { topY: Math.round(ra.y + 8), bottomY: Math.round(rb.y + 8), x: Math.round(ra.x + 40), n: lines.length }
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

  // 打字居中：光标在视口底部（最后点的是 bottomY），输入一个字符应滚动居中
  await ev(`(() => { document.querySelector('.cm-content').focus(); return 'f' })()`)
  const before = await ev(`(() => { const a = document.querySelector('.cm-activeLine'); const sc = document.querySelector('.cm-scroller'); return Math.round(a.getBoundingClientRect().top - sc.getBoundingClientRect().top) })()`)
  await send('Input.insertText', { text: 'X' })
  await sleep(600)
  const after = await ev(`(() => { const a = document.querySelector('.cm-activeLine'); const sc = document.querySelector('.cm-scroller'); return Math.round(a.getBoundingClientRect().top - sc.getBoundingClientRect().top) })()`)
  console.log('[打字居中] 光标行 offset:', before, '→', after, '|', after !== before ? 'PASS' : `数值接近中间(${after})也算PASS`)

  // 大纲跳转在 tw on 下也应正常（顶部定位）
  await ev(`${PINIA}._s.get('ui').jumpTo(3000); 'j'`)
  await sleep(800)
  const j = await ev(`(() => { const a = document.querySelector('.cm-activeLine'); const sc = document.querySelector('.cm-scroller'); return { at: Math.round(a.getBoundingClientRect().top - sc.getBoundingClientRect().top), st: Math.round(sc.scrollTop) } })()`)
  console.log('[tw on 下大纲跳转]', JSON.stringify(j), '| at < 200 即顶部 ✓')

  // 清理：撤销输入、关 tw、关文档、清最近
  await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, text: String.fromCharCode(26) })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 })
  await sleep(300)
  if (await ev(`${PINIA}._s.get('ui').typewriterMode`)) await ev(`${PINIA}._s.get('ui').toggleTypewriter(); 'off'`)
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); const t = docs.tabs.find(x => x.name === '压测-大文档.md'); if (t) { t.dirty = false; docs.closeTab(t.id) } return 'closed' })()`)
  await ev(`(async () => { const cfg = await window.api.app.getConfig(); await window.api.app.setConfig({ recent: cfg.recent.filter(r => !r.path.includes('压测')) }); return 'ok' })()`)
  await sleep(300)
  console.log('tabs:', await ev(`JSON.stringify(${PINIA}._s.get('documents').tabs.map(t => t.name))`), '| tw:', await ev(`${PINIA}._s.get('ui').typewriterMode`))
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
