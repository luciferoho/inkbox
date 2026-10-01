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
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  await ev(`${PINIA}._s.get('ui').setEditorMode('split'); 'split'`)
  // 打开（新路径的）压测文档
  await ev(`${PINIA}._s.get('documents').openPath('E:/projects/lucifer/inkbox-workspace/压测-大文档.md').then(() => 'opened')`)
  await sleep(1500)

  /* ===== 1. 脚注同步：源码滚到底 → 预览应滚到脚注区 ===== */
  await ev(`(() => { const sc = document.querySelector('.cm-scroller'); sc.scrollTop = sc.scrollHeight; return 'src to bottom' })()`)
  await sleep(800)
  const syncBottom = await ev(`(() => {
    const pv = document.querySelector('.preview-scroll')
    const foot = document.querySelector('.md-preview .footnotes')
    if (!foot) return 'NO FOOTNOTES'
    const fr = foot.getBoundingClientRect()
    const vr = pv.getBoundingClientRect()
    // 脚注区顶部是否已进入预览视口
    return { pvScrollTop: Math.round(pv.scrollTop), footTopInViewport: fr.top < vr.bottom && fr.bottom > vr.top, footVisibleRatio: Math.max(0, Math.min(1, (vr.bottom - fr.top) / fr.height)) }
  })()`)
  console.log('[1] 源码滚到底 →', JSON.stringify(syncBottom))
  // 反向：预览滚到脚注区 → 源码应接近末行
  await ev(`(() => { const foot = document.querySelector('.md-preview .footnotes'); const pv = document.querySelector('.preview-scroll'); pv.scrollTop = foot.offsetTop - 100; return 'pv to foot' })()`)
  await sleep(800)
  const syncBack = await ev(`(() => {
    const sc = document.querySelector('.cm-scroller')
    const cur = ${PINIA}._s.get('ui').currentLine
    return { cmScrollTop: Math.round(sc.scrollTop), cmMax: Math.round(sc.scrollHeight - sc.clientHeight), currentLine: cur }
  })()`)
  console.log('[1] 预览滚到脚注 →', JSON.stringify(syncBack))

  /* ===== 2. 大纲定位：目标行应到视口上方 ===== */
  // 点击大纲第 50 个条目（Outline 面板结构未知，直接调 ui.jumpTo 中部行更可控）
  await ev(`${PINIA}._s.get('ui').jumpTo(2000); 'jump'`)
  await sleep(900)
  const jump = await ev(`(() => {
    const sc = document.querySelector('.cm-scroller')
    const active = document.querySelector('.cm-activeLine')
    if (!active) return 'NO ACTIVE'
    const ar = active.getBoundingClientRect()
    const sr = sc.getBoundingClientRect()
    return { lineOffsetInViewport: Math.round(ar.top - sr.top), viewportH: Math.round(sr.height) }
  })()`)
  console.log('[2] jumpTo(2000) → 活动行在视口', JSON.stringify(jump), '（期望 offset ≈ 100 附近而非中间）')

  /* ===== 3. 打字机模式点击不抖动 ===== */
  await ev(`${PINIA}._s.get('ui').jumpTo(300); 'j'`)
  await sleep(600)
  if (!(await ev(`${PINIA}._s.get('ui').typewriterMode`))) {
    await ev(`${PINIA}._s.get('ui').toggleTypewriter(); 'tw on'`)
    await sleep(400)
  }
  console.log('[3] typewriter on:', await ev(`${PINIA}._s.get('ui').typewriterMode`))
  // 找两个可点击的行位置（当前视口内上下两行）
  const spots = await ev(`(() => {
    const sc = document.querySelector('.cm-scroller')
    const lines = [...document.querySelectorAll('.cm-line')].slice(5, 25)
    const a = lines[2], b = lines[lines.length - 3]
    if (!a || !b) return 'NO LINES'
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
    return { ax: Math.round(ra.x + 40), ay: Math.round(ra.y + ra.height / 2), bx: Math.round(rb.x + 40), by: Math.round(rb.y + rb.height / 2) }
  })()`)
  console.log('[3] click spots:', JSON.stringify(spots))
  const st0 = await ev(`document.querySelector('.cm-scroller').scrollTop`)
  await clickAt(spots.ax, spots.ay)
  await sleep(500)
  const st1 = await ev(`document.querySelector('.cm-scroller').scrollTop`)
  await clickAt(spots.bx, spots.by)
  await sleep(500)
  const st2 = await ev(`document.querySelector('.cm-scroller').scrollTop`)
  await clickAt(spots.ax, spots.ay)
  await sleep(500)
  const st3 = await ev(`document.querySelector('.cm-scroller').scrollTop`)
  console.log('[3] scrollTop:', st0, '→', st1, '→', st2, '→', st3, '| 抖动:', [st1, st2, st3].some(v => v !== st0))
  // 键盘输入仍应居中（打字机核心功能）
  const beforeType = await ev(`document.querySelector('.cm-scroller').scrollTop`)
  await ev(`(() => { const c = document.querySelector('.cm-content'); c.focus(); return 'f' })()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await sleep(600)
  const afterType = await ev(`(() => { const sc = document.querySelector('.cm-scroller'); return Math.round(sc.scrollTop) })()`)
  console.log('[3] 键盘输入后滚动调整（居中生效）:', beforeType, '→', afterType)

  // 收尾：撤销误输入、关打字机、关标签、清最近
  await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, text: String.fromCharCode(26) })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 })
  await sleep(300)
  if (await ev(`${PINIA}._s.get('ui').typewriterMode`)) await ev(`${PINIA}._s.get('ui').toggleTypewriter(); 'tw off'`)
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); const t = docs.tabs.find(x => x.name === '压测-大文档.md'); if (t) { t.dirty = false; docs.closeTab(t.id) } return 'closed' })()`)
  await ev(`(async () => { const cfg = await window.api.app.getConfig(); await window.api.app.setConfig({ recent: cfg.recent.filter(r => !r.path.includes('压测')) }); return 'cleaned' })()`)
  await sleep(300)
  console.log('tabs:', await ev(`JSON.stringify(${PINIA}._s.get('documents').tabs.map(t => t.name))`), '| tw off:', await ev(`!${PINIA}._s.get('ui').typewriterMode`))
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
