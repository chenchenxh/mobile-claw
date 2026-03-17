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

## V1 Scope Implemented

- Android-first architecture baseline.
- Local-only memory policy.
- Workspace/channel isolation and model switching flow.
- BYOK + OAuth credential store abstraction.
- Plan engine with pause/resume/terminate + status transitions.
- Fallback routing when primary model call fails.

## Notes

- Kotlin module is scaffold-only in this commit; replace TODO sections with Android Keystore and Custom Tabs OAuth callback flow.
- Gateway currently includes mock adapters for deterministic local tests.
