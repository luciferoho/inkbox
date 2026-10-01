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
const snap = () => ev(`(() => {
  const sc = document.querySelector('.cm-scroller')
  const a = document.querySelector('.cm-activeLine')
  return { st: Math.round(sc.scrollTop), at: a ? Math.round(a.getBoundingClientRect().top - sc.getBoundingClientRect().top) : null }
})()`)
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) } }
  console.log('tw:', await ev(`${PINIA}._s.get('ui').typewriterMode`))
  // 1. tw on 下 jumpTo
  await ev(`${PINIA}._s.get('ui').jumpTo(800); 'j'`); await sleep(700)
  console.log('tw ON jumpTo(800):', JSON.stringify(await snap()))
  // 2. 关 tw 再 jumpTo
  if (await ev(`${PINIA}._s.get('ui').typewriterMode`)) await ev(`${PINIA}._s.get('ui').toggleTypewriter(); 'off'`)
  await sleep(400)
  await ev(`${PINIA}._s.get('ui').jumpTo(9000); 'j'`); await sleep(700)
  console.log('tw OFF jumpTo(9000):', JSON.stringify(await snap()))
  // 3. tw off 再 jumpTo(800)
  await ev(`${PINIA}._s.get('ui').jumpTo(800); 'j'`); await sleep(700)
  console.log('tw OFF jumpTo(800):', JSON.stringify(await snap()))
  // 4. 重开 tw jumpTo(50)
  await ev(`${PINIA}._s.get('ui').toggleTypewriter(); 'on'`); await sleep(400)
  await ev(`${PINIA}._s.get('ui').jumpTo(50); 'j'`); await sleep(700)
  console.log('tw ON jumpTo(50):', JSON.stringify(await snap()))
  // 恢复
  await ev(`${PINIA}._s.get('ui').toggleTypewriter(); 'off2'`)
  ws.close()
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
