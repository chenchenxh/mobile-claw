import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { AuthMode, OAuthClientConfig } from "../../../src/types/contracts";
import type { MaterialTheme } from "../theme/material";

type Store = {
  theme: MaterialTheme;
  providers: ReadonlyArray<{ id: string; label: string }>;
  providerCredentialMap: Record<string, string>;
  onboardingRequired: boolean;
  finishOnboarding(): void;
  oauthWizard: {
    step: "provider" | "auth_mode" | "param_source" | "params" | "authorize" | "exchange" | "done";
    providerId?: string;
    authMode?: AuthMode;
    parameterSource?: "preset" | "manual";
    flowMode?: "initial" | "update";
    byokKey?: string;
    configDraft?: OAuthClientConfig;
    committed?: boolean;
    status?: string;
    error?: string;
  };
  oauthWizardBusy: boolean;
  oauthWizardSelectProvider(providerId: string): void;
  oauthWizardSelectAuthMode(mode: AuthMode): void;
  oauthWizardSelectMiniMaxRegion(region: "global" | "cn"): void;
  oauthWizardSelectParamSource(source: "preset" | "manual"): void;
  oauthWizardUpdateConfig(patch: Partial<OAuthClientConfig>): void;
  oauthWizardUpdateByokKey(key: string): void;
  oauthWizardBack(): void;
  oauthWizardNext(): void;
  oauthWizardRetry(): void;
  oauthWizardCancel(): void;
  oauthWizardExit(): void;
  oauthWizardApply(): Promise<void>;
  oauthWizardComplete(): Promise<void>;
};

const stepNameMap: Record<Store["oauthWizard"]["step"], string> = {
  provider: "选择模型提供商",
  auth_mode: "选择鉴权方式",
  param_source: "OAuth 参数来源",
  params: "填写密钥",
  authorize: "拉起授权与保存",
  exchange: "交换 Token",
  done: "完成配置"
};

const stepOrder: Record<Store["oauthWizard"]["step"], number> = {
  provider: 1,
  auth_mode: 2,
  param_source: 3,
  params: 3,
  authorize: 4,
  exchange: 4,
  done: 5
};

export function OnboardScreen(props: { store: Store }) {
  const { store } = props;
  const wizard = store.oauthWizard;
  const styles = React.useMemo(() => createStyles(store.theme), [store.theme]);
  const [scopesInput, setScopesInput] = React.useState((wizard.configDraft?.scopes ?? []).join(","));
  const [manualExpanded, setManualExpanded] = React.useState(false);

  React.useEffect(() => {
    setScopesInput((wizard.configDraft?.scopes ?? []).join(","));
  }, [wizard.configDraft?.scopes]);

  React.useEffect(() => {
    if (wizard.parameterSource !== "manual") setManualExpanded(false);
  }, [wizard.parameterSource]);

  const selectedProviderLabel = wizard.providerId
    ? store.providers.find((p) => p.id === wizard.providerId)?.label ?? wizard.providerId
    : "未选择";
  const miniMaxRegion = wizard.configDraft?.authEndpoint?.includes("minimaxi.com") ? "cn" : "global";

  const renderOAuthConfigSummary = () => {
    const config = wizard.configDraft;
    if (!config) return null;
    return (
      <View style={styles.summaryBox}>
        <Text style={styles.summaryLine}>auth: {config.authEndpoint || "-"}</Text>
        <Text style={styles.summaryLine}>token: {config.tokenEndpoint || "-"}</Text>
        <Text style={styles.summaryLine}>apiBase: {config.apiBaseUrl || "-"}</Text>
        <Text style={styles.summaryLine}>redirect: {config.redirectUri || "-"}</Text>
        <Text style={styles.summaryLine}>scopes: {(config.scopes ?? []).join(" ") || "-"}</Text>
        <Text style={styles.helper}>默认配置会使用内置参数自动授权；如果失败，再切到手动输入（高级）覆盖。</Text>
      </View>
    );
  };

  const progressChips = [
    { key: "provider", order: 1, label: "1. 提供商", value: selectedProviderLabel, done: Boolean(wizard.providerId) },
    {
      key: "auth_mode",
      order: 2,
      label: "2. 鉴权",
      value: wizard.authMode ? (wizard.authMode === "BYOK" ? "BYOK" : "OAuth") : "未选择",
      done: Boolean(wizard.authMode)
    },
    {
      key: "param_source",
      order: 3,
      label: "3. 参数",
      value: wizard.authMode === "BYOK" ? "无需参数配置" : (wizard.parameterSource === "manual" ? "手动输入" : "默认配置"),
      done: wizard.authMode === "BYOK" ? true : Boolean(wizard.parameterSource)
    },
    { key: "authorize", order: 4, label: "4. 授权", value: wizard.step === "exchange" || wizard.step === "done" ? "已执行" : "待执行", done: wizard.step === "done" || wizard.step === "exchange" },
    { key: "done", order: 5, label: "5. 完成", value: wizard.step === "done" ? "已完成" : "待完成", done: wizard.step === "done" }
  ];
  const currentOrder = stepOrder[wizard.step];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>配置向导</Text>
      {wizard.flowMode === "update" ? <Text style={styles.subtitle}>更新模式：只会在最后点击“更新配置”时生效。</Text> : null}
      <Text style={styles.subtitle}>当前步骤：第 {stepOrder[wizard.step]} 步 / 共 5 步 · {stepNameMap[wizard.step]}</Text>
      {store.onboardingRequired ? <Text style={styles.notice}>首次使用请先完成配置，再进入聊天。</Text> : null}
      {wizard.status ? <Text style={styles.status}>状态：{wizard.status}</Text> : null}
      {wizard.error ? <Text style={styles.error}>错误：{wizard.error}</Text> : null}

      <View style={styles.headerCard}>
        <Text style={styles.cardTitle}>步骤总览</Text>
        <View style={styles.stepWrap}>
          {progressChips.map((chip) => (
            <View
              key={chip.key}
              style={[
                styles.stepChip,
                chip.done ? styles.stepChipDone : null,
                chip.order === currentOrder ? styles.stepChipCurrent : null
              ]}
            >
              <Text
                style={[
                  styles.stepChipTitle,
                  chip.done ? styles.stepChipTitleDone : null,
                  chip.order === currentOrder ? styles.stepChipTitleCurrent : null
                ]}
              >
                {chip.label}
              </Text>
              <Text style={[styles.stepChipValue, chip.order === currentOrder ? styles.stepChipValueCurrent : null]}>{chip.value}</Text>
            </View>
          ))}
        </View>
      </View>

      {wizard.step === "provider" ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>第 1 步：选择模型提供商</Text>
          <View style={styles.optionList}>
            {store.providers.map((provider) => (
              <Pressable
                key={provider.id}
                style={[styles.optionButton, wizard.providerId === provider.id ? styles.optionButtonActive : null]}
                onPress={() => store.oauthWizardSelectProvider(provider.id)}
              >
                <Text style={[styles.optionButtonText, wizard.providerId === provider.id ? styles.optionButtonTextActive : null]}>
                  {provider.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.providerStatusList}>
            {store.providers.map((provider) => (
              <View key={provider.id} style={styles.providerStatusRow}>
                <Text style={styles.providerName}>{provider.label}</Text>
                <Text style={styles.providerValue}>{store.providerCredentialMap[provider.id] ? "已配置" : "未配置"}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {wizard.step === "auth_mode" ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>第 2 步：选择鉴权方式</Text>
          <Text style={styles.helper}>当前提供商：{selectedProviderLabel}</Text>
          <View style={styles.optionList}>
            <Pressable style={[styles.optionButton, wizard.authMode === "BYOK" ? styles.optionButtonActive : null]} onPress={() => store.oauthWizardSelectAuthMode("BYOK")}>
              <Text style={[styles.optionButtonText, wizard.authMode === "BYOK" ? styles.optionButtonTextActive : null]}>BYOK（API Key）</Text>
            </Pressable>
            <Pressable style={[styles.optionButton, wizard.authMode === "OAUTH" ? styles.optionButtonActive : null]} onPress={() => store.oauthWizardSelectAuthMode("OAUTH")}>
              <Text style={[styles.optionButtonText, wizard.authMode === "OAUTH" ? styles.optionButtonTextActive : null]}>OAuth（网页授权）</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {wizard.step === "param_source" && wizard.authMode === "OAUTH" ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>第 3 步：参数来源</Text>
          <Text style={styles.helper}>默认推荐直接可用；手动输入仅用于高级调试。</Text>
          {wizard.providerId === "minimax" ? (
            <View style={styles.optionList}>
              <Pressable
                style={[styles.optionButton, miniMaxRegion === "global" ? styles.optionButtonActive : null]}
                onPress={() => store.oauthWizardSelectMiniMaxRegion("global")}
              >
                <Text style={[styles.optionButtonText, miniMaxRegion === "global" ? styles.optionButtonTextActive : null]}>Global</Text>
              </Pressable>
              <Pressable
                style={[styles.optionButton, miniMaxRegion === "cn" ? styles.optionButtonActive : null]}
                onPress={() => store.oauthWizardSelectMiniMaxRegion("cn")}
              >
                <Text style={[styles.optionButtonText, miniMaxRegion === "cn" ? styles.optionButtonTextActive : null]}>CN</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.optionList}>
            <Pressable
              style={[styles.optionButton, wizard.parameterSource === "preset" ? styles.optionButtonActive : null]}
              onPress={() => store.oauthWizardSelectParamSource("preset")}
            >
              <Text style={[styles.optionButtonText, wizard.parameterSource === "preset" ? styles.optionButtonTextActive : null]}>默认配置</Text>
            </Pressable>
            <Pressable
              style={[styles.optionButton, wizard.parameterSource === "manual" ? styles.optionButtonActive : null]}
              onPress={() => store.oauthWizardSelectParamSource("manual")}
            >
              <Text style={[styles.optionButtonText, wizard.parameterSource === "manual" ? styles.optionButtonTextActive : null]}>手动输入</Text>
            </Pressable>
          </View>
          {wizard.parameterSource === "manual" ? (
            <>
              <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => setManualExpanded((prev) => !prev)}>
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>{manualExpanded ? "收起高级参数" : "展开高级参数"}</Text>
              </Pressable>
              {manualExpanded ? (
                <>
                  <TextInput
                    style={styles.input}
                    value={wizard.configDraft?.clientId ?? ""}
                    onChangeText={(value) => store.oauthWizardUpdateConfig({ clientId: value })}
                    placeholder="clientId"
                    placeholderTextColor={store.theme.color.onSurfaceVariant}
                  />
                  <TextInput
                    style={styles.input}
                    value={wizard.configDraft?.authEndpoint ?? ""}
                    onChangeText={(value) => store.oauthWizardUpdateConfig({ authEndpoint: value })}
                    placeholder="authEndpoint"
                    placeholderTextColor={store.theme.color.onSurfaceVariant}
                  />
                  <TextInput
                    style={styles.input}
                    value={wizard.configDraft?.tokenEndpoint ?? ""}
                    onChangeText={(value) => store.oauthWizardUpdateConfig({ tokenEndpoint: value })}
                    placeholder="tokenEndpoint"
                    placeholderTextColor={store.theme.color.onSurfaceVariant}
                  />
                  <TextInput
                    style={styles.input}
                    value={wizard.configDraft?.redirectUri ?? ""}
                    onChangeText={(value) => store.oauthWizardUpdateConfig({ redirectUri: value })}
                    placeholder="redirectUri"
                    placeholderTextColor={store.theme.color.onSurfaceVariant}
                  />
                  <TextInput
                    style={styles.input}
                    value={scopesInput}
                    onChangeText={(value) => {
                      setScopesInput(value);
                      store.oauthWizardUpdateConfig({
                        scopes: value.split(",").map((v) => v.trim()).filter(Boolean)
                      });
                    }}
                    placeholder="scopes（逗号分隔）"
                    placeholderTextColor={store.theme.color.onSurfaceVariant}
                  />
                </>
              ) : null}
              <Pressable style={styles.button} onPress={store.oauthWizardNext}>
                <Text style={styles.buttonText}>继续</Text>
              </Pressable>
            </>
          ) : (
            renderOAuthConfigSummary()
          )}
        </View>
      ) : null}

      {wizard.step === "params" && wizard.authMode === "BYOK" ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>第 3 步：填写 API Key</Text>
          {wizard.providerId === "minimax" ? (
            <>
              <Text style={styles.helper}>请先选择你的 MiniMax 区域（Global/CN），否则可能出现 401。</Text>
              <View style={styles.optionList}>
                <Pressable
                  style={[styles.optionButton, miniMaxRegion === "global" ? styles.optionButtonActive : null]}
                  onPress={() => store.oauthWizardSelectMiniMaxRegion("global")}
                >
                  <Text style={[styles.optionButtonText, miniMaxRegion === "global" ? styles.optionButtonTextActive : null]}>Global</Text>
                </Pressable>
                <Pressable
                  style={[styles.optionButton, miniMaxRegion === "cn" ? styles.optionButtonActive : null]}
                  onPress={() => store.oauthWizardSelectMiniMaxRegion("cn")}
                >
                  <Text style={[styles.optionButtonText, miniMaxRegion === "cn" ? styles.optionButtonTextActive : null]}>CN</Text>
                </Pressable>
              </View>
              <Text style={styles.helper}>当前 baseUrl：{wizard.configDraft?.apiBaseUrl ?? "-"}</Text>
            </>
          ) : null}
          <TextInput
            style={styles.input}
            value={wizard.byokKey ?? ""}
            onChangeText={store.oauthWizardUpdateByokKey}
            placeholder="输入 API Key"
            placeholderTextColor={store.theme.color.onSurfaceVariant}
            secureTextEntry
          />
          <Pressable
            style={[styles.button, store.oauthWizardBusy ? styles.buttonDisabled : null]}
            disabled={store.oauthWizardBusy}
            onPress={() => {
              void store.oauthWizardComplete();
            }}
          >
            <Text style={styles.buttonText}>{store.oauthWizardBusy ? "保存中..." : "保存并继续"}</Text>
          </Pressable>
        </View>
      ) : null}

      {(wizard.step === "authorize" || wizard.step === "exchange") ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>第 4 步：执行授权/保存</Text>
          {wizard.authMode === "OAUTH" ? renderOAuthConfigSummary() : null}
          <Text style={styles.helper}>
            {wizard.authMode === "BYOK"
              ? "将直接保存当前 API Key。"
              : "点击后会拉起网页授权，回到 App 后自动交换 Token 并保存。"}
          </Text>
          <Pressable
            style={[styles.button, store.oauthWizardBusy ? styles.buttonDisabled : null]}
            disabled={store.oauthWizardBusy}
            onPress={() => {
              void store.oauthWizardComplete();
            }}
          >
            <Text style={styles.buttonText}>
              {store.oauthWizardBusy ? "处理中..." : wizard.authMode === "BYOK" ? "保存 API Key" : "打开授权网页并继续"}
            </Text>
          </Pressable>
          {wizard.error ? (
            <Pressable style={[styles.button, styles.secondaryButton]} onPress={store.oauthWizardRetry}>
              <Text style={[styles.buttonText, styles.secondaryButtonText]}>重试</Text>
            </Pressable>
          ) : null}
          {store.oauthWizardBusy ? (
            <Pressable style={[styles.button, styles.secondaryButton]} onPress={store.oauthWizardCancel}>
              <Text style={[styles.buttonText, styles.secondaryButtonText]}>停止当前授权流程</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {wizard.step === "done" ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>第 5 步：确认并更新</Text>
          <Text style={styles.helper}>当前配置已准备就绪。点击“更新配置”才会写入；点击“退出”不会修改现有配置。</Text>
          <Pressable
            style={styles.button}
            onPress={() => {
              void store.oauthWizardApply();
            }}
          >
            <Text style={styles.buttonText}>更新配置</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.secondaryButton]} onPress={store.oauthWizardExit}>
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>退出（不保存）</Text>
          </Pressable>
        </View>
      ) : null}

      {wizard.step !== "provider" ? (
        <View style={styles.row}>
          <Pressable style={[styles.button, styles.secondaryButton]} onPress={store.oauthWizardBack}>
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>上一步</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.secondaryButton]} onPress={store.oauthWizardExit}>
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>退出</Text>
          </Pressable>
        </View>
      ) : null}
      {wizard.step === "provider" && wizard.flowMode === "update" ? (
        <View style={styles.row}>
          <Pressable style={[styles.button, styles.secondaryButton]} onPress={store.oauthWizardExit}>
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>退出</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

function createStyles(theme: MaterialTheme) {
  return StyleSheet.create({
    container: { flex: 1, padding: 16, backgroundColor: theme.color.background },
    content: { paddingBottom: 24, gap: 10 },
    title: { color: theme.color.onSurface, fontSize: 24, fontWeight: "900" },
    subtitle: { color: theme.color.onSurfaceVariant, fontSize: 12, lineHeight: 18, marginTop: 4 },
    notice: {
      color: theme.color.onPrimary,
      backgroundColor: theme.color.primary,
      borderRadius: theme.radius.md,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 12
    },
    status: { color: theme.color.secondary, fontSize: 12 },
    error: { color: theme.color.error, fontSize: 12 },
    headerCard: {
      backgroundColor: theme.color.surface,
      borderWidth: 1,
      borderColor: theme.color.outline,
      borderRadius: theme.radius.lg,
      padding: 12,
      gap: 8
    },
    stepWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    stepChip: {
      width: "100%",
      backgroundColor: theme.color.surface2,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.color.outline,
      paddingHorizontal: 10,
      paddingVertical: 8
    },
    stepChipDone: {
      borderColor: theme.color.secondary,
      backgroundColor: theme.mode === "dark" ? "#123A34" : "#DFF3EE"
    },
    stepChipCurrent: {
      borderColor: theme.color.primary,
      borderWidth: 2,
      backgroundColor: theme.mode === "dark" ? "#1C3560" : "#DBE9FF"
    },
    stepChipTitle: { color: theme.color.onSurfaceVariant, fontSize: 11, fontWeight: "800" },
    stepChipTitleDone: { color: theme.color.secondary },
    stepChipTitleCurrent: { color: theme.color.primary },
    stepChipValue: { color: theme.color.onSurface, fontSize: 12, marginTop: 3, fontWeight: "700" },
    stepChipValueCurrent: { color: theme.color.onSurface, fontWeight: "800" },
    card: {
      backgroundColor: theme.color.surface,
      borderWidth: 1,
      borderColor: theme.color.outline,
      borderRadius: theme.radius.lg,
      padding: 12,
      gap: 8
    },
    cardTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "800" },
    helper: { color: theme.color.onSurfaceVariant, fontSize: 12, lineHeight: 18 },
    summaryBox: {
      borderWidth: 1,
      borderColor: theme.color.outline,
      backgroundColor: theme.color.surface2,
      borderRadius: theme.radius.md,
      padding: 10,
      gap: 3
    },
    summaryLine: { color: theme.color.onSurface, fontSize: 12 },
    input: {
      backgroundColor: theme.color.surface2,
      color: theme.color.onSurface,
      borderWidth: 1,
      borderColor: theme.color.outline,
      borderRadius: theme.radius.md,
      paddingHorizontal: 10,
      paddingVertical: 10
    },
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
    optionList: { gap: 8 },
    optionButton: {
      backgroundColor: theme.color.surface2,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.color.outline,
      paddingHorizontal: 12,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center"
    },
    optionButtonActive: {
      backgroundColor: theme.color.primary,
      borderColor: theme.color.primary
    },
    optionButtonText: { color: theme.color.onSurface, fontWeight: "700", fontSize: 13 },
    optionButtonTextActive: { color: theme.color.onPrimary },
    button: {
      backgroundColor: theme.color.primary,
      borderRadius: theme.radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center"
    },
    buttonActive: { borderWidth: 1, borderColor: theme.color.secondary, backgroundColor: theme.color.secondary },
    buttonText: { color: theme.color.onPrimary, fontWeight: "700", fontSize: 12 },
    buttonTextActive: { color: theme.color.onPrimary },
    secondaryButton: { backgroundColor: theme.color.surface2 },
    secondaryButtonText: { color: theme.color.onSurface },
    buttonDisabled: { opacity: 0.6 },
    providerStatusList: {
      marginTop: 6,
      padding: 8,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.color.outline,
      backgroundColor: theme.color.surface2,
      gap: 4
    },
    providerStatusRow: { flexDirection: "row", justifyContent: "space-between" },
    providerName: { color: theme.color.onSurface, fontSize: 12, fontWeight: "700" },
    providerValue: { color: theme.color.onSurfaceVariant, fontSize: 12 }
  });
}
