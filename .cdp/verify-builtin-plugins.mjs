/* 内置插件真窗口验证：发现/徽章/面板动作行/真跑变换/禁用开关/清理 */
const base = 'http://127.0.0.1:9222'
const pages = await (await fetch(`${base}/json`)).json()
const page = pages.find((p) => p.type === 'page' && p.url.includes('localhost:5173'))
if (!page) throw new Error('no page target')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
const exceptions = []
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params?.exceptionDetails?.text)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
function send(method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res) => pending.set(id, res))
}
async function evaljs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error('eval fail: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300))
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fs = await import('node:fs')
const CFG = process.env.APPDATA + '/Inkbox/config.json'
const readCfg = () => JSON.parse(fs.readFileSync(CFG, 'utf-8'))
const pinia = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
const ui = `${pinia}.get('ui')`
const docs = `${pinia}.get('documents')`

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`) }
}

for (let i = 0; i < 40; i++) { if (await evaljs(`!document.getElementById('boot-splash')`)) break; await sleep(500) }
await send('Runtime.enable')

/* ---------- 1. 启动发现 ---------- */
console.log('\n== 1. 内置插件发现 ==')
await evaljs(`${docs}.activateHome()`)
await sleep(1500)
const ids = await evaljs(`${ui}.plugins.map(p=>p.manifest.id).join()`)
check('四个内置插件全部发现（用户自装的 word-count 共存）', ['front-matter','heading-shift','pangu','table-format'].every(x => ids.includes(x)) && ids.includes('word-count'), ids)
check('内置 4 个标记 builtin（用户插件不标）', await evaljs(`${ui}.plugins.filter(p=>p.builtin).length === 4`))
check('无装载错误', await evaljs(`Object.keys(${ui}.pluginErrors).length === 0`), JSON.stringify(await evaljs(`${ui}.pluginErrors`)))
const cmdIds = await evaljs(`${ui}.pluginCommands.map(c=>c.id).join()`)
check('五条内置命令注入（用户插件命令并存）', ['plugin:front-matter/apply','plugin:heading-shift/demote','plugin:heading-shift/promote','plugin:pangu/apply','plugin:table-format/apply'].every(x => cmdIds.includes(x)), cmdIds)

/* ---------- 2. 设置页：徽章 + 行样式结构 ---------- */
console.log('\n== 2. 设置页 ==')
await evaljs(`${ui}.openSettings()`)
await sleep(600)
check('插件行数与发现数一致', await evaljs(`document.querySelectorAll('.plugin-row').length === ${ui}.plugins.length`))
check('「内置」徽章 ×4', await evaljs(`[...document.querySelectorAll('.plugin-badge')].filter(e=>e.textContent==='内置').length === 4`))
check('描述完整渲染（clamp 截断是视觉设计，DOM 内容不丢）', await evaljs(
  `(() => { const descs = [...document.querySelectorAll('.plugin-desc')]; const mfs = ${ui}.plugins.filter(p=>p.manifest.description && !p.error); return descs.length === mfs.length && mfs.every(p => descs.some(d => d.textContent === p.manifest.description)) })()`))
check('行 hover 有底色（class 断言结构在位）', await evaljs(`!!document.querySelector('.plugin-row .switch')`))
await evaljs(`${ui}.settingsOpen = false`)
await sleep(400)

/* ---------- 3. 面板动作行 ---------- */
console.log('\n== 3. 快捷键面板动作行 ==')
await evaljs(`${ui}.toggleShortcutPanel()`)
await sleep(800)
check('动作行数 = 命令数（button 结构）', await evaljs(`document.querySelectorAll('.sc-cmd').length === ${ui}.pluginCommands.length`))
check('每行带 ▶ 图标 + 命令名 + 来源', await evaljs(
  `[...document.querySelectorAll('.sc-cmd')].every(b => b.querySelector('.sc-cmd-ico') && b.querySelector('.sc-cmd-name') && b.querySelector('.sc-cmd-src'))`))
check('旧式 ▶ 键帽不再出现', await evaljs(
  `![...document.querySelectorAll('.sc-cmd kbd')].length`))

/* ---------- 4. 真跑一个变换（pangu） ---------- */
console.log('\n== 4. 真跑变换 ==')
await evaljs(`${docs}.newDoc()`)
await sleep(400)
const myId = await evaljs(`${docs}.active?.id`)
check('测试标签为未命名', /^未命名/.test((await evaljs(`${docs}.active?.name`)) || ''))
await evaljs(`document.querySelector('.cm-content')?.focus()`)
await send('Input.insertText', { text: '用了Electron的编辑器，共3个版本。' })
await sleep(500)
await evaljs(`[...document.querySelectorAll('.sc-cmd')].find(b=>b.textContent.includes('中英文之间补空格'))?.click()`)
await sleep(700)
check('pangu 变换生效（store）', (await evaljs(`${docs}.active?.content`)) === '用了 Electron 的编辑器，共 3 个版本。', await evaljs(`${docs}.active?.content`))
check('CM 视图同步渲染', ((await evaljs(`document.querySelector('.cm-content')?.textContent`)) || '').includes('用了 Electron'))

/* ---------- 5. 禁用内置插件（与用户插件同一开关语义） ---------- */
console.log('\n== 5. 禁用/恢复 ==')
const beforeCmdCount = await evaljs(`${ui}.pluginCommands.length`)
await evaljs(`${ui}.setPluginEnabled('pangu', false)`)
await sleep(1800)
check('禁用后命令少 1 条', await evaljs(`${ui}.pluginCommands.length`) === beforeCmdCount - 1)
check('config 持久化 disabled', (readCfg()?.plugins?.disabled || []).includes('pangu'))
await evaljs(`${ui}.setPluginEnabled('pangu', true)`)
await sleep(1800)
check('恢复后命令数还原', await evaljs(`${ui}.pluginCommands.length`) === beforeCmdCount)

/* ---------- 6. 清理 ---------- */
console.log('\n== 6. 清理 ==')
await evaljs(`${ui}.settingsOpen = false`)
await evaljs(`${ui}.toggleShortcutPanel()`)
await sleep(600)
await evaljs(`${docs}.activateHome()`)
if (myId != null) { await evaljs(`${docs}.closeTab(${myId})`); await sleep(300) }
check('测试标签已关', await evaljs(`${docs}.tabs.some(t=>t.id===${myId})`) === false)
check('config 无残留禁用项', (readCfg()?.plugins?.disabled || []).length === 0)
check('四个内置插件仍在（用户插件不动）', await evaljs(`${ui}.plugins.filter(p=>p.builtin).length === 4 && ${ui}.plugins.some(p=>p.manifest.id==='word-count')`))

console.log(`\n===== ${pass} passed, ${fail} failed =====`)
if (exceptions.length) console.log('页面未捕获异常:', exceptions.slice(0, 5))
process.exit(fail === 0 ? 0 : 1)
