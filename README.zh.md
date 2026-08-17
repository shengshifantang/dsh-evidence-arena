# dsh-evidence-arena

[English](README.md) | 中文

Evidence Arena 是一个**独立于对话 Session 的多模型开发对比工作台**。它让两个或三个 Builder 在隔离的 Git worktree 与独立 DSH 子运行时中完成同一个任务，再用可复现门禁、独立 Reviewer 和逐文件 Diff 审查结果。人工确认后，它才会把被选中的精确改动写回原工作区。

![Evidence Arena 配置与预检工作台](docs/images/evidence-arena-setup.png)

## 当前交付状态

| 问题 | 当前答案 |
|---|---|
| 是否需要修改官方 DSH Host、命令、Session 或聊天 UI 源码？ | **不需要。** 插件只使用官方插件清单、Host RPC、Workspace Registry、`sidebar.footer.action` 和 `shell.overlay` 插槽。 |
| 安装后从哪里进入？ | DSH 左侧栏底部的 **A/B** 按钮。Arena 不再注册 `/arena` 斜杠命令。 |
| 新建对话会不会自动弹出预检警告？ | **不会。** 配置与预检只有在用户打开 Arena 并点击对应页签后才读取。 |
| 能否查看候选的实际代码？ | **可以。** 选择候选和文件后，按需展示带新旧行号的封存统一 Diff；不是只显示“改了几行”。 |
| 能否直接比较两个模型？ | **可以。** 每个 contender 可配置独立 provider、model、凭据引用、系统提示词和部署身份。 |
| 能否给出速度、Token、代码量和准确性结论？ | 显示墙钟时间、provider 上报 Token、调用数、工具数、文件数、增删行、patch 大小和门禁结果。单次运行的“准确性”由项目测试与 Reviewer 判定；统计准确率需要多任务基准集。 |
| 是否已发布到公共 npm？ | **尚未。** 独立包名已经确定为 `dsh-evidence-arena`，当前可以分发构建好的 `.tgz`；只有首次成功发布后，公共 npm 包名才算真正被占用。 |

这是由社区独立维护的项目，正式源码仓库为
[`shengshifantang/dsh-evidence-arena`](https://github.com/shengshifantang/dsh-evidence-arena)。
[`shengshifantang/deepseek-harness`](https://github.com/shengshifantang/deepseek-harness)
Fork 只作为上游兼容性实验场，不再承担本插件的发布仓库职责。

## 为什么它现在是真正的外置插件

Arena 的宿主集成只有两面：

1. Host 面通过包内 `cordis.patch.yml` 插入 `arena` 服务，使用官方 Workspace Registry 把浏览器传来的 `workspaceId` 解析为可信本地路径。
2. Browser 面只挂载官方现有插槽：侧栏入口和全局 overlay 工作台。它不读取聊天输入框，不创建 Session 命令，也不要求修改对话渲染逻辑。

发布包不会复制整套官方 DSH 运行时。现有 Web 安装已经提供的组件被声明为 Host peer，并由 DSH 的 profile module fallback 解析；只有官方 Web 闭包中实际缺少的五个 SDK/子 Agent 启动包作为普通依赖随 Arena 安装。这样既能启动独立子运行时，也能避免重复 Cordis、`node-pty`、`koffi` 等原生运行时分支。这五个预发布包被精确锁定为 `0.1.0-rc.6`，避免官方某次只发布了一部分组件时，包管理器悄悄替换子运行时闭包中的一部分。

这意味着兼容边界也很明确：Arena 应与构建它的 DSH 发布系列配套使用；跨版本升级要重新执行安装与浏览器 smoke，而不能假设私有接口永久稳定。

### 已验证兼容性快照——2026-08-17

- 独立仓库在 macOS 上通过 Host/Browser 两套 TypeScript 检查、16 个测试文件共 64 个用例、Host ESM 构建、浏览器加载器构建和发布包闭包校验。
- `0.1.0` tarball 已安装进由官方干净提交 [`47f943859b`](https://github.com/deepseek-ai/deepseek-harness/commit/47f943859b) 构建的全新 profile，安装以 0 退出；该 CLI 标识为 `@deepseek-ai/dsh@0.1.0-rc.5`。配置组合出现 `id: arena`，Web 启动返回 HTTP 200，启动清单与客户端 bundle 都包含 `dsh-evidence-arena`，左侧 A/B 入口可以打开双页签工作台，浏览器控制台无错误。
- 这次干净 profile smoke 有意没有配置模型密钥，因此它证明的是安装、Host 组合、RPC/客户端加载和 UI 渲染。要对某条具体模型路由宣称完整端到端验收，仍需再跑一次真实 provider 对比与采纳。
- 同日也尝试了从公共 registry 全新安装 `@deepseek-ai/dsh@0.1.0-rc.6`。官方浮动依赖会选入部分 `rc.7` 包，但 `@deepseek-ai/dsh-tools@^0.1.0-rc.7` 尚不可用，导致上游安装被阻断。这不是 Arena 的失败，但当前无法用“刚从 npm 安装的官方 CLI”作为 smoke 宿主；官方发布状态恢复后应重新验证并删除这条临时说明。

## 普通用户安装

首次发布 npm 之前，安装本地构建或 GitHub Release 提供的 tarball：

```bash
dsh plugin --profile web add \
  /absolute/path/to/dsh-evidence-arena-0.1.0.tgz
```

发布到公共 npm 后，普通用户只需要：

```bash
dsh plugin --profile web add dsh-evidence-arena@latest
```

当前 DSH profile 把官方依赖放在包管理器看不到的 Host fallback 中，因此 pnpm 可能打印一条笼统的 `Issues with peer dependencies found`。这不是原生构建失败：本包的验收标准是安装命令以 0 退出、没有 ignored-build 列表，并且紧接着能成功启动 DSH。若启动失败，不能忽略错误或把警告当成功。

然后从一个 Git 仓库启动官方 DSH：

```bash
cd /absolute/path/to/target-repository
export DEEPSEEK_API_KEY='<your-key>'
dsh --profile web --host 127.0.0.1 --port 4188
```

打开 `http://127.0.0.1:4188`，在官方 DSH 中添加或选择目标工作区，再点击左侧栏底部的 **A/B** 按钮。

本插件有意不使用 `@deepseek-ai` 命名空间，也不得对外表述为 DeepSeek 官方发布。

### 从本仓库构建 tarball

开发者需要仓库支持的 Node.js（`^22.19.0` 或 `>=24.0.0`）、Git 和 pnpm：

```bash
git clone https://github.com/shengshifantang/dsh-evidence-arena.git
cd dsh-evidence-arena
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm pack --pack-destination ./dist
```

将 `dist/dsh-evidence-arena-*.tgz` 交给用户即可。用户侧不需要 deepseek-harness 源码，也不需要重新编译插件。

## 第一次运行

1. 确保目标目录是非 bare Git 仓库，并先提交或处理已有修改。Arena 要求干净基线，避免把用户自己的未提交内容混进候选结果。
2. 在 DSH 左侧栏添加目标工作区。
3. 点击 **A/B** 打开 Evidence Arena，选择工作区。
4. 点击 **配置与预检**。这里只在你主动进入时检查 Git、凭据、policy、模型路由、Reviewer 独立性和沙箱事实。
5. 修复阻断项。默认最常见的两项是缺少 `DEEPSEEK_API_KEY`，以及没有项目测试命令。
6. 回到 **运行与代码审查**，输入同一个开发任务，点击 **开始并行对比**。
7. 运行完成后切换候选，展开门禁和 Reviewer 证据，再从文件树逐个查看代码 Diff。
8. 如需采用结果，先点 **准备采纳** 查看绑定的工件哈希与门禁，再勾选确认。Arena 会重新执行必需确定性门禁，随后才写回原工作区。

Arena 不会自动 commit、push、创建 PR 或部署。采纳后仍由你检查 `git diff` 并决定后续 Git 操作。

## 你能比较什么

| 维度 | Arena 如何记录 | 解读边界 |
|---|---|---|
| 速度 | 每个节点和整次运行的墙钟时间 | 受网络、provider 排队和本机门禁影响；最好重复多次取分布 |
| Token | 子运行时/provider 上报的输入、输出、推理、缓存和总 Token | 没有上报就不猜；Token 不等于金额 |
| 调用行为 | 模型调用数、工具调用数和近期活动 | 可看出“直接写”与“先检索再写”的行为差异 |
| 代码改动量 | 文件数、增加/删除行、patch 字节数 | 更少不自动代表更好，只用于透明排序和成本判断 |
| 正确性 | 项目测试、质量命令、完整性/安全门禁、逻辑与安全 Reviewer | 是本任务的证据，不是数学上已证明正确 |
| 可审查性 | 候选文件树、逐文件统一 Diff、Builder 最终说明、门禁输出 | 大文件有浏览上限，二进制只展示元数据 |

机械领先者只会在**通过全部必需门禁**的候选中按修改行数、patch 大小和配置顺序排序。它不是“Arena 宣布这个模型更聪明”。如果要计算模型准确率，应准备一组固定任务、隐藏测试或人工金标准，让每个模型重复运行，然后汇总通过率、成本和时间分布。

## 执行与安全模型

0. **显式预检：** 用户进入 Setup 页后，Arena 才检查仓库、凭据、policy、路由身份和沙箱条件；不会污染新对话。
1. **冻结基线：** 锁定精确 `HEAD`，为每个 Builder 创建独立 detached worktree。
2. **共享上下文：** 从不可变提交读取一次有界文件索引和指定文件，hash 后逐字节复用于所有 Builder。
3. **独立构建：** 每个 Builder 使用独立子运行时、路由、凭据引用、工具和 worktree。
4. **封存工件：** Reviewer 启动前捕获 tracked patch 与普通未跟踪文件，并绑定 SHA-256。符号链接、gitlink、特殊文件、路径逃逸或超限工件会失败关闭。
5. **确定性门禁：** 运行完整性检查、秘密/路径/二进制规则、`git diff --check` 和仓库声明的质量/测试 argv。
6. **零工具复核：** Reviewer 只接收有界封存工件与确定性证据，不获得 Shell、文件工具、Skill、候选 id 或实时 worktree。
7. **两阶段采纳：** 先生成短时、工件绑定的预览令牌；人工确认后在新隔离树重跑门禁，再写入精确字节。

文件写入受到 Harness 沙箱约束，但当前沙箱**不隔离网络，也不保证隔离所有宿主只读访问**。对抗性代码应放进容器或虚拟机，并使用最小权限凭据。

## 仓库 Policy Pack

默认文件为 `.dsh/arena-policy.json`。它是可提交、可审查的项目验收契约。Setup 页会生成完整模板；未知字段、缺失字段、不安全路径、Shell 字符串或无效签名都会明确阻断，不会静默回退。

下面是一个完整的基础示例：

```json
{
  "schemaVersion": 1,
  "policyId": "project-arena-policy",
  "revision": "1",
  "rules": {
    "judgeCommands": [
      {
        "id": "tests",
        "label": "Project tests",
        "stage": "test",
        "required": true,
        "command": "npm",
        "args": ["test"],
        "timeoutMs": 120000
      }
    ],
    "requireChanges": true,
    "requireProjectTests": true,
    "requireLogicReview": true,
    "requireSecurityReview": true,
    "allowBinaryFiles": false,
    "maxChangedFiles": 500,
    "maxReviewInputChars": 200000,
    "protectedPathPatterns": ["^\\.env(?:\\.|$)"],
    "sharedContextPaths": ["AGENTS.md", "package.json"]
  }
}
```

命令由 `command` 与 `args` 数组组成，不经过 Shell，因此管道、重定向、命令替换和命令串联不会被解释。若启用 `policySignatureMode: require`，可使用 Host 配置的 Ed25519 公钥验证分离签名；Arena 永远不接收私钥。

## 配置两个不同模型

编辑 Web profile 的用户 patch（通常是 `$DSH_HOME/profiles/web/cordis.patch.yml`），按 `arena` id 覆盖配置。下面使用抽象 OpenAI-compatible 路由；真实 URL、模型 id 和环境变量应换成你的部署：

```yaml
- id: arena
  config:
    providerProfiles:
      compare-gateway:
        apiKeyEnv: COMPARE_API_KEY
        api: openai-completions
        baseURL: https://models.example/v1
        models:
          - id: model-a
          - id: model-b
    contenders:
      - id: model-a
        label: Model A
        provider: compare-gateway
        model: model-a
        credentialEnv: [COMPARE_API_KEY]
        identity:
          organization: vendor-a
          gateway: models.example
          modelFamily: family-a
        systemPrompt: Implement the task completely and verify it.
      - id: model-b
        label: Model B
        provider: compare-gateway
        model: model-b
        credentialEnv: [COMPARE_API_KEY]
        identity:
          organization: vendor-b
          gateway: models.example
          modelFamily: family-b
        systemPrompt: Implement the task completely and verify it.
```

默认配置不是“两模型基准”：它使用同一个 DeepSeek 路由，比较 Direct 与 Evidence 两种工作方式。要比较真实模型能力，必须像上面一样把 contender 的 model/identity 改开，并尽量给两个候选相同任务、相同 policy 和相同系统提示词。严肃评估还应让 Reviewer 使用与 Builder 不重合的 provider、组织、网关和模型家族。

## 持久状态与恢复

Arena v4 默认把事件、原子快照、共享上下文、封存工件、Setup 报告和子 Session 保存到 `$DSH_HOME/arena/v4`。状态按 `workspaceId` 归属，不再绑定聊天 Session 或浏览器提交的路径。

每个候选经过 `admitted → worktree-ready → builder-complete → artifact-sealed → decision-complete`。Host 重启后会校验已注册 worktree、共享上下文和工件 hash，从最早未完成检查点恢复。采纳使用 `prepared → applying → applied → committed` 写前记录；只包含 Arena 自身效果的精确部分写入可回滚，遇到用户字节或分叉内容则进入 `needs-attention`，不会覆盖。

v4 有意拒绝 v3 及更早的预发布状态，不进行猜测迁移。升级前需要保留旧目录作为审计材料，并从新任务重新运行。

## 权限边界

- `/arena-read` 只返回运行、Setup 和按需文件 Diff，使用 trusted-host 通道。
- `/arena-control` 负责启动、重试、取消、清理、policy 写入和采纳，只允许 loopback 页面。
- 远程访问可以查看证据，但不能通过工作台修改仓库。
- Browser 只提交官方 `workspaceId`；Host 从 Workspace Registry 解析真实路径，拒绝浏览器伪造目录。
- 凭据始终按引用解析。密钥值不会写入 Arena 配置、状态、日志、RPC 或卡片。

## 已知限制

- Windows 路径与运行时组合已有静态/模拟测试，但当前开发验收来自 macOS；真实 Windows 的 ACL、junction、Git 和进程行为仍需真机 CI。
- 网络与所有宿主只读访问尚未隔离。
- Token 和调用预算依赖 provider 遥测；在途请求可能让实际值超过一个上报间隔。
- Reviewer 与规则提供工程证据，不替代完整 SAST、形式化验证或人工领域审查。
- 普通文件系统无法让多文件 working-tree 写入完全原子；Arena 提供 WAL、复验和分叉保护。
- 准备本仓库时，公共 npm 上尚无 `dsh-evidence-arena`；但只有首次成功发布后才算真正保留，发布前必须再次核对。
- 只有与当前外置插件 seam 兼容的 DSH 版本才受支持；官方接口变化后需要重新构建与验证。

## 卸载

```bash
dsh plugin --profile web remove dsh-evidence-arena
```

卸载插件不会自动删除 `$DSH_HOME/arena/v4` 的审计证据，也不会删除已经写回工作区的代码。确认不再需要后，再由用户显式归档或清理这些数据。
