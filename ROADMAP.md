# Inkbox 迭代功能清单（对标 Typora）

> 基于 v1.0.8 代码盘点形成，开发在 `iteration` 分支进行，完成后逐步合入 `dev` / `main`。
> 规模估计：S ≈ 1 天内，M ≈ 2–4 天，L ≈ 1 周以上。
> **本次暂缓**：Word/docx 导出、直接打印、复制为 HTML（见文末）。

## 一、总体判断

Inkbox 已覆盖 Typora 主干：四模式编辑（即显/源码/双栏/预览）、GFM 全语法、KaTeX、Mermaid、图片落盘 + PicGo 图床、PDF/HTML/PNG/LaTeX 导出、文件树/大纲/全文搜索、多标签、Vim、插件系统、快捷键自定义、自动更新。其中 Vim、插件系统、图床集成、双栏、PNG 长图、全屏图片查看器是 Typora 没有或不如此完善的部分。

差距集中在四个域：

| # | 差距域 | 一句话概括 |
|---|--------|-----------|
| A | 即显管线语法一致性 | 扩展语法（公式/图表/脚注等）只在预览管线渲染，即显模式里是"源码样子"——Typora 只有一个 pane、全部即时渲染，这是其立身之本 |
| B | 编辑微体验 | 表格列宽拖拽、Quick Open、编辑器内折叠、拖文件打开等"用起来才知道"的细节 |
| C | 主题与外观生态 | Typora 的 CSS 主题社区（数百主题 + 自定义 CSS）是其最大生态护城河 |
| D | 导出样式 | 导出暂不支持自定义主题/CSS（docx、打印等已暂缓） |

## 二、M1 · 即显一致性冲刺（优先级最高）

> 目标：预览管线已有的扩展语法，即显模式全部同效果渲染，两管线语法覆盖对齐。

- [x] **1.1 即显 KaTeX 数学**（L）`$...$` / `$$...$$` 即显实时渲染；自写 atom 节点 + 嵌套视图方案（`editor/wysiwyg-math.ts`），remark-math 解析、复用预览管线的 katex 懒加载，含误判护栏与序列化无损往返 ✓ 已完成并真窗口验证
- [x] **1.2 即显 Mermaid**（M）code_block 双模 nodeView：mermaid 块渲染图表、点击进源码编辑（沿用代码块键盘行为），其他语言原样；手打 ` ```mermaid ` 即建图；主题切换重画；语法错误降级为源码展示；主题配置/缓存/串行锁抽至 services/mermaid.ts 与预览管线共享 ✓ 已完成并真窗口验证
- [x] **1.3 即显 `==高亮==` `^上标^` `~下标~`**（M）自写 transformer 切分文本 + mark schema + 输入规则；`~x~` 与 GFM 单波浪删除线的语义冲突按原文切片判定归为下标（与预览一致）✓
- [x] **1.4 即显脚注 `[^1]`**（M）remark-footnotes + 引用/定义双 schema，`[^x]` 输入规则；序列化由 footnotes 的 toMarkdown 原生处理 ✓
- [x] **1.5 即显 emoji 短代码**（S）remark-gemoji 解析期替换为字符（与预览 markdown-it-emoji 行为一致）✓
- [x] **1.6 `[TOC]` 全管线**（M）即显渲染可点击目录（nodeview 实时收集标题，点击跳转+滚动，doc 变化自动重投影）✓
- [x] **1.7 Front matter 正确渲染**（M，缺陷先修）预览渲染为元信息块（自写 core rule 按行区间替换 token，不再撕成 hr/标题碎片）；即显渲染为可编辑 yaml 块（remark-frontmatter + yaml schema）；导出正确跳过；序列化往返逐字节无损 ✓
- [x] **1.8 专注/打字机覆盖即显侧**（M）专注：装饰器淡显当前顶层块之外内容（F8/状态栏共用开关）；打字机：光标行钉在面板垂直中部 ✓
- [x] **1.9 行内 HTML 白名单渲染**（M）预览/即显同一份白名单（u mark sub sup kbd b strong i em s del br）；配对标签即显渲染真实元素（支持嵌套），非白名单/未配对照旧转义；序列化原样保留标签 ✓（details/summary 块级与 center 延后）

## 三、M2 · 编辑体验补齐

- [x] **2.1 Quick Open 快速打开**（M）`Ctrl+P` 模糊搜索工作区文件名并打开；数据源复用 workspace 树 ✓ 真窗口验证
- [x] **2.2 表格列宽拖拽**（M）即显/预览拖拽列边界调宽 ✓ 真窗口验证。**持久化方案定案：列宽是视图态不做文件级持久**——HTML 注释/分隔行扩展都会污染 markdown 可移植性（其他渲染器显示杂讯或表格失效），与 Typora 行为对齐：以「表头文本」为键做会话内记忆（editor/table-widths.ts，双管线共享，文档零标记），跨会话不保留
- [x] **2.3 表格右键菜单**（S）插删行列/对齐/复制表/转文本；复用 ImageContextMenu 模式（源码侧 table-utils 纯文本变换，即显侧委托 Milkdown gfm 命令，右键显式落位到点击单元格）✓
- [x] **2.4 图片拖拽手柄**（M）即显选中图片拖右下角柄等比缩放（拖动中实时预览）；松手落 `|宽x高|` 修饰符，单事务可撤销 ✓
- [x] **2.5 插入图片（文件对话框）**（S）`Ctrl+Alt+I` 命令 + 菜单；共享 insert-image 服务按焦点落点到源码/即显光标，沿用图床→.assets 链路 ✓
- [x] **2.6 上传全部本地图片**（S）一键批量转图床（菜单命令）；失败保持原链接，部分成功分开提示 ✓
- [x] **2.7 拖 .md 文件进窗口打开**（S）window capture 拦截 Files 载荷（capture 先于编辑器图片 drop），支持多文件与 .html；路径经 preload webUtils（Electron ≥32 无 File.path）✓
- [x] **2.8 标签中键关闭**（S）中键按下即关（脏标签走既有确认框）；preventDefault 顺带压掉中键自动滚屏 ✓
- [x] **2.9 编辑器内折叠**（M）源码模式 foldGutter 标题/代码块折叠（lang-markdown 自带 fold 支持，实测已生效）；即显模式标题 hover 折叠箭头（纯装饰器隐藏区段顶层块，不改文档不影响序列化，折叠时光标保护移回标题行尾）✓
- [x] **2.10 粘贴 URL 到选区**（S）自动生成 `[选中文本](URL)`；两编辑器同行为，URL 判定与链接文本清洗共用（editor/paste-link.ts）✓
- [x] **2.11 emoji 输入补全**（S）输入 `:smi` 弹短代码补全菜单，选中插入 emoji 字符；词表与预览管线同源（markdown-it-emoji full）✓

### M2 实测问题修复（2026-10-19）

- 表格交互细化：表头列边界 hover 显示 `col-resize`；拖拽加 3px 阈值（单击不再改变列宽）；支持拖动表格右缘调整最后一列；预览/即显右键新增「自适应宽度」；预览表格外套横向滚动容器（窄窗口不压扁、超宽表格滚动查看）
- 导出：剥离列宽视图态样式，超宽表格强制 `table-layout:auto` + 断词换行，修复导出裁切
- 外部拖入：悬停显示「松开以打开」遮罩（替代系统复制提示）；支持 md/txt（去掉 html）；拖离/超时自动收起
- Quick Open：按工作区同款类型过滤（md/markdown/mdown/txt）；路径归一后去重（混用 `/` 与 `\` 不再重复开标签）；输入法组合中不抢 Enter
- 粘贴 URL：跨块选区交回默认粘贴；链接文本转义方括号；URL 首尾空白（含换行）容错
- 图片缩放：拖动中手柄实时跟随图片右下角
- 插入图片对话框打开前清理残留拖拽光标/选择状态

## 四、M3 · 主题生态与导出样式

- [x] **3.1 CSS 主题系统**（L）`userData/themes/*.css` 外部主题，设置页外观区下拉选择 + 打开主题目录（首次自动放 README 与 example-paper 示例）；兼容 Typora 常见变量（--bg-color/--text-color/--primary-color 等自动映射到 Inkbox 令牌）✓ 真窗口验证
- [x] **3.2 字体族设置**（S）设置页正文/代码字体输入框，写 --font-body/--font-code 令牌（新令牌，文档内容与代码块专用，UI 界面不受影响）；留空回落默认 ✓
- [x] **3.3 用户自定义 CSS**（S）`userData/base.user.css` 全局注入，设置页一键打开（不存在则创建）；文件监听外部保存即时热更新 ✓
- [x] **3.4 导出自定义 CSS**（M）PDF/HTML/PNG 导出自动注入当前主题 CSS + 用户 CSS（附加在所有内置样式之后，可覆盖）；LaTeX 不适用 ✓
- [x] **3.5 ePub / OPML 导出**（M）OPML 2.0 大纲导出（嵌套层级，导入 Workflowy/MindNode）；ePub 零依赖 store-zip 打包（H1 分章 + OPF/NCX 目录，本地相对图不可嵌入为已知限制）✓

## 五、M4 · 可靠性与辅助功能

- [ ] **4.1 版本历史/本地快照**（L）**已实现过一版并验证，按用户反馈暂缓（2026-10-24，觉得交互复杂、放到后面）**。完整实现在 git 历史 `c383698`（保存自动快照/内容去重/30 份上限/菜单对话框时间线预览/确认回滚），恢复时从该提交 cherry-pick 后按新交互设计重做入口即可
- [x] **4.2 拼写检查**（M）设置开关；主进程引擎常开 + 词典锁定 en-US（中文经脚本检测直接跳过，不会满屏误报）；渲染层切换编辑器宿主 spellcheck 属性（事件广播重挂载同步）✓
- [x] **4.3 智能标点**（S）markdown-it typographer 开关（弯引号/破折号/省略号）；仅预览与导出，源码与序列化不变；默认关 ✓
- [ ] **4.4 PlantUML / flowchart.js**（M）评估后维持延后：Mermaid 已覆盖 sequence/gantt/class/state，引入第二渲染引擎徒增体积
- [ ] **4.5 MathJax 可选后端**（M）评估后维持延后：KaTeX 覆盖绝大多数场景，双引擎收益不抵体积与维护成本

## 六、M5 · 即显编辑体验增强（提案，2026-10-30 修订，待评审）

> 目标：参照 Typora 把「创建类入口」补齐——格式化能力（输入规则/快捷键）已基本对齐，缺的是 Ctrl+K 链接、语言切换、插入菜单这类**不背语法也能插入东西**的入口。交互总原则：**能就地编辑的不弹对话框、能按需浮现的不占常驻界面**；插入面板用快捷键/菜单唤起，**不做 `/` 字符触发**——`/` 是正文常用字符（网址、路径、代码都会用到），Typora 也不依赖字符触发，靠菜单+快捷键。

- [x] **5.1 Ctrl+K 插入/编辑链接**（M）有选区：选区转链接并复用既有就地地址展开（linkSource 装饰）；无选区：光标处插入链接并立即展开地址输入。即显/源码两端注册（快捷键面板已宣称 Ctrl+K，即显当前无实现）✓ 即显 pmToggleLink：建链置空 href + 地址框自动聚焦（requestLinkSourceFocus 一次性信号），空地址光标离开自动去链（防 `[文字]()` 脏语法，嵌套 dispatch 已防递归）；源码 cmdLink 改为包后选区落在 URL 占位上直接输入覆盖。CDP 真窗口验证（创建/提交/去链/无选区/Esc 放弃/源码占位选中）
- [x] **5.1a 用户实测反馈修复（Ctrl+K 退不出去）** ①`findLinkSource` 补末尾归属规则——光标在链接末尾且后面不是同一链接时视为已离开（原先 Enter 提交后光标落链接后方仍展开地址框，永远退不出）；②Enter/Esc 统一走 `settleToBody`：光标落链接末尾边界 + 清 storedMarks（否则接着打字会把新文字并进链接）+ view.focus 交回正文；③创建/插入链接时光标落链接内最后一个字符（末尾边界已归属「离开」）；④地址框宽度按实际字符数（`style.width = Nch`）而非 `size` 属性——原实现按 8 字符保底分配，`)` 前留白
- [x] **5.1c 三轮反馈修复（尾部点击语义）** 展开态下点击链接文字（含末字符右侧贴近处）**保持编辑**（原先落末尾边界即退出，用户点不到最后一个字母后面）；点击右括号「)」/其右侧才退出。实现：`expandSuppress` 一次性压制标志（settleToBody 设置=不展开；handleClick 按点击坐标清除/设置；选区离开链接范围自动失效）
- [x] **5.8c 三轮反馈修复（子菜单点击无反应）** 子菜单 Teleport 到 body 后，text-context-menu.ts 里旧的 mousedown 关闭监听只认 `.ctx-menu`——点子菜单项时菜单先被关闭、按钮随 v-if 移除、**click 事件丢失**（「右键标题没反应/右键插入没反应」的共同根因）。修复：关闭检查改为 `closest('.ctx-menu, .ctx-submenu')`
- [x] **5.10a 快捷键设标题误伤相邻段** 光标在「111」末尾按 Ctrl+2 会把「222」设为标题——`pmSetHeading` 单行分支原先走 milkdown `wrapInHeadingCommand`（边界行为怪异），改为直接 `setNodeMarkup` 与右键「段落转换」同语义。CDP 验证：111 末尾 Ctrl+2 → 只转 111
- [x] **5.10b 列表项内转标题无效** 有序/无序列表项内的段落：`setNodeMarkup(paragraph→heading)` 会被列表结构吞掉（按键/右键都「没反应」）→ 两个入口都先 `liftListItem` 整项提升出列表再设级别（快捷键 pmSetHeading 与右键 runParaAction 统一）。CDP 验证：`1. 111` 光标末尾 Ctrl+2 / 右键标题 2 → `## 111` 且 222/333 保持列表
- [x] **5.11a 右键全选按上下文限定** 代码块/公式/HTML 表格/frontmatter 内右键「全选」原先选整篇文档 → 只选块内容（PM 取 node 内容区间；CM 取围栏体）。CDP 验证：代码块内全选 + Ctrl+C 剪贴板只有代码两行；源码围栏内同样只选围栏体
- [x] **5.11b 链接编辑三修** ①点击地址框区域（`](` 与 `)` 之间）时事件穿透到 PM、光标被放到链接文字后 → 地址尾栏加 mousedown 拦截：拦下并聚焦输入框全选，不让 PM 接管；②编辑时把文字删空会让 link mark 随内容消失、地址框直接关闭 → Backspace/Delete 在「将删空」或「已仅剩 1 字符」时吞键保留占位（Typora 语义），继续输入仍在链接内
- [x] **5.3e 输入关键词时光标跳位（压制邻接高亮）** 输入把单词补全成关键字的瞬间，高亮插件在光标前插入包裹 span，Chromium 把 contenteditable 光标挤到词首（用户实测输入 const 跳回 c 前）。修法：**光标邻接的 token 不上装饰**（apply 里按 `newState.selection.head` 过滤 `from < head <= to` 的 span；纯光标移动事务也重算所在块，移开后高亮恢复）。CDP 真实键击逐字符验证：const x 输入全程光标稳定
- [x] **5.3f 鼠标样式** 代码块行号留白区（.pm-code-ln 含 padding）悬停显示 text 光标（原 pointer-events:none 继承 pre 的 default）；pre/code/token/正文等内置样式复核：pre=default（滚动条区域需要）、code/token=text、正文族继承 text、链接/图片 pointer
- [x] **5.2 代码块语言选择器**（M）即显代码块 chrome 的语言标签可点击 → 原地输入框 + 语言名补全（词表与源码模式 cm-fence-completion 同源，FENCE_LANGS 导出复用并补 mermaid 词条）；mermaid 块切语言由节点视图重建自动重绘；Esc/失焦取消不落盘 ✓ CDP 真窗口验证（预填当前语言过滤/Enter 提交/Esc 取消/点选提交/mermaid 出图）
- [x] **5.2a 二轮反馈修复** ①**行号与光标重叠**：行号 widget 的留白从 `margin-right` 改 `padding-right`——inline-block 的 margin 落在光标位置之前，行首光标会压在数字右侧；padding 计入盒宽，光标落在文本起点（叠加 widget `side:-1` 保证排在内容最前）；②主题模式下语言栏 `display:none` 导致输入框 0×0 不可聚焦 → `:has(.md-code-lang-input)` 临时亮出 + 主题模式 !important 收回 input/菜单样式；③插入代码块自动开语言编辑、提交后光标落块内首行
- [x] **5.2b 代码块内 Ctrl+/ 切换注释**（S）主进程 `before-input-event` 原本拦截所有已注册加速键（含 view:toggleShortcuts），代码块内按 Ctrl+/ 会误开快捷键面板 → 主窗口对该命令放行，渲染层 `editor/code-comment.ts` 按上下文分流：代码块内按语言加/去注释（`//` `#` `--` `%%` `%` 行注释，html/xml `<!-- -->`、css 家族 `/* */` 块注释，纯文本吞键不弹面板），其余位置照旧开关面板；快捷键面板补「代码块内：切换注释」说明行 ✓ CDP 验证（即显 js 加/去注释、源码 python `#`、正文仍开面板）
- [x] **5.3 快捷键一致性**（S）即显补注册 Ctrl+Shift+X 删除线、Ctrl+Shift+C 行内码（快捷键面板已宣称但仅源码侧有），补 Ctrl+Shift+M 公式块（Typora 键位）；核对面板宣称与两编辑器实际键位全表一致 ✓ 即显走 toggleStrikethrough/toggleInlineCodeCommand，公式块 pmInsertMathBlock 落 NodeSelection 自动进嵌套编辑态；源码侧 cmdInsertMathBlock 插 $$ 围栏光标落空行；面板新增公式块行（sc.mathBlock）。CDP 真窗口验证（X/C 开关、M 空段/非空段、源码 Mod-M）
- [x] **5.4 插入面板（快捷键唤起）**（M-L）过滤式插入命令面板：表格/代码块/公式/Mermaid/图片/链接/引用/列表/任务列表/TOC/脚注/分隔线/emoji/日期。入口两个，共用同一命令层（editor/insert-commands.ts，即显/源码双实现、纯 PM 不依赖 Milkdown ctx；深层容器放不下时自动退到顶层块之后插入）：Ctrl+Shift+P（走既有菜单加速键注册表 file:insertPanel，支持设置页改键）+ 右键「插入」子菜单（5.8 承载）✓ CDP 真窗口验证（打开聚焦/过滤/Enter 执行：表格+mermaid+分隔线+脚注+任务列表/源码侧公式块/Esc 关闭；加速键已注册 debugMenuAccels，dispatch 链路 debugMenuInvoke 全通）
- [x] **5.4a 用户实测反馈修复（代码块插入）** ①行号 widget 加 `side:-1`——此前光标画在行号左侧；②插入代码块后自动进入语言编辑（`openLangEditorFor` 按 pos 取 chrome 标签直接调起，不依赖 decorations 重建时序；ESC 交回焦点、提交后光标落块内首行）；③Ctrl+Shift+K（即显/源码）与插入面板同款先选语言，源码侧光标落 ``` 之后；④`runInsertCommand` 对 codeBlock 例外不回焦 PM（PM 持焦时 input.focus 会被选区重占顶掉）；⑤**主题模式下 `.md-code-bar` 是 display:none，语言输入框 0×0 不可聚焦**——补 `:has(.md-code-lang-input)` 临时亮出，并给输入框/菜单出主题模式 !important 收口（防主题 input 规则撑成胶囊）；⑥源码围栏补全走 closed 分支时只换语言词、光标留在行尾——新增 `setFenceLang` 自己 dispatch 把光标移到块内首行
- [ ] **5.5 选区浮动格式条**（M）选中文字浮现微型工具条（粗体/斜体/删除线/行内码/高亮/链接/标题级切换）；设置页可关（默认开）；纯按需浮现，不加常驻工具栏。
- [ ] **5.6 表格行列选择器**（S）Ctrl+T / 插入面板建表时弹 5×5 网格 hover 选择（替代固定 2 列）；轻量 popover，比 Typora 的对话框更轻。
- [ ] **5.7 脚注引用/定义互跳**（S）即显点击 `[^x]` 引用滚动定位到文末定义并高亮，定义处提供返回。
- [x] **5.8 通用文本右键菜单**（M）正文右键：剪贴板操作 + 段落转换（正文/标题1-3/有序/无序/任务/引用/代码块，PM 单块 setNodeMarkup+wrapIn、CM 逐行前缀改写）+ 「插入」子菜单（复用 5.4 命令层）；与既有图片/表格右键菜单同一自绘体系（TextContextMenu.vue，图片/表格命中时不弹）✓ CDP 真窗口验证（菜单条目/h2 转换/TOC 插入/源码侧引用转换/Esc 关闭）
- [x] **5.8a 用户实测反馈修复（右键菜单）** ①段落转换顺序改为 标题1-6 → 正文 → 无序/有序/任务/引用/代码块；②每项右侧显示快捷键（固定键写自定义键位如 Ctrl+1；可改键命令读 `effectiveShortcuts(ui.shortcuts)` 显示实际设置，如图片 Ctrl+Alt+I）；③未选中时剪切/复制禁用（buildItems 按 selection.empty 判定）；④**右键不再折叠已有选区**（原先无条件 posAtCoords 落光标，导致选中文本右键后剪切/复制变禁用）；⑤**动态裁剪**：光标在代码块/公式/HTML 块/TOC/frontmatter（CM：FencedCode/HTMLBlock/FrontMatter）内时只出剪贴板组，不进段落转换与插入；⑥行高 26→32px、menbg 8px、子菜单间距与强调色对齐 Typora；⑦修 `.has-sub .ctx-accel` 选择器误伤子菜单快捷键（改 `>` 直子）
- [x] **5.8b 二轮反馈修复（窄窗口裁切）** 子菜单改为 **Teleport 到 body 的 fixed 浮层**（原先嵌在菜单内绝对定位：菜单矮时要内部滚动，绝对定位子菜单既被裁切又把 `scrollWidth` 撑出横向滚动条）→ 独立浮层可贴边：右侧不够翻到左侧、下方空间不足先限高滚动（保持与触发项对齐）、空间 <160px 才整体上移；主菜单 `overflow-x: hidden` + `overflow-y: auto`。子菜单 hover 加 160ms 关闭缓冲，方便斜向移入
- [ ] **5.9 emoji 补全覆盖即显**（S）`:smi` 弹短代码补全（对齐源码模式 2.11 行为）。
- [ ] **5.10 链接 hover 提示**（S）hover 链接显示地址提示条（点击复制/打开）；与既有「光标进入就地展开」互补，提升可发现性。

## 七、设计边界（不做）

- **任意 inline HTML 全量支持**：与安全基线冲突，坚持白名单（见 1.9）。
- **MathML 渲染**：场景极少，KaTeX/MathJax 已覆盖。
- **云同步/账号体系**：偏离本地纯工具定位。

## 八、随 M1 顺手处理的待修项

1. 预览管线会把 YAML front matter 按正文渲染（对应 1.7）。
2. ~~预览代码块无行号~~（已实现：fence 渲染注入行号列，pre grid 双列 + sticky 左贴，复制/导出自动剥离）。

## 附 · 本次暂缓（后续视需求恢复）

- Word/docx 导出（L）
- 直接打印（S）
- 复制为 HTML（M）
