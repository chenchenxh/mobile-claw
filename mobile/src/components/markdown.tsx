import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { MaterialTheme } from "../theme/material";

type Segment =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string };

export function MarkdownLite(props: { text: string; theme: MaterialTheme }) {
  const styles = React.useMemo(() => createStyles(props.theme), [props.theme]);
  const blocks = splitCodeBlocks(props.text);
  return (
    <View style={styles.container}>
      {blocks.map((b, i) => {
        if (b.kind === "code") {
          return (
            <View key={i} style={styles.codeBlock}>
              <Text style={styles.codeText}>{b.text}</Text>
            </View>
          );
        }
        return <View key={i}>{renderTextBlock(b.text, styles, i)}</View>;
      })}
    </View>
  );
}

function splitCodeBlocks(input: string): Segment[] {
  const out: Segment[] = [];
  const parts = input.split("```");
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (i % 2 === 1) {
      const lines = part.split("\n");
      const body = lines.length > 1 ? lines.slice(1).join("\n") : part;
      out.push({ kind: "code", text: body.trimEnd() });
    } else if (part.trim().length > 0) {
      out.push({ kind: "text", text: part.trim() });
    }
  }
  return out.length ? out : [{ kind: "text", text: input }];
}

function renderInline(text: string, styles: ReturnType<typeof createStyles>): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let rest = text;
  while (rest.length) {
    const codeIdx = rest.indexOf("`");
    const linkIdx = rest.indexOf("[");
    const next = minPositive(codeIdx, linkIdx);
    if (next === -1) {
      nodes.push(rest);
      break;
    }

    if (next > 0) {
      nodes.push(rest.slice(0, next));
      rest = rest.slice(next);
    }

    if (rest.startsWith("`")) {
      const end = rest.indexOf("`", 1);
      if (end === -1) {
        nodes.push(rest);
        break;
      }
      nodes.push(
        <Text key={nodes.length} style={styles.inlineCode}>
          {rest.slice(1, end)}
        </Text>
      );
      rest = rest.slice(end + 1);
      continue;
    }

    if (rest.startsWith("[")) {
      const close = rest.indexOf("]");
      const openParen = rest.indexOf("(", close);
      const closeParen = rest.indexOf(")", openParen);
      if (close === -1 || openParen === -1 || closeParen === -1) {
        nodes.push(rest);
        break;
      }
      const label = rest.slice(1, close);
      const url = rest.slice(openParen + 1, closeParen);
      nodes.push(
        <Text key={nodes.length} style={styles.link}>
          {label} ({url})
        </Text>
      );
      rest = rest.slice(closeParen + 1);
      continue;
    }
  }
  return nodes;
}

function renderTextBlock(text: string, styles: ReturnType<typeof createStyles>, keySeed: number): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = text.split("\n");

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const key = `${keySeed}-${idx}`;
    if (!line.trim()) return;

    if (line.startsWith("### ")) {
      nodes.push(
        <Text key={key} style={styles.h3}>
          {renderInline(line.slice(4), styles)}
        </Text>
      );
      return;
    }

    if (line.startsWith("## ")) {
      nodes.push(
        <Text key={key} style={styles.h2}>
          {renderInline(line.slice(3), styles)}
        </Text>
      );
      return;
    }

    if (line.startsWith("# ")) {
      nodes.push(
        <Text key={key} style={styles.h1}>
          {renderInline(line.slice(2), styles)}
        </Text>
      );
      return;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      nodes.push(
        <Text key={key} style={styles.listItem}>
          {"• "}
          {renderInline(line.slice(2), styles)}
        </Text>
      );
      return;
    }

    nodes.push(
      <Text key={key} style={styles.text}>
        {renderInline(line, styles)}
      </Text>
    );
  });

  return nodes;
}

function minPositive(a: number, b: number): number {
  const aa = a >= 0 ? a : Infinity;
  const bb = b >= 0 ? b : Infinity;
  const m = Math.min(aa, bb);
  return m === Infinity ? -1 : m;
}

function createStyles(theme: MaterialTheme) {
  return StyleSheet.create({
    container: { flexDirection: "column", gap: 6 },
    text: { color: theme.color.onAssistantBubble, fontSize: 14, lineHeight: 20 },
    h1: { color: theme.color.onAssistantBubble, fontSize: 19, lineHeight: 24, fontWeight: "900" },
    h2: { color: theme.color.onAssistantBubble, fontSize: 17, lineHeight: 22, fontWeight: "800" },
    h3: { color: theme.color.onAssistantBubble, fontSize: 15, lineHeight: 20, fontWeight: "800" },
    listItem: { color: theme.color.onAssistantBubble, fontSize: 14, lineHeight: 20 },
    codeBlock: { backgroundColor: theme.color.surface2, borderRadius: theme.radius.md, padding: 10, borderWidth: 1, borderColor: theme.color.outline },
    codeText: { color: theme.color.onSurface, fontFamily: "monospace", fontSize: 12, lineHeight: 18 },
    inlineCode: { fontFamily: "monospace", backgroundColor: theme.color.surface2, color: theme.color.onSurface },
    link: { textDecorationLine: "underline", color: theme.color.primary }
  });
}
