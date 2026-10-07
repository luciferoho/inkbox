/* 插件系统（6.9）验证：发现/装载 → 设置页区块 → 面板命令运行 → 禁用开关 → 坏插件隔离 → 清理
 * 全程 DOM click + store 断言，不用 Page.reload（会杀 CDP 键鼠注入），基线靠重启 electron */
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
const path = await import('node:path')
const USER_DATA = path.join(process.env.APPDATA, 'Inkbox')
const CFG = path.join(USER_DATA, 'config.json')
const PLUGINS = path.join(USER_DATA, 'plugins')
const pinia = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
const ui = `${pinia}.get('ui')`
const docs = `${pinia}.get('documents')`

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`) }
}
const readCfg = () => JSON.parse(fs.readFileSync(CFG, 'utf-8'))

/* 基线：等开屏消失（本次为 electron 全新启动，不做 Page.reload） */
for (let i = 0; i < 40; i++) { if (await evaljs(`!document.getElementById('boot-splash')`)) break; await sleep(500) }
await send('Runtime.enable')

/* ---------- 0. preload 就绪 ---------- */
console.log('\n== 0. 装载通道 ==')
check('window.api.plugin 存在', await evaljs(`typeof window.api.plugin?.list === 'function'`))

/* ---------- 1. 启动发现与装载（applyConfig → syncPlugins） ---------- */
console.log('\n== 1. 启动发现 ==')
await evaljs(`${docs}.activateHome()`)
check('活动标签为主页（保护真实文档）', await evaljs(`${docs}.active?.path === null`))
await sleep(1200) // applyConfig 的动态 import + IPC 扫描
check('发现 word-count 插件', await evaljs(`${ui}.plugins.length === 1 && ${ui}.plugins[0].manifest.id === 'word-count'`),
  JSON.stringify(await evaljs(`${ui}.plugins`)))
check('清单字段齐全（name/version/description）', await evaljs(
  `${ui}.plugins[0].manifest.name === '字数统计' && ${ui}.plugins[0].manifest.version === '1.0.0' && !!${ui}.plugins[0].manifest.description`))
check('两条命令已注入（count/divider）', await evaljs(
  `${ui}.pluginCommands.map(c=>c.id).join() === 'plugin:word-count/count,plugin:word-count/divider'`),
  JSON.stringify(await evaljs(`${ui}.pluginCommands`)))
check('命令带来源插件名', await evaljs(`${ui}.pluginCommands[0].plugin === '字数统计'`))
check('无装载错误', await evaljs(`Object.keys(${ui}.pluginErrors).length === 0`), JSON.stringify(await evaljs(`${ui}.pluginErrors`)))

/* ---------- 2. 设置页「插件」区块 ---------- */
console.log('\n== 2. 设置页区块 ==')
await evaljs(`${ui}.openSettings()`)
await sleep(600)
const dlgTexts = await evaljs(`[...document.querySelectorAll('.dialog .group-title')].map(e=>e.textContent)`)
check('「插件」分组标题存在', (dlgTexts || []).includes('插件'), JSON.stringify(dlgTexts))
check('行渲染显示名+版本', await evaljs(`document.querySelector('.plugin-row .plugin-name')?.textContent.includes('字数统计') && document.querySelector('.plugin-ver')?.textContent === 'v1.0.0'`))
check('描述可见', await evaljs(`document.querySelector('.plugin-desc')?.textContent.includes('统计当前文档字数')`))
check('开关默认开', await evaljs(`document.querySelector('.plugin-row .switch')?.ariaChecked === 'true'`))
const btnTexts = await evaljs(`[...document.querySelectorAll('.plugin-actions .sc-btn')].map(e=>e.textContent)`)
check('打开目录/重新加载按钮在位', JSON.stringify(btnTexts) === JSON.stringify(['打开插件目录', '重新加载']), JSON.stringify(btnTexts))

/* ---------- 3. 禁用开关（配置持久化 + 命令撤下） ---------- */
console.log('\n== 3. 禁用开关 ==')
await evaljs(`document.querySelector('.plugin-row .switch').click()`)
await sleep(1000) // setConfig → persist → broadcast → applyConfig → syncPlugins
check('disabled 表含 word-count', await evaljs(`${ui}.pluginsDisabled.includes('word-count')`), JSON.stringify(await evaljs(`${ui}.pluginsDisabled`)))
check('磁盘 config 已持久化', readCfg()?.plugins?.disabled?.includes('word-count') === true, fs.readFileSync(CFG, 'utf-8').slice(-200))
check('命令已全部撤下', await evaljs(`${ui}.pluginCommands.length === 0`))
await evaljs(`document.querySelector('.plugin-row .switch').click()`)
await sleep(1000)
check('重新启用后命令恢复', await evaljs(`${ui}.pluginCommands.length === 2`))
check('disabled 表清空', await evaljs(`${ui}.pluginsDisabled.length === 0`) === true && readCfg()?.plugins?.disabled?.length === 0,
  JSON.stringify(readCfg()?.plugins?.disabled))

/* ---------- 4. 快捷键面板插件组 + 命令运行 ---------- */
console.log('\n== 4. 面板命令运行 ==')
await evaljs(`${ui}.settingsOpen = false`)
await sleep(400)
await evaljs(`${docs}.newDoc()`)
await sleep(400)
const tabName = await evaljs(`${docs}.active?.name`)
check('测试标签已建（未命名）', /^未命名/.test(tabName || ''), tabName)
await evaljs(`document.querySelector('.cm-content')?.focus()`)
await send('Input.insertText', { text: 'hello 世界' })
await sleep(500)
check('输入已进 store（编辑器→store 链路）', (await evaljs(`${docs}.active?.content`)) === 'hello 世界')
await evaljs(`${ui}.toggleShortcutPanel()`)
await sleep(700) // 展开过渡
check('面板「插件」组出现', await evaljs(`[...document.querySelectorAll('.sc-title')].some(e=>e.textContent==='插件')`))
const cmdRows = await evaljs(`[...document.querySelectorAll('.sc-cmd .sc-desc')].map(e=>e.textContent)`)
check('两行命令按注册序渲染', JSON.stringify(cmdRows) === JSON.stringify(['统计当前文档字数', '在文末插入分隔线']), JSON.stringify(cmdRows))
await evaljs(`document.querySelectorAll('.sc-cmd')[0].click()`)
await sleep(300)
check('count 命令 toast 报字符数', ((await evaljs(`${ui}.toast`)) || '').includes('共 7 个字符'), await evaljs(`${ui}.toast`))
await evaljs(`document.querySelectorAll('.sc-cmd')[1].click()`)
await sleep(600)
check('divider 命令改写 store 内容', ((await evaljs(`${docs}.active?.content`)) || '').endsWith('---\n\n'), await evaljs(`${docs}.active?.content`))
check('notifyReload 生效：CM 视图同步渲染', ((await evaljs(`document.querySelector('.cm-content')?.textContent`)) || '').includes('---'))

/* ---------- 5. 坏插件隔离 ---------- */
console.log('\n== 5. 坏插件隔离 ==')
const badA = path.join(PLUGINS, 'broken-one')
fs.mkdirSync(badA, { recursive: true })
fs.writeFileSync(path.join(badA, 'plugin.json'), JSON.stringify({ id: 'broken-one', name: '坏插件', main: 'main.js' }))
fs.writeFileSync(path.join(badA, 'main.js'), 'throw new Error("boom-test")')
const badB = path.join(PLUGINS, 'bad-manifest')
fs.mkdirSync(badB, { recursive: true })
fs.writeFileSync(path.join(badB, 'plugin.json'), '{ "id": "Bad Id!", "name": "坏清单" }')
await evaljs(`${ui}.openSettings()`)
await sleep(500)
const reloadBtn = await evaljs(`[...document.querySelectorAll('.plugin-actions .sc-btn')].find(b=>b.textContent==='重新加载')?.click() ?? 'clicked'`)
check('重新加载可点击', reloadBtn === 'clicked')
await sleep(1200)
check('三个插件全部呈现', await evaljs(`${ui}.plugins.length === 3`), JSON.stringify(await evaljs(`${ui}.plugins.map(p=>p.manifest.id||p.dir)`)))
check('抛错插件标记运行期错误', ((await evaljs(`${ui}.pluginErrors['broken-one']`)) || '').includes('boom-test'))
check('坏清单插件标记发现期错误', ((await evaljs(`${ui}.plugins.find(p=>p.dir.includes('bad-manifest'))?.error`)) || '').includes('id'))
check('坏插件不影响好插件（命令仍 2 条）', await evaljs(`${ui}.pluginCommands.length === 2`))
check('宿主存活（eval 仍通）', await evaljs(`1 + 1`) === 2)

/* ---------- 6. 清理：删插件目录 → 重载 → 关面板/设置 → 关测试标签 ---------- */
console.log('\n== 6. 清理与恢复 ==')
fs.rmSync(badA, { recursive: true, force: true })
fs.rmSync(badB, { recursive: true, force: true })
fs.rmSync(path.join(PLUGINS, 'word-count'), { recursive: true, force: true })
await evaljs(`[...document.querySelectorAll('.plugin-actions .sc-btn')].find(b=>b.textContent==='重新加载')?.click()`)
await sleep(1200)
check('删除后重载为空', await evaljs(`${ui}.plugins.length === 0 && ${ui}.pluginCommands.length === 0`))
check('错误表随重载清空', await evaljs(`Object.keys(${ui}.pluginErrors).length === 0`))
check('config 无残留禁用项', (readCfg()?.plugins?.disabled || []).length === 0, fs.readFileSync(CFG, 'utf-8').slice(-160))
await evaljs(`${ui}.settingsOpen = false`)
await evaljs(`${ui}.toggleShortcutPanel()`) // 关面板
await sleep(600)
check('面板「插件」组消失', await evaljs(`![...document.querySelectorAll('.sc-title')].some(e=>e.textContent==='插件')`))
const myId = await evaljs(`${docs}.active?.id`)
await evaljs(`${docs}.activateHome()`)
if (myId) { await evaljs(`${docs}.closeTab(${myId})`); await sleep(300) }
check('测试标签已关（我的 id 消失，会话里的用户标签不动）', myId == null || (await evaljs(`${docs}.tabs.some(t=>t.id===${myId})`)) === false)

console.log(`\n===== ${pass} passed, ${fail} failed =====`)
if (exceptions.length) console.log('页面未捕获异常:', exceptions.slice(0, 5))
process.exit(fail === 0 ? 0 : 1)
