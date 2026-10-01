let ws, msgId = 0
const pending = new Map()
const fs = require('fs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
const VBAR = `[...document.querySelectorAll('.find-bar')].find(b => b.offsetWidth || b.offsetHeight)`
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 400))
  return r.result.value
}
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('E:/projects/lucifer/inkbox-workspace/inkbox/.cdp/' + name + '.png', Buffer.from(r.data, 'base64')) }
const setQ = async (t) => { await ev(`(() => { const b = ${VBAR}; const i = b.querySelector('.find-input'); i.focus(); i.value = ${JSON.stringify(t)}; i.dispatchEvent(new Event('input')); return 'ok' })()`); await sleep(500) }
const setR = async (t) => { await ev(`(() => { const b = ${VBAR}; const i = b.querySelector('.find-input-repl'); i.focus(); i.value = ${JSON.stringify(t)}; i.dispatchEvent(new Event('input')); return 'ok' })()`); await sleep(300) }
const click = async (txt) => { const r = await ev(`(() => { const b = ${VBAR}; const x = [...b.querySelectorAll('.find-btn')].find(x2 => x2.textContent === '${txt}'); if (!x) return 'MISSING'; x.click(); return 'ok' })()`); await sleep(450); return r }
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  // 整页刷新清掉失败的 HMR 状态
  await send('Page.enable')
  await send('Page.reload')
  await sleep(9000) // 等会话恢复完全稳定

  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  await sleep(300)
  await ev(`${PINIA}._s.get('documents').newDoc(); 'new'`)
  await sleep(400)
  if ((await ev(`${PINIA}._s.get('documents').active?.path`)) !== null) throw new Error('SAFETY')
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); docs.updateContent(docs.active.id, ['尾部行', '尾部行2', '正文段', '尾部行3'].join(String.fromCharCode(10, 10))); return 'ok' })()`)
  await ev(`${PINIA}._s.get('ui').setEditorMode('edit'); 'm'`)
  await sleep(900)
  await ev(`${PINIA}._s.get('ui').requestFind(); 'open'`)
  await sleep(400)
  await setQ('尾部')
  console.log('label:', await ev(`(() => { const b = ${VBAR}; return b.querySelector('.find-count').textContent })()`), '| luci hits:', await ev(`document.querySelectorAll('.cm-luci-find-hit').length`))
  await setR('头部')
  await click('替换')
  console.log('after one replace label:', await ev(`(() => { const b = ${VBAR}; return b.querySelector('.find-count').textContent })()`), '| doc:', await ev(`JSON.stringify(${PINIA}._s.get('documents').active.content)`))
  await click('全部替换')
  console.log('after replaceAll doc:', await ev(`JSON.stringify(${PINIA}._s.get('documents').active.content)`))
  await shot('find-7-cm-bar')
  // 撤销（替换全部应一步回退）
  await ev(`(() => { document.querySelector('.cm-content')?.focus(); return 'f' })()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, text: String.fromCharCode(26) })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 })
  await sleep(400)
  console.log('after undo doc:', await ev(`JSON.stringify(${PINIA}._s.get('documents').active.content)`))
  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); for (const t of docs.tabs.filter(t => !t.path && !t.isHome)) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'c' })()`)
  await sleep(400)
  console.log('tabs:', await ev(`JSON.stringify(${PINIA}._s.get('documents').tabs.map(t => t.name))`), '| clean:', await ev(`${PINIA}._s.get('documents').tabs.every(t => !t.dirty) ? 'yes' : 'NO'`))
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
