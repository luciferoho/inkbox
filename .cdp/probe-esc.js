let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}
async function key(opts) { await send('Input.dispatchKeyEvent', opts) }
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  console.log(await ev(`(() => {
    const bars = [...document.querySelectorAll('.find-bar')]
    return JSON.stringify({
      count: bars.length,
      infos: bars.map(b => ({
        visible: !!(b.offsetWidth || b.offsetHeight),
        inCmWrap: !!b.closest('.cm-host-wrap'),
        q: b.querySelector('.find-input')?.value ?? null
      })),
      active: document.activeElement?.className?.slice(0, 40) ?? null,
      mode: document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('ui').editorMode
    })
  })()`))
  // 聚焦第一个可见 input 并派发合成 Esc（绕开 CDP，直接走 DOM 事件链）
  console.log('synthetic esc:', await ev(`(() => {
    const bar = [...document.querySelectorAll('.find-bar')].find(b => b.offsetWidth || b.offsetHeight)
    if (!bar) return 'no visible bar'
    const input = bar.querySelector('.find-input')
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    return 'dispatched'
  })()`))
  await sleep(400)
  console.log('bars after synthetic esc:', await ev(`document.querySelectorAll('.find-bar').length`), '| visible:', await ev(`[...document.querySelectorAll('.find-bar')].filter(b => b.offsetWidth || b.offsetHeight).length`))
  // CDP Esc 对比
  const inp = await ev(`(() => { const bar = [...document.querySelectorAll('.find-bar')].find(b => b.offsetWidth || b.offsetHeight); if (!bar) return 'none'; const i = bar.querySelector('.find-input'); i.focus(); return 'focused' })()`)
  console.log('refocus:', inp)
  await key({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await key({ type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(400)
  console.log('bars after CDP esc:', await ev(`document.querySelectorAll('.find-bar').length`))
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
