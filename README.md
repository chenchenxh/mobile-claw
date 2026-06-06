# MobileClaw (Android-First)

MobileClaw V1 implementation scaffold for:

- Plan (visible step execution loop)
- Memory (local-only, channel-isolated)
- Independent workspace/channel
- Multi-model switching with BYOK + OAuth credential modes

## Architecture

- `src/types/contracts.ts`: Stable public contracts (WorkspaceConfig, ModelProvider, ModelSession, PlanRun, PlanStep, MemoryRecord, ChannelContext, GatewayAdapter, CredentialStore).
- `src/core/channel`: Workspace/channel/message management.
- `src/core/gateway`: Adapter registry, routing, fallback, auth validation.
- `src/core/agent`: Plan engine (`Plan -> Execute -> Observe -> Replan` foundation).
- `src/core/memory`: Local memory storage, extraction, semantic recall.
- `src/app/mobileclaw-kernel.ts`: App-level orchestration.
- `src/native`: RN-side bridge contract.
- `android/app/src/main/java/com/mobileclaw/credential`: Kotlin native module skeleton for secure storage/OAuth callback bridge.

## Run Tests

```bash
npm test
```

## Milestones

- See [`CHANGELOG.md`](./CHANGELOG.md) for milestone summary across `V1`, `V2.0`, `V2.1`, `V2.x`, `V3.0`, `V3.1`, and `V3.3`.

## Run CLI Demo (Real Provider)

```bash
# choose one or both
export OPENAI_API_KEY=...
export GEMINI_API_KEY=...
npm run demo
```

The demo persists local state at `.mobileclaw/state.json` and restores it on next start.

## Run Mobile UI Scaffold (React Native)

```bash
npm install
npm run start
# in another terminal, with Android emulator/device ready:
npm run android
```

### Stable Android Debug Flow

If Metro is already running or React Native tries to open a new terminal window, use the explicit two-terminal flow below.
Replace `<repo>` with your local MobileClaw repository path.

First, stop stale Gradle daemons:

```bash
cd <repo>/android
GRADLE_USER_HOME=../.gradle ./gradlew --stop
```

Then start Metro in one terminal:

```bash
cd <repo>
source ~/.nvm/nvm.sh
nvm use
npm run start -- --no-interactive
```

In another terminal, install and launch the debug app:

```bash
cd <repo>
source ~/.nvm/nvm.sh
nvm use
npm run android:no-packager -- --deviceId emulator-5554
```

If your emulator or device id is different, replace `emulator-5554` with the value from `adb devices`.

## Run Without Metro (Standalone App)

`debug` 包依赖 Metro，断开电脑后会出现 `Cannot connect to Metro` 是预期行为。  
日常脱机使用请安装 `release` 包（内置 JS bundle）：

```bash
npm run android:release
```

如果手机上还装着旧 debug 包，建议先卸载 debug 再装 release，避免误打开 debug：

```bash
adb uninstall com.mobileclawtemplate
npm run android:release
```

If your environment previously used an unavailable mirror, this repo already pins npm registry via `.npmrc`.

### Troubleshooting

- `No apps connected` on `localhost:8081` is expected when Metro is running but Android app has not been installed/launched yet.
- If `npm run android` fails with Gradle cache permission errors, this repo already uses project-local Gradle home in script:
  - `GRADLE_USER_HOME=$PWD/.gradle react-native run-android`
- If emulator does not auto-launch, start it manually first from Android Studio Device Manager, then run `npm run android` again.
- Run environment checks with:
  - `npm run doctor`

### V2/V3 Quick Acceptance

1. Open drawer -> `Config`.
2. Select provider (`OpenAI` or `MiniMax`), then choose `BYOK` or `OAuth`.
3. If using OAuth, finish browser authorization and return to app (`mobileclaw://oauth` deep link).
4. Finish wizard and apply a recommendation profile.
5. Back in chat, confirm header shows `Session name + resolved model display name`.

## V1 Scope Implemented

- Android-first architecture baseline.
- Local-only memory policy.
- Workspace/channel isolation and model switching flow.
- BYOK + OAuth credential store abstraction.
- Plan engine with pause/resume/terminate + status transitions.
- Fallback routing when primary model call fails.
- Mobile UI shell scaffold (OpenClaw-style): chat home + left drawer for Channels/Tools/Settings.

## V2/V3 Milestones

- `V2.0` and `V2.1` milestone items are implemented on this branch.
- `V2.x` contains ongoing UX hardening (especially chat scrolling/keyboard/input behavior).
- `V3.0` milestone is completed for Agent core alignment and internal config developer tooling.
- `V3.1` milestone is completed for Session/Channel 语义收敛与 MiniMax 区域鉴权诊断收口。
- `V3.3` milestone is completed for ReAct/tool-loop 基线、工具可视化、Cron 审批链路与时间真值统一。
- `V3.4` next focus: 消息即时回显、顶部刷新、审批悬浮内联、抽屉重构（定时任务/审批与安全）、会话左滑删除。
- Detailed changelog is maintained in [`CHANGELOG.md`](./CHANGELOG.md).

## Install / Upgrade Verification

- Usually **no uninstall required** in dev flow.
- Rebuild and install over existing app:
  - `npm run android`
- If UI text/state looks stale after migration, use uninstall + reinstall as fallback.

## Notes

- Android credential bridge now uses Keystore-backed encryption and launches OAuth via Custom Tabs.
- Gateway currently includes mock adapters for deterministic local tests.
- Real adapters are included for OpenAI-compatible and Gemini HTTP APIs.
- Mobile shell files:
  - `mobile/App.tsx`
  - `mobile/src/mobileclaw-shell.tsx`
  - `mobile/src/screens/*.tsx`
