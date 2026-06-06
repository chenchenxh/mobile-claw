import { NativeModules } from "react-native";
import type { AppPreferences, ThemePreference } from "../../../src/types/contracts";

type StateModule = {
  savePreference(key: string, value: string): Promise<boolean>;
  loadPreference(key: string): Promise<string | null>;
  removePreference(key: string): Promise<boolean>;
};

const moduleRef: StateModule | undefined = NativeModules.MobileClawStateModule as StateModule | undefined;

const PREF_KEY = "app_preferences_v1";

const inMemoryFallback: AppPreferences = {
  themePreference: "system",
  notificationsEnabled: true,
  notificationSoundEnabled: true,
  notificationVibrationEnabled: true,
  developerModeEnabled: false,
  modelCatalog: [],
  channelModelMap: {},
  providerApiBaseMap: {},
  pendingCronApprovals: [],
  cronPermissionGrants: [],
  pendingPermissionRequests: [],
  permissionGrants: []
};

function normalizePreferences(input?: Partial<AppPreferences> | null): AppPreferences {
  return {
    themePreference: input?.themePreference ?? "system",
    notificationsEnabled: input?.notificationsEnabled ?? true,
    notificationSoundEnabled: input?.notificationSoundEnabled ?? true,
    notificationVibrationEnabled: input?.notificationVibrationEnabled ?? true,
    developerModeEnabled: input?.developerModeEnabled ?? false,
    modelCatalog: input?.modelCatalog ?? [],
    channelModelMap: input?.channelModelMap ?? {},
    providerApiBaseMap: input?.providerApiBaseMap ?? {},
    pendingCronApprovals: input?.pendingCronApprovals ?? [],
    cronPermissionGrants: input?.cronPermissionGrants ?? [],
    pendingPermissionRequests: input?.pendingPermissionRequests ?? [],
    permissionGrants: input?.permissionGrants ?? []
  };
}

export function createNativePreferencesStore() {
  if (!moduleRef) {
    return {
      load: async (): Promise<AppPreferences> => normalizePreferences(inMemoryFallback),
      saveThemePreference: async (themePreference: ThemePreference): Promise<void> => {
        inMemoryFallback.themePreference = themePreference;
      },
      save: async (next: AppPreferences): Promise<void> => {
        Object.assign(inMemoryFallback, normalizePreferences(next));
      }
    };
  }

  return {
    load: async (): Promise<AppPreferences> => {
      const raw = await moduleRef.loadPreference(PREF_KEY);
      if (!raw) return normalizePreferences();
      try {
        const parsed = JSON.parse(raw) as Partial<AppPreferences>;
        return normalizePreferences(parsed);
      } catch {
        return normalizePreferences();
      }
    },
    saveThemePreference: async (themePreference: ThemePreference): Promise<void> => {
      const current = await moduleRef.loadPreference(PREF_KEY);
      let payload = normalizePreferences();
      if (current) {
        try {
          payload = normalizePreferences(JSON.parse(current) as Partial<AppPreferences>);
        } catch {
          payload = normalizePreferences();
        }
      }
      payload.themePreference = themePreference;
      await moduleRef.savePreference(PREF_KEY, JSON.stringify(payload));
    },
    save: async (next: AppPreferences): Promise<void> => {
      const payload = normalizePreferences(next);
      await moduleRef.savePreference(PREF_KEY, JSON.stringify(payload));
    }
  };
}
