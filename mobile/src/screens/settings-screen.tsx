import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ThemePreference } from "../../../src/types/contracts";
import type { MaterialTheme } from "../theme/material";

type Store = {
  theme: MaterialTheme;
  themePreference: ThemePreference;
  setThemePreference(value: ThemePreference): Promise<void>;
  notificationsEnabled: boolean;
  notificationSoundEnabled: boolean;
  notificationVibrationEnabled: boolean;
  setNotificationPreference(key: "notificationsEnabled" | "notificationSoundEnabled" | "notificationVibrationEnabled", value: boolean): Promise<void>;
  developerModeEnabled: boolean;
  setDeveloperModePreference(value: boolean): Promise<void>;
  openModels(): void;
  initializeAll(mode: "full" | "update"): Promise<void>;
};

const themeChoices: Array<{ id: ThemePreference; label: string }> = [
  { id: "system", label: "跟随系统" },
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" }
];

export function SettingsScreen(props: { store: Store }) {
  const styles = React.useMemo(() => createStyles(props.store.theme), [props.store.theme]);
  const [tapCount, setTapCount] = React.useState(0);
  const [hint, setHint] = React.useState("");

  const onVersionTap = () => {
    if (props.store.developerModeEnabled) return;
    const next = tapCount + 1;
    setTapCount(next);
    if (next >= 10) {
      setTapCount(0);
      setHint("开发者模式已开启");
      void props.store.setDeveloperModePreference(true);
      return;
    }
    if (next >= 6) setHint(`再点击 ${10 - next} 次开启开发者模式`);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>设置</Text>

      <Text style={styles.section}>模型与配置</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>模型管理与 API Key 配置已统一到“模型”页面。</Text>
        <Pressable style={styles.button} onPress={props.store.openModels}>
          <Text style={styles.buttonText}>打开模型页</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>外观</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>主题支持系统跟随、浅色和深色，切换后即时生效。</Text>
        <View style={styles.optionList}>
          {themeChoices.map((choice) => (
            <Pressable
              key={choice.id}
              style={[styles.optionButton, props.store.themePreference === choice.id ? styles.optionButtonActive : null]}
              onPress={() => {
                void props.store.setThemePreference(choice.id);
              }}
            >
              <Text style={[styles.optionText, props.store.themePreference === choice.id ? styles.optionTextActive : null]}>{choice.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Text style={styles.section}>通知</Text>
      <View style={styles.card}>
        <ToggleRow
          label="通知总开关"
          value={props.store.notificationsEnabled}
          onToggle={(next) => void props.store.setNotificationPreference("notificationsEnabled", next)}
          styles={styles}
        />
        <ToggleRow
          label="通知声音"
          value={props.store.notificationSoundEnabled}
          onToggle={(next) => void props.store.setNotificationPreference("notificationSoundEnabled", next)}
          styles={styles}
        />
        <ToggleRow
          label="通知震动"
          value={props.store.notificationVibrationEnabled}
          onToggle={(next) => void props.store.setNotificationPreference("notificationVibrationEnabled", next)}
          styles={styles}
        />
      </View>

      <Text style={styles.section}>初始化 / 更新</Text>
      <Text style={styles.hint}>完全重置会清空全部；更新会保留凭据并重置会话状态。</Text>
      <View style={styles.optionList}>
        <Pressable style={[styles.button, styles.danger]} onPress={() => void props.store.initializeAll("full")}>
          <Text style={styles.buttonText}>完全重置</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={() => void props.store.initializeAll("update")}>
          <Text style={styles.buttonText}>更新配置</Text>
        </Pressable>
      </View>

      {props.store.developerModeEnabled ? (
        <View style={styles.card}>
          <Text style={styles.section}>开发者模式</Text>
          <Text style={styles.hint}>当前已开启，可访问内部配置。</Text>
          <Pressable style={[styles.button, styles.danger]} onPress={() => void props.store.setDeveloperModePreference(false)}>
            <Text style={styles.buttonText}>关闭开发者模式</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable onPress={onVersionTap} style={styles.versionWrap}>
        <Text style={styles.versionText}>MobileClaw v0.3.0</Text>
        {hint ? <Text style={styles.versionHint}>{hint}</Text> : null}
      </Pressable>
    </ScrollView>
  );
}

function ToggleRow(props: {
  label: string;
  value: boolean;
  onToggle(next: boolean): void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={props.styles.toggleRow}>
      <Text style={props.styles.toggleLabel}>{props.label}</Text>
      <Pressable
        style={[props.styles.toggleButton, props.value ? props.styles.toggleButtonOn : null]}
        onPress={() => props.onToggle(!props.value)}
      >
        <Text style={[props.styles.toggleText, props.value ? props.styles.toggleTextOn : null]}>{props.value ? "开启" : "关闭"}</Text>
      </Pressable>
    </View>
  );
}

function createStyles(theme: MaterialTheme) {
  return StyleSheet.create({
    container: { flex: 1, padding: 16, backgroundColor: theme.color.background },
    content: { paddingBottom: 24 },
    title: { color: theme.color.onSurface, fontSize: 20, fontWeight: "800", marginBottom: 10 },
    section: { color: theme.color.onSurface, fontSize: 14, fontWeight: "900", marginTop: 16, marginBottom: 8 },
    hint: { color: theme.color.onSurfaceVariant, fontSize: 12, lineHeight: 18, marginTop: 4 },
    card: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, padding: 12, marginTop: 10, borderWidth: 1, borderColor: theme.color.outline, gap: 8 },
    optionList: { gap: 8, marginTop: 10 },
    optionButton: {
      backgroundColor: theme.color.surface2,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.color.outline,
      paddingHorizontal: 12,
      paddingVertical: 10,
      alignItems: "center"
    },
    optionButtonActive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
    optionText: { color: theme.color.onSurface, fontWeight: "700", fontSize: 12 },
    optionTextActive: { color: theme.color.onPrimary },
    button: { backgroundColor: theme.color.primary, borderRadius: theme.radius.md, paddingHorizontal: 12, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
    danger: { backgroundColor: theme.color.error },
    buttonText: { color: theme.color.onPrimary, fontWeight: "900", fontSize: 12 },
    toggleRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      borderWidth: 1,
      borderColor: theme.color.outline,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.surface2,
      paddingHorizontal: 10,
      paddingVertical: 10
    },
    toggleLabel: { color: theme.color.onSurface, fontSize: 13, fontWeight: "700" },
    toggleButton: {
      borderWidth: 1,
      borderColor: theme.color.outline,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: theme.color.surface
    },
    toggleButtonOn: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
    toggleText: { color: theme.color.onSurface, fontSize: 12, fontWeight: "700" },
    toggleTextOn: { color: theme.color.onPrimary },
    versionWrap: { marginTop: 20, alignItems: "center", paddingVertical: 12 },
    versionText: { color: theme.color.onSurfaceVariant, fontSize: 12, fontWeight: "700" },
    versionHint: { color: theme.color.primary, fontSize: 11, marginTop: 4 }
  });
}
