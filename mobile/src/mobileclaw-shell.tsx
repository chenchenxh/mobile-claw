import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DrawerLayoutAndroid,
  Keyboard,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from "react-native";
import { useMobileClaw, type DrawerTab } from "./use-mobileclaw";
import { ChatScreen } from "./screens/chat-screen";
import { OnboardScreen } from "./screens/onboard-screen";
import { SessionsScreen } from "./screens/channels-screen";
import { ToolsScreen } from "./screens/tools-screen";
import { SecurityScreen } from "./screens/security-screen";
import { SettingsScreen } from "./screens/settings-screen";
import { ModelsScreen } from "./screens/models-screen";
import { LogsScreen } from "./screens/logs-screen";
import { InternalScreen } from "./screens/internal-screen";
import type { MaterialTheme } from "./theme/material";

const baseItems: Array<{ key: DrawerTab; label: string }> = [
  { key: "chat", label: "聊天" },
  { key: "models", label: "模型" },
  { key: "sessions", label: "会话" },
  { key: "tasks", label: "定时任务" },
  { key: "security", label: "审批与安全" },
  { key: "logs", label: "日志" }
];

export function MobileClawShell() {
  const drawerRef = useRef<DrawerLayoutAndroid>(null);
  const store = useMobileClaw();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const styles = useMemo(() => createStyles(store.theme), [store.theme]);
  const items = useMemo(
    () =>
      store.developerModeEnabled
        ? [...baseItems, { key: "internal" as DrawerTab, label: "内部配置" }, { key: "settings" as DrawerTab, label: "设置" }]
        : [...baseItems, { key: "settings" as DrawerTab, label: "设置" }],
    [store.developerModeEnabled]
  );

  useEffect(() => {
    if (!store.developerModeEnabled && store.activeTab === "internal") {
      store.setActiveTab("settings");
    }
  }, [store.developerModeEnabled, store.activeTab, store.setActiveTab]);

  const content = useMemo(() => {
    if (!store.ready) return <Text style={styles.loading}>正在加载 MobileClaw...</Text>;
    if (store.activeTab === "onboard") return <OnboardScreen store={store} />;
    if (store.activeTab === "models") return <ModelsScreen store={store} />;
    if (store.activeTab === "sessions") {
      return (
        <SessionsScreen
          theme={store.theme}
          sessions={store.sessions.map((session) => ({
            ...session,
            defaultModel: store.getSessionModelDisplay(session.id)
          }))}
          activeSessionId={store.sessionId}
          onCreate={(name) => store.createSession(name)}
          onRename={store.renameSession}
          onSelect={(id) => {
            store.switchSession(id);
            store.setActiveTab("chat");
          }}
          onDelete={store.deleteSession}
        />
      );
    }
    if (store.activeTab === "tasks") {
      return (
        <ToolsScreen
          theme={store.theme}
          sessionId={store.sessionId}
          cronJobs={store.cronJobs}
          cronExecutionRecords={store.cronExecutionRecords}
          toolExecutionRecords={store.toolExecutionRecords}
          onRetry={store.retryCronJob}
          onRunNow={store.runCronJobNow}
        />
      );
    }
    if (store.activeTab === "security") {
      return (
        <SecurityScreen
          theme={store.theme}
          pendingApprovals={store.pendingApprovals}
          pendingPermissionRequests={store.pendingPermissionRequests}
          cronPermissionGrants={store.cronPermissionGrants}
          permissionGrants={store.permissionGrants}
          onApprove={store.approveCronRequest}
          onReject={store.rejectCronRequest}
          onApprovePermission={store.approvePermissionRequest}
          onRejectPermission={store.rejectPermissionRequest}
        />
      );
    }
    if (store.activeTab === "internal") return <InternalScreen store={store} />;
    if (store.activeTab === "logs") return <LogsScreen store={store} />;
    if (store.activeTab === "settings") return <SettingsScreen store={store} />;
    return (
      <ChatScreen
        theme={store.theme}
        messages={store.messages}
        collapsedFlowGroupIds={store.collapsedFlowGroupIds}
        onToggleFlowGroup={store.toggleFlowGroup}
        onSend={store.send}
        onStopToolLoop={store.stopToolLoop}
        onRetry={store.retryLast}
        isSending={store.isSending}
        isToolLooping={store.isToolLooping}
        sendStartedAt={store.sendStartedAt}
        sendTimeoutLevel={store.sendTimeoutLevel}
        sendTimeoutDismissed={store.sendTimeoutDismissed}
        onClearSendTimeoutHint={store.clearSendTimeoutHint}
        onRefresh={() => store.refreshSessionSnapshot()}
        currentModel={store.currentModel}
        onSwitchModel={store.switchModel}
        availableModels={store.availableModels}
        onOpenModels={store.openModels}
        pendingApprovalPeek={store.pendingApprovalPeek}
        onApproveTopPending={store.approveTopPending}
        onRejectTopPending={store.rejectTopPending}
        onOpenSecurity={() => store.setActiveTab("security")}
        sessionId={store.sessionId}
        sessionName={store.sessions.find((c) => c.id === store.sessionId)?.name ?? "聊天"}
        resolvedModelName={store.currentModelInfo?.displayName ?? store.resolvedModel?.displayName ?? ""}
        errorText={store.lastError}
      />
    );
  }, [store, styles.loading]);

  const barStyle = store.theme.mode === "dark" ? "light-content" : "dark-content";

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle={barStyle} backgroundColor={store.theme.color.background} />
      <DrawerLayoutAndroid
        ref={drawerRef}
        drawerWidth={300}
        drawerPosition="left"
        onDrawerOpen={() => {
          Keyboard.dismiss();
          setDrawerOpen(true);
        }}
        onDrawerClose={() => setDrawerOpen(false)}
        renderNavigationView={() => (
          <View style={styles.drawer}>
            <Text style={styles.drawerTitle}>MobileClaw</Text>
            {items.map((item) => (
              <Pressable
                key={item.key}
                onPress={() => {
                  Keyboard.dismiss();
                  store.setActiveTab(item.key);
                  drawerRef.current?.closeDrawer();
                }}
                style={[
                  styles.drawerItem,
                  store.activeTab === item.key ? styles.drawerItemActive : null
                ]}
              >
                <Text style={styles.drawerItemText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      >
        <View style={styles.container}>
          <Pressable
            style={styles.menuButton}
            onPress={() => {
              Keyboard.dismiss();
              if (drawerOpen) drawerRef.current?.closeDrawer();
              else drawerRef.current?.openDrawer();
            }}
          >
            <Text style={styles.menuButtonText}>≡</Text>
          </Pressable>
          {content}
        </View>
      </DrawerLayoutAndroid>
    </SafeAreaView>
  );
}

function createStyles(theme: MaterialTheme) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.color.background },
    container: { flex: 1, backgroundColor: theme.color.background },
    drawer: { flex: 1, backgroundColor: theme.color.surface, paddingTop: 28, paddingHorizontal: 16 },
    drawerTitle: { color: theme.color.onSurface, fontSize: 22, fontWeight: "800", marginBottom: 16 },
    drawerItem: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: theme.radius.md, marginBottom: 8, borderWidth: 1, borderColor: "transparent" },
    drawerItemActive: { backgroundColor: theme.color.surface2, borderColor: theme.color.outline },
    drawerItemText: { color: theme.color.onSurface, fontSize: 16, fontWeight: "700" },
    menuButton: {
      width: 42,
      height: 42,
      marginLeft: 12,
      marginTop: 12,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: theme.color.surface,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.color.outline
    },
    menuButtonText: { color: theme.color.onSurface, fontSize: 22, marginTop: -4 },
    loading: { color: theme.color.onSurfaceVariant, marginTop: 16, marginHorizontal: 16, fontSize: 16 }
  });
}
