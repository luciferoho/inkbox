// 标题层级：所有 # 标题整篇升/降一级。降级常用于贴到要求正文从 ## 开始的平台，
// 升级用于把摘录文档并回主文档。围栏内的 # 注释不动，1/6 级在边界截断。
function shift(dir) {
  return function () {
    var doc = inkbox.getActiveDoc()
    if (!doc) { inkbox.showToast('当前没有可处理的文档'); return }
    var lines = doc.content.split('\n')
    var inFence = false
    var count = 0
    for (var i = 0; i < lines.length; i++) {
      var fence = lines[i].match(/^\s*(```|~~~)/)
      if (fence) { inFence = !inFence; continue }
      if (inFence) continue
      var m = lines[i].match(/^(#{1,6})(\s)/)
      if (!m) continue
      var level = m[1].length + dir
      if (level < 1 || level > 6) continue
      lines[i] = '#'.repeat(level) + lines[i].slice(m[1].length)
      count++
    }
    if (count === 0) {
      inkbox.showToast(dir > 0 ? '没有可降级的标题' : '没有可升级的标题')
      return
    }
    inkbox.setContent(lines.join('\n'))
    inkbox.showToast('已将 ' + count + ' 个标题' + (dir > 0 ? '降' : '升') + '一级')
  }
}
inkbox.registerCommand({ id: 'demote', title: '标题全部降一级（# → ##）', run: shift(1) })
inkbox.registerCommand({ id: 'promote', title: '标题全部升一级（## → #）', run: shift(-1) })
