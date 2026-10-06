const pages = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = pages.find((p) => p.type === 'page' && p.url.includes('localhost:5173'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
const send = (method, params = {}) => {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res) => pending.set(id, res))
}
const evaljs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  return r.result?.result?.value
}
const pinia = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
const tabs = await evaljs(`${pinia}.get('documents').tabs.map(t => ({ name: t.name, path: t.path, dirty: t.dirty, len: (t.content || '').length, polluted: (t.content || '').includes('第一行文字'), head: (t.content || '').slice(0, 50) }))`)
console.log(JSON.stringify(tabs, null, 1))
ws.close()
