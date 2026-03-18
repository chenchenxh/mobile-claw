# MobileClaw V1 (Android-First)

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

If your environment previously used an unavailable mirror, this repo already pins npm registry via `.npmrc`.

### Troubleshooting

- `No apps connected` on `localhost:8081` is expected when Metro is running but Android app has not been installed/launched yet.
- If `npm run android` fails with Gradle cache permission errors, this repo already uses project-local Gradle home in script:
  - `GRADLE_USER_HOME=$PWD/.gradle react-native run-android`
- If emulator does not auto-launch, start it manually first from Android Studio Device Manager, then run `npm run android` again.
- Run environment checks with:
  - `npm run doctor`

## V1 Scope Implemented

- Android-first architecture baseline.
- Local-only memory policy.
- Workspace/channel isolation and model switching flow.
- BYOK + OAuth credential store abstraction.
- Plan engine with pause/resume/terminate + status transitions.
- Fallback routing when primary model call fails.
- Mobile UI shell scaffold (OpenClaw-style): chat home + left drawer for Channels/Tools/Settings.

## Notes

- Kotlin module is scaffold-only in this commit; replace TODO sections with Android Keystore and Custom Tabs OAuth callback flow.
- Gateway currently includes mock adapters for deterministic local tests.
- Real adapters are included for OpenAI-compatible and Gemini HTTP APIs.
- Mobile shell files:
  - `mobile/App.tsx`
  - `mobile/src/mobileclaw-shell.tsx`
  - `mobile/src/screens/*.tsx`
