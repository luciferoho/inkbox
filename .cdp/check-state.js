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
    return r.result?.value
  }
  console.log(JSON.stringify(await ev(`(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const docs = pinia._s.get('documents')
    const ui = pinia._s.get('ui')
    return {
      autosaveEnabled: ui.autosaveEnabled,
      intervalMs: ui.autosaveIntervalMs,
      tabs: docs.tabs.map(t => ({ name: t.name, path: t.path, dirty: t.dirty, head: (t.content||'').slice(0, 40) })),
      activeId: docs.activeId,
      mode: ui.editorMode
    }
  })()`)))
  ws.close()
})().catch(e => { console.error('FAIL', e.message); process.exit(1) })
