const fs = require('fs')
const DIR = 'E:/projects/lucifer/inkbox-workspace/inkbox/.cdp'
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
async function type(text) { await send('Input.insertText', { text }) }
async function key(opts) { await send('Input.dispatchKeyEvent', opts) }
const down = (o) => key({ type: 'keyDown', ...o })
const up = (o) => key({ type: 'keyUp', ...o })
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${DIR}/${name}.png`, Buffer.from(r.data, 'base64')) }
async function enter() { await down({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await up({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }) }
async function ctrl(k, vk, text) { await down({ modifiers: 2, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: vk, text }); await up({ modifiers: 2, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: vk }) }
async function clickAt(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }

  // 0. 清理：挂起的确认框 + 未命名脏标签
  console.log('hanging dialog:', await ev(`${PINIA}._s.get('ui').confirm ? 'yes' : 'no'`))
  await ev(`${PINIA}._s.get('ui').resolveConfirm(false); 'cancel-dialog'`)
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); const t = docs.tabs.find(t => !t.path && !t.isHome); if (t) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'cleaned' })()`)

  // 1. 新文档 + 即显
  await ev(`${PINIA}._s.get('documents').newDoc(); 'new'`)
  await sleep(400)
  await ev(`${PINIA}._s.get('ui').setEditorMode('wysiwyg'); 'mode'`)
  await sleep(1200)
  await ev(`document.querySelector('.ProseMirror')?.focus(); 'focus'`)
  await type('墨匣是墨匣的墨匣'); await enter()
  await type('第二行墨匣测试'); await enter()
  await type('普通文本行')
  await sleep(300)

  // 2. 选区预填：点进第一段 → Home → Shift+→ ×2 选中「墨匣」→ Ctrl+F
  const rect = await ev(`(() => { const p = document.querySelector('.ProseMirror p'); const r = p.getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 } })()`)
  await clickAt(rect.x, rect.y)
  await sleep(200)
  await down({ key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 }); await up({ key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 })
  for (let i = 0; i < 2; i++) {
    await down({ modifiers: 8, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }); await up({ modifiers: 8, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  }
  await sleep(150)
  await ctrl('f', 70, 'f')
  await sleep(400)
  console.log('prefill:', JSON.stringify(await ev(`document.querySelector('.find-input')?.value`)))
  console.log('count:', await ev(`document.querySelector('.find-count')?.textContent`))

  // 3. 正则：开正则开关 → Ctrl+A 覆盖查询词
  await ev(`[...document.querySelectorAll('.find-tg')][1]?.click(); 'regex'`)
  await sleep(200)
  await ev(`document.querySelector('.find-input')?.focus(); 'qf'`)
  await ctrl('a', 65, 'a')
  await type('第.行')
  await sleep(400)
  console.log('regex hits:', await ev(`document.querySelectorAll('.pm-find-hit').length`))
  console.log('regex count:', await ev(`document.querySelector('.find-count')?.textContent`))
  await shot('find-4-regex')

  // 4. 字面全部替换 + 单事务撤销
  await ev(`[...document.querySelectorAll('.find-tg')][1]?.click(); 'regex-off'`)
  await sleep(200)
  await ev(`document.querySelector('.find-input')?.focus(); 'qf2'`)
  await ctrl('a', 65, 'a')
  await type('墨匣')
  await sleep(300)
  await ev(`[...document.querySelectorAll('.find-btn-txt')][1].click(); 'all'`)
  await sleep(400)
  console.log('after replaceAll:', await ev(`document.querySelector('.ProseMirror').textContent`))
  await ev(`document.querySelector('.ProseMirror')?.focus(); 'ef'`)
  await ctrl('z', 90, '\u001a')
  await sleep(400)
  console.log('after undo:', await ev(`document.querySelector('.ProseMirror').textContent`))
  console.log('count after undo:', await ev(`document.querySelector('.find-count')?.textContent`))

  // 5. 清理测试标签
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); const t = docs.active; docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id); return 'closed' })()`)
  await sleep(400)
  console.log('tabs:', await ev(`JSON.stringify(${PINIA}._s.get('documents').tabs.map(t => t.name))`))
  console.log('all clean:', await ev(`${PINIA}._s.get('documents').tabs.every(t => !t.dirty) ? 'yes' : 'NO'`))
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
