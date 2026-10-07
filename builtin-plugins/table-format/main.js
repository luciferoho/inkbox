// 表格格式化：把随手写的 Markdown 表格重排成竖线对齐的整齐形态。
// 中文按两格宽计算对齐；单元格里的 \| 转义与对齐冒号（:- / -: / :-:）原样保留；
// 代码围栏内的 | 行不参与。列表非严格表格（无分隔行）不动。
inkbox.registerCommand({
  id: 'apply',
  title: '对齐表格竖线',
  run: function () {
    var doc = inkbox.getActiveDoc()
    if (!doc) { inkbox.showToast('当前没有可处理的文档'); return }

    function displayWidth(s) {
      var w = 0
      for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0xff ? 2 : 1
      return w
    }
    function pad(s, w) {
      var dw = displayWidth(s.replace(/\\(?=\|)/g, '')) // 转义符不占显示宽度
      return s + ' '.repeat(Math.max(0, w - dw))
    }
    // 单元格拆分：\| 占位后按 | 拆
    function cells(line) {
      var stash = []
      var safe = line.replace(/\\\|/g, function () { stash.push('\\|'); return '\u0000' + (stash.length - 1) + '\u0000' })
      var parts = safe.split('|')
      if (parts.length && parts[0].trim() === '') parts.shift()
      if (parts.length && parts[parts.length - 1].trim() === '') parts.pop()
      parts = parts.map(function (c) {
        var cell = c.trim()
        return cell.replace(/\u0000(\d+)\u0000/g, function (m, i) { return stash[+i] })
      })
      return parts
    }
    function isSep(cells) {
      return cells.length > 0 && cells.every(function (c) { return /^:?-+:?$/.test(c) })
    }
    function sepWidth(w, align) {
      var n = Math.max(3, w)
      if (align === 'l') return ':' + '-'.repeat(n - 1)
      if (align === 'r') return '-'.repeat(n - 1) + ':'
      if (align === 'c') return ':' + '-'.repeat(n - 2) + ':'
      return '-'.repeat(n)
    }
    function alignOf(c) {
      if (c[0] === ':' && c[c.length - 1] === ':') return 'c'
      if (c[c.length - 1] === ':') return 'r'
      return 'l'
    }
    function formatBlock(block) {
      var rows = block.map(cells)
      var sepIdx = rows.findIndex(isSep)
      if (sepIdx !== 1) return null // 第二行必须是分隔行才算表格
      var n = rows[0].length
      if (n < 2) return null
      for (var r = 0; r < rows.length; r++) {
        if (rows[r].length !== n && !isSep(rows[r])) return null // 列数不齐的"伪表格"不动
      }
      var widths = []
      for (var c = 0; c < n; c++) {
        var w = 3
        for (var r2 = 0; r2 < rows.length; r2++) {
          if (isSep(rows[r2])) continue
          w = Math.max(w, displayWidth(rows[r2][c].replace(/\\(?=\|)/g, '')))
        }
        widths.push(w)
      }
      var aligns = rows[sepIdx].map(alignOf)
      return rows.map(function (row, ri) {
        if (isSep(row)) {
          return '| ' + row.map(function (c, ci) { return sepWidth(widths[ci], alignOf(c)) }).join(' | ') + ' |'
        }
        return '| ' + row.map(function (c, ci) { return pad(c, widths[ci]) }).join(' | ') + ' |'
      })
    }

    var lines = doc.content.split('\n')
    var inFence = false
    var blocks = [] // {start, end}
    var start = -1
    for (var i = 0; i < lines.length; i++) {
      var fence = lines[i].match(/^\s*(```|~~~)/)
      if (fence) { inFence = !inFence; start = -1; continue }
      if (inFence) continue
      var isRow = /^\s*\|.*\|\s*$/.test(lines[i])
      if (isRow && start < 0) start = i
      if ((!isRow || i === lines.length - 1) && start >= 0) {
        blocks.push({ start: start, end: isRow ? i : i - 1 })
        start = -1
      }
    }
    var changed = 0
    for (var b = blocks.length - 1; b >= 0; b--) {
      var blk = formatBlock(lines.slice(blocks[b].start, blocks[b].end + 1))
      if (!blk) continue
      var after = blk.join('\n')
      var before = lines.slice(blocks[b].start, blocks[b].end + 1).join('\n')
      if (after !== before) {
        lines.splice.apply(lines, [blocks[b].start, blocks[b].end - blocks[b].start + 1].concat(blk))
        changed++
      }
    }
    if (changed === 0) { inkbox.showToast('没有需要格式化的表格'); return }
    inkbox.setContent(lines.join('\n'))
    inkbox.showToast('已格式化 ' + changed + ' 个表格')
  }
})
