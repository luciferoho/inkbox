// Front Matter：博客发文常用。没有 YAML 头部时在文首生成 title/date 两行；
// 已有时就地更新这两个字段，其余字段与顺序原样保留。
inkbox.registerCommand({
  id: 'apply',
  title: '生成/更新 Front Matter',
  run: function () {
    var doc = inkbox.getActiveDoc()
    if (!doc) { inkbox.showToast('当前没有可处理的文档'); return }
    var title = doc.name.replace(/\.md$/i, '')
    var d = new Date()
    var date = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0')

    var fm = '---\ntitle: "' + title + '"\ndate: ' + date + '\n---'
    var m = doc.content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/)
    if (m) {
      // 逐字段替换 title/date，其余行（categories/tags…）保持不动
      var lines = m[1].split(/\r?\n/)
      var seen = { title: false, date: false }
      lines = lines.map(function (l) {
        var km = l.match(/^([A-Za-z][\w-]*)\s*:/)
        if (!km) return l
        var k = km[1].toLowerCase()
        if (k === 'title' && !seen.title) { seen.title = true; return 'title: "' + title + '"' }
        if (k === 'date' && !seen.date) { seen.date = true; return 'date: ' + date }
        return l
      })
      if (!seen.date) lines.unshift('date: ' + date)
      if (!seen.title) lines.unshift('title: "' + title + '"') // 补齐时 title 保持第一行
      // 替换串补回正则尾部吞掉的换行（m[2]），保证二次执行内容完全一致
      var next = doc.content.replace(m[0], '---\n' + lines.join('\n') + '\n---' + (m[2] ?? ''))
      inkbox.setContent(next)
      inkbox.showToast('Front Matter 已更新（title/date）')
    } else {
      var body = doc.content.replace(/^\s*\n+/, '') // 头部前不应有杂空行
      inkbox.setContent(fm + '\n\n' + body)
      inkbox.showToast('已生成 Front Matter（title/date）')
    }
  }
})
