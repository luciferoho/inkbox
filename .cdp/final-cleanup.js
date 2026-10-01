const fs = require('fs')
const DIR = 'E:/projects/lucifer/inkbox-workspace/inkbox/.cdp'
let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${DIR}/${name}.png`, Buffer.from(r.data, 'base64')) }
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }

  // 用户原主题
  const theme = await ev(`window.api.app.getConfig().then(c => c.theme)`)
  console.log('user theme:', theme)

  // 暗色 + 命中高亮截图
  await ev(`${PINIA}._s.get('ui').setThemePref('dark').then(() => 'dark')`)
  await sleep(600)
  await ev(`${PINIA}._s.get('ui').requestFind(); 'open'`)
  await sleep(300)
  await ev(`(() => { const i = document.querySelector('.find-input'); if (i) { i.focus(); i.value = 'BBB'; i.dispatchEvent(new Event('input')) } return 'q' })()`)
  await sleep(500)
  await shot('find-6-dark')

  // 恢复主题 + 清理测试标签 + 关查找条
  await ev(`${PINIA}._s.get('ui').setThemePref(${JSON.stringify(theme)}).then(() => 'restored')`)
  await ev(`(() => { const ui = ${PINIA}._s.get('ui'); if (ui.confirm) ui.resolveConfirm(false); return 'x' })()`)
  await ev(`(() => { const b = document.querySelector('.find-bar button:last-child'); b && b.click(); return 'closed' })()`)
  await ev(`(() => { const docs = ${PINIA}._s.get('documents'); const t = docs.tabs.find(t => !t.path && !t.isHome); if (t) { docs.updateContent(t.id, ''); t.dirty = false; docs.closeTab(t.id) } return 'tab-cleaned' })()`)
  await sleep(400)
  console.log('final tabs:', await ev(`JSON.stringify(${PINIA}._s.get('documents').tabs.map(t => ({ n: t.name, d: t.dirty })))`))
  console.log('theme now:', await ev(`window.api.app.getConfig().then(c => c.theme)`))
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
