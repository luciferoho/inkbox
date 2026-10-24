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
// 打开查找条（走 store，与菜单路径等价）
await evalPage(`(() => { document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('ui').requestFind(); return 1 })()`)
await wait(800)
out.bar = await evalPage(`(() => { const b = document.querySelector('[class*=find-bar], .find-bar'); return { present: !!b, visible: b ? b.offsetParent !== null : false } })()`)
// 输入查询（README 或当前文档找 "图片"）
await evalPage(`(() => { const inp = document.querySelector('[class*=find-bar] input, .find-bar input'); if (inp) { inp.focus(); document.execCommand('insertText', false, '图片') } return 1 })()`)
await wait(900)
out.matches = await evalPage(`(() => { const b = document.querySelector('[class*=find-bar], .find-bar'); return { text: b?.textContent?.slice(0, 80) ?? null, hasCount: /\d/.test(b?.textContent ?? '') } })()`)
// 关闭
await evalPage(`(() => { document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('ui').requestFind(); return 1 })()`)
await wait(400)
socket.close()
console.log(JSON.stringify(out, null, 1))
