import fs from 'node:fs'
const name = process.argv[2] ?? 'shot.png'
const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id === 1 && m.result?.data) {
    fs.writeFileSync(name, Buffer.from(m.result.data, 'base64'))
    console.log('saved', name)
    ws.close()
  } else if (m.id === 1) {
    console.error('ERR', JSON.stringify(m).slice(0, 120))
    ws.close()
  }
}
ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }))
