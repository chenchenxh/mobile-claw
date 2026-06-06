import React from "react";
import { Alert, Animated, FlatList, PanResponder, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { MaterialTheme } from "../theme/material";

export function SessionsScreen(props: {
  theme: MaterialTheme;
  sessions: Array<{ id: string; name: string; defaultModel: string }>;
  activeSessionId: string;
  onSelect(id: string): void;
  onCreate(name: string): void;
  onRename(id: string, name: string): Promise<boolean>;
  onDelete(id: string): Promise<{ result: "ok" | "blocked" | "switchedTo"; nextSessionId?: string }>;
}) {
  const [name, setName] = React.useState("");
  const [editingSessionId, setEditingSessionId] = React.useState<string | null>(null);
  const [editingName, setEditingName] = React.useState("");
  const styles = React.useMemo(() => createStyles(props.theme), [props.theme]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>会话</Text>
      <View style={styles.createRow}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="输入新会话名称"
          placeholderTextColor={props.theme.color.onSurfaceVariant}
          style={styles.input}
        />
        <Pressable
          style={styles.createBtn}
          onPress={() => {
            const trimmed = name.trim();
            if (!trimmed) return;
            props.onCreate(trimmed);
            setName("");
          }}
        >
          <Text style={styles.createText}>新增</Text>
        </Pressable>
      </View>
      <FlatList
        data={props.sessions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SwipeSessionRow
            item={item}
            styles={styles}
            active={props.activeSessionId === item.id}
            isEditing={editingSessionId === item.id}
            editingName={editingName}
            onChangeEditingName={setEditingName}
            onPress={() => props.onSelect(item.id)}
            onEdit={() => {
              setEditingSessionId(item.id);
              setEditingName(item.name);
            }}
            onSaveEdit={async () => {
              const ok = await props.onRename(item.id, editingName);
              if (ok) {
                setEditingSessionId(null);
                setEditingName("");
              } else {
                Alert.alert("重命名失败", "名称不能为空或会话不存在。");
              }
            }}
            onCancelEdit={() => {
              setEditingSessionId(null);
              setEditingName("");
            }}
            onDelete={async () => {
              Alert.alert("删除会话", `确认删除「${item.name}」吗？`, [
                { text: "取消", style: "cancel" },
                {
                  text: "删除",
                  style: "destructive",
                  onPress: async () => {
                    const result = await props.onDelete(item.id);
                    if (result.result === "blocked") {
                      Alert.alert("无法删除", "至少需要保留一个会话。");
                    }
                  }
                }
              ]);
            }}
          />
        )}
      />
    </View>
  );
}

function SwipeSessionRow(props: {
  item: { id: string; name: string; defaultModel: string };
  active: boolean;
  styles: ReturnType<typeof createStyles>;
  isEditing: boolean;
  editingName: string;
  onChangeEditingName(name: string): void;
  onPress(): void;
  onEdit(): void;
  onSaveEdit(): void;
  onCancelEdit(): void;
  onDelete(): void;
}) {
  const translateX = React.useRef(new Animated.Value(0)).current;
  const [opened, setOpened] = React.useState(false);

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 10 && Math.abs(gesture.dy) < 10,
        onPanResponderMove: (_, gesture) => {
          if (props.isEditing) return;
          if (gesture.dx > 0) return;
          const clamped = Math.max(-124, gesture.dx);
          translateX.setValue(clamped);
        },
        onPanResponderRelease: (_, gesture) => {
          if (props.isEditing) return;
          if (gesture.dx < -48) {
            setOpened(true);
            Animated.spring(translateX, { toValue: -124, useNativeDriver: true }).start();
          } else {
            setOpened(false);
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          }
        },
        onPanResponderTerminate: () => {
          if (!opened) return;
          Animated.spring(translateX, { toValue: -124, useNativeDriver: true }).start();
        }
      }),
    [opened, translateX, props.isEditing]
  );

  const close = () => {
    setOpened(false);
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
  };

  return (
    <View style={props.styles.swipeWrap}>
      <View style={props.styles.deleteArea}>
        <Pressable
          style={[props.styles.actionBtn, props.styles.editBtn]}
          onPress={() => {
            close();
            props.onEdit();
          }}
          accessibilityLabel="编辑会话"
        >
          <Text style={[props.styles.actionIcon, props.styles.editIcon]}>✎</Text>
        </Pressable>
        <Pressable
          style={[props.styles.actionBtn, props.styles.deleteBtn]}
          onPress={() => {
            close();
            props.onDelete();
          }}
          accessibilityLabel="删除会话"
        >
          <Text style={props.styles.actionIcon}>🗑</Text>
        </Pressable>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <Pressable
          onPress={() => {
            close();
            props.onPress();
          }}
          style={[props.styles.card, props.active ? props.styles.cardActive : null]}
        >
          {props.isEditing ? (
            <View>
              <TextInput
                value={props.editingName}
                onChangeText={props.onChangeEditingName}
                placeholder="输入会话名称"
                placeholderTextColor="#9AA0A6"
                style={props.styles.inlineInput}
              />
              <View style={props.styles.inlineActions}>
                <Pressable style={props.styles.inlineBtn} onPress={props.onSaveEdit}>
                  <Text style={props.styles.inlineBtnText}>保存</Text>
                </Pressable>
                <Pressable style={[props.styles.inlineBtn, props.styles.inlineBtnGhost]} onPress={props.onCancelEdit}>
                  <Text style={[props.styles.inlineBtnText, props.styles.inlineBtnGhostText]}>取消</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View>
              <Text style={props.styles.name}>{props.item.name}</Text>
              <Text style={props.styles.meta}>{props.item.defaultModel}</Text>
            </View>
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
}

export const ChannelsScreen = SessionsScreen;

function createStyles(theme: MaterialTheme) {
  return StyleSheet.create({
    container: { flex: 1, padding: 16, backgroundColor: theme.color.background },
    title: { color: theme.color.onSurface, fontSize: 20, fontWeight: "800", marginBottom: 12 },
    createRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
    input: {
      flex: 1,
      backgroundColor: theme.color.surface,
      color: theme.color.onSurface,
      borderRadius: theme.radius.md,
      paddingHorizontal: 10,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: theme.color.outline
    },
    createBtn: {
      backgroundColor: theme.color.primary,
      borderRadius: theme.radius.md,
      paddingHorizontal: 12,
      justifyContent: "center"
    },
    createText: { color: theme.color.onPrimary, fontWeight: "700" },
    swipeWrap: { marginBottom: 10 },
    deleteArea: {
      position: "absolute",
      right: 0,
      top: 0,
      bottom: 0,
      width: 124,
      justifyContent: "center",
      alignItems: "center",
      flexDirection: "row",
      gap: 6
    },
    actionBtn: {
      width: 58,
      height: "100%",
      minHeight: 72,
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center"
    },
    editBtn: { backgroundColor: theme.color.primaryContainer },
    deleteBtn: { backgroundColor: theme.color.error },
    actionIcon: { color: theme.color.onError, fontSize: 18, fontWeight: "800" },
    editIcon: { color: theme.color.onPrimaryContainer },
    card: {
      backgroundColor: theme.color.surface,
      borderRadius: theme.radius.md,
      padding: 12,
      borderWidth: 1,
      borderColor: theme.color.outline
    },
    cardActive: { borderColor: theme.color.primary },
    name: { color: theme.color.onSurface, fontSize: 16, fontWeight: "700" },
    meta: { color: theme.color.onSurfaceVariant, marginTop: 4 },
    inlineInput: {
      backgroundColor: theme.color.surface2,
      color: theme.color.onSurface,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.color.outline,
      paddingHorizontal: 10,
      paddingVertical: 8
    },
    inlineActions: { flexDirection: "row", gap: 8, marginTop: 8 },
    inlineBtn: {
      backgroundColor: theme.color.primary,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 10,
      paddingVertical: 6
    },
    inlineBtnGhost: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: theme.color.outline
    },
    inlineBtnText: { color: theme.color.onPrimary, fontWeight: "700" },
    inlineBtnGhostText: { color: theme.color.onSurface }
  });
}
