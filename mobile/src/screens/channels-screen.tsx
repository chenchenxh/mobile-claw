import React from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export function ChannelsScreen(props: {
  channels: Array<{ id: string; name: string; defaultModel: string }>;
  activeChannelId: string;
  onSelect(id: string): void;
  onCreate(name: string): void;
}) {
  const [name, setName] = React.useState("");

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Channels</Text>
      <View style={styles.createRow}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="new channel name"
          placeholderTextColor="#94A3B8"
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
          <Text style={styles.createText}>Add</Text>
        </Pressable>
      </View>
      <FlatList
        data={props.channels}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => props.onSelect(item.id)}
            style={[styles.card, props.activeChannelId === item.id ? styles.cardActive : null]}
          >
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>{item.defaultModel}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { color: "#F8FAFC", fontSize: 20, fontWeight: "700", marginBottom: 12 },
  createRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  input: { flex: 1, backgroundColor: "#1F2937", color: "#F8FAFC", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  createBtn: { backgroundColor: "#0EA5E9", borderRadius: 8, paddingHorizontal: 12, justifyContent: "center" },
  createText: { color: "#0C4A6E", fontWeight: "700" },
  card: { backgroundColor: "#1F2937", borderRadius: 10, padding: 12, marginBottom: 10 },
  cardActive: { borderWidth: 1, borderColor: "#38BDF8" },
  name: { color: "#F8FAFC", fontSize: 16, fontWeight: "600" },
  meta: { color: "#94A3B8", marginTop: 4 }
});
