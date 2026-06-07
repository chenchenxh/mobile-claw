import React from "react";
import { Modal, NativeModules, Platform, Pressable, ScrollView, StyleSheet, Text, ToastAndroid, View } from "react-native";
import type { AppLogEntry, AppLogLevel } from "../../../src/core/observability/app-logger";
import type { MaterialTheme } from "../theme/material";

const levels: AppLogLevel[] = ["VERBOSE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"];

const nativeClipboard = NativeModules.MobileClawClipboard as
  | { setString(label: string, text: string): Promise<boolean> }
  | undefined;

type Store = {
  theme: MaterialTheme;
  logs: AppLogEntry[];
  clearLogs(): void;
};

export function LogsScreen(props: { store: Store }) {
  const { store } = props;
  const styles = React.useMemo(() => createStyles(store.theme), [store.theme]);
  const [enabledLevels, setEnabledLevels] = React.useState<Record<AppLogLevel, boolean>>({
    VERBOSE: true,
    DEBUG: true,
    INFO: true,
    WARN: true,
    ERROR: true,
    FATAL: true
  });
  const [selected, setSelected] = React.useState<AppLogEntry | null>(null);

  const rows = React.useMemo(
    () => store.logs.filter((entry) => enabledLevels[entry.level]),
    [store.logs, enabledLevels]
  );

  const formatLogEntry = (entry: AppLogEntry): string => {
    const parts = [
      `time=${new Date(entry.ts).toLocaleString()}`,
      `level=${entry.level}`,
      `module=${entry.module}`,
      `event=${entry.event}`,
      `message=${entry.message}`
    ];
    if (entry.context) parts.push(`context=${JSON.stringify(entry.context, null, 2)}`);
    if (entry.error) parts.push(`error=${entry.error}`);
    return parts.join("\n");
  };

  const copyLogEntry = async (entry: AppLogEntry) => {
    const text = formatLogEntry(entry);
    if (!nativeClipboard?.setString) {
      if (Platform.OS === "android") ToastAndroid.show("当前环境不支持复制", ToastAndroid.SHORT);
      return;
    }
    try {
      await nativeClipboard.setString("MobileClaw Log", text);
      if (Platform.OS === "android") ToastAndroid.show("日志已复制", ToastAndroid.SHORT);
    } catch (err) {
      if (Platform.OS === "android") ToastAndroid.show("复制失败", ToastAndroid.SHORT);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>日志</Text>
      <View style={styles.toolbar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.levelWrap}>
          {levels.map((level) => (
            <Pressable
              key={level}
              style={[styles.levelChip, enabledLevels[level] ? styles.levelChipActive : null]}
              onPress={() => setEnabledLevels((prev) => ({ ...prev, [level]: !prev[level] }))}
            >
              <Text style={[styles.levelText, enabledLevels[level] ? styles.levelTextActive : null]}>{level}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable style={styles.clearButton} onPress={store.clearLogs}>
          <Text style={styles.clearText}>清空</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {rows.length ? (
          rows.map((entry) => (
            <Pressable
              key={entry.id}
              style={styles.row}
              onPress={() => setSelected(entry)}
              onLongPress={() => void copyLogEntry(entry)}
            >
              <Text style={styles.time}>{new Date(entry.ts).toLocaleTimeString()}</Text>
              <Text style={styles.level}>{entry.level}</Text>
              <Text style={styles.event} numberOfLines={1}>
                {entry.module}.{entry.event}
              </Text>
            </Pressable>
          ))
        ) : (
          <Text style={styles.empty}>暂无匹配日志</Text>
        )}
      </ScrollView>

      <Modal visible={Boolean(selected)} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.overlay} onPress={() => setSelected(null)}>
          <Pressable style={styles.detailCard} onPress={() => undefined}>
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>日志详情</Text>
              {selected ? (
                <Pressable style={styles.copyButton} onPress={() => void copyLogEntry(selected)}>
                  <Text style={styles.copyText}>复制</Text>
                </Pressable>
              ) : null}
            </View>
            {selected ? (
              <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
                <Text selectable onLongPress={() => void copyLogEntry(selected)} style={styles.detailLine}>时间：{new Date(selected.ts).toLocaleString()}</Text>
                <Text selectable onLongPress={() => void copyLogEntry(selected)} style={styles.detailLine}>级别：{selected.level}</Text>
                <Text selectable onLongPress={() => void copyLogEntry(selected)} style={styles.detailLine}>模块：{selected.module}</Text>
                <Text selectable onLongPress={() => void copyLogEntry(selected)} style={styles.detailLine}>事件：{selected.event}</Text>
                <Text selectable onLongPress={() => void copyLogEntry(selected)} style={styles.detailLine}>消息：{selected.message}</Text>
                {selected.context ? (
                  <Text selectable onLongPress={() => void copyLogEntry(selected)} style={styles.detailJson}>{JSON.stringify(selected.context, null, 2)}</Text>
                ) : null}
                {selected.error ? <Text selectable onLongPress={() => void copyLogEntry(selected)} style={styles.detailError}>错误：{selected.error}</Text> : null}
              </ScrollView>
            ) : null}
            <Pressable style={styles.closeButton} onPress={() => setSelected(null)}>
              <Text style={styles.closeText}>关闭</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function createStyles(theme: MaterialTheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.color.background, padding: 16 },
    title: { color: theme.color.onSurface, fontSize: 24, fontWeight: "900", marginBottom: 10 },
    toolbar: { gap: 10, marginBottom: 8 },
    levelWrap: { gap: 8, paddingRight: 8 },
    levelChip: {
      borderWidth: 1,
      borderColor: theme.color.outline,
      borderRadius: theme.radius.md,
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor: theme.color.surface2
    },
    levelChipActive: { borderColor: theme.color.primary, backgroundColor: theme.color.primary },
    levelText: { color: theme.color.onSurface, fontSize: 12, fontWeight: "700" },
    levelTextActive: { color: theme.color.onPrimary },
    clearButton: {
      alignSelf: "flex-start",
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.color.outline,
      backgroundColor: theme.color.surface,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    clearText: { color: theme.color.onSurface, fontSize: 12, fontWeight: "700" },
    list: { flex: 1 },
    listContent: { gap: 6, paddingBottom: 24 },
    row: {
      minHeight: 52,
      borderWidth: 1,
      borderColor: theme.color.outline,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.surface,
      paddingHorizontal: 10,
      paddingVertical: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    time: { width: 76, color: theme.color.onSurfaceVariant, fontSize: 11 },
    level: { width: 52, color: theme.color.onSurface, fontSize: 11, fontWeight: "800" },
    event: { flex: 1, color: theme.color.onSurface, fontSize: 12, fontWeight: "700" },
    empty: { color: theme.color.onSurfaceVariant, fontSize: 12, marginTop: 20 },
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 16 },
    detailCard: {
      maxHeight: "86%",
      borderRadius: theme.radius.lg,
      backgroundColor: theme.color.surface,
      borderWidth: 1,
      borderColor: theme.color.outline,
      padding: 14,
      gap: 8
    },
    detailHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    detailTitle: { color: theme.color.onSurface, fontSize: 16, fontWeight: "900" },
    copyButton: {
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.color.outline,
      backgroundColor: theme.color.surface2,
      paddingHorizontal: 10,
      paddingVertical: 6
    },
    copyText: { color: theme.color.onSurface, fontSize: 12, fontWeight: "800" },
    detailScroll: { flexGrow: 0 },
    detailContent: { gap: 8, paddingBottom: 4 },
    detailLine: { color: theme.color.onSurface, fontSize: 12, lineHeight: 18 },
    detailJson: {
      color: theme.color.onSurface,
      fontSize: 11,
      lineHeight: 16,
      backgroundColor: theme.color.surface2,
      borderWidth: 1,
      borderColor: theme.color.outline,
      borderRadius: theme.radius.sm,
      padding: 8
    },
    detailError: { color: theme.color.error, fontSize: 12, lineHeight: 18 },
    closeButton: {
      alignSelf: "flex-end",
      backgroundColor: theme.color.primary,
      borderRadius: theme.radius.md,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    closeText: { color: theme.color.onPrimary, fontWeight: "800", fontSize: 12 }
  });
}
