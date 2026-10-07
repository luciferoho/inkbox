// 中英文排版：中文与英文/数字之间补空格（盘古之白）。
// 逐行处理：```/~~~ 围栏内不动；行内代码 `…` 与链接/图片目标 (…) 先占位后还原，
// 保证代码与 URL 永不被改写。规则幂等，重复执行无副作用。
inkbox.registerCommand({
  id: 'apply',
  title: '中英文之间补空格',
  run: function () {
    var doc = inkbox.getActiveDoc()
    if (!doc) {
      inkbox.showToast('当前没有可处理的文档')
      return
    }
    var CJK = '\\u4e00-\\u9fa5'
    var RE_CJK_EN = new RegExp('([' + CJK + '])([A-Za-z0-9])', 'g')
    var RE_EN_CJK = new RegExp('([A-Za-z0-9])([' + CJK + '])', 'g')
    var count = 0

    function transformLine(line) {
      var stash = []
      function keep(m) {
        stash.push(m)
        return '\u0000' + (stash.length - 1) + '\u0000'
      }
      var out = line.replace(/`[^`]*`/g, keep) // 行内代码
        .replace(/(\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, function (m, pre, url, tail) {
          return pre + keep(url) + tail
        }) // 链接/图片目标
      out = out.replace(RE_CJK_EN, function (m, a, b) { count++; return a + ' ' + b })
        .replace(RE_EN_CJK, function (m, a, b) { count++; return a + ' ' + b })
      return out.replace(/\u0000(\d+)\u0000/g, function (m, i) { return stash[+i] })
    }

    var lines = doc.content.split('\n')
    var inFence = false
    for (var i = 0; i < lines.length; i++) {
      var fence = lines[i].match(/^\s*(```|~~~)/)
      if (fence) { inFence = !inFence; continue }
      if (!inFence) lines[i] = transformLine(lines[i])
    }
    var next = lines.join('\n')
    if (next === doc.content) {
      inkbox.showToast('排版已经很规范，无需调整')
      return
    }
    inkbox.setContent(next)
    inkbox.showToast('已在 ' + count + ' 处中英文之间补空格')
  }
})
