/* 禅模式修复验证：布局行收缩 → 内容可见 → 可输入 → 退出恢复 */
const base = 'http://127.0.0.1:9222'
const pages = await (await fetch(`${base}/json`)).json()
const page = pages.find((p) => p.type === 'page' && p.url.includes('localhost:5173'))
if (!page) throw new Error('no page target')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
function send(method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res) => pending.set(id, res))
}
async function evaljs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error('eval fail: ' + JSON.stringify(r.result.exceptionDetails))
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fs = await import('node:fs')
const pinia = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
const ui = `${pinia}.get('ui')`
const docs = `${pinia}.get('documents')`

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`) }
}

for (let i = 0; i < 40; i++) { if (await evaljs(`!document.getElementById('boot-splash')`)) break; await sleep(500) }
await send('Page.enable')
await send('Page.reload')
await sleep(2500)
for (let i = 0; i < 30; i++) { if (await evaljs(`!document.getElementById('boot-splash')`)) break; await sleep(500) }

/* 准备：主页 → 新建未落盘文档（打字测试目标，path 必须为 null） */
await evaljs(`${docs}.activateHome()`)
await evaljs(`${docs}.newDoc()`)
await sleep(400)
check('活动文档未落盘（安全协议）', await evaljs(`${docs}.active?.path === null`))

/* 常态基线：app-body 高度 */
const normalH = await evaljs(`document.querySelector('.app-body').clientHeight`)
check(`常态 app-body 高度正常（${normalH}px）`, normalH > 500, String(normalH))

/* 进入禅模式 */
await evaljs(`${ui}.toggleZen()`)
await sleep(500)
check('zen 类已挂到根节点', await evaljs(`document.querySelector('.app').classList.contains('app-zen')`))
const zenH = await evaljs(`document.querySelector('.app-body').clientHeight`)
check(`禅模式 app-body 高度恢复（${normalH} → ${zenH}px）`, zenH > 500, String(zenH))
check('纸面可见（有实际尺寸）', await evaljs(`(() => { const p = document.querySelector('.paper-scroll'); return !!p && p.clientHeight > 400 })()`))

/* 截图目检 */
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('.cdp/shot-zen-fixed.png', Buffer.from(shot.result.data, 'base64'))

/* 可编辑性：聚焦 CM6 内容区并输入 */
await evaljs(`document.querySelector('.cm-content')?.focus()`)
await sleep(200)
await send('Input.insertText', { text: '禅模式可编辑验证' })
await sleep(400)
check('输入已进入文档', ((await evaljs(`${docs}.active.content`)) || '').includes('禅模式可编辑验证'))
check('标签为脏（编辑生效）', await evaljs(`${docs}.active.dirty === true`))

/* 打字机/滚动不干扰：再输入一个字符确认持续可编辑 */
await send('Input.insertText', { text: '，二次输入正常' })
await sleep(300)
check('持续输入正常', ((await evaljs(`${docs}.active.content`)) || '').includes('二次输入正常'))

/* 退出禅模式：Esc（无弹层时退出） */
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 })
await sleep(80)
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', windowsVirtualKeyCode: 27 })
await sleep(400)
check('Esc 退出禅模式', await evaljs(`${ui}.zenMode === false`))
check('退出后布局还原', (await evaljs(`document.querySelector('.app-body').clientHeight`)) === normalH)

/* 清理：关掉测试标签（脏未落盘 → askConfirm 两键确认框 → 确认丢弃） */
await evaljs(`${docs}.closeActive()`)
await sleep(400)
if (await evaljs(`!!${ui}.confirm`)) {
  await evaljs(`${ui}.resolveConfirm(true)`)
  await sleep(300)
}
check('测试标签已清理', !(await evaljs(`${docs}.tabs.some(t => (t.content || '').includes('禅模式可编辑验证'))`)))
check('用户文件未受影响（dirty 均为 false）', await evaljs(`${docs}.tabs.filter(t => t.path).every(t => !t.dirty)`))

console.log(`\n结果：${pass} 过 / ${fail} 败`)
ws.close()
process.exit(fail > 0 ? 1 : 0)
