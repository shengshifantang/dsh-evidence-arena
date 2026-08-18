# Evidence Arena 技术边界与演进方案

本文区分“当前已经实现”与“后续架构目标”。Arena 的目标不是重新实现一个编码 Agent，而是让 DeepSeek Harness 负责真正的 Agent 执行，让 Arena 负责公平调度、证据固化、评估编排和人工审查。

## 一句话架构

```text
DSH 执行面：会话、Agent loop、工具、压缩、命令/回复事件、Token 计量
                         ↓ 事件与封存工件
Arena 控制/证据面：隔离调度、门禁、评估编排、指标投影、对比 UI、受控采纳
```

这样做有三个直接收益：

1. 复杂工程任务仍由 DSH 已有的开发能力完成，Arena 不维护第二套容易漂移的 Agent loop。
2. Token、模型调用、工具调用和过程日志来自 DSH Session 事件，而不是 Arena 根据文本猜测。
3. Builder、测试 Agent 和 Reviewer 都可以换模型或运行配方，但任务基线、工件哈希和评估契约保持不变。

## 当前已经实现

### 1. DSH 原生 Builder 执行

每个候选都启动独立 DSH SDK 子会话，使用独立 Git worktree、模型路由、凭据引用、Session JSONL 和 Harness 工具链。Arena 只传入同一份任务和不可变共享上下文，不直接替代 DSH 的生成逻辑。

对齐官方 `0.1.0-rc.7` 后，Builder 运行配方显式组合 Agent spine、sandboxed shell/文件系统、glob/grep、结构化替换、后台 job、Skill、todo、压缩/工具结果裁剪与进程内子 Agent。这些都是 DSH 组件，Arena 只是按运行角色组合：Builder 拥有工程工具，Reviewer 始终无工具。

一个 SDK 子会话是新的 Harness 进程，它不会自动继承正在运行的 Web profile 中所有任意插件。Arena 因此把工具组合固化为可记录、可重放的运行配方，并只自动发现候选 worktree 内的 `.dsh/skills` 与 `.agents/skills`。每个子会话使用空的 Arena 私有 `DSH_HOME`，避免当前 Host profile 中的凭据文件被模型 shell 定位。若无条件地继承用户当前全部插件或用户级 Skill，两个候选可能加载不同状态、暴露本地配置或产生外部副作用，反而破坏隔离和公平性。后续若支持用户级扩展，应做成显式勾选、版本锁定、运行前展示的 allowlist 配方，而不是默认继承。

### 2. 事件驱动计量

Arena 从 DSH 的 `session.event` / `assistant` usage 事件折叠出模型调用、工具调用、输入/输出/推理/缓存 Token 和近期活动。大过程日志保留在子 Session，浏览器只显示有界投影。

### 3. 封存工件与确定性门禁

Builder 完成后，Arena 固化 tracked patch、普通未跟踪文件、文件清单和 SHA-256。项目命令、`git diff --check`、路径/密钥/二进制规则都针对同一封存候选执行。

### 4. Reviewer 输出失败不再伪装成代码否决

原生 DeepSeek Reviewer 默认关闭扩展思考，把有界输出预算留给结构化结论。首轮如果仍用尽输出预算或没有返回合法 JSON，Arena 会启动新的审计 Session，重放同一份封存证据，并执行一次有界的“只输出结论 JSON”修复轮次。这样不依赖一个以 `max-tokens` 结束的旧 Session 能否跨子进程继续。仍失败时状态为 `unavailable`：继续失败关闭，但 UI 明确说明“评估没有完成”，而不是显示“Reviewer 明确否决代码”。两轮 Token 和模型调用会合并计量。

### 5. 显式候选预览

每个有封存证据的候选都有折叠的“运行候选结果”入口。只有用户勾选确认后，Host 才会：

1. 从不可变基线创建一次性 worktree；
2. 应用与工件哈希绑定的精确候选；
3. 优先启动 `dist/build/out` 静态产物，否则尝试已有的 `npm run preview/dev/start`；
4. 只公布 `127.0.0.1` 链接、启动配方和有界日志；
5. 停止时终止完整进程树并移除一次性 worktree。

Arena 不自动安装依赖。当前沙箱约束文件写入，但不隔离网络和全部宿主只读访问，因此预览是显式人工操作。人工浏览结果不会悄悄改变自动准确率或胜负。

预览真正通过回环就绪探针后，用户还可以保存“通过 / 未通过 / 无法判断”和最多 2000 字备注。记录绑定封存工件哈希与预览就绪时间，作为独立 state event 持久化并进入便携报告；Host 重启后仍可审计。它是人工证据，不会修改确定性门禁、Reviewer 结论或机械领先者。若 Host 已重启而用户要修改结论，需要重新启动同一候选并测试，不能凭旧 URL 直接改写。

### 6. 不增加模型调用的对比摘要

运行页会从已有证据直接计算最快 Builder、最低 Token、最小改动、门禁通过数和机械领先者。它不引入新的打分模型，也不把“代码更少”或“速度更快”伪装成质量更高；摘要明确说明单次任务通过不等于统计准确率。

### 7. 跨层 DSH SDK 回归

测试套件不仅分别 mock Arena 与 Runtime，还包含完整 SDK E2E：真实启动 DSH JSON-RPC 子进程和 Agent loop，让 Builder 通过 Harness 工具修改 worktree，随后走封存、项目门禁、两个零工具 Reviewer、Session JSONL/Token 投影、候选网页启动和最终采纳。测试模型端使用脚本化回环服务，避免把网络与付费模型波动混入回归门禁。

### 8. 隐私有界的便携评估报告

终态运行可从 trusted-read 通道下载版本化 JSON 报告。报告由 Host 按字段白名单重新投影，不会直接序列化 durable state：仓库/worktree 绝对路径、凭据引用、子 Session ID、原始 JSONL、Builder/Reviewer 原始回复、错误文本、命令参数与输出、完整 patch/Diff 均被排除。保留的任务、Reviewer 摘要和 finding 文本还会进行常见密钥/路径模式脱敏与长度限制，并记录脱敏/截断次数。

报告保留运行与 policy 哈希、预算、DSH 计量、候选身份、工件哈希、相对文件清单、门禁元数据、结构化 Reviewer 结论、机械领先者和采纳证明。它适合代码评审附件或实验归档，但不是“绝对无秘密”证明；自由文本在对外发布前仍需人工检查，完整证据继续留在本机内容库中。

### 9. Web 优先的项目与凭据接入

Arena 不维护第二套工作区目录或密钥文件。浏览器端复用 DSH 官方能力：

- **现有项目：** 调用 Harness 目录选择器，再通过 Workspace 服务注册；Arena Host 仍只接收 `workspaceId`，真实路径由官方 Registry 解析。
- **演示项目：** 只有用户点击后，Arena Host 才在自己的状态目录下创建一个有界 CommonJS 示例，写入测试与 policy，并生成干净 Git 提交；浏览器随后用官方 Workspace 服务注册它。
- **模型凭据：** Setup 只为缺失且可写的凭据引用显示密码输入框，值通过 Harness `credentials.set` 写入。Arena RPC、policy、durable state、日志和 React 状态在保存刷新后都不保留值。
- **开始前预检：** 每次点击开始都会重新读取预检。若仓库、凭据或 policy 有阻断，工作台自动切换到 Setup 并明确提示，不发起模型调用。

这让普通使用路径留在一个 Web 工作台中，同时保留“官方服务负责身份与秘密、Arena 只负责调度”的插件边界。命令行仍用于首次安装插件和高级故障恢复，不再是创建测试空间或配置密钥的必经步骤。

## 为什么不在运行中替换用户的全局 DSH 插件

直接热切换用户 profile 会带来三个问题：会污染正在使用的 DSH、难以重放当时到底加载了什么、不同插件之间可能出现顺序和状态冲突。

更合理的方式是“运行级配方”：Arena 为 Builder、Test Agent、Logic Reviewer、Security Reviewer 分别启动新的 DSH 子会话，并为每个会话记录明确的 provider/model/tool policy/system prompt 版本。它们共享封存工件标识，但不修改用户全局 profile。

## 下一阶段：DSH Test Agent（尚未实现）

当前 Reviewer 使用有界工件包，适合中小改动；对大型仓库或长 Diff，它不是最终形态。下一阶段应新增一个专门的 DSH Test Agent：

| 项目 | 设计 |
|---|---|
| 工作区 | 从封存候选重新物化的只读/受限一次性 worktree |
| 输入 | 原任务、项目 policy、确定性门禁结果、工件哈希；不内嵌整个长 Diff |
| 工具 | 只读搜索/文件工具，加 Host 控制的测试、预览与浏览器检查工具；默认不允许修改候选 |
| 会话 | 独立 DSH Session，保留命令、回复、工具轨迹和 Token usage |
| 输出 | 小型结构化 verdict；长测试日志、截图、coverage、trace 只保存为工件引用 |
| 恢复 | 每个测试阶段单独检查点，可在 Host 重启后继续或只重试失败节点 |

通用性来自“评估适配器”，不是硬编码某个前端框架：

```ts
interface EvaluationAdapter {
  detect(worktree: string): Promise<Detection>
  deterministicGates(): readonly CommandGate[]
  testAgentRecipe(): DshRunRecipe | undefined
  previewRecipe(): PreviewRecipe | undefined
  normalizeEvidence(): Promise<EvaluationEvidence>
}
```

内置适配器只负责常见静态站点和 package scripts；项目可以通过 policy 声明自己的测试/启动命令。后续语言或框架插件只需增加适配器，不需要重写 Arena 调度器。

## 合理的评估流水线

1. **机械门禁：** 编译、lint、项目测试、隐藏断言、patch 完整性；可复现，权重最高。
2. **DSH Test Agent：** 根据任务生成/选择额外测试，运行并记录完整 Session 证据。Agent 结论不能覆盖机械失败。
3. **逻辑 Reviewer：** 检查需求覆盖、边界条件、回归和测试充分性。
4. **安全 Reviewer：** 在逻辑评估可用后检查权限、输入、路径、密钥和依赖边界。
5. **人工 UAT：** 用户分别打开候选链接验证交互；当前已支持把工件绑定的显式反馈持久化，不自动改写机器分数。

“准确率”不能由一个 Reviewer 的一句话产生。单任务应展示各节点证据；模型级准确率必须来自固定任务集、相同基线、隐藏测试或人工金标准，并至少报告通过率、失败类型、时间分布和 Token 分布。

## 长任务与长输出

当前 v4 已有 Builder/工件/决策检查点、事件日志和 Host 重启恢复，但仍有整次运行 deadline 和 Reviewer 输入上限。面向小时级任务需要继续实现：

- 将 deadline、Token、模型调用和停滞阈值拆成可配置预算；用 heartbeat 区分“仍在思考”与“进程失联”。
- 每个 Builder/Test/Review 节点独立恢复，不因一个节点失败重跑所有已经封存的节点。
- 只增量折叠 DSH JSONL；不把完整会话和大 Diff 常驻内存或 RPC。
- 长日志、coverage、截图、trace 和报告写入内容寻址工件库；状态只保存 hash、大小、类型、摘要和分页索引。
- 浏览器按需加载文件、日志页和报告段；当前便携报告只导出有界摘要，后续完整证据包应采用显式授权、内容寻址和分段下载，而不是把数十万字符塞进一张卡片。
- verdict 永远保持小且严格；模型自由分析与最终结构化结论分离，最终结论允许一次有界修复。

## 从优秀 DSH 插件吸收的边界原则

- [Awesome DSH Plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的收录边界强调可安装、描述清晰、来源可查；topic 星数本身不是质量证明。
- [dsh-auto-review](https://github.com/PerryLink/dsh-auto-review) 的可借鉴点是只读第二模型、结构化 verdict、失败关闭、Session 日志审计和真实 headless DSH eval；Arena 应复用这些 DSH seam，而不是复制聊天逻辑。
- [Ouroboros](https://github.com/Q00/ouroboros) 的可借鉴点是事件账本、检查点和机械→语义→多模型的分层评估；Arena 只吸收长任务思想，不扩张成跨运行时平台。

因此 Arena 的长期产品边界应保持为：**可安装的 DSH 原生评估/调度插件**，而不是 IDE、通用 Agent 框架、部署平台或新的聊天客户端。
