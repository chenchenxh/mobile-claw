import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CronExecutionRecord, CronJob } from "../../../src/core/cron/types";
import type { ToolExecutionRecord } from "../../../src/types/contracts";
import type { MaterialTheme } from "../theme/material";

export function ToolsScreen(props: {
  theme: MaterialTheme;
  sessionId: string;
  cronJobs: CronJob[];
  cronExecutionRecords: CronExecutionRecord[];
  toolExecutionRecords: ToolExecutionRecord[];
  onRetry(jobId: string): void;
  onRunNow(jobId: string): void;
}) {
  const styles = React.useMemo(() => createStyles(props.theme), [props.theme]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>定时任务</Text>
      <Text style={styles.desc}>当前会话：{props.sessionId || "-"}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>任务说明</Text>
        <Text style={styles.desc}>当前版本不提供手动创建定时任务。</Text>
        <Text style={styles.desc}>请在聊天中让 Agent 使用工具创建/更新/删除任务。</Text>
        <Text style={styles.desc}>审批与权限管理已迁移到「审批与安全」页面。</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>已创建任务</Text>
        {props.cronJobs.length === 0 ? <Text style={styles.desc}>暂无任务</Text> : null}
        {props.cronJobs.map((job) => (
          <View key={job.id} style={styles.jobCard}>
            <Text style={styles.jobName}>{job.name}</Text>
            <Text style={styles.jobMeta}>
              {job.schedule.kind === "every"
                ? `每 ${Math.round(job.schedule.everyMs / 1000)} 秒`
                : job.schedule.kind === "cron"
                  ? `Cron：${job.schedule.expr}${job.schedule.tz ? ` (${job.schedule.tz})` : ""}`
                  : `执行时间：${new Date(job.schedule.atMs).toLocaleString()}`}
            </Text>
            <Text style={styles.jobMeta}>
              状态：{job.enabled ? "启用" : "停用"} · 最近结果：{job.state.lastStatus ?? "-"} · 连续错误：{job.state.consecutiveErrors}
            </Text>
            <Text style={styles.jobMeta}>
              目标：{job.sessionTarget} · 时效：{job.timingClass === "exact_foreground" ? "前台精准" : "后台最佳努力"} · 投递：
              {job.delivery?.mode ?? "announce"}
            </Text>
            {job.state.lastErrorReason ? <Text style={styles.jobMeta}>最近错误：{job.state.lastErrorReason}</Text> : null}
            <View style={styles.row}>
              <Pressable style={styles.button} onPress={() => props.onRunNow(job.id)}>
                <Text style={styles.buttonText}>立即执行</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={() => props.onRetry(job.id)}>
                <Text style={styles.buttonText}>立即重试</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>执行历史</Text>
        {props.cronExecutionRecords.length === 0 ? <Text style={styles.desc}>暂无执行记录</Text> : null}
        {props.cronExecutionRecords.map((record) => (
          <View key={record.runId} style={styles.jobCard}>
            <Text style={styles.jobName}>Run: {record.runId}</Text>
            <Text style={styles.jobMeta}>任务：{record.jobId}</Text>
            <Text style={styles.jobMeta}>
              结果：{record.status === "ok" ? "成功" : "失败"} · 来源：
              {record.triggeredBy === "retry"
                ? "重试"
                : record.triggeredBy === "manual"
                  ? "手动执行"
                  : record.triggeredBy === "catchup"
                    ? "补跑"
                    : "计划触发"}
            </Text>
            <Text style={styles.jobMeta}>投递：{record.deliveryStatus ?? "-"} · 错误分类：{record.errorKind ?? "-"}</Text>
            <Text style={styles.jobMeta}>时长：{record.durationMs}ms · 开始：{new Date(record.startedAt).toLocaleString()}</Text>
            {record.errorSummary ? <Text style={styles.jobMeta}>错误：{record.errorSummary}</Text> : null}
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>工具执行日志</Text>
        {props.toolExecutionRecords.length === 0 ? <Text style={styles.desc}>暂无工具执行记录</Text> : null}
        {props.toolExecutionRecords.map((record) => (
          <View key={record.id} style={styles.jobCard}>
            <Text style={styles.jobName}>{record.tool}</Text>
            <Text style={styles.jobMeta}>状态：{record.status}</Text>
            <Text style={styles.jobMeta}>摘要：{record.summary}</Text>
            <Text style={styles.jobMeta}>会话：{record.sessionId}</Text>
            <Text style={styles.jobMeta}>时间：{new Date(record.createdAt).toLocaleString()}</Text>
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
    row: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" },
    button: {
      backgroundColor: theme.color.primary,
      borderRadius: theme.radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center"
    },
    buttonText: { color: theme.color.onPrimary, fontSize: 12, fontWeight: "700" },
    jobCard: {
      backgroundColor: theme.color.surface2,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.color.outline,
      padding: 10,
      gap: 4
    },
    jobName: { color: theme.color.onSurface, fontSize: 13, fontWeight: "800" },
    jobMeta: { color: theme.color.onSurfaceVariant, fontSize: 12 }
  });
}
