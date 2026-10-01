const fs = require('fs')
const DIR = 'E:/projects/lucifer/inkbox-workspace/inkbox/.cdp'
let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 500))
  return r.result.value
}
async function type(text) { await send('Input.insertText', { text }) }
async function key(opts) { await send('Input.dispatchKeyEvent', opts) }
const keyDown = (o) => key({ type: 'rawKeyDown', ...o })
const keyUp = (o) => key({ type: 'keyUp', ...o })
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(`${DIR}/${name}.png`, Buffer.from(r.data, 'base64'))
}
async function typeEnter() {
  await keyDown({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await keyUp({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
}
async function ctrlKey(k, vk) {
  await keyDown({ modifiers: 2, key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, windowsVirtualKeyCode: vk })
  await keyUp({ modifiers: 2, key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, windowsVirtualKeyCode: vk })
}

;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) }
  }

  // 1. 新建文档（未落盘，自动保存不会写磁盘）
  await ev(`document.querySelector('.welcome .btn-primary')?.click(); 'newdoc'`)
  await sleep(500)
  // 2. 切到即显模式
  await ev(`document.querySelectorAll('.mode-switch button')[0].click(); 'wysiwyg'`)
  await sleep(1200)
  await ev(`document.querySelector('.ProseMirror')?.focus(); 'focus'`)
  // 3. 打入测试内容
  await type('墨匣是墨匣的墨匣'); await typeEnter()
  await type('第二行墨匣测试'); await typeEnter()
  await type('普通文本行')
  await sleep(400)
  console.log('content:', await ev(`document.querySelector('.ProseMirror').textContent`))

  // 4. Ctrl+F → 查找条出现
  await ctrlKey('f', 70)
  await sleep(400)
  console.log('findBar open:', await ev(`!!document.querySelector('.find-bar')`))
  console.log('input focused:', await ev(`document.activeElement?.classList.contains('find-input')`))

  // 5. 输入查询词
  await type('墨匣')
  await sleep(500)
  console.log('hits:', await ev(`document.querySelectorAll('.pm-find-hit').length`))
  console.log('count label:', await ev(`document.querySelector('.find-count')?.textContent`))
  await shot('find-1-highlight')

  // 6. Enter → 下一个
  await keyDown({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await keyUp({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await sleep(300)
  console.log('after Enter:', await ev(`document.querySelector('.find-count')?.textContent`))

  // 7. 替换当前项
  await ev(`document.querySelector('.find-input-repl')?.focus(); 'repl-focus'`)
  await type('inkbox')
  await ev(`[...document.querySelectorAll('.find-btn-txt')][0].click(); 'replace-one'`)
  await sleep(400)
  console.log('after replace:', await ev(`document.querySelector('.ProseMirror').textContent`))
  console.log('count:', await ev(`document.querySelector('.find-count')?.textContent`))
  await shot('find-2-replace-one')

  // 8. 全部替换
  await ev(`[...document.querySelectorAll('.find-btn-txt')][1].click(); 'replace-all'`)
  await sleep(400)
  console.log('after replaceAll:', await ev(`document.querySelector('.ProseMirror').textContent`))
  console.log('count:', await ev(`document.querySelector('.find-count')?.textContent`))

  // 9. 撤销（单事务）
  await ev(`document.querySelector('.ProseMirror')?.focus(); 'ed-focus'`)
  await ctrlKey('z', 90)
  await sleep(400)
  console.log('after undo:', await ev(`document.querySelector('.ProseMirror').textContent`))

  // 10. 正则开关
  await ev(`[...document.querySelectorAll('.find-tg')][1]?.click(); 'regex-on'`)
  await ev(`document.querySelector('.find-input')?.focus(); 'q-focus'`)
  await type('第.行')
  await sleep(500)
  console.log('regex hits:', await ev(`document.querySelectorAll('.pm-find-hit').length`))
  // 清掉查询、关正则
  await ev(`const i=document.querySelector('.find-input'); i.value=''; i.dispatchEvent(new Event('input')); 'cleared'`)
  await sleep(300)

  // 11. Esc 关闭
  await keyDown({ key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await keyUp({ key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(300)
  console.log('bar closed:', await ev(`!document.querySelector('.find-bar')`))
  console.log('decorations gone:', await ev(`!document.querySelector('.pm-find-hit')`))
  console.log('editor focused:', await ev(`document.activeElement?.classList.contains('ProseMirror')`))

  // 12. 回归：源码模式 Ctrl+F 仍是 CM6 面板
  await ev(`document.querySelectorAll('.mode-switch button')[1].click(); 'edit-mode'`)
  await sleep(500)
  await ctrlKey('f', 70)
  await sleep(400)
  console.log('cm panel:', await ev(`!!document.querySelector('.cm-search') || !!document.querySelector('.cm-panel')`))

  await shot('find-3-final')
  ws.close()
  console.log('DONE')
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
