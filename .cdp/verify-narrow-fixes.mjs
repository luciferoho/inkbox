/* 小窗口样式三修复验证：front matter 行高 / 工具条 wrap / 面板键帽统一 */
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
const pinia = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
const ui = `${pinia}.get('ui')`
const docs = `${pinia}.get('documents')`

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`) }
}

for (let i = 0; i < 40; i++) { if (await evaljs(`!document.getElementById('boot-splash')`)) break; await sleep(500) }

/* ---------- 1. front matter 行高统一（图1） ---------- */
console.log('\n== 1. front matter 行高 ==')
await evaljs(`${docs}.activateHome()`)
await evaljs(`${ui}.setEditorMode('split')`)
await evaljs(`${docs}.newDoc()`)
await sleep(400)
const fmTabId = await evaljs(`${docs}.active?.id`)
await evaljs(`document.querySelector('.cm-content')?.focus()`)
await send('Input.insertText', { text: '---\ntitle: "测试"\ndate: 2026-10-07\n---\n\n# 标题\n\n正文\n\n---\n\n尾部分隔线后\n' })
await sleep(800)
const lh = await evaljs(`(() => {
  const lines = [...document.querySelectorAll('.cm-line')].slice(0, 4)
  return lines.map(l => Math.round(l.getBoundingClientRect().height * 10) / 10)
})()`)
check('front matter 4 行行高全部一致（不再撑高）', lh.length === 4 && new Set(lh).size === 1, JSON.stringify(lh))
check('水平线不误伤（FM 开/闭 + 中间 HR 共 3 行 ---）', await evaljs(
  `[...document.querySelectorAll('.cm-line')].filter(l=>l.textContent.trim()==='---').length`) === 3)

/* ---------- 2. 工具条 wrap（图2/图3） ---------- */
console.log('\n== 2. 工具条换行 ==')
await evaljs(`${docs}.newDoc()`)
await sleep(400)
const myId = await evaljs(`${docs}.active?.id`)
await evaljs(`document.querySelector('.cm-content')?.focus()`)
await send('Input.insertText', { text: '| 列1 | 列2 | 列3 | 列4 |\n| --- | --- | --- | --- |\n| a | b | c | d |\n' })
await sleep(400)
// 光标移进表格：点击第一行内容
const cell = await evaljs(`(() => {
  const lines = [...document.querySelectorAll('.cm-line')]
  const row = lines.find(l => l.textContent.includes('| a |'))
  const r = row?.getBoundingClientRect()
  if (!r) return false
  return JSON.stringify({ x: Math.round(r.x + 10), y: Math.round(r.y + r.height / 2) })
})()`)
if (cell) {
  const { x, y } = JSON.parse(cell)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
await sleep(500)
const strip = await evaljs(`(() => {
  const s = document.querySelector('.ctx-strip')
  if (!s) return null
  const inTable = !!s.querySelector('.tb-size')
  const btns = [...s.querySelectorAll('button')]
  const btn = btns[0]?.getBoundingClientRect()
  return {
    inTable,
    count: btns.length,
    scrollH: s.scrollHeight, clientH: s.clientHeight,
    scrollW: s.scrollWidth, clientW: s.clientWidth,
    btnH: btn ? Math.round(btn.height) : 0,
    wraps: s.getComputedStyle ? null : getComputedStyle(s).flexWrap
  }
})()`)
check('表格工具条激活（按钮最全的最坏场景）', strip?.inTable === true, JSON.stringify(strip))
check('按钮无纵向裁切（每枚完整 24px）', strip?.btnH === 24, String(strip?.btnH))
check('无横向溢出（scrollWidth ≤ clientWidth）', strip ? strip.scrollW <= strip.clientW + 1 : false,
  `sw=${strip?.scrollW} cw=${strip?.clientW}`)
check('窄窗口下发生换行（两行摊开）', strip ? strip.scrollH > strip.clientH / 2 : false, JSON.stringify({ sh: strip?.scrollH, ch: strip?.clientH }))

/* ---------- 3. 面板键帽统一（图4） ---------- */
console.log('\n== 3. 键帽格式统一 ==')
await evaljs(`${ui}.toggleShortcutPanel()`)
await sleep(900)
const kbds = await evaljs(`(() => {
  const groups = [...document.querySelectorAll('.sc-group')]
  const g = groups.find(e => e.querySelector('.sc-title')?.textContent === '编辑与格式')
  if (!g) return null
  const rows = [...g.querySelectorAll('.sc-item')]
  return rows.map(r => [...r.querySelectorAll('.sc-keys kbd')].map(k => k.textContent).join('+'))
})()`)
check('静态组键帽已按 + 拆分（Ctrl / B 两枚）', Array.isArray(kbds) && kbds[0] === 'Ctrl+B' && kbds[1] === 'Ctrl+I', JSON.stringify(kbds))
const kbdCounts = await evaljs(`(() => {
  const groups = [...document.querySelectorAll('.sc-group')]
  const g = groups.find(e => e.querySelector('.sc-title')?.textContent === '编辑与格式')
  return [...g.querySelectorAll('.sc-item')].map(r => r.querySelectorAll('kbd').length)
})()`)
check('Ctrl+B 渲染 2 枚键帽（与注册表组一致）', JSON.stringify(kbdCounts) === '[2,2,2,3,3,4,2]', JSON.stringify(kbdCounts))
const regB = await evaljs(`(() => {
  const groups = [...document.querySelectorAll('.sc-group')]
  const g = groups.find(e => e.querySelector('.sc-title')?.textContent === '编辑与格式')
  return g.querySelectorAll('.sc-item')[0].querySelectorAll('kbd').length
})()`)
check('与注册表组键帽形态一致（均为分键）', regB === 2)

/* ---------- 4. 清理 ---------- */
console.log('\n== 4. 清理 ==')
await evaljs(`${ui}.toggleShortcutPanel()`)
await sleep(600)
await evaljs(`${docs}.activateHome()`)
for (const id of [fmTabId, myId]) {
  if (id != null) { await evaljs(`${docs}.closeTab(${id})`); await sleep(200) }
}
check('测试标签已关（fm + 表格两个）', await evaljs(
  `${docs}.tabs.some(t=>t.id===${fmTabId}) || ${docs}.tabs.some(t=>t.id===${myId})`) === false)

console.log(`\n===== ${pass} passed, ${fail} failed =====`)
if (exceptions.length) console.log('页面未捕获异常:', exceptions.slice(0, 5))
process.exit(fail === 0 ? 0 : 1)
