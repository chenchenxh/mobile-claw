import type { MemoryRecordType } from "../../types/contracts.ts";

interface ExtractionRule {
  type: MemoryRecordType;
  patterns: RegExp[];
}

const RULES: ExtractionRule[] = [
  { type: "preference", patterns: [/我喜欢(.+)/, /偏好(.+)/, /prefer (.+)/i] },
  { type: "goal", patterns: [/我的目标是(.+)/, /计划(.+)/, /goal (.+)/i] },
  { type: "fact", patterns: [/我是(.+)/, /我在(.+)/, /I am (.+)/i] }
];

export interface ExtractionResult {
  type: MemoryRecordType;
  content: string;
}

export function extractMemory(userText: string): ExtractionResult[] {
  const out: ExtractionResult[] = [];
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = userText.match(pattern);
      if (!match?.[1]) continue;
      out.push({ type: rule.type, content: match[1].trim() });
      break;
    }
  }
  return dedupe(out);
}

function dedupe(items: ExtractionResult[]): ExtractionResult[] {
  const seen = new Set<string>();
  const result: ExtractionResult[] = [];
  for (const item of items) {
    const key = `${item.type}:${item.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
