/* 样式巡查：两种窗口尺寸 × 多个 UI 场景，程序化扫描溢出/裁切 + 全屏截图
 * 检查项：
 *  A. 横向溢出裁切：元素 scrollWidth > clientWidth + 2 且 overflow-x 非滚动条可见
 *  B. 纵向裁切：overflow hidden 容器内子元素被截（scrollHeight > clientHeight + 2，仅查已知容器白名单外）
 *  C. 逐场景全屏截图（judge 目检） */
const base = 'http://127.0.0.1:9222'
const connect = async () => {
  const pages = await (await fetch(`${base}/json`)).json()
  const page = pages.find((p) => p.type === 'page' && p.url.includes('localhost:5173'))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  return {
    send: (method, params = {}) => {
      const id = ++seq
      ws.send(JSON.stringify({ id, method, params }))
      return new Promise((res) => pending.set(id, res))
    },
    ws
  }
}
const { send, ws } = await connect()
const evaljs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error('eval fail: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300))
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fs = await import('node:fs')
const pinia = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
const ui = `${pinia}.get('ui')`
const docs = `${pinia}.get('documents')`

/* 溢出/裁切扫描器：只报可见元素，排除编辑器滚动容器（内容型滚动是设计） */
const SCAN = `(() => {
  const bad = []
  const els = document.querySelectorAll('body *')
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const st = getComputedStyle(el)
    if (st.visibility === 'hidden' || st.display === 'none') continue
    // 横向溢出：内容宽超容器且不允许换行/滚动（滚动条可见的容器是设计，跳过）
    if (el.scrollWidth > el.clientWidth + 2 && r.width > 20) {
      const scrollable = st.overflowX === 'auto' || st.overflowX === 'scroll'
      const clipHidden = st.overflowX === 'hidden' || (st.overflowX === 'visible' && el.clientWidth > 0)
      if (scrollable) continue // 内容型横滚（编辑器/列表）：设计
      if (clipHidden) bad.push({ kind: 'x-clip', tag: el.tagName, cls: String(el.className).slice(0, 50), sw: el.scrollWidth, cw: el.clientWidth, text: (el.textContent || '').slice(0, 30) })
    }
    // 纵向：overflow-y hidden 且内容被截（按钮/标签/行类元素）
    if (el.scrollHeight > el.clientHeight + 3 && r.height > 0 && r.height < 120) {
      const st2 = st.overflowY
      if (st2 === 'hidden' || st2 === 'clip') bad.push({ kind: 'y-clip', tag: el.tagName, cls: String(el.className).slice(0, 50), sh: el.scrollHeight, ch: el.clientHeight, text: (el.textContent || '').slice(0, 30) })
    }
  }
  return bad.slice(0, 40)
})()`

const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(`.cdp/audit-${name}.png`, Buffer.from(s.result.data, 'base64'))
  console.log(`  📸 ${name}`)
}

for (let i = 0; i < 40; i++) { if (await evaljs(`!document.getElementById('boot-splash')`)) break; await sleep(500) }

const scenarios = async (tag) => {
  console.log(`\n===== 场景组 ${tag}（窗口 ${await evaljs('innerWidth')}x${await evaljs('innerHeight')}） =====`)
  // 1. 文档+双栏+工具条
  await evaljs(`${docs}.activateHome()`)
  await evaljs(`${ui}.setEditorMode('split')`)
  await sleep(500)
  let tab = await evaljs(`${docs}.tabs.find(t=>t.name==='测试.md')?.id`)
  if (tab != null) await evaljs(`${docs}.activeId = ${tab}`)
  await sleep(600)
  console.log('  [split+doc] 溢出:', JSON.stringify(await evaljs(SCAN)))
  await shot(`${tag}-split-doc`)
  // 2. 快捷键面板
  await evaljs(`${ui}.toggleShortcutPanel()`)
  await sleep(800)
  console.log('  [panel] 溢出:', JSON.stringify(await evaljs(SCAN)))
  await shot(`${tag}-panel`)
  await evaljs(`${ui}.toggleShortcutPanel()`)
  await sleep(500)
  // 3. 设置页
  await evaljs(`${ui}.openSettings()`)
  await sleep(700)
  console.log('  [settings] 溢出:', JSON.stringify(await evaljs(SCAN)))
  await shot(`${tag}-settings`)
  await evaljs(`${ui}.settingsOpen = false`)
  await sleep(400)
  // 4. 主页
  await evaljs(`${docs}.activateHome()`)
  await sleep(500)
  console.log('  [home] 溢出:', JSON.stringify(await evaljs(SCAN)))
  await shot(`${tag}-home`)
}

await scenarios('w1280')
process.exit(0)
