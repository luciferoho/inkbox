/* 快捷键自定义（6.7）真窗口验证 v3 —— CDP 断言 + dev 菜单钩子
   说明：本环境（受控 shell）注入不了 OS 级键击（keybd_event/SendInput/SendKeys 均不落地，
   已做 F12 对照实验确认），OS 键→加速器匹配属 Electron 框架层不受本次改动影响；
   本脚本覆盖：加速器注册（活体菜单）、命令管线、录制/冲突/清除/恢复、持久化、面板跟随。 */
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
const pinia = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
const ui = `${pinia}.get('ui')`
const docs = `${pinia}.get('documents')`
const api = 'window.api.app'
const MOD = { ALT: 1, CTRL: 2, SHIFT: 8 }
async function pressKey(key, vk, mods = 0) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods })
  await sleep(60)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods })
  await sleep(250)
}

let pass = 0, fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`) }
}
async function zenRow() {
  return evaljs(`(() => { const r = [...document.querySelectorAll('.sc-row')].find(x => x.textContent.includes('禅模式')); return r ? [...r.querySelectorAll('kbd')].map(k => k.textContent) : null })()`)
}
async function clickZenBtn(nth) {
  return evaljs(`(() => { const r = [...document.querySelectorAll('.sc-row')].find(x => x.textContent.includes('禅模式')); const b = r?.querySelectorAll('.sc-btn'); if (!b || !b[${nth}]) return false; b[${nth}].click(); return true })()`)
}
const accelOf = async (id) => evaljs(`${api}.debugMenuAccels().then(a => a['${id}'] ?? null)`)

/* ---------- 0. 就绪 + 安全 ---------- */
for (let i = 0; i < 40; i++) { if (await evaljs(`!document.getElementById('boot-splash')`)) break; await sleep(500) }
await evaljs(`${docs}.activateHome()`)
check('活动标签 = 主页（不碰用户文件）', await evaljs(`${docs}.active?.isHome === true`))
check('基线：禅模式无覆盖项', await evaljs(`!('view:toggleZen' in ${ui}.shortcuts)`))

/* ---------- 1. 基线：活体菜单注册默认加速器 + 命令管线 ---------- */
console.log('\n== 基线：菜单注册 + 命令管线 ==')
check('活体菜单 view:toggleZen = F10', (await accelOf('view:toggleZen')) === 'F10', String(await accelOf('view:toggleZen')))
check('活体菜单 file:save = CmdOrCtrl+S', (await accelOf('file:save')) === 'CmdOrCtrl+S', String(await accelOf('file:save')))
check('菜单项触发 → 禅模式开', await evaljs(`${api}.debugMenuInvoke('view:toggleZen')`) && await evaljs(`${ui}.zenMode === true`))
check('菜单项触发 → 禅模式关', await evaljs(`${api}.debugMenuInvoke('view:toggleZen')`) && await evaljs(`${ui}.zenMode === false`))

/* ---------- 2. 设置页：注册表渲染 ---------- */
console.log('\n== 设置页快捷键段 ==')
await evaljs(`${ui}.openSettings()`)
await sleep(500)
check('注册表 17 行全部渲染', (await evaljs(`document.querySelectorAll('.sc-row').length`)) === 17)

/* ---------- 3. 冲突拒绝 + 录制期菜单挂起 ---------- */
console.log('\n== 冲突检测 + 录制期菜单挂起 ==')
check('禅模式行进入录制态', await clickZenBtn(0))
await sleep(300)
const tabsBefore = await evaljs(`${docs}.tabs.length`)
await pressKey('n', 78, MOD.CTRL)
const toast = await evaljs(`${ui}.toast`)
check('Ctrl+N 被判冲突并提示', typeof toast === 'string' && toast.includes('新建文档'), `toast="${toast}"`)
check('录制期间未真的新建文档', (await evaljs(`${docs}.tabs.length`)) === tabsBefore)
await pressKey('Escape', 27)
await sleep(200)
check('Esc 只退出录制（设置页仍开）', await evaljs(`${ui}.settingsOpen === true`))

/* ---------- 4. 改键：禅模式 F10 → Ctrl+Alt+Z ---------- */
console.log('\n== 改键：禅模式 F10 → Ctrl+Alt+Z ==')
check('再次进入录制态', await clickZenBtn(0))
await sleep(300)
await pressKey('z', 90, MOD.CTRL | MOD.ALT)
await sleep(300)
check('覆盖表已写入 CmdOrCtrl+Alt+Z', (await evaljs(`${ui}.shortcuts['view:toggleZen']`)) === 'CmdOrCtrl+Alt+Z')
check('行内键帽显示 Ctrl/Alt/Z', JSON.stringify(await zenRow()) === JSON.stringify(['Ctrl', 'Alt', 'Z']), JSON.stringify(await zenRow()))
check('config.json 已持久化', (await evaljs(`${api}.getConfig().then(c => c.shortcuts?.['view:toggleZen'] ?? null)`)) === 'CmdOrCtrl+Alt+Z')

/* ---------- 5. 菜单已按覆盖重建 ---------- */
console.log('\n== 菜单重建 ==')
check('活体菜单 view:toggleZen = CmdOrCtrl+Alt+Z', (await accelOf('view:toggleZen')) === 'CmdOrCtrl+Alt+Z', String(await accelOf('view:toggleZen')))
check('其他命令不受影响（file:save 仍默认）', (await accelOf('file:save')) === 'CmdOrCtrl+S')
check('新加速器菜单项命令管线正常', await evaljs(`${api}.debugMenuInvoke('view:toggleZen')`) && await evaljs(`${ui}.zenMode === true`))
check('再次触发 → 关', await evaljs(`${api}.debugMenuInvoke('view:toggleZen')`) && await evaljs(`${ui}.zenMode === false`))
await evaljs(`${ui}.settingsOpen = false`)
await sleep(300)

/* ---------- 6. 重载持久化 ---------- */
console.log('\n== 重载持久化 ==')
await send('Page.enable')
await send('Page.reload')
await sleep(2500)
for (let i = 0; i < 30; i++) { if (await evaljs(`!document.getElementById('boot-splash')`)) break; await sleep(500) }
check('重载后覆盖表仍在（渲染层重读配置）', (await evaljs(`${pinia}.get('ui').shortcuts['view:toggleZen']`)) === 'CmdOrCtrl+Alt+Z')
check('重载后活体菜单仍带覆盖', (await accelOf('view:toggleZen')) === 'CmdOrCtrl+Alt+Z')

/* ---------- 7. 清除绑定（Backspace） ---------- */
console.log('\n== 清除绑定 ==')
await evaljs(`${pinia}.get('ui').openSettings()`)
await sleep(500)
check('禅模式行进入录制态', await clickZenBtn(0))
await sleep(300)
await pressKey('Backspace', 8)
await sleep(300)
check('覆盖表置空（禁用）', (await evaljs(`String(${ui}.shortcuts['view:toggleZen'])`)) === '',
  `value="${await evaljs(`String(${ui}.shortcuts['view:toggleZen'])`)}"`)
check('行内显示未设置', JSON.stringify(await zenRow()) === '[]', JSON.stringify(await zenRow()))
check('活体菜单该命令已无加速器', (await accelOf('view:toggleZen')) === null, String(await accelOf('view:toggleZen')))
await evaljs(`${ui}.settingsOpen = false`)
await sleep(300)

/* ---------- 8. 恢复默认 ---------- */
console.log('\n== 恢复默认 ==')
await evaljs(`${ui}.openSettings()`)
await sleep(500)
check('恢复默认按钮存在并点击', await clickZenBtn(1))
await sleep(400)
check('覆盖项已删除', await evaljs(`!('view:toggleZen' in ${ui}.shortcuts)`))
check('活体菜单恢复 F10', (await accelOf('view:toggleZen')) === 'F10')
await evaljs(`${ui}.settingsOpen = false`)
await sleep(300)
check('恢复后命令管线正常（开）', await evaljs(`${api}.debugMenuInvoke('view:toggleZen')`) && await evaljs(`${ui}.zenMode === true`))
check('恢复后命令管线正常（关）', await evaljs(`${api}.debugMenuInvoke('view:toggleZen')`) && await evaljs(`${ui}.zenMode === false`))

/* ---------- 9. 快捷键面板跟随 ---------- */
console.log('\n== 面板跟随 ==')
await evaljs(`${ui}.toggleShortcutPanel()`)
await sleep(400)
const panelZen = await evaljs(`(() => { const it = [...document.querySelectorAll('.sc-panel .sc-item')].find(x => x.textContent.includes('禅模式')); return it ? [...it.querySelectorAll('kbd')].map(k => k.textContent) : null })()`)
check('面板显示 F10（注册表驱动）', JSON.stringify(panelZen) === JSON.stringify(['F10']), JSON.stringify(panelZen))
await evaljs(`${ui}.toggleShortcutPanel()`)

/* ---------- 10. 设置入口菜单命令回归 ---------- */
check('菜单命令回归：app:settings 打开设置页', await evaljs(`${api}.debugMenuInvoke('app:settings')`) && await evaljs(`${ui}.settingsOpen === true`))
await evaljs(`${ui}.settingsOpen = false`)

console.log(`\n结果：${pass} 过 / ${fail} 败`)
ws.close()
process.exit(fail > 0 ? 1 : 0)
