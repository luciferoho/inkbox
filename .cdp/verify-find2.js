const fs = require('fs')
const DIR = 'E:/projects/lucifer/inkbox-workspace/inkbox/.cdp'
let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`

function send(method, params = {}) {
  return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) })
}
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
async function dclick(x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 2 })
  }
}

;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }

  // 未落盘新文档 + 即显模式
  await ev(`${PINIA}._s.get('documents').newDoc(); 'new'`)
  await sleep(400)
  await ev(`${PINIA}._s.get('ui').setEditorMode('wysiwyg'); 'mode'`)
  await sleep(1200)
  console.log('doc path:', await ev(`${PINIA}._s.get('documents').active?.path`))
  await ev(`document.querySelector('.ProseMirror')?.focus(); 'focus'`)
  await type('墨匣是墨匣的墨匣'); await enter()
  await type('第二行墨匣测试'); await enter()
  await type('普通文本行')
  await sleep(300)

  // 选区预填：双击选中第二个「墨匣」再 Ctrl+F
  const rect = await ev(`(() => {
    const root = document.querySelector('.ProseMirror')
    const p = root.querySelectorAll('p')[0]
    const text = p.firstChild.textContent
    const off = text.indexOf('墨匣', text.indexOf('墨匣') + 1)
    const range = document.createRange()
    range.setStart(p.firstChild, off); range.setEnd(p.firstChild, off + 2)
    const r = range.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  await dclick(rect.x, rect.y)
  await sleep(200)
  await ctrl('f', 70, 'f')
  await sleep(400)
  console.log('prefill:', JSON.stringify(await ev(`document.querySelector('.find-input')?.value`)))

  // 正则开关：全选查询框 → 输入正则
  await ctrl('a', 65, 'a')
  await type('第.行')
  await sleep(400)
  console.log('regex hits:', await ev(`document.querySelectorAll('.pm-find-hit').length`))
  console.log('count:', await ev(`document.querySelector('.find-count')?.textContent`))
  await shot('find-4-regex')

  // 全部替换 + 撤销（单事务）
  await ev(`document.querySelector('.find-input-repl')?.focus(); 'rf'`)
  await type('N')
  await ev(`[...document.querySelectorAll('.find-btn-txt')][1].click(); 'all'`)
  await sleep(400)
  console.log('after regex replaceAll:', await ev(`document.querySelector('.ProseMirror').textContent`))
  await ev(`document.querySelector('.ProseMirror')?.focus(); 'ef'`)
  await ctrl('z', 90, '\u001a')
  await sleep(400)
  console.log('after undo:', await ev(`document.querySelector('.ProseMirror').textContent`))

  // requestFind（菜单路径）复开
  await ev(`${PINIA}._s.get('ui').requestFind(); 'rf'`)
  await sleep(300)
  console.log('reopen bar:', await ev(`!!document.querySelector('.find-bar')`))
  await shot('find-5-reopen')

  // Esc 关闭
  await down({ key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await up({ key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(300)
  console.log('closed:', await ev(`!document.querySelector('.find-bar')`))

  // CM6 回归：编辑模式 requestFind → CM 面板
  await ev(`${PINIA}._s.get('ui').setEditorMode('edit'); 'edit'`)
  await sleep(500)
  await ev(`${PINIA}._s.get('ui').requestFind(); 'req'`)
  await sleep(500)
  console.log('cm panel:', await ev(`!!document.querySelector('.cm-search') || !!document.querySelector('.cm-panel')`))
  const closeBtn = await ev(`!!document.querySelector('.cm-close-panels')`)
  if (closeBtn) await ev(`document.querySelector('.cm-close-panels').click(); 'c'`)

  // 关闭测试标签（未落盘，无脏数据）避免残留
  await ev(`${PINIA}._s.get('ui').setEditorMode('wysiwyg'); 'm'`)
  await sleep(300)
  await ev(`(async () => { const docs = ${PINIA}._s.get('documents'); const t = docs.active; if (t && !t.path && !t.isHome) { docs.closeActive(); } return 'closed' })()`)
  await sleep(500)
  console.log('tabs:', await ev(`JSON.stringify(${PINIA}._s.get('documents').tabs.map(t => t.name))`))
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
