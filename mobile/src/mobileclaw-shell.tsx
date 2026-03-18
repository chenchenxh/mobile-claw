import React, { useMemo, useRef, useState } from "react";
import {
  DrawerLayoutAndroid,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import { useMobileClaw, type DrawerTab } from "./use-mobileclaw";
import { ChatScreen } from "./screens/chat-screen";
import { ChannelsScreen } from "./screens/channels-screen";
import { ToolsScreen } from "./screens/tools-screen";
import { SettingsScreen } from "./screens/settings-screen";

const items: Array<{ key: DrawerTab; label: string }> = [
  { key: "chat", label: "Chat" },
  { key: "channels", label: "Channels" },
  { key: "tools", label: "Tools" },
  { key: "settings", label: "Settings" }
];

export function MobileClawShell() {
  const drawerRef = useRef<DrawerLayoutAndroid>(null);
  const store = useMobileClaw();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const content = useMemo(() => {
    if (!store.ready) return <Text style={styles.loading}>Loading MobileClaw...</Text>;
    if (store.activeTab === "channels") {
      return (
        <ChannelsScreen
          channels={store.channels}
          activeChannelId={store.channelId}
          onCreate={(name) => store.createChannel(name)}
          onSelect={(id) => {
            store.switchChannel(id);
            store.setActiveTab("chat");
          }}
        />
      );
    }
    if (store.activeTab === "tools") return <ToolsScreen />;
    if (store.activeTab === "settings") return <SettingsScreen />;
    return (
      <ChatScreen
        messages={store.messages}
        onSend={store.send}
        currentModel={(store.session?.modelId as "small" | "large") ?? "small"}
        onSwitchModel={store.switchModel}
      />
    );
  }, [store]);

  return (
    <DrawerLayoutAndroid
      ref={drawerRef}
      drawerWidth={280}
      drawerPosition="left"
      onDrawerOpen={() => setDrawerOpen(true)}
      onDrawerClose={() => setDrawerOpen(false)}
      renderNavigationView={() => (
        <View style={styles.drawer}>
          <Text style={styles.drawerTitle}>MobileClaw</Text>
          {items.map((item) => (
            <Pressable
              key={item.key}
              onPress={() => {
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
        <Pressable style={styles.menuButton} onPress={() => (drawerOpen ? drawerRef.current?.closeDrawer() : drawerRef.current?.openDrawer())}>
          <Text style={styles.menuButtonText}>≡</Text>
        </Pressable>
        {content}
      </View>
    </DrawerLayoutAndroid>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B1220" },
  drawer: { flex: 1, backgroundColor: "#111827", paddingTop: 24, paddingHorizontal: 16 },
  drawerTitle: { color: "#F9FAFB", fontSize: 22, fontWeight: "700", marginBottom: 16 },
  drawerItem: { paddingVertical: 12, paddingHorizontal: 10, borderRadius: 10, marginBottom: 8 },
  drawerItemActive: { backgroundColor: "#1F2937" },
  drawerItemText: { color: "#E5E7EB", fontSize: 16 },
  menuButton: {
    width: 40,
    height: 40,
    marginLeft: 12,
    marginTop: 12,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1F2937",
    borderRadius: 8
  },
  menuButtonText: { color: "#F9FAFB", fontSize: 22, marginTop: -4 },
  loading: { color: "#CBD5E1", marginTop: 16, marginHorizontal: 16, fontSize: 16 }
});
