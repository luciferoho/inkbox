/* 内置插件变换正确性 node 单测：模拟 inkbox API 直接跑 main.js 逻辑 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + JSON.stringify(detail) : ''}`) }
}
const ROOT = 'builtin-plugins'

function loadPlugin(id, doc) {
  const code = readFileSync(join(ROOT, id, 'main.js'), 'utf-8')
  const cmds = {}
  const toast = []
  const api = {
    registerCommand: (c) => { cmds[c.id] = c.run },
    getActiveDoc: () => (doc.content === null ? null : doc),
    setContent: (t) => { doc.content = t; doc.setContentCalled = true },
    showToast: (m) => toast.push(m)
  }
  new Function('inkbox', code)(api)
  return { cmds, toast }
}

console.log('== pangu ==')
{
  const doc = { name: 't.md', content: [
    '用了Electron的编辑器，共3个版本。',
    'HTML5很好用，visit https://example.com/中文路径 直接看',
    '`code foo bar`保持不动',
    '![示意|60%|center](./测试.assets/my%20pic.png)',
    '```js',
    'const x = 1 // 中文注释Electron',
    '```'
  ].join('\n') }
  const p = loadPlugin('pangu', doc)
  p.cmds.apply()
  const out = doc.content
  check('中→英补空格', out.includes('用了 Electron 的编辑器，共 3 个版本。'), out.split('\n')[0])
  check('字母→中文补空格', out.includes('很好用，visit'), out.split('\n')[1])
  check('URL 目标未被改写', out.includes('https://example.com/中文路径'), out.split('\n')[1])
  check('图片路径未被改写', out.includes('(./测试.assets/my%20pic.png)'), out.split('\n')[3])
  check('行内代码不动', out.includes('`code foo bar`'), out.split('\n')[2])
  check('围栏内不动', out.includes('// 中文注释Electron'), out.split('\n')[5])
  const before = out
  p.cmds.apply() // 幂等
  check('幂等（二次执行无变化）', doc.content === before && p.toast[1].includes('无需调整'))
}

console.log('== front-matter ==')
{
  const doc = { name: '我的笔记.md', content: '# 正文\n\n内容' }
  const p = loadPlugin('front-matter', doc)
  p.cmds.apply()
  check('无头部时生成 title/date', /^---\ntitle: "我的笔记"\ndate: \d{4}-\d{2}-\d{2}\n---\n\n# 正文/.test(doc.content), doc.content)
  const withFm = { name: 'a.md', content: '---\ntitle: "旧标题"\ntags: [x, y]\ndate: 2020-01-01\n---\n\n正文' }
  const p2 = loadPlugin('front-matter', withFm)
  p2.cmds.apply()
  const c = withFm.content
  check('已有头部更新 title', c.includes('title: "a"'), c)
  check('已有头部更新 date（今天）', /date: \d{4}-\d{2}-\d{2}/.test(c), c)
  check('未知字段 tags 保留', c.includes('tags: [x, y]'), c)
  const before = c
  p2.cmds.apply()
  check('幂等', withFm.content === before)
}

console.log('== heading-shift ==')
{
  const doc = { name: 't.md', content: '# 一级\n## 二级\n\n```js\n# 不是标题\n```\n\n普通段落' }
  const p = loadPlugin('heading-shift', doc)
  p.cmds.demote()
  check('降级 #→##，围栏内不动', doc.content.startsWith('## 一级\n### 二级') && doc.content.includes('# 不是标题'), doc.content)
  p.cmds.promote()
  check('升级还原', doc.content.startsWith('# 一级\n## 二级'))
  const deep = { name: 't.md', content: '###### 六级' }
  loadPlugin('heading-shift', deep).cmds.demote()
  check('六级不再降', deep.content === '###### 六级', deep.content)
}

console.log('== table-format ==')
{
  const doc = { name: 't.md', content: [
    '前文',
    '| 列1 | 列二很长啦 | b |',
    '| --- | :-: | -: |',
    '| a | bb | ccc |',
    '| 中文值 | x | y |',
    '',
    '| 1 | 2 |',
    '| - | - |'
  ].join('\n') }
  const p = loadPlugin('table-format', doc)
  p.cmds.apply()
  const lines = doc.content.split('\n')
  check('表格被对齐（中文按两格宽）', lines[1] === '| 列1    | 列二很长啦 | b   |', lines[1])
  check('对齐冒号保留（居中/右对齐）', lines[2] === '| :----- | :--------: | --: |', lines[2])
  check('表格间空行保留（块边界正确）', lines[5] === '' && lines[6] === '| 1   | 2   |', JSON.stringify(lines.slice(5, 8)))
  check('前文未动', lines[0] === '前文')
  const before = doc.content
  p.cmds.apply()
  check('幂等', doc.content === before)
  const notTable = { name: 't.md', content: '| 只有 | 一行 |\n普通行' }
  loadPlugin('table-format', notTable).cmds.apply()
  check('无分隔行的伪表格不动', notTable.content === '| 只有 | 一行 |\n普通行', notTable.content)
}

console.log(`\n===== ${pass} passed, ${fail} failed =====`)
process.exit(fail === 0 ? 0 : 1)
