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
// 本地存在的图（.shots 有 png）+ 远程图
await evalPage(`new Promise(res => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const docs = pinia._s.get('documents')
  const ui = pinia._s.get('ui')
  docs.tabs.filter(t => t.path === null && !t.isHome).forEach(t => docs.closeTab(t.id))
  docs.newDoc()
  const tab = docs.tabs[docs.tabs.length - 1]
  const sep = String.fromCharCode(92)
  const localImg = 'E:' + sep + 'projects' + sep + 'lucifer' + sep + 'inkbox-workspace' + sep + '.shots' + sep + 'debug-state.png'
  docs.updateContent(tab.id, '# 图片测试' + String.fromCharCode(10) + String.fromCharCode(10) + '![](file:///' + localImg.split(sep).join('/') + ')' + String.fromCharCode(10) + String.fromCharCode(10) + '![远程](https://inkbox-1305675591.cos.ap-chongqing.myqcloud.com/IMG_20261010_104802.jpg)')
  docs.activate(tab.id)
  ui.setEditorMode('wysiwyg')
  setTimeout(res, 2600)
})`)
await wait(3000)
out.render = await evalPage(`(() => {
  const imgs = [...document.querySelectorAll('.ProseMirror img')]
  return imgs.map(im => ({
    src: decodeURIComponent(im.getAttribute('src') ?? '').slice(0, 80),
    natural: im.naturalWidth + 'x' + im.naturalHeight,
    rectW: Math.round(im.getBoundingClientRect().width)
  }))
})()`)
socket.close()
console.log(JSON.stringify(out, null, 1))
