import type { LangSmithOptions } from "./langsmith";

export type CodexOptions = {
  codexPathOverride?: string;
  baseUrl?: string;
  apiKey?: string;
  langSmith?: LangSmithOptions;
};
