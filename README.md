# 墨匣 Inkbox · 墨匣纸面 Markdown 编辑器

参考 Typora 形态、界面完全原创的桌面 Markdown 编辑器。Electron + Vue 3 + TypeScript。

- 功能清单与里程碑：[PLAN.md](./PLAN.md)
- 界面设计规范（原创「墨匣纸面」设计语言）：[DESIGN.md](./DESIGN.md)

## 快速开始

```bash
npm install        # 若 Electron 二进制未自动下载：node node_modules/electron/install.js
npm run dev        # 开发模式（HMR）
npm run typecheck  # 类型检查（主进程 + 渲染进程）
npm run build      # 产物构建（out/）
```

## 打包发布（Windows）

```bash
npm run icons      # 重新生成应用图标（build/icon.ico + icon.png，改了脚本里的设计后执行）
npm run dist       # 构建并打包：NSIS 安装版 + 便携版（release/pkg/*.exe）
npm run dist:dir   # 仅打未打包目录版（release/pkg/win-unpacked，快速自测用）
```

- 产物：`Inkbox-<版本>-setup.exe`（辅助安装器，可选安装目录）/ `Inkbox-<版本>-portable.exe`（免安装单文件）
- 图标源文件在 `scripts/make-icon.mjs`（墨脊底 + 琥珀 spark，canvas 程序化绘制）
- Electron 与 NSIS 二进制走 npmmirror 镜像（见 `.npmrc` 与 `electron-builder.yml` 的 `electronDownload.mirror`）
- 代码签名未配置（未签名安装包首次运行会有 SmartScreen 提示），正式分发前再补


## 已完成里程碑（M0–M2）

- **M0 骨架**：三进程（main / preload / renderer），contextIsolation + sandbox + 类型化 IPC 白名单；自绘标题栏、菜单与快捷键转发、多标签、墨脊导航、文件树、最近文件
- **M1 编辑器**：CodeMirror 6 内核 + markdown-it 双栏实时预览（块级同步滚动）、代码高亮墨块、任务列表、查找替换、格式化快捷键、大纲面板、自动保存、字数统计
- **M2 渲染增强**：
  - 数学公式 `$...$` / `$$...$$`（KaTeX 懒加载，文档含公式才拉取；`$100` 货币写法防误判）
  - Mermaid 图表（异步渲染、结果缓存、明暗主题跟随重建、语法错误降级显示源码）
  - 图片查看器：点击放大，滚轮以光标为锚缩放、拖拽平移、双击复位、Esc 关闭
  - 偏好设置页（墨脊齿轮 / Ctrl+,）：主题、正文字号、行距、纸面宽度、自动保存开关与间隔——全部即时生效并持久化
  - SVG data URI 图片放行（img 上下文不执行脚本，CSP 兜底）

## 功能示例文档

`samples/示例.md` 覆盖全部支持的语法（标题/行内元素/列表/任务/引用/多语言代码块/表格/公式/Mermaid 三种图/图片/分隔线），随构建打包。两种打开方式：

- 欢迎页 → **功能示例** 按钮
- 菜单 **帮助 → 打开功能示例文档**

## M3 已完成（Typora 体验）

**M3a（第一批）**
- **专注模式**（F8）：淡出光标所在段落之外的内容，状态栏胶囊可点
- **打字机模式**（F9）：输入时保持当前行居中
- **图片粘贴/拖拽自动落盘**：保存到文档旁 `文档名.assets/`，自动插入相对链接；未保存文档有友好提示
- **本地图片预览**：相对路径图片经 `luci-img://` 协议解析（CSP 白名单内）
- **文件树增强**：新建文档/文件夹、重命名（内联输入）、删除（确认）；重命名已打开文档时标签同步

**M3b（第二批）**
- **即显模式（所见即所得）**：Milkdown/ProseMirror 内核，四模式并存（即显/编辑/双栏/预览）一键切换；与源码模式共用同一数据源，双向同步、脏标记与保存链路复用；墨匣纸面主题适配
- **标签栏**：拖拽排序（琥珀插入指示线）+ 右键菜单（关闭/关闭左侧/关闭右侧/关闭其他/关闭全部，含数量提示与脏确认）
- **最近文件**：记录打开时间，欢迎页展示「文件名 + 相对时间 + 所在目录」（旧 string[] 配置自动迁移）

即显模式已知边界：公式/Mermaid 以代码块形态展示（源码/双栏模式可完整渲染）；大纲光标联动仅在源码/双栏生效。

## 当前里程碑：M4 已完成（导入导出 + 打磨）

- **导出 HTML**：单文件内联——墨匣纸面排版样式、KaTeX 公式字体（woff2 转 data URI）、本地图片（`luci-img://` 转 base64）全部打进一个 HTML，可直接分享
- **导出 PDF**：printToPDF 打印管线，A4 纵/横向、页边距三档（标准/窄/无）、页脚页码（开启时底部自动留白）；导出对话框右侧用 pdf.js 渲染真实产物预览（前 5 页）
- **富文本粘贴转 Markdown**：从网页/Office 复制带 `text/html` 载荷时自动 turndown + GFM（表格/删除线/任务列表）；纯文本复制不走此路径
- **外部修改检测**：目录级 file watcher + 300ms 防抖广播；渲染层内容比对后决定静默重载（未编辑）或弹确认（有未保存修改），自身保存不误报
- **草稿恢复**：未保存/未落盘文档三重落盘（停止输入 800ms 防抖 + 5 秒兜底 + 窗口失焦），tmp+rename 原子写；异常退出（崩溃/强杀）后下次启动静默恢复全部草稿
- **多窗口与标签**：标签可拖出新窗口、跨窗口拖拽转移（主进程中转），同一文件跨窗口去重；窗口会话快照恢复（标签顺序/激活项/工作区文件夹，崩溃时全量恢复）
- **会话与托盘**：`restoreTabs`/`restoreFolders` 偏好、关窗行为（退出/最小化到托盘）、快捷键面板

## 下一步（M5 发布）

electron-builder 打包打磨（NSIS + 便携版已有脚本）、自动更新（electron-updater 已接入）、i18n 中英、启动速度与大文件 profiling。

## 技术栈

Electron 44 · electron-vite 5 · Vue 3.5 · Pinia · TypeScript 5.9 · CodeMirror 6（M1）· Milkdown（M3）
