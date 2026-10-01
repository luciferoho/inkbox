let ws, msgId = 0
const pending = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PINIA = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
const VBAR = `[...document.querySelectorAll('.find-bar')].find(b => b.offsetWidth || b.offsetHeight)`
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }) }
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 400))
  return r.result.value
}
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      console.log('CONSOLE[' + m.params.type + ']:', m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300))
    }
    if (m.method === 'Runtime.exceptionThrown') {
      console.log('EXCEPTION:', JSON.stringify(m.params.exceptionDetails).slice(0, 300))
    }
  }
  await send('Runtime.enable')
  // 清挂起确认框
  console.log('dialog:', await ev(`${PINIA}._s.get('ui').confirm ? 'open→cancel' : 'none'`))
  await ev(`${PINIA}._s.get('ui').resolveConfirm?.(false); 'x'`)
  console.log('mode:', await ev(`${PINIA}._s.get('ui').editorMode`), '| label:', await ev(`(() => { const b = ${VBAR}; return b ? b.querySelector('.find-count').textContent + ' q=' + b.querySelector('.find-input').value + ' r=' + (b.querySelector('.find-input-repl')?.value ?? '-') : 'NO BAR' })()`))
  console.log('doc:', await ev(`JSON.stringify(${PINIA}._s.get('documents').active.content)`))
  // 重新设查询触发 applySearchQuery，看计数是否恢复
  await ev(`(() => { const b = ${VBAR}; const i = b.querySelector('.find-input'); i.focus(); i.value = '尾部'; i.dispatchEvent(new Event('input')); return 'ok' })()`)
  await sleep(500)
  console.log('label after re-set:', await ev(`(() => { const b = ${VBAR}; return b.querySelector('.find-count').textContent })()`), '| luci hits:', await ev(`document.querySelectorAll('.cm-luci-find-hit').length`))
  // 全部替换 + 抓控制台
  await ev(`(() => { const b = ${VBAR}; [...b.querySelectorAll('.find-btn')].find(x => x.textContent === '全部替换').click(); return 'ok' })()`)
  await sleep(600)
  console.log('doc after replaceAll:', await ev(`JSON.stringify(${PINIA}._s.get('documents').active.content)`))
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
