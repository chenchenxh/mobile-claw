import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { AppModelConfig } from "../../../src/types/contracts";
import type { MaterialTheme } from "../theme/material";

type Store = {
  theme: MaterialTheme;
  providers: ReadonlyArray<{ id: string; label: string }>;
  providerStatusMap: Record<string, "unconfigured" | "pending_commit" | "configured">;
  listProviderModels(providerId: string): AppModelConfig[];
  openProviderSetup(providerId?: string): void;
  createModel(input: { providerId: string; modelId: string; displayName?: string }): Promise<string>;
  deleteModel(modelKey: string): Promise<void>;
};

export function ModelsScreen(props: { store: Store }) {
  const { store } = props;
  const styles = React.useMemo(() => createStyles(store.theme), [store.theme]);
  const [adding, setAdding] = React.useState(false);
  const [providerId, setProviderId] = React.useState(store.providers[0]?.id ?? "openai");
  const [modelId, setModelId] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [error, setError] = React.useState("");

  const addModel = async () => {
    try {
      setError("");
      await store.createModel({ providerId, modelId, displayName });
      setAdding(false);
      setModelId("");
      setDisplayName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>模型</Text>
      <Text style={styles.subtitle}>配置入口已经收敛到这里：先看状态，再去配置，再管理模型列表。</Text>

      {store.providers.map((provider) => {
        const status = store.providerStatusMap[provider.id] ?? "unconfigured";
        const models = store.listProviderModels(provider.id);
        return (
          <View key={provider.id} style={styles.card}>
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.providerName}>{provider.label}</Text>
                <Text style={styles.providerStatus}>
                  {status === "configured" ? "已配置" : status === "pending_commit" ? "待提交" : "未配置"}
                </Text>
              </View>
              <Pressable style={styles.button} onPress={() => store.openProviderSetup(provider.id)}>
                <Text style={styles.buttonText}>{status === "unconfigured" ? "去配置" : "更新配置"}</Text>
              </Pressable>
            </View>
            {models.length ? (
              <View style={styles.modelList}>
                {models.map((model) => (
                  <View key={model.key} style={styles.modelRow}>
                    <View style={styles.modelTextWrap}>
                      <Text style={styles.modelName}>{model.displayName}</Text>
                      <Text style={styles.modelMeta}>{model.modelId}</Text>
                    </View>
                    <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void store.deleteModel(model.key)}>
                      <Text style={[styles.buttonText, styles.secondaryButtonText]}>删除</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.empty}>当前 Provider 还没有模型，请点击“新增模型”。</Text>
            )}
          </View>
        );
      })}

      <View style={styles.card}>
        <Text style={styles.providerName}>新增模型</Text>
        <Text style={styles.subtitle}>新增 Provider 配置请先走向导；模型名可在下方手动维护。</Text>
        <Pressable style={styles.button} onPress={() => store.openProviderSetup()}>
          <Text style={styles.buttonText}>打开配置向导</Text>
        </Pressable>
        {!adding ? (
          <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => setAdding(true)}>
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>手动新增模型名</Text>
          </Pressable>
        ) : (
          <>
            <View style={styles.optionList}>
              {store.providers.map((provider) => (
                <Pressable
                  key={provider.id}
                  style={[styles.optionButton, providerId === provider.id ? styles.optionButtonActive : null]}
                  onPress={() => setProviderId(provider.id)}
                >
                  <Text style={[styles.optionText, providerId === provider.id ? styles.optionTextActive : null]}>{provider.label}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.input}
              value={modelId}
              onChangeText={setModelId}
              placeholder="模型 ID（例如 MiniMax-M2.5）"
              placeholderTextColor={store.theme.color.onSurfaceVariant}
            />
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="展示名（可选）"
              placeholderTextColor={store.theme.color.onSurfaceVariant}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actionRow}>
              <Pressable style={styles.button} onPress={() => void addModel()}>
                <Text style={styles.buttonText}>保存</Text>
              </Pressable>
              <Pressable
                style={[styles.button, styles.secondaryButton]}
                onPress={() => {
                  setAdding(false);
                  setError("");
                }}
              >
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>取消</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function createStyles(theme: MaterialTheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.color.background },
    content: { padding: 16, paddingBottom: 24, gap: 10 },
    title: { color: theme.color.onSurface, fontSize: 24, fontWeight: "900" },
    subtitle: { color: theme.color.onSurfaceVariant, fontSize: 12, lineHeight: 18 },
    card: {
      backgroundColor: theme.color.surface,
      borderWidth: 1,
      borderColor: theme.color.outline,
      borderRadius: theme.radius.lg,
      padding: 12,
      gap: 8
    },
    headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
    providerName: { color: theme.color.onSurface, fontSize: 16, fontWeight: "800" },
    providerStatus: { color: theme.color.onSurfaceVariant, fontSize: 12, marginTop: 2 },
    modelList: { gap: 8, marginTop: 4 },
    modelRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      borderWidth: 1,
      borderColor: theme.color.outline,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.surface2,
      padding: 10,
      gap: 8
    },
    modelTextWrap: { flex: 1, gap: 2 },
    modelName: { color: theme.color.onSurface, fontSize: 13, fontWeight: "700" },
    modelMeta: { color: theme.color.onSurfaceVariant, fontSize: 11 },
    optionList: { gap: 8 },
    optionButton: {
      borderWidth: 1,
      borderColor: theme.color.outline,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.surface2,
      paddingHorizontal: 12,
      paddingVertical: 12,
      alignItems: "center"
    },
    optionButtonActive: {
      borderColor: theme.color.primary,
      backgroundColor: theme.color.primary
    },
    optionText: { color: theme.color.onSurface, fontWeight: "700" },
    optionTextActive: { color: theme.color.onPrimary },
    input: {
      backgroundColor: theme.color.surface2,
      borderWidth: 1,
      borderColor: theme.color.outline,
      color: theme.color.onSurface,
      borderRadius: theme.radius.md,
      paddingHorizontal: 10,
      paddingVertical: 10
    },
    actionRow: { flexDirection: "row", gap: 8 },
    button: {
      backgroundColor: theme.color.primary,
      borderRadius: theme.radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center"
    },
    buttonText: { color: theme.color.onPrimary, fontSize: 12, fontWeight: "800" },
    secondaryButton: { backgroundColor: theme.color.surface2 },
    secondaryButtonText: { color: theme.color.onSurface },
    empty: { color: theme.color.onSurfaceVariant, fontSize: 12 },
    error: { color: theme.color.error, fontSize: 12 }
  });
}
