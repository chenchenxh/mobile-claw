import type { ModelRecommendation } from "../../types/contracts.ts";

export const MODEL_RECOMMENDATIONS: ModelRecommendation[] = [
  {
    id: "deepseek",
    label: "DeepSeek API Key",
    description: "使用 DeepSeek 官方聊天补全 API，默认 deepseek-v4-flash。",
    tierMapping: {
      small: { providerId: "deepseek", modelId: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash" },
      large: { providerId: "deepseek", modelId: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro" }
    }
  },
  {
    id: "minimax-only",
    label: "MiniMax API Key",
    description: "Small 与 Large 都路由到 MiniMax 家族模型。",
    tierMapping: {
      small: { providerId: "minimax", modelId: "MiniMax-M2.5", displayName: "MiniMax M2.5" },
      large: { providerId: "minimax", modelId: "MiniMax-M2.7", displayName: "MiniMax M2.7" }
    }
  }
];
