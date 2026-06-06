import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CronApprovalRequest, CronPermissionGrant, PermissionGrant, PermissionRequest } from "../../../src/types/contracts";
import type { MaterialTheme } from "../theme/material";

export function SecurityScreen(props: {
  theme: MaterialTheme;
  pendingApprovals: CronApprovalRequest[];
  pendingPermissionRequests: PermissionRequest[];
  cronPermissionGrants: CronPermissionGrant[];
  permissionGrants: PermissionGrant[];
  onApprove(id: string, mode?: "once" | "always_for_job_update"): void;
  onReject(id: string): void;
  onApprovePermission(id: string, mode?: "once" | "always"): void;
  onRejectPermission(id: string): void;
}) {
  const styles = React.useMemo(() => createStyles(props.theme), [props.theme]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>审批与安全</Text>
      <Text style={styles.desc}>集中管理 Cron 审批、长期同意与 Agent 权限。</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Cron 待审批</Text>
        {props.pendingApprovals.length === 0 ? <Text style={styles.desc}>暂无 Cron 待审批请求</Text> : null}
        {props.pendingApprovals.map((row) => (
          <View key={row.id} style={styles.item}>
            <Text style={styles.itemTitle}>
              {row.type === "add" ? "创建任务" : row.type === "update" ? "更新任务" : row.type === "remove" ? "删除任务" : "删除全部任务"}
            </Text>
            <Text style={styles.itemMeta}>会话：{row.sessionId}</Text>
            <Text style={styles.itemMeta}>时间：{new Date(row.createdAt).toLocaleString()}</Text>
            <View style={styles.row}>
              <Pressable style={styles.button} onPress={() => props.onApprove(row.id, "once")}>
                <Text style={styles.buttonText}>批准一次</Text>
              </Pressable>
              {row.type === "update" ? (
                <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => props.onApprove(row.id, "always_for_job_update")}>
                  <Text style={[styles.buttonText, styles.secondaryButtonText]}>总是允许修改</Text>
                </Pressable>
              ) : null}
              <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => props.onReject(row.id)}>
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>拒绝</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>高权限工具审批</Text>
        {props.pendingPermissionRequests.length === 0 ? <Text style={styles.desc}>暂无权限请求</Text> : null}
        {props.pendingPermissionRequests.map((row) => (
          <View key={row.id} style={styles.item}>
            <Text style={styles.itemTitle}>{row.action ?? "tool.call"}</Text>
            <Text style={styles.itemMeta}>权限域：{row.scope}</Text>
            <Text style={styles.itemMeta}>来源会话：{row.channelId ?? "-"}</Text>
            <Text style={styles.itemMeta}>原因：{row.reason}</Text>
            <View style={styles.row}>
              <Pressable style={styles.button} onPress={() => props.onApprovePermission(row.id, "once")}>
                <Text style={styles.buttonText}>批准一次</Text>
              </Pressable>
              <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => props.onApprovePermission(row.id, "always")}>
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>长期允许</Text>
              </Pressable>
              <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => props.onRejectPermission(row.id)}>
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>拒绝</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>长期授权（Cron）</Text>
        {props.cronPermissionGrants.length === 0 ? <Text style={styles.desc}>暂无 Cron 长期授权</Text> : null}
        {props.cronPermissionGrants.map((grant) => (
          <View key={grant.id} style={styles.item}>
            <Text style={styles.itemTitle}>Agent: {grant.agentId}</Text>
            <Text style={styles.itemMeta}>任务：{grant.cronJobId}</Text>
            <Text style={styles.itemMeta}>范围：{grant.scope}</Text>
            <Text style={styles.itemMeta}>授权时间：{new Date(grant.grantedAt).toLocaleString()}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Agent 权限授权</Text>
        {props.permissionGrants.length === 0 ? <Text style={styles.desc}>暂无 Agent 权限授权</Text> : null}
        {props.permissionGrants.map((grant) => (
          <View key={grant.id} style={styles.item}>
            <Text style={styles.itemTitle}>{grant.scope}</Text>
            <Text style={styles.itemMeta}>Agent：{grant.agentId ?? "all"}</Text>
            <Text style={styles.itemMeta}>状态：{grant.granted ? "已授权" : "拒绝"}</Text>
            <Text style={styles.itemMeta}>时间：{new Date(grant.grantedAt).toLocaleString()}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function createStyles(theme: MaterialTheme) {
  return StyleSheet.create({
    container: { flex: 1, padding: 16, backgroundColor: theme.color.background },
    content: { paddingBottom: 24, gap: 10 },
    title: { color: theme.color.onSurface, fontSize: 20, fontWeight: "700", marginBottom: 6 },
    desc: { color: theme.color.onSurfaceVariant, fontSize: 13, lineHeight: 20 },
    card: {
      backgroundColor: theme.color.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.color.outline,
      padding: 12,
      gap: 8
    },
    cardTitle: { color: theme.color.onSurface, fontSize: 14, fontWeight: "800" },
    item: {
      backgroundColor: theme.color.surface2,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.color.outline,
      padding: 10,
      gap: 4
    },
    itemTitle: { color: theme.color.onSurface, fontSize: 13, fontWeight: "800" },
    itemMeta: { color: theme.color.onSurfaceVariant, fontSize: 12 },
    row: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 2 },
    button: {
      backgroundColor: theme.color.primary,
      borderRadius: theme.radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center"
    },
    secondaryButton: { backgroundColor: theme.color.surface },
    buttonText: { color: theme.color.onPrimary, fontSize: 12, fontWeight: "700" },
    secondaryButtonText: { color: theme.color.onSurface }
  });
}
