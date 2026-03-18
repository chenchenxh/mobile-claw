import React from "react";
import { StyleSheet, Text, View } from "react-native";

export function SettingsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.desc}>Model credentials, privacy toggles, and OAuth account management go here.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { color: "#F8FAFC", fontSize: 20, fontWeight: "700", marginBottom: 10 },
  desc: { color: "#CBD5E1", fontSize: 14, lineHeight: 22 }
});
