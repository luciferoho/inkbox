# Markdown 桌面编辑器 — 功能清单与开发计划

参考 Typora，基于 **Electron + Vue 3** 的跨平台 Markdown 编辑器。

- 项目名（暂定）：墨匣fer Markdown / 后定
- 平台：Windows 优先，macOS / Linux 后续支持
- 核心定位：本地优先的 Markdown 编辑器，主打**即时渲染**（所见即所得）+ 文件管理 + 多格式导出

---

## 一、功能清单

优先级定义：
- **P0** — MVP 必须，没有就不能用
- **P1** — 核心体验，对标 Typora 的关键差异点
- **P2** — 重要增强，发布 1.0 前应有
- **P3** — 远期 / 生态功能

### 1. Markdown 编辑核心

| # | 功能 | 优先级 | 说明 |
|---|------|--------|------|
| 1.1 | 基础语法 | P0 | 标题(1-6)、粗体、斜体、删除线、行内代码、引用、有序/无序/任务列表、表格、链接、图片、分隔线 |
| 1.2 | 代码块高亮 | P0 | 语言标注 + 语法高亮（highlight.js 起步，可升级 Shiki） |
| 1.3 | 实时预览 | P0 | 编辑/预览双栏，同步滚动（MVP 阶段方案） |
| 1.4 | 即时渲染模式 | P1 | Typora 式单栏所见即所得，光标所在块显示源码、其余块渲染（详见"技术决策"） |
| 1.5 | 源码模式 | P1 | 纯文本 + 语法着色，可切换三模式（即时渲染/源码/双栏） |
| 1.6 | 查找替换 | P0 | 大小写、正则、全部替换、高亮命中 |
| 1.7 | 撤销/重做 | P0 | 编辑器内建 undo 栈 |
| 1.8 | 快捷键格式化 | P0 | Ctrl+B/I/K、标题提升/降级(Ctrl+= / Ctrl+-)等 |
| 1.9 | 块悬浮工具栏 | P2 | 光标进入块时浮现快捷操作（加粗/插入图片/表格操作） |
| 1.10 | 智能补全 | P1 | 括号/引号/Markdown 标记自动配对，列表自动续行 |
| 1.11 | 富文本粘贴转 Markdown | P1 | 从浏览器/Word 粘贴自动转 md 语法 |
| 1.12 | 扩展语法 | P2 | 高亮 ==x==、上下标、脚注、[TOC]、emoji(:smile:)、HTML 内嵌 |
| 1.13 | ~~Vim 键位~~ | P3 | 已实现（1.x 第八批）：源码/双栏模式，设置页开关，状态栏 NORMAL/INSERT 徽标 |

### 2. 扩展渲染

| # | 功能 | 优先级 | 说明 |
|---|------|--------|------|
| 2.1 | 数学公式 | P1 | KaTeX，行内 `$...$` 与块级 `$$...$$` |
| 2.2 | Mermaid 图表 | P1 | 流程图/时序图/甘特图等，按需异步加载 |
| 2.3 | 图片查看器 | P1 | 点击放大、缩放、拖动 |
| 2.4 | 表格编辑增强 | P2 | 可视化增删行列、对齐设置 |

### 3. 文件与工作区

| # | 功能 | 优先级 | 说明 |
|---|------|--------|------|
| 3.1 | 打开/保存/另存为 | P0 | 单文件读写，未保存修改标记（标题栏 ●） |
| 3.2 | 新建文档 | P0 | 未命名文档，首次保存时询问路径 |
| 3.3 | 自动保存 | P0 | 可配置间隔 + 失焦触发，默认开启 |
| 3.4 | 关闭前拦截 | P0 | 有未保存修改时弹确认 |
| 3.5 | 多标签页 | P1 | 多文档并开，Ctrl+Tab 切换，脏标记 |
| 3.6 | 文件树侧边栏 | P1 | 打开文件夹作为工作区，新建/重命名/删除/在资源管理器中显示 |
| 3.7 | 最近文件 | P1 | 历史列表，固定常用项 |
| 3.8 | 外部修改检测 | P2 | file watcher，文件被外部改动时提示重载 |
| 3.9 | 图片落盘管理 | P1 | 粘贴/拖拽图片自动存入 `${docName}.assets/`，路径规则可配置 |
| 3.10 | 全局搜索 | P3 | 工作区跨文件搜索 |
| 3.11 | 草稿恢复 | P2 | 崩溃/异常关闭后恢复未保存内容 |

### 4. 视图与外观

| # | 功能 | 优先级 | 说明 |
|---|------|--------|------|
| 4.1 | 大纲面板 | P1 | 标题层级树，点击跳转，随光标联动 |
| 4.2 | 主题系统 | P1 | 内置 light/dark，跟随系统；基于 CSS 变量，支持用户自定义主题文件 |
| 4.3 | 字体/字号/行距/页宽 | P1 | 偏好设置可调 |
| 4.4 | 专注模式 | P1 | 淡出非当前段落 |
| 4.5 | 打字机模式 | P1 | 当前行居中 |
| 4.6 | 状态栏 | P0 | 字数/字符数/行/列、光标位置、编码 |
| 4.7 | 自定义标题栏 | P2 | 无边框窗口 + 自绘标题栏（ menus 三键） |
| 4.8 | 多窗口 | P2 | 拖出标签为新窗口 |
| 4.9 | 全屏/禅模式 | P2 | F11、隐藏一切面板 |

### 5. 导入导出

| # | 功能 | 优先级 | 说明 |
|---|------|--------|------|
| 5.1 | 导出 HTML | P1 | 单文件（内联样式/图片可选） |
| 5.2 | 导出 PDF | P1 | 渲染进程打印管线，支持页边距/页眉页脚设置 |
| 5.3 | 导出图片 | P2 | 长图 PNG |
| 5.4 | ~~导出 Word (docx)~~ | P2 | 已实现后移除（html-to-docx 保真度不足）；需要时导出 HTML 用 Word 打开 |
| 5.5 | ~~导出 LaTeX~~ | P3 | 已实现（1.x 第八批）：ctexart，token 树转换，弹窗内实时预览 .tex |
| 5.6 | 导入 | P2 | .md/.txt/.markdown，HTML 转 md |

### 6. 系统与应用

| # | 功能 | 优先级 | 说明 |
|---|------|--------|------|
| 6.1 | 原生菜单 | P0 | 完整菜单栏 + 上下文菜单（编辑区/文件树/标签） |
| 6.2 | 偏好设置 | P1 | 独立设置页，JSON 持久化（userData） |
| 6.3 | 系统托盘 | P3 | |
| 6.4 | 开机自启 | P3 | |
| 6.5 | 自动更新 | P2 | electron-updater + GitHub Releases |
| 6.6 | 国际化 | P2 | 中/英，vue-i18n |
| 6.7 | ~~快捷键自定义~~ | P3 | 已实现（1.x 第七批）：应用级命令注册表 + 设置页行内改键 |
| 6.8 | ~~图片上传~~ | P3 | 已实现（1.x 第八批）：PicGo server 协议，失败回退本地 .assets |
| 6.9 | ~~插件/脚本系统~~ | P3 | 已实现（1.x 第九批）：目录扫描 + 受控 API 宿主 + 设置页管理 |

---

## 二、技术选型

| 层 | 选择 | 理由 |
|----|------|------|
| 框架 | Electron 33+ | 跨平台桌面事实标准，生态成熟 |
| 构建 | **electron-vite** + TypeScript | 主/preload/渲染三进程一体化的 Vite 方案，HMR 体验好 |
| 前端 | Vue 3.5 + Pinia | 组合式 API，状态管理轻量 |
| UI 组件 | Naive UI | 暗色主题变量体系好，按需引入，风格中性 |
| 源码编辑器 | **CodeMirror 6** | 源码模式与 MVP 编辑核心，性能强、可深度定制 |
| 即时渲染编辑器 | **Milkdown**（基于 ProseMirror） | 开源方案中最接近 Typora 的块级 WYSIWYG，插件化 |
| Markdown 解析 | markdown-it + 插件集 | 快、稳定、插件生态全；与 Milkdown 内部（remark）双轨并存 |
| 代码高亮 | highlight.js（MVP）→ Shiki（可选升级） | 先轻量后美化 |
| 公式 / 图表 | KaTeX、Mermaid 11 | 按需异步 import，避免拖慢启动 |
| 打包分发 | electron-builder | NSIS 安装包 + 便携版，后期接自动更新 |

### 关键技术决策：即时渲染的实现路线（待确认）

Typora 的灵魂是**单栏即时渲染**。三条可选路线：

| 路线 | 优点 | 缺点 | 工作量 |
|------|------|------|--------|
| A. Milkdown（推荐） | 现成的块级 WYSIWYG，ProseMirror 底座可靠，markdown 双向序列化内置 | 深度定制（表格、图片交互）要啃它的插件体系；样式需按主题重做 | 中 |
| B. CodeMirror 6 自研块渲染（Bluestone 路线） | 完全自主可控，与源码模式同栈 | 即时渲染层全部自研，难度高 | 大 |
| C. 只做双栏 + 源码两模式 | 最稳最快 | 没有 Typora 的核心体验，降级为常规编辑器 | 小 |

**推荐策略：MVP 先走 C（CodeMirror 双栏）快速跑通文件链路 → M3 引入 Milkdown 做即时渲染模式（路线 A），CodeMirror 保留为源码模式**。两套编辑器组件共存、可切换，风险隔离，任一路线失败不拖垮整体。

---

## 三、系统架构

```
┌─────────────────────────────────────────────────┐
│ Renderer (Vue 3, sandbox, contextIsolation)     │
│  ├─ TabsBar / TitleBar / StatusBar              │
│  ├─ Sidebar: Outline · FileTree                 │
│  ├─ EditorArea                                  │
│  │   ├─ SourceEditor (CodeMirror 6)             │
│  │   ├─ WysiwygEditor (Milkdown, M3+)           │
│  │   └─ Preview (markdown-it + KaTeX + Mermaid) │
│  ├─ Stores: documents / workspace / settings    │
│  └─ Services: md 渲染管线 / 导出 / 查找替换      │
└───────────────────▲─────────────────────────────┘
                    │ contextBridge (window.api.*)
┌───────────────────┴─────────────────────────────┐
│ Preload: 类型化 API 白名单                        │
└───────────────────▲─────────────────────────────┘
                    │ ipcRenderer.invoke (handle)
┌───────────────────┴─────────────────────────────┐
│ Main: 窗口管理 · 菜单 · 文件 IO · 对话框          │
│       file watcher · 配置持久化 · 自动更新        │
└─────────────────────────────────────────────────┘
```

IPC 频道按域划分（全部 `invoke/handle` 模式，无双向 `on` 滥用）：

- `fs:*` — readFile / writeFile / readDir / create / rename / delete / watch
- `dialog:*` — openFile / openFolder / saveFile / showMessage
- `app:*` — getConfig / setConfig / recentFiles
- `win:*` — 最小化/最大化/关闭（自绘标题栏用）

安全基线：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、渲染进程不直接碰 Node API。

### 目录结构

```
markdown-editor/
├─ electron.vite.config.ts
├─ package.json
├─ build/                      # 图标、打包资源
├─ src/
│  ├─ main/                    # 主进程
│  │  ├─ index.ts
│  │  ├─ window.ts
│  │  ├─ menu.ts
│  │  └─ ipc/{fs,dialog,config}.ts
│  ├─ preload/index.ts         # contextBridge API + 类型
│  └─ renderer/
│     ├─ index.html
│     └─ src/
│        ├─ main.ts / App.vue
│        ├─ stores/{documents,workspace,settings,tabs}.ts
│        ├─ services/{markdown,exporter,search}.ts
│        ├─ composables/
│        ├─ components/
│        │  ├─ editor/         # EditorArea / SourceEditor / Wysiwyg / Preview
│        │  ├─ sidebar/        # Outline / FileTree
│        │  └─ chrome/         # TitleBar / TabsBar / StatusBar / SettingsDialog
│        └─ assets/themes/     # 主题 CSS（变量化）
└─ tests/
```

---

## 四、开发计划（里程碑）

按单人投入估算（业余时间 ~15h/周）；串行推进，每个里程碑结束都有可运行版本。

### M0 — 工程脚手架（约 1 周）
- electron-vite + Vue3 + TS + Pinia 初始化，ESLint/Prettier
- 主/preload/渲染三进程跑通，IPC 安全通道与类型化 `window.api`
- 主窗口、基础原生菜单、DevTools
- **产出：空壳应用可打包运行**

### M1 — MVP 编辑器（约 2 周）【P0 全部】
- 打开/保存/另存/新建，脏标记与关闭拦截
- CodeMirror 6 编辑 + markdown-it 双栏实时预览、同步滚动
- 基础语法 + 代码块高亮 + 查找替换 + 字数统计状态栏
- 快捷键格式化、自动保存（间隔 + 失焦）
- **产出：可日常使用的双栏编辑器**

### M2 — 渲染与外观增强（约 2 周）
- KaTeX 公式、Mermaid 图表（异步加载）、图片查看器
- 主题系统：CSS 变量 + light/dark + 跟随系统
- 大纲面板（解析标题树，点击跳转、光标联动）
- 字体/字号/行距/页宽设置，偏好设置页（持久化）
- **产出：好看的、公式图表齐全的编辑器**

### M3 — Typora 核心体验（约 2-3 周）【项目灵魂】
- Milkdown 即时渲染模式接入，与源码模式/双栏模式切换
- 专注模式、打字机模式
- 多标签页、文件树工作区（增删改名）、最近文件
- 图片粘贴/拖拽自动落盘（`.assets` 目录规则）
- **产出：形态上对标 Typora 的完整编辑器**

### M4 — 导入导出 + 打磨（约 2 周）
- 导出 HTML（单文件内联）、PDF（打印管线，页边距设置）
- 富文本粘贴转 Markdown、外部修改检测、草稿恢复
- 拖标签成新窗口（多窗口）、全局快捷键梳理
- **产出：1.0-beta**

### M5 — 发布（约 1-2 周）
- electron-builder 打包：Windows NSIS + 便携版
- 自动更新（GitHub Releases）、i18n 中英
- 性能：大文件、启动速度、内存 profiling
- 安装包签名（可选）、macOS/Linux 构建
- **产出：1.0.0**

### 1.x 迭代池（P2/P3）
~~Word/图片导出、表格可视化编辑、全局搜索、托盘、PicGo 上传、快捷键自定义、Vim 键位、插件系统~~（全部落地，见六、下一步 9-31）。迭代池已清空。

---

## 五、风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| 即时渲染实现复杂度超预期 | M3 延期 | 路线隔离：双栏/源码模式独立可用，Milkdown 失败可退回 C 路线不阻塞发布 |
| 双轨编辑器（CM6 + Milkdown）状态同步 | 数据丢失/不一致 | 单一数据源（store 持 doc 文本），切换模式时序列化交接 + E2E 用例覆盖 |
| Mermaid/KaTeX 拖慢首屏 | 启动卡顿 | 全部动态 import，仅文档含对应语法时加载 |
| 大文件（>1MB）卡顿 | 体验差 | CM6 分块视口渲染；预览按块惰性渲染 |
| Electron 安全面 | 沙箱逃逸/恶意 md | contextIsolation + sandbox + IPC 白名单 + 禁用 remote；HTML 内嵌默认关闭可配置 |
| Windows 打包/杀软误报 | 分发受阻 | electron-builder 官方模板起步，必要时代码签名 |
| 双栏同步滚动不准 | 消费级细节差 | 源码行 ↔ 渲染块位置映射表，按比例插值 |

---

## 六、下一步

1. ~~确认即时渲染路线~~ → **已确认（2026-09-28）：C 起步（CodeMirror 双栏）→ M3 演进 A（Milkdown）**；界面要求原创设计，不照抄 Typora（见 DESIGN.md「墨匣纸面」）
2. ~~初始化 M0 脚手架~~ → **已完成**：应用定名墨匣 Inkbox；三进程骨架、类型化 IPC、自绘标题栏/标签栏/墨脊侧栏/状态栏、最小文件链路（打开/保存/最近文件/文件树）
3. ~~M1 编辑内核~~ → **已完成（2026-09-28）**：CodeMirror 6 内核（主题令牌化/格式化快捷键/查找替换面板）、markdown-it 双栏实时预览（同步滚动、任务列表、链接安全）、代码高亮（墨块风格）、大纲面板（点击跳转/光标联动）、三模式切换（编辑/双栏/预览）、自动保存（间隔+失焦）、字数/阅读时长统计
4. ~~M2 渲染增强~~ → **已完成（2026-09-28）**：KaTeX 公式（$/$$，懒加载 + 货币防误判）、Mermaid 图表（异步渲染 + 结果缓存 + 主题跟随重建 + 失败降级）、图片查看器（滚轮光标锚缩放/拖拽/Esc）、偏好设置页（主题/字号/行距/纸宽/自动保存，实时生效 + 持久化；墨脊齿轮与 Ctrl+, 入口）；SVG data URI 图片放行
5. ~~M3a Typora 体验第一批~~ → **已完成（2026-09-28）**：专注模式（F8 段落淡出）、打字机模式（F9 光标居中）、图片粘贴/拖拽自动落盘 `文档名.assets/`、本地图片 `luci-img://` 协议预览、文件树新建/重命名/删除
6. ~~M3b 即时渲染引擎~~ → **已完成（2026-09-28）**：Milkdown(ProseMirror) 即显模式（四模式并存、双向同步、墨匣纸面主题）；标签栏拖拽排序 + 右键菜单（关闭/左侧/右侧/其他/全部）；最近文件带打开时间与路径展示（旧配置自动迁移）。**M3 全部完成**
7. ~~M4 导入导出 + 打磨~~ → **已完成（2026-09-30）**：导出 HTML（单文件内联样式/KaTeX 字体/本地图片 base64）；导出 PDF（printToPDF 打印管线 + 页边距三档/横竖向/页脚页码，pdf.js 真实产物预览）；富文本粘贴转 Markdown（turndown+GFM，仅接管带标签结构的 HTML 载荷）；外部修改检测（目录 watcher + 防抖广播 + 内容比对，静默重载或询问覆盖）；草稿恢复（编辑防抖/周期兜底/失焦三重落盘、tmp+rename 原子写、崩溃标志静默恢复）；标签拖出新窗口 + 跨窗口拖拽与文件去重；窗口会话快照（标签/文件夹/崩溃全量恢复）；快捷键面板
8. ~~M5 发布~~ → **核心已完成（2026-09-30，版本升至 1.0.0）**：electron-builder NSIS + 便携版打包验证通过（win-unpacked 实测可运行）；自动更新链路就绪（electron-updater + GitHub Releases publish，推送 v* 标签即生效）；**i18n 中英双语**（vue-i18n + 渲染层扁平词典/主进程词典，设置页可选 跟随系统/简体中文/English，菜单/托盘/系统对话框/CodeMirror 搜索面板全量跟随切换）。发布前跟进项：启动/大文件性能 profiling、安装包代码签名、macOS/Linux 构建
9. **1.x 第一批（P2，2026-09-30）**：扩展语法渲染（==高亮== ^上标~下标 脚注，自写 [TOC] 规则生成可点击嵌套目录 + 标题锚点，样式入 preview.css 随导出携带）；导出 PNG 长图（offscreen paint 帧整页截取——capturePage 在 Windows offscreen 下抛 UnknownVizError）；导入 HTML 转 Markdown（打开 .html 自动 turndown，生成未另存草稿）。Word 导出（html-to-docx）经实测保真度不足（SVG 图表/公式/代码块需整体栅格化，编辑价值有限），按产品决策移除，导出矩阵定为 PNG/PDF/HTML 三格式。多窗口配置同步与窗口私有偏好（纸宽/侧栏宽）随本轮一起落地
10. **1.x 第二批（2026-09-30）**：**全局搜索**（3.10 提前落地）——工作区跨文件搜索，墨脊搜索按钮/侧栏搜索页/Ctrl+Shift+F 三入口；主进程递归扫描（跳过隐藏/依赖/.assets 目录，2000 文件、单文件 30 命中、总量 400 限流），结果按文件分组、命中词安全高亮、点击打开并跳转命中行；**禅模式**（4.9 收尾）——F10/菜单隐藏标签栏、状态栏、墨脊与侧栏，Esc 退出并恢复侧栏；工作区目录递归监听（外部增删改自动刷新文件树，保持展开态）+ 文件树按名筛选（扁平列表直达）；**表格可视化编辑**（2.4 落地）——光标进入表格浮现工具栏（编辑器/双栏模式），增删行列、四档对齐、删除整表，纯文本变换单事务可撤销，单元格 `\|` 转义与代码围栏排除均已处理
11. **1.x 第三批（2026-10-01）**：**块悬浮工具栏**（1.9 落地，P2 收官）——光标进入非表格块时贴块首行右侧浮现工具栏（编辑/双栏模式）：加粗/斜体/行内代码/高亮/链接（与快捷键同一实现，可再按取消）、标题升降级、插入表格/代码块模板、插入图片（原生选择器 → 复制进 `文档名.assets/` → 插入相对链接，新增 `dialog:openImage` 通道）；块首滚出视口上方时钉在编辑器顶部，滚动实时跟随；**emoji 短代码**（1.12 收尾）——`:smile:` 全量词表渲染（markdown-it-emoji），随 HTML 导出携带，即显模式边界同公式；**开机自启**（6.4 落地）——设置页开关，`app.setLoginItemSettings` 写系统登录项，仅打包后生效（dev 不污染系统登录项）

12. **1.x 第三批回归修复（2026-10-01，实测反馈）**：① 外部修改误报——自动保存写盘后 300ms 内继续输入，磁盘（已存版本）≠ 编辑器（更新版本）即弹「已被外部修改」；改为 DocTab 记录 savedContent 写盘快照，磁盘与快照一致即识别为自身保存回声（打开/保存/重载三处维护快照）。② 本地图片裂图（含既有粘贴功能）——markdown-it 对链接目标做过一次百分号编码（中文 → %XX），image 规则再 encodeURIComponent 二次编码，主进程解码一次后剩字面量 % 路径 404；改为解码回原始文件名再重组（HTML 导出的 luci-img 内联同步痊愈）。③ 悬浮工具栏遮挡/距离感/出现时机（块栏+表格栏共性问题）——重构为编辑区顶部固定停靠条：不再浮动、不随光标移动、任何窗口宽度不遮挡正文，光标进表格自动切换为表格操作。④ 选中文本对比度（双主题）——新增 --selection 设计令牌（钢蓝色，与琥珀 ==高亮==/搜索命中区分），CodeMirror/即显/全局 ::selection 三处统一，明暗两档按实测截图校准
13. **1.x 第三批回归修复·第二轮（2026-10-01，实测反馈）**：① 标题提升清空内容——旧实现只重写标记前缀区间（`to: line.from + m[0].length`），与整行替换叠加时正文丢失；改为整行重写且标题文字始终保留。② 无选区格式标记无限累积——光标空选区重复点加粗/高亮只成对插入；改为光标紧邻一对标记时再按一次=成对移除（切换语义），源码模式截图中的 `****加粗****` 不再出现。③ 自动保存误报残余——saveTab 在 await 写盘后才读 tab.content 记快照（期间继续输入会记错），改为写盘前固化；主进程 fileWatcher 的 filename=null 匿名事件不再保守视为命中（同目录其他文件的事件不再误报本文件）。④ 即显模式图片裂图——Milkdown 按字面解析相对路径；MutationObserver 把 img[src] 在显示层改写为 luci-img://（不动 ProseMirror 文档，序列化回源码仍是相对路径）。⑤ 打开新文件滚动未复位——预览面板在 docDir 变化时 scrollTop 归零（与源码面板切标签归零口径一致）；即显面板切标签同样归零。⑥ 图片尺寸/对齐——alt 修饰符语法 `![文字|60%|center](src)`（`50%`/`300`/`300x200` 尺寸 + left/center/right 对齐），预览/HTML 导出渲染为内联样式，工具条新增图片上下文（加宽/缩窄 10% 步进、三档对齐、清除修饰，单事务可撤销）；修通 markdown-it alt 由 children 渲染导致的属性设置失效（renderInlineAsText 显式取原文 + 自行 renderToken）。⑦ 工具条图标对齐 WPS 习惯——B（粗体衬线字重）/ I（斜体）/ S（删除线）文本字形，补删除线按钮（快捷键 Ctrl+Shift+X 原有），标题升降保留 ↑H/↓H
14. **1.x 第三批回归修复·第三轮（2026-10-01，实测反馈）**：① 选区在标记内部时重复点击未解包（`====高亮====` 双层标记根因）——wrapSelection 补第三分支：选区两侧紧贴标记对即解包，且包裹/解包后选区始终覆盖内部文本（连续点击 = 加/解循环，操作后保持选中）。② 即显图片仍未回显——DOM 层改写会被 ProseMirror 的 DOM 同步恢复（根因）；改为数据层：进入即显时相对路径转 luci-img://（代码围栏跳过），markdownUpdated 序列化时转回相对路径（store/磁盘保持原始写法，往返已验证等价）。③ mermaid 配色重做——base 主题 + 全量 themeVariables（墨匣琥珀系两套明暗变量：序列图节点/消息文字、饼图扇区/图例/标题全部显式设色，默认主题浅色下消息文字与图例看不清的问题一并修复，预览与 HTML 导出同管线生效）；字体用具体字栈（SVG 内联样式不依赖 CSS 变量）
15. **1.x 第三批回归修复·第四轮（2026-10-01，实测反馈）**：① 图表配色改了但用户侧纹丝不动——两个机制漏洞：mermaid 渲染缓存 key 只含 `theme|code`，改 themeVariables 后旧缓存全数命中（key 加入 MERMAID_THEME_VERSION，改配色换版本即失效）；initMermaidTheme 只在首次加载/切主题时调用，组件 HMR 重挂载不触发主题 watch，实例一直用旧配置（改为每轮渲染前 initialize，配置对象开销可忽略）。② 流程图边标签背景块——edgeLabelBackground: 'transparent'（两套主题）。③ 饼图 ECharts 质感——pieOpacity '1'（默认 0.7 半透明是"廉价感"根源）+ 纸面色扇区描边 2px（扇区间隔）+ 图例/标题深色。④ mermaid 12 变量名核实（pieLegendTextColor/signalTextColor/actorBkg/edgeLabelBackground 均存在且直接插值渲染，排除变量名问题）；Milkdown image 链路源码核实（imageSchema toDOM 原样输出 src，sanitizeLinkHref 只作用于链接 mark，无协议白名单限制）
16. **1.x 第三批回归修复·第五轮（2026-10-01，即显图片根因终局）**：用户持续反馈即显图片不显示，为定位加了 dev-only CDP 远程调试口（main/index.ts，仅 !isPackaged 开 9222）与 __milkDebug 调试钩子（PM doc JSON / 序列化 / 内部 remark 探针），在真实 Electron 窗口内逐层二分，最终锁定：**Milkdown 7.22.2 的 image schema 声明 `validate: "string"`，而 remark 对无 alt/title 的图片给出 null → prosemirror-model 校验抛 RangeError → Milkdown 的 addNode 静默 catch（仅 console.error）→ 图片节点连段落一起蒸发**（remark→PM 转换层丢失，remark 解析本身正常已单测排除）。修复：remarkPluginsCtx 注入 mdast 清洗插件（alt/title null → ''，插件元素格式必须为 { plugin, options }，裸函数会被 core 静默跳过——两个坑连踩）。修复后真实窗口验证：PM doc 含 image 节点、DOM 渲染 img、内容编辑往返无损、用户测试.md（相对路径 luci-img 转换）两张图 loaded=true。附修：edgeLabelBackground 用 'transparent' 会被 mermaid fade() 混成 rgba(0,0,0,.5) 暗底，改为实际背景色值。磁盘核验：用户测试.md 未被写坏（丢失只发生在窗口内存态）
17. **1.x 第三批回归修复·第六轮（2026-10-01，图表双主题终局）**：用户反馈深色主题下图表仍是浅色配色——实测定位根因：主题切换时 content 未变 → v-html 不重建 DOM → 已渲染 SVG 节点带着 data-processed 标记，renderMermaid 整轮跳过（浅色 SVG 永久留存）；且不能只移除标记重跑（run 会把 SVG 内部 <style> 文本当源码，曾致图表变 CSS 文字）。修复：主题 watch 里清空 html 强制 v-html 重建（占位 div 回到源码态）+ 保留 data-processed 保护。修复后真实窗口往返验证：dark（actor #3b3128/消息 #eae2d6）⇄ light（#f3e5cf/#4a4036）切换图表即时重着色。饼图字号精修（标题 19px/图例与扇区 13px，更贴 ECharts 比例）
18. **1.x 第三批回归修复·第七轮（2026-10-01，切主题滚动位置）**：主题切换强制重建预览 DOM 的副作用——innerHTML 清空时 scrollTop 被重置，图表区域（内容高度大头）滚动位置丢失。修复：切换前锚定视口顶所在块的行号+块内比例（blockAtScrollTop），mermaid 渲染完成、块映射重建后按锚点 syncToLine 恢复；双栏模式源码面板不受主题影响，预览恢复到同一行即保持两侧对齐。真实窗口实测：滚至图表区（3000px）切主题两次，scrollTop 零漂移、视口顶元素一致
19. **1.x 第三批回归修复·第八轮（2026-10-01，切主题闪烁）**：第七轮的整页 DOM 重建导致切主题时预览闪一下（内容消失一瞬 + 图表 SVG 塌陷回源码占位再撑开）。重构为**离屏重渲染**：主题切换只重渲染 mermaid（其余内容颜色全走 CSS 变量自动跟随）——渲染成功时把源码存进 data-mermaid-src，切换时取源码在离屏节点（同宽度、脱离文档流）按新主题画好 SVG，完成后原地替换 innerHTML。真实窗口实测：切主题时 DOM 主体引用不变（无重建即无闪烁）、scrollTop 零漂移、图表实际换色；同主题来回切走缓存秒换
20. **1.x 第四批（2026-10-01）**：**即显模式查找替换**（1.6 P0 补全）——此前 Ctrl+F 在即显/预览模式会强制切回双栏开 CM6 面板；新写 ProseMirror 层查找插件 `editor/pm-find.ts`（$prose 挂载）：逐文本块匹配（段落/标题/表格单元格/代码块行，不跨块）、Decoration 全量高亮（当前项描边）、文档编辑实时重算（活动项 mapping 映射最近命中）。纸卡顶部**停靠查找条**（压缩正文高度不遮挡，符合用户固定停靠偏好）：nN 计数、Enter/Shift+Enter 回绕导航、选中文本自动预填、Aa 大小写 / .* 正则开关（替换串支持 $1 分组引用）、单处替换（替换后自动前进）、全部替换（旧坐标逆序单事务，一步撤销）、Esc 清理高亮回焦编辑器；正则无效时输入框红框 + 「正则无效」提示。App.vue 路由改为仅预览模式切双栏，SourceEditor 监听加模式守卫（隐藏态不再误开 CM6 面板）。**即显撤销/重做修复**（1.7 P0 补全）：commonmark 预设不含 history 插件，即显模式 Ctrl+Z 此前完全失效；挂载 @milkdown/plugin-history 修复（CDP 实测：打字单步撤销/重做、全部替换一步回退；另确认 PM history 会把 500ms 内连续输入合并为一个撤销步——标准语义）。真窗口 CDP 全链路验证 + 暗色截图校准
21. **1.x 第四批·实测反馈修复（2026-10-01）**：① 即显模式点 ↑↓ 不定位——`tr.scrollIntoView()` 依赖 DOM 选区坐标，焦点在查找条（编辑器未聚焦）时静默失效；改为 `scrollPosIntoView` 手动按 coordsAtPos 计算滚动（可滚动祖先 + margin 贴边），输入即搜/导航/替换后均可定位。② 补全字匹配开关（`\b`，正则模式下禁用，替换串 `$1` 保留）。③ 编辑/双栏模式弃用 CM6 内置搜索面板（无计数、悬浮样式）——自建同款停靠查找条驱动 `SearchQuery`：nN 计数（SearchCursor 全文迭代 + 光标定界）、↑↓ 回绕导航、全部命中琥珀高亮（自写视口高亮插件 `cm-find-highlight.ts`：CM 自带高亮要求面板打开，`setSearchQuery` 驱动时永远不亮）、选区预填、单处替换（replaceNext，替换后前进）、全部替换（replaceAll 单事务一步撤销）、关闭即清查询清高亮；Mod-f 在 CM 扩展里拦截路由到自建条（不再可能弹出内置面板）。④ 预览模式 Ctrl+F 不再切双栏：同款查找条 searchOnly 形态（无替换区），DOM 文本节点扫描包高亮 span（跳过 mermaid/katex，命中数组导航 + scrollIntoView 居中定位），内容重渲染后自动重扫，Esc/✕ 清除。⑤ 查找条组件化（FindBar.vue 三模式共用），空查询显示 0/0（修复图二空白）；Esc 在条根节点接管（点过 ↑↓ 焦点在按钮上也能关闭——.esc 修饰符守卫在该场景不可靠，改显式 e.key 判断）。真窗口 CDP 全链路验证（三种模式 × 定位/计数/全字/替换/撤销/Esc），并定位了一次 vite HMR 失败（import 先于目标文件创建）导致的陈旧组件假象
22. **1.x 第五批·启动性能（2026-10-01，发布前跟进项）**：electron-vite preview（跑打包产物）+ CDP performance 时间线做基线与复测。**基线**：入口单 chunk 3507KB 全量解析，first-paint（窗口可见）1568ms、DCL 748ms；1MB 真实感文档（标题/正文/js 代码块/表格/列表 ×2900）打开→CM 就绪+双栏预览全渲染 580ms。**优化**：① WysiwygEditor（Milkdown 全家桶 1MB）defineAsyncComponent 按需加载；② 设置页/导出弹窗（exporter 连带 pdf worker/字体资源链）异步化；③ turndown+turndown-plugin-gfm 改为首次富文本粘贴/HTML 导入时动态加载（export= CJS 包动态导入需 default/本体双形状兼容）；④ highlight.js 从 lib/common 全量改为 lib/core+34 常用语言显式注册（未注册语言回退纯文本，语言模块自带别名 sh/ts 等仍可用）；⑤ 预览大文档（>200KB）重渲染防抖 120→450ms（全文重渲染一次几百 ms，避免连续输入卡顿）。**结果**：入口 3507→2363KB（-33%），first-paint 1568→876ms（-44%），DCL ~750ms 持平（剩余为 Electron 渲染进程固定成本）；功能回归全过：即显首次切换正常挂载（1MB 独立 chunk）、富文本粘贴转换正确（gfm 三插件验证：删除线/任务列表/带 thead 表格；无 thead 裸表格本就不转——上游行为）、设置/导出弹窗正常、js 代码块高亮正常、控制台无错。两份 katex chunk 非重复：一份 mermaid 自带（图表时才加载），一份应用懒加载
23. **1.x 第五批·续（2026-10-01，压测样例 + mermaid 懒渲染）**：**预置大文档压测样例**——scripts/make-bigfile.mjs 参数化生成仓库外层 inkbox-workspace/压测-大文档.md（避免提交 git）（1.03MB：463 章/1850 标题/1387 代码块/693 表格/198 张差异化 mermaid/463 脚注/公式/任务列表/引用，素材为项目纪实轮换，不随安装包分发、不进 JS bundle）；真窗口 openPath 实测：文本渲染 140ms、CM 就绪 548ms、大纲 1851 条正常。压测暴露 **mermaid 串行渲染瓶颈**：mermaid 12 的 run 对多节点是 for-await 串行且共享全局配置（并发 run 互踩，批量传节点也不并发），198 张全量渲染 105 秒且占满主线程。重构为**视口懒渲染**：视口 ±600px 余量内立即入队，视口外注册 IntersectionObserver 滚到附近才渲染；后台队列串行消费（互斥约束下安全）；渲染完成后 150ms 合并重收集块映射（滚动同步不失效）；主题切换路径同步改造——视口内的图离屏重绘原地替换（保住不闪烁），视口外的回占位态入后台队列按新主题补渲。实测：打开即用（0 张首屏图秒开），滚到图处 1.2s 内出图，交互不再被渲染风暴阻塞
24. **1.x 第五批·实测反馈修复（2026-10-01）**：① 脚注区双栏失同步——markdown-it-footnote 的 section 无 data-source-line（脚注定义在源码文末），块映射缺失最后一环，源码滚到脚注定义区时预览停在最后正文块；collectBlocks 给 .footnotes 补锚（line=文档总行数，源码滚到底↔预览滚到脚注区），实测双向同步恢复（源码→预览脚注入视口；预览滚脚注→源码 98.7% 底部）。② 大纲点击定位改视口上方——scrollIntoView y:'center'→y:'start'+yMargin:100，实测活动行落视口顶 ~97px。③ 打字机模式点击抖动——旧实现对 selectionSet 无差别居中，视口内来回点击每次强制居中导致视口反复上下调整；收紧为仅 input.type/delete 触发（CM6 的鼠标点击与键盘移动命令均不设 userEvent，无法区分也不该强制），实测四次点击 scrollTop 零变化、打字居中保留（光标行 491→285）、tw 开启下大纲跳转不受干扰。④ 压测文件移出仓库——inkbox 是 git 仓库，压测大文档改存 workspace 外层（E:\projects\lucifer\inkbox-workspace\压测-大文档.md），生成脚本输出路径同步调整（npm run bigfile），PLAN/README 路径更新。验证教训：跨多轮 CDP 测试的长驻窗口可能出现 CM 滚动中间态（旧 listener 与 jumpTo effect 争抢后 scrollIntoView 静默失效），验证前重启窗口取干净基线
25. **1.x 第六批（2026-10-01，列表智能续行 1.10 P1 收官）**：源码/双栏模式 Enter 自动续行——无序 `-/*/+/任务 [ ]`（勾选状态重置为未勾选）、有序序号+1（保留 `.`/`)` 分隔符）、引用 `>` 续行、缩进继承；空项回车删除标记结束列表；光标在标记内回车/代码围栏内不接管（围栏判定走 syntaxTree，typora 式默认换行）。实现要点：① lang-markdown 的 `markdown({ addKeymap })` 默认注册 **Prec.high 的内置续行 keymap**，会压过自定义绑定（第一版 continueList 静默失效、被内置实现冒名顶替的排查过程：console 日志注入证伪 → 禁用实验二分 → dist 源码定位 Prec.high）；② 禁用 addKeymap 后 defaultKeymap 的 insertNewlineAndIndent（basicSetup）仍会先拦截，Enter 绑定必须注册在 extensions 数组最前；③ CM6 `state.update` 不带 selection 时光标默认映射到插入文本**之前**（后续输入落上一行），续行 dispatch 必须显式 `selection: { anchor: head + 1 + next.length }`；④ CM6 无 `state.tr`（那是 ProseMirror API），事务用 `state.update({ changes })`。九场景真窗口 CDP 验证全过（含勾选重置、空项结束、代码块保护、嵌套缩进）；另补 Backspace 删标记命令（deleteListMarker：光标紧贴标记尾时一次退格删整个标记——补回被禁用的内置 deleteMarkupBackward，四场景实测：空项删标记/保内容/有序同样/标记前不接管）
26. **1.x 第七批（2026-10-06，快捷键自定义 6.7 收官）**：应用级命令快捷键可改。**架构判断**：菜单加速器本就是唯一全局键源（全部命令经 menu:command → App.dispatch），改键 = 改菜单模板，渲染层分发零改动。`shared/shortcuts.ts` 注册表（17 命令：文件 9 + 查找 + 视图/设置 7）＋ `config.shortcuts` 覆盖表（id → 加速键，'' = 禁用，缺省用默认；与默认相同则删覆盖项）；`createMenu` 按覆盖表生成模板，setConfig 快捷键变化 / 语言切换两条路都走 rebuildMenus。设置页「快捷键」分组行内改键：录制用 window 捕获阶段监听（抢在设置弹窗自身 Esc 之前）、**录制期间主进程挂起应用菜单**（`Menu.setApplicationMenu(null)`——加速器会抢在渲染层之前消费按键，录制根本收不到；60s 兜底自动恢复防渲染层异常全键失效）、冲突拒绝（与其他命令归一化比对 + 固定占用表 RESERVED_ACCELS：role 键与编辑器格式键）、合法性（必须含 Ctrl/Alt 或为 F 键——单字母会拦截打字）、Backspace 清除、单条恢复默认；快捷键面板改为注册表驱动实时跟随。Electron 下渲染层旧的 Ctrl+F 兜底绑定（CM6 Mod-f / 即显 window keydown）同步按 userAgent 关闭——否则改键后旧组合在编辑器里还活着。**验证方法论（重要）**：本受控环境注入不了 OS 键击（CDP Input.dispatchKeyEvent 不走 Electron 菜单加速器路径；keybd_event/SendInput/SendKeys/PostMessage 四种注入经 F12 对照实验全部不落地——受控 shell 限制），退而给菜单项加 `id` 并开 dev-only IPC（debugMenuAccels 读活体菜单加速器 / debugMenuInvoke 触发菜单项 click），覆盖「注册了什么加速器」+「命令管线」两环，OS 键→加速器匹配属 Electron 框架层不受改动影响；32 项断言全过（基线注册/管线、17 行渲染、冲突+挂起、改键持久化、菜单重建、重载后两侧一致、清除后加速器为 null、恢复默认、面板跟随、设置入口回归）。另：会话恢复会带着用户真实文件标签，测试前 activateHome 切主页（本批再次避免污染）
27. **禅模式空白修复（2026-10-06，用户实测反馈）**：进禅模式后整窗空白且无法编辑——`.app` 是固定四行网格（44/38/1fr/28 对应标题栏/标签栏/正文/状态栏），禅模式用 v-if 移除标签栏与状态栏元素后**网格行声明不变，app-body 自动补位进 38px 的第二行**，正文被压成看不见也点不到的细条；该 bug 自禅模式落地（batch 10）即存在，当时验证未盯内容区。修复：根节点按 zenMode 挂 `.app-zen` 类，网格行收缩为 44px + minmax(0,1fr)。真窗口复验：app-body 730→796px、纸面可见、两连击输入正常、Esc 退出布局还原；顺带核实侧栏 Transition 离场 400ms 内完成（排查中首张截图的"侧栏残留"是动画未完时抓帧的假象，非 bug）。教训：**v-if 删网格子元素必须同步收缩 grid-template-rows**；模式开关类验证要断言容器 clientHeight 而不只看状态位。**后续增强（同日反馈）**：禅模式下支持打开右侧快捷键面板——新增 `view:toggleShortcuts` 命令（默认 Ctrl+/，入注册表可改键，菜单视图组加项），进禅模式不再强制关闭已开的面板（它是随叫随到的参考层）；墨脊隐藏后 Ctrl+/ 是禅模式内唯一入口。验证 12 项全过（默认键活体注册、命令开关、面板随禅保留、禅内开关、退出延续、设置页 18 行、面板清单跟随）；再次确认 Transition 离场期元素仍在 DOM，断言要等动画结束
28. **1.x 第八批（2026-10-06，图床上传 6.8 落地）**：PicGo server 协议图片上传。设置页新增「图床」分组（启用开关 + 服务地址，默认关、默认 `http://127.0.0.1:36677/upload`）；`config.upload` 持久化（server 只收 http(s)，非法回默认）。主进程新增 `image:upload` IPC（ipc/net.ts）：POST `{list:[dataURL]}` 到服务端——PicGo 官方 server API 契约（非二进制 body），响应 `{success,result:[url]}` 取 [0]，AbortSignal 30s 超时，失败返回 `{ok:false,error}` 不抛 IPC 异常。渲染层 SourceEditor 抽出 `persistImage` 统一落点：**开启图床先上传（成功插入远端 markdown 链接），未开启/服务拒绝/连接失败一律回退本地 .assets**（粘贴/拖拽/块工具条插入三条路径共用）；粘贴多图逐张处理，上传与回退的轻提示不同。**验证**：本环境无 PicGo，写 mock server（node http，/upload 正常、/fail 返回 success:false、另一端口模拟连不上）+ 合成 ClipboardEvent（DataTransfer.items.add(File) 构造图片粘贴）真窗口 E2E：14 项断言全过——上传成功插入 `https://mock.cdn/...` 且 .assets 零写入；success:false 与端口不通两种失败均回退 `./测试图.assets/` 落盘并提示；设置页开关/地址回显与 config.json 持久化；测试文档写在工作区外层 img-upload-test/（不进 git、不碰用户笔记），测毕关标签 + 删盘 + 配置还原。验证工程教训：① 粘贴图片的 alt 名是代码生成的时间戳（`IMG_20261006_134722.png`，两段数字下划线相连——断言正则 `\d+` 会断在 `_` 处，要用 `\d{8}_\d{6}`）；② `.assets` 目录名是**文档名**.assets（不是目录名.assets）；③ 测试标签强制关闭用 `docs.closeTab(id)`（直关不弹确认），`closeActive()` 会因脏弹 askConfirm——清理脚本必须消费 `ui.confirm`（本轮第三次踩，verify-zen 修过 verify-upload 又忘，已两处修正）
29. **1.x 第八批·续（2026-10-06，导出 LaTeX 5.5 收官）**：导出矩阵第四格式。`services/latex.ts`（~370 行）复用预览的 markdown-it 单例（md.parse 含全部扩展 token），token 树递归生成 **ctexart** 文档（XeLaTeX/中文）：标题→\section 族、加粗/斜体/删除线(ulem \sout)/高亮(soul \hl)/上下标、行内代码 \texttt、代码块 lstlisting（小语种映射，未知不着色）、有序/无序/嵌套列表、任务列表（core 规则注入的 checkbox html_inline → $\boxtimes$/$\square$）、引用 quote、表格 tabular（表头 style 对齐 → 列格式 l/c/r）、块/行内公式 passthrough（**行内公式 TeX 原文此前在 token 流丢失**——luci_math_inline 规则补 `token.meta.tex`）、脚注定义两遍收集→引用处内联 \footnote、[TOC]（luci_toc_block）→ \tableofcontents、hr→rule、:emoji: 转 unicode 字符；正文单遍全转义（\ & % $ # _ { } ~ ^），代码/公式不过转义。图片：markdown-it 的百分号编码先解码，alt 修饰符复用 parseImageLine（60%→0.60\linewidth、px→pt、center→center 环境、含空格路径 {"..."} 包裹），远程图片 \href 占位（.tex 按相对路径引用本地图，提示与文档同目录导出）。导出弹窗格式段 +LaTeX，右侧预览区实时展示生成的 .tex 源码（等宽 pre，无需预览 DOM——单栏/即显模式也可导出，走 tab.content）；`dialog:saveFile` 加 tex 类型（标题/过滤器）。**验证**：真窗口 31 项断言全过（全要素转换 + 转义完整性 + 弹窗预览）；修了三处：表格 renderRow 的 `_open`.slice(0,-4) 算错 close 类型（5 字符不是 4）致单元格丢失、luci_toc_block 未接、测试脚本两处自身 bug（未转义 `|` 本就是表格分隔符——样例错；预览防抖 600ms 等待不足）。至此功能表除 6.9 插件系统（远期）外全部收官
30. **1.x 第八批·续二（2026-10-06，Vim 键位落地，迭代池仅剩插件系统）**：设置页「编辑」组新增 **Vim 模式（源码/双栏）** 开关（`config.vimMode`，默认关，跨窗口同步）；SourceEditor 以 Compartment 按需装卸 `@replit/codemirror-vim`（**动态 import，~40KB 不进入口 chunk**，已加载后缓存复用，切标签经 makeState 自动重挂）。**上游 bug 规避**：`vim({status:true})` 的状态面板工厂在 view.cm 挂载前执行（`view.cm.state` 抛 undefined）致 CM 回滚整个 vim 扩展（console "CodeMirror plugin crashed"），故裸 `vim()` + **自研状态栏徽标**（NORMAL/INSERT，ui.vimInsert 由 updateListener 回报，SourceEditor 独有依赖时才查 getCM）。**键位语义协调**：应用的 Enter 续行/Backspace 删标记优先级高于 vim keymap，普通/可视态会误接——`vimOwnsKey`（vim 开且非插入态）时显式 `Vim.handleKey(cm,'<CR>'/'<BS>')` 委托回 vim（lib 的 keymap 不接管这两键），插入态保留列表续行；菜单加速器（Ctrl+S 等）本就先于渲染层，无冲突。**验证**：真窗口 22 项断言全过——hjkl/x/dd/gg、普通态 Enter 不换行、插入态 i/Enter/Esc、状态栏徽标 NORMAL⇄INSERT、开关切换（关后 h 恢复输入）、config.json 持久化、设置页开关联动、清理零残留（按 newDoc 前后 id 差集精确跟踪，内容特征匹配会被 vim 操作改没——教训）。**验证工程新教训**：① **本环境 Page.reload 之后 CDP 键击/鼠标注入永久失效**（连 document 捕获层都收不到，insertText 不受影响；真实用户键击走 OS 管线不受影响）——需要干净基线时重启 electron，绝不用 Page.reload；② `Input.dispatchKeyEvent` 必须带 `code`（老脚本形状），`text` 只在需要产生字符时给（普通态动作键给 text 会双重触发）；③ 首发键击有延迟落地伪影，断言前给落定时间。

31. **1.x 第九批（2026-10-07，插件系统 6.9 落地，迭代池清空）**：**架构**（渲染进程 `app.enableSandbox()` 无 Node，插件不走 require）：主进程扫描 `userData/plugins/<目录>/`（plugin.json 清单校验：id 小写字母数字连字符 / name 必填 / api=1，坏清单以 error 项呈现不藏错）+ 入口源码经 IPC 传字符串（id 只在已扫描清单里匹配不拼路径、入口名单文件名拒目录跳越、256KB 上限），渲染层 `services/pluginHost.ts` 以 `new Function('inkbox', code)` 执行，唯一入口受控 **inkbox API**：`registerCommand({id,title,run})`（注入快捷键面板「插件」组，点击即运行，禁用即撤下）、`getActiveDoc()`、`setContent()`（updateContent 后 `notifyReload()` 整档重同步——store→编辑器单向流的既有回程通道）、`showToast()`。**信任模型**：插件与宿主同权限（用户主动放入本机的代码），宿主职责是故障隔离——单插件抛错只 markError 该插件（清单期 error 与运行期 error 双通道展示在设置页），绝不影响应用与其他插件；config.plugins.disabled 退出式禁用，开关切换持久化后广播，各窗口 applyConfig→syncPlugins 重装载，设置页「重新加载」改码免重启。**两个真坑**：① **渲染层 CSP `script-src 'self'` 把 `new Function` 一并禁掉**（EvalError），插件静默失效——index.html script-src 加 `'unsafe-eval'`（内联脚本/事件处理器仍被禁，markdown 注入面不变，eval 仅为插件宿主开放）；② `setPluginEnabled` 把 store 的 reactive 数组直接塞进 IPC 载荷——structured clone 静默失败，setConfig 不达主进程（不持久化/不广播/命令不撤下），表单上是两次 Uncaught (in promise)——**嵌套载荷里每一层都要展开**（老教训第三犯）。**验证**：真窗口 35 项断言全过——启动发现/清单字段/双命令注入、设置页区块（分组/名+版本/描述/开关/按钮）、禁用开关（store+磁盘 config+命令撤下+恢复）、面板插件组运行（count toast 报 7 字符、divider 改写 store 且 CM 视图同步渲染）、坏插件隔离（抛错标记 boom-test、坏清单标记 id 错误、好插件不受累、宿主存活）、清理零残留（插件目录/config/面板/测试标签按 id 消除断言——「无非主页标签」断言会误伤用户恢复的会话标签）。**验证工程教训**：CDP `returnByValue` 对**空 reactive 数组**序列化成 `{}`（非空正常），判空用 Array.isArray/length 别 JSON.stringify。

32. **1.x 第九批·续（2026-10-07，内置插件四件套 + 插件 UI 优化）**：**内置插件机制**——应用自带插件随包分发：项目根 `builtin-plugins/<id>/`（plugin.json + main.js），electron-builder extraResources 打进 resources/（打包后 `process.resourcesPath/builtin-plugins`，dev 取 out/main 上两级项目根）；主进程扫描**内置在前、用户在后按 id 覆盖合并**（用户目录同名 id 可替换内置版），PluginInfo 增 `builtin` 标记，设置页行内琥珀色「内置」徽章；内置与用户插件同一套禁用/装载/错误隔离语义。**四个内置插件**（全部走 v1 受控 API，纯文本变换，逐一 node 单测 + 真窗口断言）：① 中英文排版（盘古之白：CJK↔英数补空格，逐行处理、```/~ 围栏跳过、行内代码与链接目标先占位后还原、幂等、计数 toast）；② Front Matter（无头部生成 title=文档名/date=今天，已有则只改这两字段其余保留——**替换串必须补回正则尾部 `(\r?\n|$)` 吞掉的换行**否则破坏幂等）；③ 标题层级（整篇 ATX 标题升/降一级两条命令，1-6 级截断，围栏不动）；④ 表格格式化（竖线对齐，中文按两格宽 displayWidth、`\|` 转义占位、对齐冒号 :-/-:/:-: 保留、无分隔行的伪表格与列数不齐者不动、块边界空行保留——**formatBlock 返回行数组，splice concat 直接用数组**，误 .split 是类型乌龙）。**插件 UI 优化**（用户截图反馈不美观）：快捷键面板插件组从「▶ 键帽+右侧悬空文字」改为**整行动作条目**（▶ svg 图标 accent 色 + 命令名占满 + 右侧来源插件名小字，hover surface-2 起底），与键位组视觉区分且可点击感明确；设置页插件行改**卡条**（hover 起底 + 圆角，名称+徽章+版本同行，描述 -webkit-line-clamp 2 行自然换行替代单行 ellipsis）。**布局坑**：设置页 `.label` 基类钉死 `width:72px`，插件行复用该类被挤成 72px 窄条（名称逐字竖排、开关停弹窗中部）——复用带固定宽度的基类必须显式覆盖 `width:auto; flex:1`。**验证工程教训**：**CDP `captureScreenshot` 的 clip+scale 模式会产生合成伪影**（鬼影文字/「透底」假象，judge 放大实测像素差确认存在但干净重启后全屏原图无）——视觉判定一律用全屏原图，clip 裁剪图不可作为透底/渲染叠印的证据；「内置」徽章等小 UI 变化无需重启 electron（CSS HMR 生效），但**主进程扫描改动必须重启**。真窗口 20 断言 + node 单测 21 断言全过（用户自装的 word-count 与内置插件共存验证一并覆盖——它就是用户照 README 手工装回去的，清理时绝不能删）。

33. **1.x 第九批·续二（2026-10-07，小窗口样式三修复 + 快捷键面板键帽统一）**：用户小窗口截图反馈四处。① **front matter 行距被撑大**（图1）——量化探针实锤：title/date/--- 行高 29.8px vs 普通行 22.9px，根因是 **lang-markdown 把「title: x\ndate: y」段落 + 后续 `---` 误判成 setext 二级标题**（SetextHeading 的字号样式 1.3em 撑高行盒）。修复：新增 `editor/cm-frontmatter.ts`（lezer **eager block parser**，参考内置 FencedCode：parse 一次吞行到闭合 `---`，YAMLFrontmatter 节点 meta 灰调 + 两枚 marker）。**三个坑**：a) leaf() 钩子只对「paragraph 型块」触发，`---` 首行会先被 HorizontalRule（eager）吃掉，leaf 版本永远不触发——必须 eager parse + `before: 'HorizontalRule'`（重写时还把 before 丢了导致二次返工）；b) `cx.addNode/buffer` 是内置 parser 专用的私有 API，公开路径是 `addElement(elt(...))`；c) 护栏：只认 `cx.lineStart === 0` 的文档首行 + peekLine 非闭合（单行/双行 `---` 交还 HR 不误吞水平线）。② **工具条按钮裁切**（图2/3）——`.ctx-strip` overflow-x:auto + 滚动条隐藏，窄窗口尾部按钮被截半；改 `flex-wrap: wrap` 换行摊开（表格工具条 13 按钮最坏场景验证：scrollWidth≤clientWidth、按钮完整 24px、两行摊开）。③ **键帽格式统一**（图4）——面板静态组 "Ctrl+B" 单 kbd 含加号 vs 注册表组分键帽；`splitKeys` 先按 ` / ` 再按 `+` 拆，全面板每键一枚 kbd（Ctrl+= → Ctrl / =）。验证：真窗口 10 断言全过 + judge 三图 pass（行距均匀/按钮完整/键帽统一）；**教训：断言前先确认目标组件在页面上**（activateHome 后查 .cm-line 得 []——主页没有编辑器；`k.split(' / ')` 的旧行为漏算了动态 find 行）。

34. **1.x 第九批·续三（2026-10-07，行号遮挡修复 + 键帽格式二次调整 + 全 UI 样式巡查）**：① **横向滚动遮挡行号**——`.cm-gutters` 此前 `backgroundColor: transparent` + `opacity: 0.6`，CM 默认 gutter z-index 200 盖在内容上，横滚时长行文字从透明的行号列下透出叠印；修复为不透明 `var(--surface)` 背景 + 去掉整体 opacity（行号淡显改用 color-mix text-2 70% 表达）。程序化验证：双栏窄编辑器（sw 534 / cw 299）滚到最右后 gutter x 不变、背景不透明、行号清晰。② **键帽格式二次调整**（用户看过分键形态后改主意）——全面板统一为**一个组合一枚 kbd**：注册表组 `accelKeys(...).join('+')` 单枚、静态组数据直接给组合数组（`['Ctrl+=','Ctrl+-']` 两枚）、动态查找行 `findLabel` join 单枚、设置页改键行同步单枚；空覆盖（禁用态）仍显示「未设置」。③ **全 UI 样式巡查**：程序化扫描器（遍历可见元素查 scrollWidth>clientWidth+2 的非滚动容器 x 裁切 + overflow hidden 的 y 裁切）在 1280/920/1100 三种窗口 × split/panel/settings/home 四场景跑了一遍，揪出并修复**插件动作行横向溢出 6px**（上轮 `width: calc(100%+12px)` + 负 margin 被 sc-body 滚动容器裁切——hover 背景全幅的收益不值得溢出，改回 width:100%）。`.ri-dir` 的 scrollWidth>clientWidth 是 ellipsis 截断机制，属误报。**重大验证方法论发现——后台节流冻结 Vue Transition**：judge 两度报「设置弹窗半透明透底」，程序化查证 `maskClass` 卡在 `settings-enter-from`、关闭后 DOM 不卸载——**验证窗口长期无焦点，Chromium intensive throttling 冻结 rAF/定时器，Vue Transition 的类切换与卸载永不完成**（此前"Transition 离场要等 400ms"教训家族的真正根因；用户前台窗口不受影响，其截图里弹窗一直正常）。解药 `Emulation.setFocusEmulationEnabled(true)`——之后打开态 opacity=1 正常、关闭 350ms 正常卸载。判断特征：computed className 残留 enter-from/leave-active + v-if 元素在关闭后仍在 DOM。bringToFront 不解（不是焦点问题，是节流策略）。验证：真窗口 8 断言全过 + judge 四图 pass。

35. **1.x 第九批·续四（2026-10-07，设置弹窗双栏重设计）**：内容增至 10 个分组后 460px 单列长滚动暴露的三个问题——弹窗小、布局无导航、72px 定宽 label 把长标签挤竖排 + 多条 hint 堆叠归属混乱（用户截图圈出）。**重设计**：760×620 双栏布局——左侧 168px 导航列（六分区：外观与排版/启动与窗口/编辑/图床/快捷键/插件，琥珀选中态），右侧内容区独立滚动、保留原 group-title 小节结构；label 72→96px（长标签不再竖排），行 hint 缩进随 108px 对齐控件列；**hint 归属修复**：startupHint（会话恢复说明）从开机自启后挪到恢复文件夹行后——图中圈出的「两件事挤一段」就是这两条 hint 连堆造成的语义混乱；长 label 文案缩短（Vim 模式（源码/双栏）→ Vim 模式，启用图床上传（PicGo）→ 图床上传，说明语义已在各自 hint 里）。顺手两处轻微项：自动保存关闭时保存间隔选中项置灰（.on:disabled opacity .45）、插件 hint 孤字折行（文案精简）。验证：typecheck + judge 六分区截图全 pass（导航选中态/无透底/label 单行/hint 对齐/控件右缘一致）；实现要点：nav 是组件局部 ref 不进 store（打开弹窗保留上次分区），六个 template v-if/v-else-if 分支包裹原行结构，滚动从 .dialog 移到 .settings-body（.dialog 改 flex 列布局 overflow hidden）。

36. **1.x 第九批·续五（2026-10-07，快捷键面板布局优化）**：键帽改一组合一枚后，156px 定宽键帽列（为旧分体形态设计）成了布局病灶——键帽实际宽 60~110px，中间大空洞、描述列被压窄（「全局搜索（工作区）」折行）。改为常规快捷键面板形态：**功能名在左占满（ellipsis 兜底）、键帽右对齐成整齐右列**（grid 156px → flex space-between），三类行（注册表/静态组/动态查找行）与插件动作行统一方向。溢出扫描零残留，judge 两图 pass。模板改行序时注意 Vue3 的 v-if 与 v-for 不能同元素（v-if 先执行访问不到 v-for 变量）。
