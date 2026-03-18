import React from "react";
import { SafeAreaView, StatusBar } from "react-native";
import { MobileClawShell } from "./src/mobileclaw-shell";

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }}>
      <StatusBar barStyle="light-content" />
      <MobileClawShell />
    </SafeAreaView>
  );
}
