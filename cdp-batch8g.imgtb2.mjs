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
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

const out = {}
const img = await evalPage(`(() => {
  const im = [...document.querySelectorAll('.ProseMirror img')].find(i => i.getBoundingClientRect().width > 100)
  if (!im) return null
  const r = im.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) }
})()`)
out.img = img
if (img) {
  await click(img.x, img.y)
  await wait(800)
  out.toolbar = await evalPage(`(() => { const tb = document.querySelector('.el-toolbar, [class*=el-toolbar]'); if (!tb) return { present: false }; return { present: true, visible: tb.offsetParent !== null, text: tb.textContent.slice(0, 120), buttons: [...tb.querySelectorAll('button')].map(b => b.title || b.textContent.trim()).slice(0, 8) } })()`)
  // 图片悬浮提示（先移开再移入制造真实进入）
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: img.x - 200, y: img.y - 150 })
  await wait(150)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: img.x, y: img.y })
  await wait(700)
  out.hoverTip = await evalPage(`(() => { const tip = document.querySelector('[class*=img-tip], .img-tip'); return { present: !!tip, text: tip?.textContent?.slice(0, 60) ?? null } })()`)
}
socket.close()
console.log(JSON.stringify(out, null, 1))
