import type { ModelRecommendation } from "../../types/contracts.ts";

export const MODEL_RECOMMENDATIONS: ModelRecommendation[] = [
  {
    id: "balanced-openai-minimax",
    label: "均衡方案（OpenAI + MiniMax）",
    description: "Small 使用更快模型，Large 使用更强推理模型。",
    tierMapping: {
      small: { providerId: "openai", modelId: "gpt-4o-mini", displayName: "OpenAI GPT-4o mini" },
      large: { providerId: "minimax", modelId: "MiniMax-M2.7", displayName: "MiniMax M2.7" }
    }
  },
  {
    id: "openai-only",
    label: "仅 OpenAI",
    description: "Small 与 Large 都使用 OpenAI 家族，按强度区分。",
    tierMapping: {
      small: { providerId: "openai", modelId: "gpt-4o-mini", displayName: "OpenAI GPT-4o mini" },
      large: { providerId: "openai", modelId: "gpt-4.1-mini", displayName: "OpenAI GPT-4.1 mini" }
    }
  },
  {
    id: "minimax-only",
    label: "仅 MiniMax",
    description: "Small 与 Large 都路由到 MiniMax 家族模型。",
    tierMapping: {
      small: { providerId: "minimax", modelId: "MiniMax-M2.5", displayName: "MiniMax M2.5" },
      large: { providerId: "minimax", modelId: "MiniMax-M2.7", displayName: "MiniMax M2.7" }
    }
  }
];
