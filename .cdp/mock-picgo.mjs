/* mock PicGo server：POST /upload → {success:true, result:[url]}；/fail → success:false；/dead 直接连不上（用另一个端口模拟） */
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 43677)
const mode = process.argv[3] ?? 'ok'

createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    console.log(`[mock-picgo] ${req.method} ${req.url} bytes=${body.length}`)
    if (mode === 'fail') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true, result: [`https://mock.cdn/picgo/img_${Date.now()}.png`] }))
  })
}).listen(port, '127.0.0.1', () => console.log(`mock-picgo on :${port} mode=${mode}`))
