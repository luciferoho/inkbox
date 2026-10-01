const fs = require('fs')
const ORIG = fs.readFileSync('E:/projects/lucifer/blog/notes/测试.md', 'utf8')
let ws, msgId = 0
const pending = new Map()
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 400))
  return r.result.value
}
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  const lit = JSON.stringify(ORIG)
  console.log(await ev(`(() => {
    const docs = ${PINIA}._s.get('documents')
    const ui = ${PINIA}._s.get('ui')
    const tab = docs.tabs.find(t => t.name === '测试.md')
    if (!tab) return 'NO TAB'
    docs.updateContent(tab.id, ${lit})
    ui.notifyReload()
    return 'restored dirty=' + tab.dirty
  })()`))
  console.log(await ev(`${PINIA}._s.get('documents').save().then(() => {
    const tab = ${PINIA}._s.get('documents').tabs.find(t => t.name === '测试.md')
    return 'saved dirty=' + tab.dirty + ' match=' + (tab.savedContent === tab.content)
  })`))
  console.log('all tabs:', await ev(`JSON.stringify(${PINIA}._s.get('documents').tabs.map(t => ({ n: t.name, d: t.dirty })))`))
  ws.close()
})().catch(e => { console.error('FAIL', e.message); process.exit(1) })
