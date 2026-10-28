# Pi English Companion

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Pi](https://img.shields.io/badge/Pi-%E2%89%A51.4-6f42c1)](https://pi.dev)
[![Node](https://img.shields.io/badge/Node-%E2%89%A524%20for%20development-339933)](https://nodejs.org)

在 [Pi Coding Agent](https://pi.dev) 里顺手练英语。你照常用中文、英文或中英混合和 Pi 对话，它在输入框上方用 2–4 行显示更自然的英文表达和简短中文解析。消息照常发送，输入框不被接管，工作流不被打断。

> Pi English Companion is a context-aware English learning extension for the Pi coding agent. It rewrites your latest Chinese, English, or mixed-language message into natural English and shows a short Chinese learning note in a 2–4 line widget above the editor. `raw` mode never delays the agent, and code, commands, and attachments are preserved.

## 为什么

和 AI 协作时，注意力应该留在问题上。大多数英语学习工具要求你切换窗口、复制粘贴或停下来做练习；这个扩展把学习放进你已经要发送的消息里，用最少的视觉和操作成本提供即时反馈。

产品原则只有一条：**保持 Pi 原生交互，让英语学习自然发生。** 不替换编辑器，不增加发送按钮，不在发送前弹确认框，也不为了展示而固定占用四行终端空间。

## 功能

- 中文输入生成自然、语义忠实的英文
- 英文输入纠正语法、拼写、搭配和不自然表达；已经准确的句子保持原样
- 中英混合输入统一成一句自然英文，保留 API 名称、标识符和术语
- 参考当前会话最近的消息，理解代词、省略和技术术语
- 默认 `raw` 模式：原文立即发给 Agent，语言处理在旁路异步完成
- 可切换 `en` 模式：等待处理完成，把英文发给 Agent
- 独立模型与思考强度，不影响主 Agent
- 代码块、行内代码、Shell 命令和结构化数据不会被强行改写
- 2–4 行动态 Widget，遵循当前 Pi 主题，终端变窄时自动重排

## 效果

中文输入：

```text
你输入：帮我把这个函数改成异步的。

 EN   Could you make this function asynchronous?
 解析 Could you（礼貌请求）/ make ... asynchronous（使……变为异步）
```

英文纠错：

```text
你输入：Can you helps me to fix this bug?

 EN   Can you help me fix this bug?
 解析 helps → help（情态动词后用原形）/ help me fix（自然搭配）
```

`raw` 模式下 Agent 收到的仍然是你的原文；`en` 模式下 Agent 收到的是上面 `EN` 行里的英文。两种模式的面板内容相同。

## 环境要求

- **Pi 1.4** 或更新版本。项目在 Pi 1.4.0 上开发和验证。
- 至少一个已经配置好凭据、可用的模型（用 `/model` 或 `/login` 配置）。
- 交互式 TUI 才能看到 Widget 和设置界面。RPC、JSON、print 模式下语言处理仍可工作，但没有面板。
- 仅在本地开发时需要 Node.js 24+；通过 Pi 安装使用时不需要单独运行 Node。

## 安装

### 从 GitHub 安装

```bash
pi install git:github.com/opentokenz/pi-english-companion
```

### 从本地目录安装

```bash
git clone https://github.com/opentokenz/pi-english-companion.git
cd pi-english-companion
pi install "$(pwd)"
```

### 不安装，直接试用

```bash
cd pi-english-companion
pi -e ./src/index.ts
```

发布到 npm 之后也可以使用 `pi install npm:pi-english-companion`。安装或移除后可以用 `pi list` 检查当前配置。扩展代码需要重新加载 Pi 才会生效。

## 快速开始

1. 安装扩展并启动 Pi。
2. 运行 `/english` 打开设置，确认启用状态和发送模式。
3. 运行 `/english model`，选择模型和思考强度；默认的 `auto` 会跟随 Pi 当前模型。
4. 正常发送消息。输入框上方会出现 `EN` 和 `解析` 两行。

如果只想先看看效果，保持默认的 `raw` 模式即可：原文立即发给 Agent，不会因为翻译而变慢。

## 命令

| 命令 | 功能 |
| --- | --- |
| `/english` | 打开全局设置界面（TUI） |
| `/english on` | 开启插件 |
| `/english off` | 关闭插件并隐藏 Widget |
| `/english send raw` | 发送原始消息 |
| `/english send en` | 发送处理后的英文 |
| `/english model` | 选择模型及思考强度 |
| `/english context 4` | 设置上下文条数（0–10） |

- `/english model` 同时设置 Model 和 Thinking Level，没有单独的 thinking 命令。
- 插件命令由 Pi 的命令系统处理，不会转发给 Agent。
- 命令参数支持补全，例如 `/english send ` 会提示 `raw` 和 `en`。
- 在非 TUI 模式下，`/english` 和 `/english model` 会输出当前配置摘要；`on`、`off`、`send`、`context` 仍然可用。

## 发送模式

| 模式 | 行为 |
| --- | --- |
| `raw`（默认） | 原文立即发给 Agent；翻译、纠错和解析异步进行，不增加 Agent 等待时间 |
| `en` | 先完成语言处理，再把处理后的英文发给 Agent；失败或超时自动改发原文 |

`en` 模式按提交顺序串行处理，不会重复发送，也不会因为并发而丢失消息。模式是全局配置，修改后从下一条消息生效。语言处理失败时不会询问你如何选择，而是直接发送原文并给出简短提示。

## Widget 布局

Widget 位于原生输入框正上方，由 Pi 的 Widget 区域渲染，不接管输入、光标、键盘事件或输入历史。

- 默认 2 行，内容变长时最多扩展到 4 行，不预留空白行
- 英文最多 3 行，解析最多 2 行，超出用省略号截断
- 根据终端实际宽度换行；终端过窄时自动隐藏 `EN` / `解析` 标签
- 优先保证英文完整，再分配解析空间
- 解析优先展示最有价值的 1–3 个知识点
- 处理中显示两行轻量状态；失败时短暂显示一行警告，然后恢复上一次成功结果
- 切换会话、fork、分支跳转或关闭插件时清除面板

推荐的行数分配：

| 总行数 | 英文 | 解析 |
| --- | --- | --- |
| 2 | 1 | 1 |
| 3 | 2 | 1 |
| 3（另一种） | 1 | 2 |
| 4 | 3 | 1 |
| 4（另一种） | 2 | 2 |

## 输入处理

- **中文**：翻译成自然、语义忠实的英文，保留原意、语气和请求。
- **英文**：纠正语法、拼写、搭配和不自然表达；已经准确自然的句子保持不变，但仍给出学习要点。
- **中英混合**：统一成一句自然英文，保留 API 名称、代码标识符、路径和技术术语。
- **代码保护**：围栏代码块、行内代码和明显未加围栏的代码行会替换成 `{{code:N}}` 占位符。模型必须原样保留占位符，处理完成后按原样还原；如果模型丢失或篡改占位符，本次处理按失败处理并发送原文。
- **默认跳过**：`/` 命令、`!` Shell 前缀、纯代码、JSON / HTML、Markdown 表格、diff、YAML frontmatter、日志和堆栈跟踪，以及 `npm install`、`git rebase` 这类 Shell 命令。混合消息中的自然语言部分仍会处理。
- **输入长度**：消息超过 `maxInputChars`（默认 4000 字符）时跳过语言处理，消息照常发送；设为 `0` 表示不限制。这个检查在调用模型之前完成，不会消耗模型额度。
- **附件**：`en` 模式改写文本时会保留原始附件；纯附件消息不做语言处理。

上下文只取当前分支最近 `contextMessages` 条用户/助手文本消息，并限制在约 1200 token 的预算内；超出时从较旧的消息开始丢弃。不会擅自添加你未提出的功能要求、约束或技术决策。

## 模型与思考强度

- 默认模型 `auto`：跟随 Pi 当前会话模型；如果没有会话模型，使用第一个可用模型。
- 也可以固定为某个 `provider/model-id`。配置的模型不可用时会临时回退到 Auto，并提示一次。
- 默认思考强度 `low`。可选项来自模型自身支持的档位（`off` 到 `max`），不支持的档位会自动收敛到最近的可用档位。
- 这些设置只用于插件的独立模型调用，不读取也不修改主 Agent 的模型设置。
- 插件模型调用有独立的输出上限和 15 秒默认超时，不会无限等待。

## 配置

配置保存在用户级文件 `~/.pi/agent/english-companion.json`，在所有项目和会话之间共享。`PI_CODING_AGENT_DIR` 可以改变 Pi 的 agent 目录，配置文件随之移动。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 是否处理消息 |
| `sendMode` | `raw` | `raw` 或 `en` |
| `model` | `auto` | `auto` 或 `provider/model-id` |
| `thinkingLevel` | `low` | `off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max` |
| `contextMessages` | `4` | 读取最近多少条消息作为上下文，限制 0–10 |
| `englishCorrection` | `true` | 关闭后纯英文消息原样发送、不生成解析 |
| `timeoutMs` | `15000` | 单次语言处理超时，限制 1000–60000 |
| `maxInputChars` | `4000` | 超过该字符数的消息跳过语言处理；`0` 表示不限制 |
| `failurePolicy` | `send-raw` | 失败时发送原文；MVP 只有这一种策略 |
| `maxWidgetLines` | `4` | 面板内部行数上限，通常不需要修改 |

完整示例：

```json
{
  "enabled": true,
  "sendMode": "raw",
  "model": "auto",
  "thinkingLevel": "low",
  "contextMessages": 4,
  "englishCorrection": true,
  "timeoutMs": 15000,
  "maxInputChars": 4000,
  "failurePolicy": "send-raw",
  "maxWidgetLines": 4
}
```

历史配置里的 `sendMode: "original"` 会读成 `raw`，`"translated"` 会读成 `en`。损坏或缺失的配置文件回退到默认值；写入失败会在当前运行中保留新设置并给出提示，不会影响 Pi 启动。

## 如何工作

`raw` 模式：

1. Pi 收到提交，触发扩展的 `input` 事件。
2. 扩展立即返回 `continue`，原文继续发给 Agent。
3. 同时读取最近上下文，调用插件模型生成英文和解析。
4. 结果只更新 Widget，不修改已发送的消息。

`en` 模式：

1. `input` 事件先等待语言处理完成。
2. 扩展返回一条 `transform` 结果，Pi 只发出这一条英文消息。
3. 处理失败、超时或模型输出无效时返回 `continue`，发送原文并提示。
4. 串行队列保证多次快速提交按顺序到达 Agent，不会重复发送。

每次任务带递增序号和会话标识，只有最新任务能更新面板；旧任务不能覆盖新结果。外部扩展注入的消息不会再次处理，避免递归。

### 代码结构

```text
src/
  index.ts         Pi 扩展入口：事件、发送路由、任务调度
  analyze.ts       语言分类、特殊输入跳过、代码占位符
  prompt.ts        系统提示词、请求载荷、JSON 解析
  processor.ts     带超时和取消的单次语言任务
  context.ts       当前分支上下文提取与 token 预算
  diagnostics.ts   失败与慢任务诊断日志（本地 JSONL，不含原文）
  layout.ts        纯函数 2–4 行布局与截断
  panel.ts         Widget 状态与主题渲染
  models.ts        模型解析、思考强度收敛
  model-picker.ts  可搜索的模型列表
  commands.ts      /english 命令与设置界面
  config.ts        配置校验、迁移、持久化
  coordinator.ts   最新任务优先 + 串行队列
```

## 可靠性

- `raw` 模式不等待语言处理，Agent 延迟不受影响。
- `en` 模式每次提交最多产生一条 Agent 用户消息。
- 超时使用硬截止时间并中止底层请求；失败回退发送原文，不丢消息。
- 并发任务不会交叉更新 Widget；旧结果不会覆盖新结果。
- 会话切换、fork、分支跳转和 Pi 退出会中止在途任务并清理面板
- `/english off` 会停止后续处理并隐藏面板，已发出的消息不受影响。
- 未预期的扩展异常也会回退发送原文，避免吞掉用户消息。
- 诊断日志写入失败不会阻塞或改变消息处理。

## 隐私

语言处理会把你当前的消息和最近 `contextMessages` 条上下文发送给插件选择的模型 provider，使用的是 Pi 已配置好的凭据。插件不上传任何数据，也不包含遥测；`/english off` 会停止全部语言请求。

本地会写一份诊断日志（见[故障排查](#故障排查)），只记录错误码、模型、耗时和字符数，不记录消息原文。

## 故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 看不到 Widget | 非 TUI 模式，或插件被关闭 | 在交互式 Pi 中运行；执行 `/english on` |
| 提示“没有可用的模型” | 没有可用凭据 | 用 `/login` 或 `/model` 配置模型，再运行 `/english model` |
| `en` 模式明显变慢 | 该模式本来就要等待语言处理 | 改用 `/english send raw`，或调低 `thinkingLevel` |
| 提示“处理超时”或“处理失败” | 模型或网关慢、上游报错 | 查看诊断日志里的 `code` 与 `error`；必要时调大 `timeoutMs` |
| 配置改了但没生效 | 设置从下一条消息开始生效 | 重新发送消息；必要时重启 Pi |
| 长文没有学习面板 | 超过 `maxInputChars`，按设计跳过 | 调大配置值，或设为 `0` 取消限制 |
| 设置写入失败 | 配置目录不可写 | 检查 `~/.pi/agent` 或 `PI_CODING_AGENT_DIR` 的权限 |
| 英文被截断 | Widget 只显示 2–4 行 | 这是 MVP 的显示限制；完整查看在后续迭代中提供 |
| 代码被改动 | 模型没有保留占位符 | 本次会自动回退发送原文；如仍出现请附示例开 issue |

插件在 `~/.pi/agent/english-companion.log` 追加 JSONL 诊断记录（目录同样受 `PI_CODING_AGENT_DIR` 影响）。失败总是记录，耗时超过 5000 毫秒的成功任务记为 `slow`，这样超时前就能看到趋势。每条记录包含 `time`、`event`、`code`、`model`、`kind`、`elapsedMs`、`timeoutMs`、`chars` 和 `error`；`code` 为 `timeout` / `failed` / `invalid` / `aborted` / `no-model` / `ok`。输入原文不会写入。文件超过 256 KiB 时轮转为 `.1`，只保留一份历史。

## 开发

需要 Node.js 24+。

```bash
git clone https://github.com/opentokenz/pi-english-companion.git
cd pi-english-companion
npm install
npm run typecheck
npm test
```

直接加载本地扩展：

```bash
pi -e ./src/index.ts
```

测试使用 Node 内置测试运行器和 TypeScript 类型擦除，不需要额外构建步骤。覆盖范围包括：

- 输入分类、特殊输入跳过（含日志和堆栈）、代码占位符还原和输入长度限制
- 上下文条数、角色过滤和 token 预算
- 提示词 JSON 解析与容错
- 超时、取消、无效模型输出
- 2–4 行布局、宽字符、emoji、窄终端截断
- 模型列表过滤和配置迁移
- 用假 Pi API 驱动的 `raw` / `en` 端到端路径

## 贡献

欢迎 issue 和 pull request。提交行为改动前，建议先开 issue 说明场景，避免和 MVP 边界冲突。

请保持以下约束：

- 不接管或替换 Pi 原生输入框
- `raw` 模式不能增加 Agent 等待时间
- `en` 模式每次提交最多产生一条用户消息
- 失败时保留用户原文
- 新行为配套测试，提交前运行 `npm run typecheck && npm test`

## Roadmap

当前版本 `0.1.0`，按 PRD v1.2 完成 MVP。后续计划：

- 查看被截断的完整英文和学习解析
- 收藏有价值的英文表达
- 记录常见语法错误
- 按用户水平调整解析深度
- 支持不同的英语表达风格
- 生成周期性英语学习回顾

## License

[MIT](LICENSE) © opentokenz
