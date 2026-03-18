import React, { useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import type { Message } from "../../../src/types/contracts";

export function ChatScreen(props: {
  messages: Message[];
  onSend(text: string): Promise<void>;
  currentModel: "small" | "large";
  onSwitchModel(modelId: "small" | "large"): void;
}) {
  const [input, setInput] = useState("");

  const submit = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    await props.onSend(text);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chat</Text>
        <View style={styles.modelRow}>
          <Pressable
            style={[styles.modelButton, props.currentModel === "small" ? styles.modelButtonActive : null]}
            onPress={() => props.onSwitchModel("small")}
          >
            <Text style={styles.modelButtonText}>small</Text>
          </Pressable>
          <Pressable
            style={[styles.modelButton, props.currentModel === "large" ? styles.modelButtonActive : null]}
            onPress={() => props.onSwitchModel("large")}
          >
            <Text style={styles.modelButtonText}>large</Text>
          </Pressable>
        </View>
      </View>
      <FlatList
        data={props.messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.role === "assistant" ? styles.assistant : styles.user]}>
            <Text style={styles.role}>{item.role}</Text>
            <Text style={styles.text}>{item.content}</Text>
          </View>
        )}
      />
      <View style={styles.inputRow}>
        <TextInput
          placeholder="Say something..."
          placeholderTextColor="#94A3B8"
          value={input}
          onChangeText={setInput}
          style={styles.input}
          multiline
        />
        <Pressable style={styles.send} onPress={submit}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 12, paddingBottom: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  headerTitle: { color: "#F8FAFC", fontSize: 20, fontWeight: "700" },
  modelRow: { flexDirection: "row", gap: 8 },
  modelButton: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "#1F2937" },
  modelButtonActive: { backgroundColor: "#0EA5E9" },
  modelButtonText: { color: "#E2E8F0", fontSize: 12, fontWeight: "700" },
  list: { paddingVertical: 10, gap: 8 },
  bubble: { borderRadius: 10, padding: 10 },
  user: { backgroundColor: "#1E3A8A" },
  assistant: { backgroundColor: "#334155" },
  role: { color: "#BFDBFE", fontSize: 11, marginBottom: 4 },
  text: { color: "#F8FAFC", fontSize: 14, lineHeight: 20 },
  inputRow: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  input: {
    flex: 1,
    backgroundColor: "#1F2937",
    borderRadius: 10,
    minHeight: 44,
    maxHeight: 100,
    color: "#F8FAFC",
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  send: { backgroundColor: "#0EA5E9", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  sendText: { color: "#082F49", fontWeight: "700" }
});
