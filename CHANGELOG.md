# CHANGELOG

## V3.3

### Added
- 建立纯模型路由基线，并引入 ToolCallVerifier 做工具调用合法性校验（工具名、参数、权限）。
- 上线系统工具链可视化（`time.now / fs.read / fs.list / fs.write / exec.run / cron.*`）与流程日志。
- 加入工具循环运行态与中断能力（运行阶段、停止回执、流程分组折叠）。
- 增加 Cron 审批/授权链路：待审批队列、长期授权、审批审计日志。

### Changed
- 时间真值统一到设备系统时间，`time.now` 与聊天时间答复口径一致。
- `fs.read/fs.list` 工具上下文与本地总结器增强，模型空响应时可回退到真值摘要。
- 工具循环阈值与告警分级调整：重复同签名调用到第 10 次才进入 warning 收口。
- 消息渲染引入 system 流程折叠，弱化工具过程噪音，保留可追溯细节。

### Fixed
- 修复 MiniMax 工具循环中 `Tool_Call` 文本泄露到 assistant 正文的问题（含多种格式清洗）。
- 修复 Cron 删除全部审批链路中“口头已删但未落盘”的一致性问题。
- 修复 one-shot Cron 触发后未及时清理的场景，补齐删除补偿日志。
- 修复多处工具 follow-up 空响应导致“只有 system、无最终答复”的问题。

### Known Gaps / Next
- 进入 V3.4：消息即时回显、顶部手动刷新、审批悬浮内联、抽屉重构（定时任务/审批与安全）、会话左滑删除。
- 保持 Android 先行，iOS 继续接口兼容。

## V3.1

### Added
- 完成 Session/Channel 语义收敛：App 内短期会话统一为 Session，外部 IM 连接语义保留为 Channel。
- MiniMax BYOK/OAuth 区域显式化（Global/CN），并补齐鉴权诊断链路（region/baseUrl/401 分类）。
- 聊天错误面板新增“去模型配置修复”快捷入口，降低鉴权失败恢复成本。

### Changed
- 配置向导的 MiniMax 区域选择逻辑抽离为统一动作，BYOK 与 OAuth 共用同一组区域配置源。
- 网关 MiniMax 适配器请求/失败日志补充区域和鉴权模式，便于区分“区域错配”与“key 无效”。

### Fixed
- 修复重装后 MiniMax BYOK 容易走错默认区域导致的 401 反复失败问题。
- 修复部分配置流程中区域信息未落盘导致发送链路使用错误 baseUrl 的问题。

### Known Gaps / Next
- V3.2 主线进入 Cron + 通知闭环（Agent-only 创建/更新/删除，用户侧只读+重试）。
- 多Agent与外部IM桥接延后到 V3 后续 / V4。

## V3.0

### Added
- Agent 内核对齐 OpenClaw 工作区语义，完成 8 个核心 workspace 文件基线（AGENTS/SOUL/TOOLS/IDENTITY/USER/HEARTBEAT/BOOTSTRAP/MEMORY）。
- Prompt 装配升级为文件驱动，支持 Project Context 注入、预算截断与注入报告（`contextFiles` / `truncationWarnings`）。
- 开发者模式“内部配置”页面升级：支持资产树浏览、scope 过滤（workspace/会话/全部）与会话级资产查看。
- 会话资产补充 `agents/main/sessions/<sessionId>/session.json` 结构，便于按会话排查运行态。

### Changed
- `MEMORY.md` 注入策略收敛为仅 main-context 注入，shared-context 默认不注入。
- `BOOTSTRAP.md` 生命周期与 workspace state 对齐：setup 完成后默认不再注入。
- 内部配置页交互改为上目录树、下预览，并显示当前文件名与完整路径。

### Fixed
- 修复内部配置页点击崩溃（`Maximum update depth exceeded`）相关循环更新路径。
- 修复多轮聊天与配置链路中的 prompt 资产可见性与注入一致性问题。

### Known Gaps / Next
- V3.1 将推进多 Agent 隔离与外部 IM Channel 连接骨架。
- 术语统一持续推进：App 内“会话（session）”与外部“Channel”继续去混淆。

## V1

### Added
- Android-first MobileClaw scaffold with core layering: Channel, Gateway, Agent, Memory.
- Stable contracts for workspace, model provider/session, plan run/step, memory record, channel context, adapter and credential store.
- Local-only memory baseline with channel isolation.
- Plan engine baseline (`Plan -> Execute -> Observe -> Replan`) and lifecycle controls.
- OpenClaw-style mobile shell baseline: chat home + drawer navigation.

### Changed
- Unified provider abstraction for BYOK and OAuth credentials.
- Mobile kernel orchestration around local persistence and channel sessions.

### Fixed
- Android project recognition and basic runnable RN shell baseline.

### Known Gaps / Next
- V1 focuses on app-internal agent loop; no plugin/foreground service scope yet.

## V2.0

### Added
- Theme preference with `system / light / dark` and persistent app-level preference.
- Standalone onboarding flow (outside Settings) for provider configuration.
- Provider onboarding focus for OpenAI + MiniMax with BYOK/OAuth paths.
- Startup self-heal for missing `ws_mobile` workspace/default channel.

### Changed
- Chat header UX refined to show channel + resolved model display name.
- OAuth callback wiring and deep link path stabilized for Android flow.

### Fixed
- Workspace missing crash path fixed via startup self-healing initialization.

### Known Gaps / Next
- Chat UX still required iterative scroll/input polish after V2.0 baseline.

## V2.1

### Added
- Dedicated models page and provider-first model configuration entry.
- In-app logs screen with structured chain logs for onboarding/gateway/chat diagnostics.
- MiniMax anthropic-style adapter + response parsing tests.
- Provider registry and recommendation updates for OpenAI/MiniMax paths.

### Changed
- OAuth onboarding converged toward OpenClaw-style guided flow.
- Model naming/routing alignment for MiniMax and provider base-url handling.
- Settings page narrowed toward generic app settings while model setup moved to models area.

### Fixed
- OAuth compatibility issues across RN runtime and redirect handling.
- Multiple authentication failure paths exposed with clearer diagnostics.

### Known Gaps / Next
- Chat scroll/keyboard behavior still needed dedicated stabilization in V2.x.

## V2.x

### Added
- Ongoing chat UX hardening: typing placeholder flow, keyboard/input affordance refinements, model/chat layout tuning.
- Observability enhancements for request/scroll behavior diagnostics.

### Changed
- Chat list scrolling strategy iterated from basic auto-follow to robust `inverted` list model for mobile consistency.
- Bottom spacing strategy simplified to remove visible blank-gap regressions.
- Input remains editable while assistant is typing; send action remains guarded.

### Fixed
- Repeated regressions around first-load half-scroll and keyboard-induced offset drift.
- Bottom-gap artifacts caused by over-allocated content padding.
- Message visibility issues when transitioning from typing state to assistant response.

### Known Gaps / Next
- Evaluate reintroducing history pagination only after inverted-scroll stability is consistently validated on device.
- Continue Chat UX backlog: search/copy/multi-select and overlay-style header status/actions.
