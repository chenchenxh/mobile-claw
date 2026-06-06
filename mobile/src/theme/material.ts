import type { ColorSchemeName } from "react-native";
import type { ThemePreference } from "../../../src/types/contracts";

export type MaterialMode = "light" | "dark";

export interface MaterialTheme {
  mode: MaterialMode;
  color: {
    background: string;
    surface: string;
    surface2: string;
    outline: string;
    onSurface: string;
    onSurfaceVariant: string;
    primary: string;
    onPrimary: string;
    secondary: string;
    error: string;
    userBubble: string;
    onUserBubble: string;
    assistantBubble: string;
    onAssistantBubble: string;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
  };
  spacing(n: number): number;
}

const shared = {
  radius: {
    sm: 10,
    md: 14,
    lg: 18
  },
  spacing: (n: number) => n * 8
};

export const materialThemes: Record<MaterialMode, MaterialTheme> = {
  light: {
    mode: "light",
    color: {
      background: "#F8FAFD",
      surface: "#FFFFFF",
      surface2: "#F0F4FA",
      outline: "#D2DBE8",
      onSurface: "#182231",
      onSurfaceVariant: "#51627A",
      primary: "#0D5BB8",
      onPrimary: "#FFFFFF",
      secondary: "#0A8A79",
      error: "#C62828",
      userBubble: "#E1EEFF",
      onUserBubble: "#113055",
      assistantBubble: "#FFFFFF",
      onAssistantBubble: "#182231"
    },
    ...shared
  },
  dark: {
    mode: "dark",
    color: {
      background: "#0B0F19",
      surface: "#111827",
      surface2: "#0F172A",
      outline: "#243041",
      onSurface: "#E5E7EB",
      onSurfaceVariant: "#9CA3AF",
      primary: "#4F8CFF",
      onPrimary: "#0B1220",
      secondary: "#22C55E",
      error: "#EF4444",
      userBubble: "#0B2A6A",
      onUserBubble: "#E6EEFF",
      assistantBubble: "#111827",
      onAssistantBubble: "#E5E7EB"
    },
    ...shared
  }
};

export function resolveThemeMode(preference: ThemePreference, systemScheme: ColorSchemeName): MaterialMode {
  if (preference === "light" || preference === "dark") return preference;
  return systemScheme === "dark" ? "dark" : "light";
}

export function resolveMaterialTheme(preference: ThemePreference, systemScheme: ColorSchemeName): MaterialTheme {
  return materialThemes[resolveThemeMode(preference, systemScheme)];
}
