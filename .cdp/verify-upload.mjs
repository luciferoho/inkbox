/* 图床上传（6.8）真窗口验证：mock PicGo server + 合成粘贴事件
   场景：上传成功插入远端链接（不写 .assets）/ 上传失败回退本地 / 设置页持久化 */
import { spawn } from 'node:child_process'

/* ---------- 起 mock PicGo ---------- */
const mock = spawn('node', ['.cdp/mock-picgo.mjs', '43677', 'ok'], { stdio: 'pipe' })
await new Promise((res) => {
  mock.stdout.on('data', (d) => {
    if (String(d).includes('mock-picgo on')) res()
  })
})
const failMock = spawn('node', ['.cdp/mock-picgo.mjs', '43678', 'fail'], { stdio: 'pipe' })
await new Promise((res) => {
  failMock.stdout.on('data', (d) => {
    if (String(d).includes('mock-picgo on')) res()
  })
})
process.on('exit', () => {
  mock.kill()
  failMock.kill()
})

/* ---------- CDP ---------- */
const base = 'http://127.0.0.1:9222'
const pages = await (await fetch(`${base}/json`)).json()
const page = pages.find((p) => p.type === 'page' && p.url.includes('localhost:5173'))
if (!page) throw new Error('no page target')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
function send(method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res) => pending.set(id, res))
}
async function evaljs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error('eval fail: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pinia = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
const ui = `${pinia}.get('ui')`
const docs = `${pinia}.get('documents')`

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`) }
}

/* 1x1 PNG */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

for (let i = 0; i < 40; i++) { if (await evaljs(`!document.getElementById('boot-splash')`)) break; await sleep(500) }
await send('Page.enable')
await send('Page.reload')
await sleep(2500)
for (let i = 0; i < 30; i++) { if (await evaljs(`!document.getElementById('boot-splash')`)) break; await sleep(500) }
await evaljs(`${docs}.activateHome()`)

/* ---------- 准备一个已落盘的测试文档（粘贴图片要求 tab.path；写在工作区外层，不进 git、不碰用户笔记） ---------- */
const TEST_DIR = 'E:\\projects\\lucifer\\inkbox-workspace\\img-upload-test'
const TEST_MD = `${TEST_DIR}\\测试图.md`
/* 重跑自清理：先关旧标签（closeTab 不弹确认），删盘上目录，再建干净的 */
const staleId = await evaljs(`${docs}.tabs.find(t => (t.path || '').includes('img-upload-test'))?.id ?? null`)
if (staleId !== null) {
  await evaljs(`${docs}.closeTab(${staleId})`)
  await sleep(300)
}
await evaljs(`window.api.fs.delete('${TEST_DIR.replace(/\\/g, '\\\\')}')`)
await evaljs(`window.api.fs.create('${TEST_DIR.replace(/\\/g, '\\\\')}', true)`)
await evaljs(`window.api.fs.writeFile('${TEST_DIR.replace(/\\/g, '\\\\')}\\\\测试图.md', '# 测试图\\n\\n粘贴区\\n')`)
await sleep(200)
await evaljs(`${docs}.openPath('${TEST_DIR.replace(/\\/g, '\\\\')}\\\\测试图.md')`)
await sleep(700)
check('测试文档已打开（未碰用户笔记）', ((await evaljs(`${docs}.active?.path`)) ?? '').includes('img-upload-test'))
check('初始无图床配置残留', await evaljs(`${ui}.upload.enabled === false`))

/* ---------- 场景 1：上传成功 → 远端链接，不写 .assets ---------- */
console.log('\n== 上传成功路径 ==')
await evaljs(`${ui}.setUpload({ enabled: true, server: 'http://127.0.0.1:43677/upload' })`)
await sleep(300)
const pasteImg = `(() => {
  const b64 = '${PNG_B64}'
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const dt = new DataTransfer()
  dt.items.add(new File([bytes], 'clip.png', { type: 'image/png' }))
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  document.querySelector('.cm-content').focus()
  document.querySelector('.cm-content').dispatchEvent(ev)
  return true
})()`
await evaljs(pasteImg)
await sleep(1200)
const content1 = (await evaljs(`${docs}.active.content`)) || ''
check('粘贴后插入远端链接', /!\[IMG_\d{8}_\d{6}\.png\]\(https:\/\/mock\.cdn\/picgo\/img_\d+\.png\)/.test(content1), JSON.stringify(content1.slice(-140)))
check('本地 .assets 未写入', (await evaljs(`window.api.fs.readDir('${TEST_DIR.replace(/\\/g, '\\\\')}').then(r => JSON.stringify(r.map(e => e.name)))`)) === '["测试图.md"]')

/* ---------- 场景 2：服务端返回 success:false → 回退本地 .assets ---------- */
console.log('\n== 失败回退路径 ==')
await evaljs(`${ui}.setUpload({ server: 'http://127.0.0.1:43678/upload' })`)
await sleep(300)
await evaljs(pasteImg)
await sleep(1200)
const content2 = (await evaljs(`${docs}.active.content`)) || ''
check('回退插入本地相对链接', /!\[IMG_\d{8}_\d{6}\.png\]\(\.\/测试图\.assets\/IMG_\d{8}_\d{6}\.png\)/.test(content2), JSON.stringify(content2.slice(-140)))
check('.assets 已写入图片', (await evaljs(`window.api.fs.readDir('${TEST_DIR.replace(/\\/g, '\\\\')}\\\\测试图.assets').then(r => r.length)`)) === 1)
check('失败提示已弹出', ((await evaljs(`${ui}.toast`)) || '').includes('回退本地'))

/* ---------- 场景 3：服务端连不上（进程未起）→ 同样回退 ---------- */
console.log('\n== 连接失败回退 ==')
await evaljs(`${ui}.setUpload({ server: 'http://127.0.0.1:49999/upload' })`)
await sleep(300)
await evaljs(pasteImg)
await sleep(1500)
const content3 = (await evaljs(`${docs}.active.content`)) || ''
check('连接失败也回退本地', /!\[IMG_\d{8}_\d{6}\.png\]\(\.\/测试图\.assets\//.test(content3))

/* ---------- 场景 4：设置页 UI + 持久化 ---------- */
console.log('\n== 设置页与持久化 ==')
await evaljs(`${ui}.setUpload({ enabled: true, server: 'http://127.0.0.1:36677/upload' })`)
await evaljs(`${ui}.openSettings()`)
await sleep(500)
const sw = await evaljs(`(() => { const rows = [...document.querySelectorAll('.row')]; const r = rows.find(x => x.textContent.includes('启用图床上传')); return r ? r.querySelector('.switch.on') !== null : null })()`)
check('设置页开关呈开启态', sw === true)
const urlVal = await evaljs(`(() => { const i = document.querySelector('.url-input'); return i ? i.value : null })()`)
check('服务地址输入框回显', urlVal === 'http://127.0.0.1:36677/upload', String(urlVal))
await evaljs(`${ui}.settingsOpen = false`)
const cfg = await evaljs(`window.api.app.getConfig().then(c => JSON.stringify(c.upload))`)
check('config.json 持久化', cfg === '{"enabled":true,"server":"http://127.0.0.1:36677/upload"}', cfg)

/* ---------- 清理：配置还原、测试标签关闭、磁盘测试目录删除 ---------- */
await evaljs(`${ui}.setUpload({ enabled: false })`)
await evaljs(`${ui}.setUpload({ server: 'http://127.0.0.1:36677/upload' })`)
await evaljs(`${docs}.closeActive()`)
await sleep(400)
/* 脏标签关闭走 askConfirm（两键确认框）：必须消费掉，否则悬在用户窗口上 */
if (await evaljs(`!!${ui}.confirm`)) {
  await evaljs(`${ui}.resolveConfirm(true)`)
  await sleep(300)
}
check('测试标签已关闭', !(await evaljs(`${docs}.tabs.some(t => (t.path || '').includes('img-upload-test'))`)))
await evaljs(`window.api.app.getConfig().then(c => c.upload.enabled === false ? 'clean' : 'dirty')`)
const finalUpload = await evaljs(`window.api.app.getConfig().then(c => c.upload.enabled)`)
check('图床配置已还原为关闭', finalUpload === false)
await evaljs(`window.api.fs.delete('${TEST_DIR.replace(/\\/g, '\\\\')}')`)
await sleep(200)
check('磁盘测试目录已删除', await evaljs(`window.api.fs.readDir('E:\\\\projects\\\\lucifer\\\\inkbox-workspace').then(r => !r.some(e => e.name === 'img-upload-test'))`))

console.log(`\n结果：${pass} 过 / ${fail} 败`)
ws.close()
process.exit(fail > 0 ? 1 : 0)
