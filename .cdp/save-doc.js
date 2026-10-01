;(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pend = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id) } }
  const ev = async (expr) => {
    const r = await new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })) })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400))
    return r.result?.value
  }
  const getPinia = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia`
  console.log('save:', await ev(`${getPinia}._s.get('documents').save().then(() => {
    const tab = ${getPinia}._s.get('documents').tabs.find(t => t.name === '测试.md')
    return 'dirty=' + tab.dirty + ' head=' + JSON.stringify(tab.content.slice(0, 16)) + ' savedMatch=' + (tab.savedContent === tab.content)
  })`))
  console.log('cm view head:', await ev(`JSON.stringify((document.querySelector('.cm-content')?.textContent || 'no-cm').slice(0, 30))`))
  console.log('all tabs:', await ev(`JSON.stringify(${getPinia}._s.get('documents').tabs.map(t => ({ n: t.name, d: t.dirty })))`))
  ws.close()
})().catch(e => { console.error('FAIL', e.message); process.exit(1) })
