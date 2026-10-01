let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
const VBAR = `[...document.querySelectorAll('.find-bar')].find(b => b.offsetWidth || b.offsetHeight)`
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  console.log('bars before:', await ev(`document.querySelectorAll('.find-bar').length`))
  console.log('click X:', await ev(`(() => { const b = ${VBAR}; if (!b) return 'NO BAR'; const x = [...b.querySelectorAll('.find-btn')].find(e => e.textContent === '✕'); x.click(); return 'ok' })()`))
  await sleep(400)
  console.log('bars after X:', await ev(`document.querySelectorAll('.find-bar').length`))
  // 若已关：重开再看根节点的 Vue 监听是否真的存在
  await ev(`${PINIA}._s.get('ui').requestFind(); 'reopen'`)
  await sleep(400)
  console.log('reopened:', await ev(`document.querySelectorAll('.find-bar').length`))
  // 列出根 div 上的 keydown 监听（getEventListeners 不可用，用 Chrome devtools protocol 不可行；改查 Vue 存根）
  console.log('vue binding check:', await ev(`(() => {
    const b = ${VBAR}
    const keys = Object.keys(b)
    const veiKey = keys.find(k => k.startsWith('__vue'))
    const props = veiKey ? b[veiKey] : null
    return JSON.stringify({ veiKey, hasProps: !!props, onKeydown: !!(props && props.vnode && props.vnode.props && (props.vnode.props.onKeydown || props.vnode.props['onKeydown'])) })
  })()`))
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
