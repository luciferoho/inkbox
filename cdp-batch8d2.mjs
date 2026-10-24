const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej })
let msgId = 0
const pending = new Map()
socket.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const send = (method, params = {}) => new Promise((res) => {
  const id = ++msgId
  pending.set(id, res)
  socket.send(JSON.stringify({ id, method, params }))
})
const evalPage = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  return r.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const out = {}
out.active = await evalPage(`(() => { const d = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('documents').active; return { path: d.path, name: d.name, mode: document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('ui').editorMode } })()`)
out.srcImgs = await evalPage(`(() => { const c = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('documents').active.content; return (c.match(/!?\[[^\]]*\]\([^)]*\)/g) ?? []).slice(0, 8) })()`)
out.domSrcs = await evalPage(`(() => [...document.querySelectorAll('.ProseMirror img')].slice(0, 8).map(im => decodeURIComponent(im.getAttribute('src') ?? '').slice(0, 95)))()`)
out.loadCorrect = await evalPage(`new Promise(res => {
  const t = new Image()
  t.onload = () => res({ ok: true, size: t.naturalWidth + 'x' + t.naturalHeight })
  t.onerror = () => res({ ok: false })
  t.src = 'luci-img://E%3A/projects/lucifer/inkbox-workspace/inkbox/docs/banner.svg'
  setTimeout(() => res({ timeout: true }), 4000)
})`)
socket.close()
console.log(JSON.stringify(out, null, 1))
