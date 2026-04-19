# CodexMonitor 当前前端 UI 整理与样式迁移说明

## 变更说明

- 无迁移，直接替换。
- 本文用于把另一个项目的前端样式替换为 CodexMonitor 当前项目的 UI 风格。
- 整理日期：2026-03-27
- 整理依据：当前仓库前端源码与 `screenshot.png`

## 用途

这份文档不是讲业务逻辑，而是把当前项目的前端视觉语言、页面骨架、组件样式和迁移规则整理出来，方便直接交给 AI coding 工具做“样式替换”。

## 当前 UI 一句话总结

这是一个偏桌面工作台风格的 AI Agent 应用界面：深色半透明、多层面板、细边框、大圆角、紧凑信息密度、浅蓝高亮、弱动画、强结构感。

## 视觉关键词

- 桌面级工作台，不是普通网页后台
- 深色主视觉，支持 `dark / dim / light / system`
- 玻璃感和半透明分层，但不过度炫技
- 面板很多，但层级清晰
- 主色偏冷蓝，不走紫色路线
- 大量使用胶囊按钮、圆角卡片、细描边
- 信息密度高，但文字尺寸克制，适合长时间使用

## 截图参考

可直接参考根目录截图：

- `screenshot.png`

## 主题与设计变量

### 主题来源

- `src/styles/themes.dark.css`
- `src/styles/themes.dim.css`
- `src/styles/themes.light.css`
- `src/styles/themes.system.css`
- `src/styles/base.css`
- `src/styles/ds-tokens.css`

### 核心视觉变量

建议迁移时先建立这一层变量，再改组件：

| 类型 | 关键变量 | 说明 |
| --- | --- | --- |
| 文本 | `--text-strong` `--text-muted` `--text-faint` | 文字层级清楚，强弱对比明显 |
| 主表面 | `--surface-sidebar` `--surface-topbar` `--surface-right-panel` `--surface-messages` `--surface-composer` | 左栏、顶栏、右栏、消息区、输入区分别独立 |
| 卡片表面 | `--surface-card` `--surface-card-strong` `--surface-item` | 卡片/条目/悬浮块 |
| 强调态 | `--surface-active` `--border-accent` `--border-accent-soft` | 激活、选中、焦点统一走冷蓝色 |
| CodexMonitor 语义层 | `--cm-surface-panel-*` `--cm-border-*` | 项目自定义的面板层和边框层 |
| 动效 | `--ds-dur-fast` `--ds-dur-normal` `--ds-dur-slow` | 全局 120ms / 160ms / 220ms 左右 |

### 颜色取向

- 深色主题主背景不是纯黑，而是 `深灰蓝 + 低透明`
- 激活色是浅蓝、冰蓝，不用高饱和霓虹
- 成功态偏青绿，警告偏橙，错误偏淡红
- Light 主题也保留同样的结构关系，只是把半透明深色面板换成浅色磨砂面板

### 字体与字号

- UI 字体：系统字体栈
- 代码字体：`ui-monospace / Cascadia Mono / Menlo / Consolas`
- 代码字号默认 `11px`
- 大标题偏克制，不追求夸张展示感

### 圆角、边框、阴影

- 主卡片和消息块常用 `14px ~ 20px` 圆角
- 胶囊按钮和状态标签用 `999px`
- 边框普遍是 `1px` 低对比描边
- 阴影很轻，更多依赖半透明表面和描边来建立层次
- 很多区域只做 `inset` 高光，不做重阴影

### 动效风格

- 普通 hover / active 很短，约 `120ms ~ 180ms`
- popover / modal 有轻微上浮和淡入
- loading 常见旋转和 shimmer，不做大范围炫动画
- 整体偏“稳”，不是营销页那种强动效

## 布局骨架

### 桌面布局

主要参考：

- `src/styles/base.css`
- `src/styles/main.css`
- `src/features/layout/components/DesktopLayout.tsx`

桌面端是标准三段式工作台：

1. 左侧项目栏：默认约 `280px`，可拖拽调整宽度。
2. 中间主工作区：顶部栏 + 消息区/差异视图 + 底部输入区。
3. 右侧功能面板：默认约 `230px`，承载 Git 面板和 Plan 面板，也可拖拽。

关键特征：

- 顶部栏固定吸顶，带轻微毛玻璃感
- 中间对话列最大宽度约 `900px`
- 输入区固定在底部，以覆盖层方式压在消息区上面
- 聊天区和 Diff Viewer 支持左右分栏切换
- 左栏、右栏、聊天/Diff 分隔条都可拖拽

### 平板布局

主要参考：

- `src/features/layout/components/TabletLayout.tsx`
- `src/styles/compact-tablet.css`

平板端变成：

1. 最左窄导航栏，约 `72px`
2. 中间项目栏
3. 右侧主内容区

特点：

- 保留工作台感
- 右侧独立 Git/Log 区还在
- 顶栏、消息区、输入区整体更紧凑

### 手机布局

主要参考：

- `src/features/layout/components/PhoneLayout.tsx`
- `src/styles/compact-phone.css`
- `src/styles/tabbar.css`

手机端改成底部 tab：

- `home`
- `projects`
- `codex`
- `git`
- `log`

特点：

- 右侧面板消失，改为独立 tab
- 输入框聚焦时，底部 tabbar 自动收起
- safe area 处理完整
- Git 列表和 Git 详情拆成两层

## 主要界面模块

### 1. 左侧项目栏 Sidebar

主要参考：

- `src/features/app/components/Sidebar.tsx`
- `src/features/app/components/SidebarHeader.tsx`
- `src/features/app/components/WorkspaceCard.tsx`
- `src/features/app/components/WorktreeCard.tsx`
- `src/features/app/components/SidebarBottomRail.tsx`
- `src/styles/sidebar.css`

#### 结构

- 顶部：项目标题、添加项目、排序、刷新、搜索
- 中段：项目组、项目卡片、工作树、会话列表、已固定会话
- 底部：Usage、Account、Settings、Debug

#### 视觉语言

- 背景是独立侧栏表面，不与主内容混在一起
- 项目卡片不是硬卡片，而是“透明容器 + before 伪元素面板”
- 当前激活项目是淡蓝高亮面板
- 会话行比项目卡片更轻、更紧凑
- 状态点很关键：处理中、审查中、未读、完成态都靠颜色区分
- 子 Agent 会用 pill 标签、角色标签、上下文标签
- 底部 Usage 面板是细条形进度，不是大图表

#### 迁移要求

- 保留“项目卡片 > 会话条目”的两级密度差
- 项目卡片更像面板，会话条目更像列表项
- 不要把左栏做成传统树组件样式
- 连接状态、Provider、活跃状态都用轻量 badge 表达

### 2. 顶部栏 Main Topbar

主要参考：

- `src/features/app/components/MainTopbar.tsx`
- `src/styles/main.css`

#### 结构

- 左侧：项目名、分支、Provider、返回/切换信息
- 右侧：打开外部应用、复制、切换视图、其他快捷操作

#### 样式特征

- 高度较低，约 `44px`
- 吸顶
- 有毛玻璃和轻模糊
- 操作按钮多为 `8px ~ 10px` 内边距的小方形圆角按钮
- 分支选择器是胶囊按钮
- 操作区视觉很收敛，不抢中间内容

### 3. 中间消息区 Messages

主要参考：

- `src/styles/messages.css`
- `src/features/messages/components/Messages.tsx`

#### 布局

- 整体滚动
- 消息内容居中，最大宽度约 `900px`
- 顶部与吸顶栏重叠处理过
- 底部预留输入框覆盖高度

#### 消息样式

- 用户消息：右对齐，较短，蓝色激活底
- 助手消息：全宽卡片化，更像内容容器
- assistant 消息不是细长气泡，而是大圆角信息块
- 工具输出、文件变更、计划、review 等也走统一卡片风格

#### 关键细节

- hover 时出现复制、引用按钮
- working 状态是胶囊条 + spinner + shimmer 文本
- 图片附件是小缩略图，可点击放大
- 表格、代码、卡片都在一个统一暗色语义下

#### 迁移要求

- 用户与助手消息不能只靠左右位置区分，必须同时区分表面层级
- 助手消息要更“块状”、更像工作记录面板
- 工具输出不要用默认 alert，要统一为内容卡片

### 4. 底部输入区 Composer

主要参考：

- `src/features/composer/components/Composer.tsx`
- `src/styles/composer.css`

#### 结构

- 队列提示区
- follow-up 提示区
- context action 按钮组
- 输入主面板
- 图片附件
- 录音/字典输入波形反馈
- 模型、权限、协作模式等 meta bar

#### 样式特征

- 整体像一个贴底悬浮工作条
- 背景使用独立表面和模糊
- 文本输入容器是大圆角 `20px`
- 附件、上下文操作、模式选择都偏胶囊化
- 麦克风、发送、附加文件等操作是圆形按钮

#### 迁移要求

- 输入区一定要和消息区分层
- 不要做成普通 textarea + 蓝按钮
- 所有输入附属能力都应该贴着输入框表面长出来

### 5. 右侧 Git 面板

主要参考：

- `src/features/git/components/GitDiffPanel.tsx`
- `src/styles/diff.css`
- `src/styles/panel-tabs.css`
- `src/styles/ds-panel.css`

#### 结构

- 顶部模式切换 tab
- 分支/远端/统计概览
- commit message 输入区
- staged / unstaged 文件列表
- log / issue / PR 等模式切换

#### 样式特征

- 右栏不是大卡片堆叠，而是轻面板容器
- tab 是很小的胶囊切换器
- 列表项是紧凑文件行，适合高密度浏览
- commit 输入、分支选择都延续主界面的圆角面板语言

#### 迁移要求

- 如果目标项目没有 Git 功能，也建议保留右侧“辅助操作面板”的视觉结构
- 右栏风格要比中间聊天区更克制、更工具化

### 6. 首页 Home / 项目首页 Workspace Home

主要参考：

- `src/styles/home.css`
- `src/styles/workspace-home.css`

#### 首页 Home

- 内容居中，宽度控制在 `720px` 左右
- 大标题 + 简短副标题
- usage 卡片采用带轻微冷色渐变的面板
- 图表卡片和指标卡片延续半透明卡片风格

#### 项目首页 Workspace Home

- 比 Home 更偏“项目上下文入口”
- 项目图标、项目名、路径、Git 提示条
- 内嵌一个更大的 composer
- Agent 配置、最近运行记录等使用卡片栅格

#### 迁移要求

- 空态/首页不要做成纯文案页
- 应该像“可开始工作”的控制台首页

### 7. 设置、弹窗、浮层

主要参考：

- `src/styles/settings.css`
- `src/styles/ds-modal.css`
- `src/styles/ds-popover.css`

#### 设置页

- 类似桌面应用设置窗口
- 左侧导航 + 右侧详情
- 大面板、清晰分区、表单控件较克制

#### Modal

- 背景遮罩带模糊
- 卡片居中弹出
- 圆角大约 `18px`
- 输入框统一圆角 `10px`

#### Popover

- 小而轻，圆角约 `10px`
- 上浮淡入
- hover 态只做轻背景变化

#### 迁移要求

- 弹层不要变成网页式重阴影白盒子
- 要延续主界面的磨砂和低对比边框

## 可直接复用的视觉规则

如果你要让另一个项目快速“长得像 CodexMonitor”，优先保留下面这些规则：

1. 主布局采用“左栏 + 中间主工作区 + 右侧辅助面板”。
2. 主色走冷蓝，不走紫色，不走鲜艳渐变营销风。
3. 表面层级至少分成：侧栏、顶栏、消息区、输入区、右栏、卡片层。
4. 卡片和输入容器必须是大圆角、低对比边框、半透明表面。
5. 会话条目、列表项、按钮都要紧凑，避免松散留白。
6. 用户消息与系统/助手消息必须有明显层级差异。
7. 底部输入区必须是悬浮工作条，不要退化成普通表单。
8. 弹窗、popover、下拉菜单都沿用同一套表面和动效语言。
9. 平板和手机不是简单缩放，而是要重排成窄导航或底部 tab。
10. 整体要像“桌面 AI 工作台”，不是“通用后台管理系统”。

## 给 AI coding 工具的样式替换提示词

下面这段可以直接给 AI coding 工具使用，再结合目标项目页面结构微调：

```text
请把当前项目的前端 UI 重做为 CodexMonitor 风格，要求如下：

1. 整体视觉是桌面级 AI 工作台，不是普通后台。
2. 主视觉采用深色半透明分层面板，支持冷蓝色激活态，避免紫色主色。
3. 页面结构优先改造成“左侧项目栏 + 中间主工作区 + 右侧辅助面板”。
4. 所有核心容器统一使用大圆角、低对比 1px 描边、轻毛玻璃或半透明表面。
5. 顶部栏高度较低且吸顶，按钮使用小尺寸圆角图标按钮，分支/模式切换使用胶囊控件。
6. 中间消息区或主内容区保持较高信息密度，内容列宽不要过宽，建议控制在 860px 到 900px。
7. 输入区必须设计成贴底悬浮工作条，输入容器为大圆角面板，附件、模式、发送等动作嵌入其中。
8. 左侧列表中的项目卡片要比普通列表项更厚重，会话条目更轻、更紧凑，并保留状态点、标签、badge。
9. 右侧面板偏工具化，适合放 Git、日志、检查项、辅助操作，不要做得像营销卡片。
10. 手机端改为底部 tab 导航，输入框聚焦时可自动隐藏 tabbar。
11. 动效保持克制，hover/active 以 120ms 到 180ms 为主，popover 和 modal 只做轻微上浮淡入。
12. 优先抽出主题变量：文本、表面、边框、激活态、状态色、圆角、阴影、动效时长。

视觉关键词：
深色、冷蓝、半透明、磨砂、桌面应用、工作台、紧凑、专业、低噪音、强结构感。

不要做成：
白底后台、紫色 AI 风、重投影卡片、过大留白、营销页式大渐变。
```

## 建议的迁移顺序

如果要把另一个项目改成当前风格，建议按下面顺序做：

1. 先抽主题变量和全局表面层级。
2. 再改主布局骨架。
3. 再改左栏、顶栏、主内容区、右栏。
4. 再改输入区、弹窗、popover、tab。
5. 最后补移动端和平板端重排。

## 参考文件清单

- `src/styles/base.css`
- `src/styles/ds-tokens.css`
- `src/styles/main.css`
- `src/styles/sidebar.css`
- `src/styles/messages.css`
- `src/styles/composer.css`
- `src/styles/diff.css`
- `src/styles/panel-tabs.css`
- `src/styles/home.css`
- `src/styles/workspace-home.css`
- `src/styles/settings.css`
- `src/styles/compact-base.css`
- `src/styles/compact-phone.css`
- `src/styles/compact-tablet.css`
- `src/styles/tabbar.css`
- `src/styles/ds-modal.css`
- `src/styles/ds-popover.css`
- `src/features/layout/components/DesktopLayout.tsx`
- `src/features/layout/components/TabletLayout.tsx`
- `src/features/layout/components/PhoneLayout.tsx`
- `src/features/app/components/Sidebar.tsx`
- `src/features/app/components/MainTopbar.tsx`
- `src/features/composer/components/Composer.tsx`
- `src/features/git/components/GitDiffPanel.tsx`
