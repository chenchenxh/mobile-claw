import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AssetDoc, AssetListScope, AssetTreeNode, AssetViewerRole } from "../../../src/types/contracts";
import { appLogger } from "../../../src/core/observability/app-logger";
import { MarkdownLite } from "../components/markdown";
import type { MaterialTheme } from "../theme/material";

type Store = {
  theme: MaterialTheme;
  sessionId: string;
  listAssets(
    role: AssetViewerRole,
    options?: {
      scope?: AssetListScope;
      channelId?: string;
    }
  ): AssetDoc[];
  listAssetTree(
    role: AssetViewerRole,
    options?: {
      scope?: AssetListScope;
      channelId?: string;
    }
  ): AssetTreeNode[];
  readAsset(role: AssetViewerRole, path: string): AssetDoc | null;
  exportAsset(path: string): string | null;
};

type ScopeTab = "workspace_shared" | "channel_session" | "cron" | "all";

export function InternalScreen(props: { store: Store }) {
  const styles = React.useMemo(() => createStyles(props.store.theme), [props.store.theme]);
  const [scope, setScope] = React.useState<ScopeTab>("workspace_shared");
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({
    workspace: true,
    agents: true,
    "agents/main": true,
    "agents/main/sessions": true
  });
  const options = React.useMemo(
    () => ({
      scope,
      channelId: props.store.sessionId
    }),
    [props.store.sessionId, scope]
  );
  const tree = React.useMemo(() => props.store.listAssetTree("developer", options), [options, props.store]);
  const docs = React.useMemo(() => props.store.listAssets("developer", options), [options, props.store]);
  const [selectedPath, setSelectedPath] = React.useState<string>("workspace/AGENTS.md");

  React.useEffect(() => {
    if (!docs.length) return;
    const fallback = docs.find((doc) => doc.path === "workspace/AGENTS.md")?.path ?? docs[0]?.path ?? "";
    const exists = docs.some((doc) => doc.path === selectedPath);
    if (!selectedPath || !exists) setSelectedPath(fallback);
  }, [docs, selectedPath]);

  const selected = React.useMemo(() => {
    if (!selectedPath) return null;
    return props.store.readAsset("developer", selectedPath);
  }, [props.store, selectedPath]);

  React.useEffect(() => {
    appLogger.info({
      module: "asset",
      event: "asset_read",
      message: "进入内部配置页",
      context: { role: "developer", count: docs.length, scope, sessionId: props.store.sessionId }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderTree = (nodes: AssetTreeNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const isDir = node.type === "dir";
      const isOpen = expanded[node.path] ?? (depth < 2);
      const isActive = selectedPath === node.path;
      const hasChildren = Boolean(node.children?.length);
      return (
        <View key={node.path}>
          <Pressable
            style={[
              styles.treeRow,
              { paddingLeft: 10 + depth * 12 },
              isActive ? styles.treeRowActive : null
            ]}
            onPress={() => {
              if (isDir) {
                setExpanded((prev) => ({ ...prev, [node.path]: !isOpen }));
                return;
              }
              setSelectedPath(node.path);
              appLogger.info({
                module: "asset",
                event: "asset_read",
                message: "切换内部配置文档",
                context: { path: node.path, scope, sessionId: props.store.sessionId }
              });
            }}
          >
            <Text style={styles.treeIcon}>{isDir ? (isOpen ? "▾" : "▸") : "·"}</Text>
            <Text numberOfLines={1} style={[styles.treeText, isActive ? styles.treeTextActive : null]}>
              {node.name}
            </Text>
            {isDir && hasChildren ? <Text style={styles.treeCount}>{node.children?.length ?? 0}</Text> : null}
          </Pressable>
          {isDir && isOpen && hasChildren ? renderTree(node.children ?? [], depth + 1) : null}
        </View>
      );
    });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>内部配置</Text>
        <Text style={styles.hint}>当前会话：{props.store.sessionId}</Text>
      </View>
      <View style={styles.scopeRow}>
        {[
          { id: "workspace_shared" as const, label: "Workspace" },
          { id: "channel_session" as const, label: "当前会话" },
          { id: "cron" as const, label: "Cron" },
          { id: "all" as const, label: "全部" }
        ].map((tab) => (
          <Pressable
            key={tab.id}
            style={[styles.scopeChip, scope === tab.id ? styles.scopeChipActive : null]}
            onPress={() => setScope(tab.id)}
          >
            <Text style={[styles.scopeChipText, scope === tab.id ? styles.scopeChipTextActive : null]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
        <View style={styles.treePanel}>
          {tree.length ? renderTree(tree, 0) : <Text style={styles.empty}>当前范围无资产</Text>}
        </View>
        <View style={styles.previewPanel}>
          {selected ? (
            <View style={styles.card}>
              <View style={styles.fileHead}>
                <Text style={styles.fileName}>文件：{selected.name}</Text>
                <Text style={styles.filePath}>Path：{selected.path}</Text>
              </View>
              <Text style={styles.meta}>更新时间：{new Date(selected.updatedAt).toLocaleString()}</Text>
              <Pressable
                style={styles.exportButton}
                onPress={() => {
                  appLogger.info({
                    module: "asset",
                    event: "asset_export",
                    message: "点击导出资产",
                    context: { path: selected.path }
                  });
                }}
              >
                <Text style={styles.exportText}>导出（预留）: {props.store.exportAsset(selected.path) ? "可用" : "无内容"}</Text>
              </Pressable>
              <View style={styles.divider} />
              <MarkdownLite text={selected.contentMd} theme={props.store.theme} />
            </View>
          ) : (
            <Text style={styles.empty}>请选择上方文件</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function createStyles(theme: MaterialTheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.color.background, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 },
    header: { marginBottom: 6 },
    title: { color: theme.color.onSurface, fontSize: 18, fontWeight: "900" },
    hint: { color: theme.color.onSurfaceVariant, fontSize: 11, marginTop: 2 },
    scopeRow: { flexDirection: "row", gap: 6, marginBottom: 8 },
    page: { flex: 1 },
    pageContent: { paddingBottom: 20 },
    scopeChip: {
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.color.outline,
      backgroundColor: theme.color.surface2,
      paddingHorizontal: 8,
      paddingVertical: 5
    },
    scopeChipActive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
    scopeChipText: { color: theme.color.onSurface, fontSize: 11, fontWeight: "700" },
    scopeChipTextActive: { color: theme.color.onPrimary },
    treePanel: {
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.color.outline,
      backgroundColor: theme.color.surface,
      marginBottom: 8
    },
    treeRow: {
      minHeight: 30,
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.outline,
      paddingRight: 8
    },
    treeRowActive: { backgroundColor: theme.color.secondaryContainer },
    treeIcon: { width: 12, color: theme.color.onSurfaceVariant, fontSize: 10 },
    treeText: { flex: 1, color: theme.color.onSurface, fontSize: 11, fontWeight: "600" },
    treeTextActive: { color: theme.color.onSecondaryContainer, fontWeight: "800" },
    treeCount: { color: theme.color.onSurfaceVariant, fontSize: 10 },
    previewPanel: {
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.color.outline,
      backgroundColor: theme.color.surface,
      marginBottom: 8
    },
    card: {
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.color.outline,
      backgroundColor: theme.color.surface,
      padding: 8,
      gap: 6
    },
    fileHead: {
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.color.outline,
      backgroundColor: theme.color.surface2,
      paddingHorizontal: 8,
      paddingVertical: 6
    },
    fileName: { color: theme.color.onSurface, fontSize: 11, fontWeight: "800" },
    filePath: { color: theme.color.onSurfaceVariant, fontSize: 10, marginTop: 2 },
    meta: { color: theme.color.onSurfaceVariant, fontSize: 10 },
    exportButton: {
      borderWidth: 1,
      borderColor: theme.color.outline,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 8,
      paddingVertical: 6,
      backgroundColor: theme.color.surface2
    },
    exportText: { color: theme.color.onSurface, fontSize: 11, fontWeight: "700" },
    divider: { height: 1, backgroundColor: theme.color.outline, marginVertical: 2 },
    empty: { color: theme.color.onSurfaceVariant, marginTop: 10, marginHorizontal: 8, fontSize: 11 }
  });
}
