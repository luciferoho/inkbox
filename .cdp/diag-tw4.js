let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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
  console.log(JSON.stringify(await ev(`(() => {
    const sc = document.querySelector('.cm-scroller')
    // 手动滚动是否可行
    sc.scrollTop = 5000
    const manual = sc.scrollTop
    sc.scrollTop = 0
    const cmEd = document.querySelector('.cm-editor')
    const content = document.querySelector('.cm-content')
    return {
      manualScroll: Math.round(manual),
      contentH: Math.round(content.offsetHeight),
      scrollerScrollH: Math.round(sc.scrollHeight),
      docLinesInDom: document.querySelectorAll('.cm-line').length,
      gapEl: (() => { const g = document.querySelectorAll('.cm-content > [style], .cm-content > div'); return g.length })(),
      firstChildTop: (() => { const f = document.querySelector('.cm-line'); return f ? Math.round(f.offsetTop) : null })(),
      firstChildMarginTop: (() => { const f = document.querySelector('.cm-line'); return f ? getComputedStyle(f).marginTop : null })()
    }
  })()`)))
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
