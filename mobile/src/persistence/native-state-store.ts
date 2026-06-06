import { NativeModules } from "react-native";
import type { PersistedAppState } from "../../../src/core/persistence/file-state-store";

type StateModule = {
  saveState(json: string): Promise<boolean>;
  loadState(): Promise<string | null>;
  clearState(): Promise<boolean>;
};

const moduleRef: StateModule | undefined = NativeModules.MobileClawStateModule as StateModule | undefined;

export function createNativePersistence() {
  if (!moduleRef) {
    // Fallback for environments without the native module (e.g. tests).
    let inMemory: PersistedAppState | null = null;
    return {
      load: async () => inMemory,
      save: async (state: PersistedAppState) => {
        inMemory = state;
      },
      clear: async () => {
        inMemory = null;
      }
    };
  }

  return {
    load: async (): Promise<PersistedAppState | null> => {
      const raw = await moduleRef.loadState();
      if (!raw) return null;
      return JSON.parse(raw) as PersistedAppState;
    },
    save: async (state: PersistedAppState): Promise<void> => {
      await moduleRef.saveState(JSON.stringify(state));
    },
    clear: async (): Promise<void> => {
      await moduleRef.clearState();
    }
  };
}

