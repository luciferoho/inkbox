const fs = require('fs')
const ORIG = fs.readFileSync('E:/projects/lucifer/blog/notes/测试.md', 'utf8')
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
  const lit = JSON.stringify(ORIG)
  console.log(await ev(`(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const docs = pinia._s.get('documents')
    const ui = pinia._s.get('ui')
    const tab = docs.tabs.find(t => t.name === '测试.md')
    if (!tab) return 'NO TAB'
    docs.updateContent(tab.id, ${lit})
    ui.notifyReload()
    return 'restored, dirty=' + tab.dirty
  })()`))
  // save 归一化（写回相同内容，清脏标、更新回声快照）
  console.log('save:', await ev(`pinia._s.get('documents').save().then(() => {
    const tab = pinia._s.get('documents').tabs.find(t => t.name === '测试.md')
    return 'dirty=' + tab.dirty + ' head=' + JSON.stringify(tab.content.slice(0, 20))
  })`))
  // 编辑器视图也确认
  console.log('editor head:', await ev(`JSON.stringify((document.querySelector('.cm-content')?.textContent || document.querySelector('.ProseMirror')?.textContent || '').slice(0, 30))`))
  ws.close()
})().catch(e => { console.error('FAIL', e.message); process.exit(1) })
