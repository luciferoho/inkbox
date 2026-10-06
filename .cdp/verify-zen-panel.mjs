/* 禅模式 × 快捷键面板验证 */
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
const api = 'window.api.app'
const panelVisible = () => evaljs(`!!document.querySelector('.sc-panel')`)

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
await evaljs(`${docs}.activateHome()`)
check('活动标签 = 主页', await evaljs(`${docs}.active?.isHome === true`))

/* 1. 默认键注册 + 菜单命令管线 */
console.log('\n== 新命令注册 ==')
check('活体菜单 view:toggleShortcuts = CmdOrCtrl+/', (await evaljs(`${api}.debugMenuAccels().then(a => a['view:toggleShortcuts'] ?? null)`)) === 'CmdOrCtrl+/')
check('菜单命令 → 面板打开', await evaljs(`${api}.debugMenuInvoke('view:toggleShortcuts')`) && (await panelVisible()))
check('再触发 → 面板关闭', await evaljs(`${api}.debugMenuInvoke('view:toggleShortcuts')`) && await evaljs(`new Promise(r => setTimeout(() => r(!document.querySelector('.sc-panel')), 500))`))

/* 2. 面板开着进禅模式：不再被强制关闭 */
console.log('\n== 面板随禅模式保留 ==')
await evaljs(`${ui}.toggleShortcutPanel()`)
await sleep(400)
await evaljs(`${ui}.toggleZen()`)
await sleep(600)
check('禅模式开启', await evaljs(`${ui}.zenMode === true`))
check('已开的面板在禅模式下保留', await panelVisible())

/* 3. 禅模式内关→开（菜单命令路径） */
await evaljs(`${ui}.toggleShortcutPanel()`)
await sleep(400)
check('禅模式内可关闭', !(await panelVisible()))
await evaljs(`${api}.debugMenuInvoke('view:toggleShortcuts')`)
await sleep(400)
check('禅模式内可再打开（菜单命令）', await panelVisible())
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('.cdp/shot-zen-panel.png', Buffer.from(shot.result.data, 'base64'))

/* 4. 退出禅模式，面板状态延续 */
await evaljs(`${ui}.toggleZen()`)
await sleep(400)
check('退出禅模式后面板仍在', await panelVisible())
await evaljs(`${ui}.toggleShortcutPanel()`)
await sleep(300)

/* 5. 设置页 18 行 + 面板清单跟随 */
await evaljs(`${ui}.openSettings()`)
await sleep(500)
check('设置页 18 行', (await evaljs(`document.querySelectorAll('.sc-row').length`)) === 18)
const rowKeys = await evaljs(`(() => { const r = [...document.querySelectorAll('.sc-row')].find(x => x.textContent.includes('快捷键面板')); return r ? [...r.querySelectorAll('kbd')].map(k => k.textContent) : null })()`)
check('设置页行显示 Ctrl /', JSON.stringify(rowKeys) === JSON.stringify(['Ctrl', '/']), JSON.stringify(rowKeys))
await evaljs(`${ui}.settingsOpen = false`)
await sleep(300)
await evaljs(`${ui}.toggleShortcutPanel()`)
await sleep(400)
const panelRow = await evaljs(`(() => { const it = [...document.querySelectorAll('.sc-panel .sc-item')].find(x => x.textContent.includes('快捷键面板')); return it ? [...it.querySelectorAll('kbd')].map(k => k.textContent) : null })()`)
check('面板清单含快捷键面板 Ctrl /', JSON.stringify(panelRow) === JSON.stringify(['Ctrl', '/']), JSON.stringify(panelRow))
await evaljs(`${ui}.toggleShortcutPanel()`)

console.log(`\n结果：${pass} 过 / ${fail} 败`)
ws.close()
process.exit(fail > 0 ? 1 : 0)
