import { randomUUID } from "node:crypto";

import type { ThreadEvent } from "./events";
import type { ThreadItem, CommandExecutionItem, FileChangeItem, McpToolCallItem, AgentMessageItem, ReasoningItem, WebSearchItem, TodoListItem, ErrorItem } from "./items";
import type { ThreadOptions } from "./threadOptions";
import type { TurnOptions } from "./turnOptions";

const DEFAULT_ENDPOINT = "https://api.smith.langchain.com";

export type LangSmithOptions = {
  /** Explicitly enable or disable tracing. Defaults to auto based on environment variables. */
  enabled?: boolean;
  /** API key used to authenticate with LangSmith. Defaults to LANGSMITH_API_KEY or LANGCHAIN_API_KEY. */
  apiKey?: string;
  /** Base URL for the LangSmith ingestion API. Defaults to LANGSMITH_ENDPOINT or LANGCHAIN_ENDPOINT. */
  apiUrl?: string;
  /** Project name where the traces will be stored. Defaults to LANGSMITH_PROJECT or LANGCHAIN_PROJECT. */
  project?: string;
  /** Custom name for the root run. */
  runName?: string;
  /** Tags to attach to each run. */
  tags?: string[];
  /** Arbitrary metadata to attach to the root run. */
  metadata?: Record<string, unknown>;
};

type Booleanish = string | number | boolean | undefined | null;

function isTruthy(value: Booleanish): boolean {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

type LangSmithClientLike = {
  sendRuns(runs: LangSmithRunPayload[], traceId: string): Promise<void>;
};

type LangSmithRunPayload = {
  id: string;
  name: string;
  run_type: string;
  start_time: string;
  end_time: string;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: { message: string } | null;
  parent_run_id?: string | null;
  trace_id: string;
  tags?: string[];
  extra?: { metadata?: Record<string, unknown> };
  execution_order?: number;
  dotted_order?: string;
  child_runs?: never;
  logs?: string;
};

type RunRecord = {
  id: string;
  name: string;
  runType: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  metadata: Record<string, unknown>;
  startTime: Date | null;
  endTime: Date | null;
  parentId: string | null;
  order: number;
  parentDottedOrder: string | null;
  tags: string[];
  error?: string;
  logs: string[];
};

type LangSmithTracerContext = {
  client: LangSmithClientLike;
  runName: string;
  tags: string[];
  metadata: Record<string, unknown>;
};

export type CreateLangSmithTracerParams = {
  options: LangSmithOptions | undefined;
  input: string;
  threadId: string | null;
  threadOptions: ThreadOptions;
  turnOptions: TurnOptions;
};

export async function createLangSmithTracer(
  params: CreateLangSmithTracerParams,
): Promise<LangSmithTracer | null> {
  const envEnabled =
    isTruthy(process.env.LANGSMITH_TRACING) ||
    isTruthy(process.env.LANGSMITH_TRACING_V2) ||
    isTruthy(process.env.LANGCHAIN_TRACING_V2);

  const explicitEnabled = params.options?.enabled;
  if (explicitEnabled === false) {
    return null;
  }
  if (explicitEnabled == null && !envEnabled && !params.options?.apiKey) {
    return null;
  }

  const apiKey =
    params.options?.apiKey ||
    process.env.LANGSMITH_API_KEY ||
    process.env.LANGCHAIN_API_KEY ||
    process.env.LANGCHAIN_TRACING_V2_API_KEY ||
    process.env.LANGCHAIN_API_KEY;

  if (!apiKey) {
    return null;
  }

  const apiUrl =
    params.options?.apiUrl ||
    process.env.LANGSMITH_API_URL ||
    process.env.LANGSMITH_ENDPOINT ||
    process.env.LANGCHAIN_ENDPOINT ||
    process.env.LANGCHAIN_TRACING_V2_ENDPOINT ||
    DEFAULT_ENDPOINT;

  const project =
    params.options?.project ||
    process.env.LANGSMITH_PROJECT ||
    process.env.LANGCHAIN_PROJECT ||
    process.env.LANGCHAIN_TRACING_V2_PROJECT;

  const tags = params.options?.tags ?? parseTags(process.env.LANGSMITH_TAGS ?? process.env.LANGCHAIN_TAGS);

  const metadata = cleanMetadata({
    ...params.options?.metadata,
    input_preview: previewText(params.input),
    thread_id: params.threadId ?? undefined,
    model: params.threadOptions.model ?? undefined,
    sandbox_mode: params.threadOptions.sandboxMode ?? undefined,
    working_directory: params.threadOptions.workingDirectory ?? undefined,
    skip_git_repo_check: params.threadOptions.skipGitRepoCheck ?? undefined,
    output_schema_requested: params.turnOptions.outputSchema ? true : undefined,
  });

  const client = await LangSmithClient.create({ apiKey, apiUrl, project, tags, metadata });
  if (!client) {
    return null;
  }

  const runName = params.options?.runName || "Codex Turn";

  return new LangSmithTracer({ client, runName, tags, metadata }, params.input);
}

class LangSmithTracer {
  private readonly client: LangSmithClientLike;
  private readonly root: RunRecord;
  private readonly items: Map<string, RunRecord> = new Map();
  private readonly completedRuns: RunRecord[] = [];
  private readonly tags: string[];
  private finalized = false;
  private orderCounter = 1;

  constructor(context: LangSmithTracerContext, input: string) {
    this.client = context.client;
    this.tags = context.tags;
    this.root = {
      id: randomUUID(),
      name: context.runName,
      runType: "chain",
      inputs: { prompt: input },
      outputs: {},
      metadata: { ...context.metadata },
      startTime: null,
      endTime: null,
      parentId: null,
      order: 0,
      parentDottedOrder: null,
      tags: context.tags,
      logs: [],
    };
  }

  public async handleEvent(event: ThreadEvent): Promise<void> {
    switch (event.type) {
      case "thread.started": {
        this.root.metadata.thread_id = event.thread_id;
        break;
      }
      case "turn.started": {
        if (!this.root.startTime) {
          this.root.startTime = new Date();
        }
        break;
      }
      case "turn.completed": {
        this.root.endTime = new Date();
        this.root.outputs.usage = toJsonSafe(event.usage);
        break;
      }
      case "turn.failed": {
        this.root.endTime = new Date();
        this.root.error = event.error.message;
        break;
      }
      case "item.started": {
        this.handleItemStarted(event.item);
        break;
      }
      case "item.updated": {
        this.handleItemUpdated(event.item);
        break;
      }
      case "item.completed": {
        this.handleItemCompleted(event.item);
        break;
      }
      case "error": {
        this.root.endTime = new Date();
        this.root.error = event.message;
        break;
      }
      default: {
        const _exhaustive: never = event;
        void _exhaustive;
      }
    }
  }

  private handleItemStarted(item: ThreadItem): void {
    const run = this.ensureRunRecord(item);
    if (!run.startTime) {
      run.startTime = new Date();
    }
  }

  private handleItemUpdated(item: ThreadItem): void {
    const run = this.ensureRunRecord(item);
    this.applyItemState(run, item);
  }

  private handleItemCompleted(item: ThreadItem): void {
    const run = this.ensureRunRecord(item);
    this.applyItemState(run, item);
    run.endTime = new Date();
    if (!this.completedRuns.includes(run)) {
      this.completedRuns.push(run);
    }
    if (item.type === "agent_message") {
      this.root.outputs.final_response = item.text;
    }
  }

  private ensureRunRecord(item: ThreadItem): RunRecord {
    const existing = this.items.get(item.id);
    if (existing) {
      return existing;
    }
    const sequence = this.orderCounter++;
    const run: RunRecord = {
      id: randomUUID(),
      name: describeItem(item),
      runType: inferRunType(item),
      inputs: initialInputs(item),
      outputs: {},
      metadata: {
        item_id: item.id,
        item_type: item.type,
      },
      startTime: null,
      endTime: null,
      parentId: this.root.id,
      order: sequence,
      parentDottedOrder: null, // Will be set when we construct dotted_order
      tags: this.tags,
      logs: [],
    };
    this.items.set(item.id, run);
    return run;
  }

  private applyItemState(run: RunRecord, item: ThreadItem): void {
    switch (item.type) {
      case "command_execution":
        applyCommandExecution(run, item);
        break;
      case "file_change":
        applyFileChange(run, item);
        break;
      case "mcp_tool_call":
        applyMcpToolCall(run, item);
        break;
      case "agent_message":
        applyAgentMessage(run, item);
        break;
      case "reasoning":
        applyReasoning(run, item);
        break;
      case "web_search":
        applyWebSearch(run, item);
        break;
      case "todo_list":
        applyTodoList(run, item);
        break;
      case "error":
        applyError(run, item);
        break;
      default: {
        const _exhaustive: never = item;
        return _exhaustive;
      }
    }
  }

  public async finalize(error?: unknown): Promise<void> {
    if (this.finalized) {
      return;
    }
    this.finalized = true;

    if (!this.root.startTime) {
      this.root.startTime = new Date();
    }
    if (!this.root.endTime) {
      this.root.endTime = new Date();
    }
    if (error && !this.root.error) {
      this.root.error = describeError(error);
    }

    for (const run of this.items.values()) {
      if (!run.startTime) {
        run.startTime = this.root.startTime;
      }
      if (!run.endTime) {
        run.endTime = this.root.endTime;
      }
      if (!this.completedRuns.includes(run)) {
        this.completedRuns.push(run);
      }
    }

    const traceId = this.root.id;
    
    // Convert root to payload first to get its dotted_order
    const rootPayload = toPayload(this.root, traceId);
    const runs: LangSmithRunPayload[] = [rootPayload];
    
    // Set parent dotted_order for child runs before converting to payload
    for (const run of this.completedRuns.sort((a, b) => a.order - b.order)) {
      if (run.parentId === this.root.id) {
        run.parentDottedOrder = rootPayload.dotted_order ?? null;
      }
      runs.push(toPayload(run, traceId));
    }

    try {
      await this.client.sendRuns(runs, traceId);
    } catch (clientError) {
      console.warn("Failed to publish LangSmith trace", clientError);
    }
  }
}

type LangSmithClientInit = {
  apiKey: string;
  apiUrl: string;
  project?: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
};

class LangSmithClient implements LangSmithClientLike {
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly project: string | null;
  private readonly tags: string[];
  private readonly metadata: Record<string, unknown>;
  private readonly client: unknown;

  private constructor(init: LangSmithClientInit, client: unknown) {
    this.apiKey = init.apiKey;
    this.apiUrl = init.apiUrl.replace(/\/$/, "");
    this.project = init.project ?? null;
    this.tags = init.tags;
    this.metadata = init.metadata;
    this.client = client;
  }

  static async create(init: LangSmithClientInit): Promise<LangSmithClient | null> {
    try {
      const module = await import("langsmith");
      const ClientCtor = (module as { Client?: new (config?: Record<string, unknown>) => unknown }).Client;
      if (!ClientCtor) {
        return new LangSmithClient(init, null);
      }
      const client = new ClientCtor({
        apiUrl: init.apiUrl,
        apiKey: init.apiKey,
      });
      return new LangSmithClient(init, client);
    } catch (error) {
      if (isModuleNotFound(error)) {
        return new LangSmithClient(init, null);
      }
      console.warn("Failed to initialize LangSmith client", error);
      return null;
    }
  }

  async sendRuns(runs: LangSmithRunPayload[], traceId: string): Promise<void> {
    // Always use HTTP ingestion to ensure dotted_order is properly sent
    // The langsmith SDK may not forward dotted_order correctly in older versions
    await this.sendWithHttp(runs, traceId);
  }

  private async sendWithSdk(client: LangSmithSdk, runs: LangSmithRunPayload[], traceId: string): Promise<void> {
    for (const run of runs) {
      const payload = {
        ...run,
        trace_id: traceId,
        tags: run.tags ?? this.tags,
        extra: mergeMetadata(run.extra, this.metadata),
      };
      const debugFlag = process.env?.["DEBUG_LANGSMITH_PAYLOAD"];
      if (debugFlag === "1") {
        console.log("LangSmith SDK payload", JSON.stringify(payload));
      }
      if (this.project) {
        const attempts: Array<() => Promise<unknown>> = [
          () => client.createRun(payload, { projectName: this.project ?? undefined }),
          () => client.createRun({ ...payload, project_name: this.project }),
        ];
        let lastError: unknown = null;
        for (const attempt of attempts) {
          try {
            await attempt();
            lastError = null;
            break;
          } catch (attemptError) {
            lastError = attemptError;
          }
        }
        if (!lastError) {
          continue;
        }
        throw lastError instanceof Error ? lastError : new Error("Failed to create LangSmith run");
      }
      await client.createRun(payload);
    }
  }

  private async sendWithHttp(runs: LangSmithRunPayload[], traceId: string): Promise<void> {
    for (const run of runs) {
      const payload = {
        ...run,
        tags: run.tags ?? this.tags,
        extra: mergeMetadata(run.extra, this.metadata),
        project_name: this.project ?? undefined,
        trace_id: traceId,
      };
      const debugFlag = process.env?.["DEBUG_LANGSMITH_PAYLOAD"];
      if (debugFlag === "1") {
        console.log("LangSmith HTTP payload", JSON.stringify(payload));
      }
      const url = new URL("/api/v1/runs", this.apiUrl);
      if (this.project) {
        url.searchParams.set("project_name", this.project);
      }
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
        headers["x-api-key"] = this.apiKey;
      }
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!response.ok && response.status !== 409) {
        const text = await safeReadBody(response);
        throw new Error(`LangSmith HTTP ingestion failed (${response.status}): ${text}`);
      }
    }
  }
}

type LangSmithSdk = {
  createRun: (run: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
};

function mergeMetadata(
  runExtra: LangSmithRunPayload["extra"],
  baseMetadata: Record<string, unknown>,
): LangSmithRunPayload["extra"] {
  const payloadMetadata = runExtra?.metadata ?? {};
  const merged = { ...baseMetadata, ...payloadMetadata };
  return Object.keys(merged).length > 0 ? { metadata: merged } : undefined;
}

function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function previewText(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length <= 120) {
    return trimmed;
  }
  return `${trimmed.slice(0, 117)}...`;
}

function toJsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function describeItem(item: ThreadItem): string {
  switch (item.type) {
    case "command_execution":
      return `Command: ${item.command}`;
    case "file_change":
      return "File Changes";
    case "mcp_tool_call":
      return `MCP Tool: ${item.server}.${item.tool}`;
    case "agent_message":
      return "Agent Response";
    case "reasoning":
      return "Reasoning";
    case "web_search":
      return `Web Search: ${item.query}`;
    case "todo_list":
      return "Plan";
    case "error":
      return "Error";
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

function inferRunType(item: ThreadItem): string {
  switch (item.type) {
    case "command_execution":
    case "mcp_tool_call":
    case "web_search":
      return "tool";
    case "file_change":
      return "chain";
    case "agent_message":
      return "llm";
    case "reasoning":
    case "todo_list":
      return "chain";
    case "error":
      return "tool";
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

function initialInputs(item: ThreadItem): Record<string, unknown> {
  switch (item.type) {
    case "command_execution":
      return { command: item.command };
    case "file_change":
      return {};
    case "mcp_tool_call":
      return { server: item.server, tool: item.tool };
    case "agent_message":
      return {};
    case "reasoning":
      return {};
    case "web_search":
      return { query: item.query };
    case "todo_list":
      return { initial_plan: item.items };
    case "error":
      return {};
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

function applyCommandExecution(run: RunRecord, item: CommandExecutionItem): void {
  run.outputs.status = item.status;
  if (item.aggregated_output) {
    run.outputs.output = item.aggregated_output;
  }
  if (typeof item.exit_code === "number") {
    run.outputs.exit_code = item.exit_code;
  }
}

function applyFileChange(run: RunRecord, item: FileChangeItem): void {
  run.outputs.changes = item.changes.map((change) => ({ ...change }));
  run.outputs.status = item.status;
}

function applyMcpToolCall(run: RunRecord, item: McpToolCallItem): void {
  run.outputs.status = item.status;
}

function applyAgentMessage(run: RunRecord, item: AgentMessageItem): void {
  run.outputs.message = item.text;
  run.logs.push(item.text);
}

function applyReasoning(run: RunRecord, item: ReasoningItem): void {
  run.outputs.reasoning = item.text;
  if (item.text) {
    run.logs.push(item.text);
  }
}

function applyWebSearch(run: RunRecord, item: WebSearchItem): void {
  run.outputs.query = item.query;
}

function applyTodoList(run: RunRecord, item: TodoListItem): void {
  run.outputs.plan = item.items.map((todo) => ({ ...todo }));
}

function applyError(run: RunRecord, item: ErrorItem): void {
  run.error = item.message;
  run.outputs.error = item.message;
  run.logs.push(item.message);
}

function toPayload(run: RunRecord, traceId: string): LangSmithRunPayload {
  const start = run.startTime ?? new Date();
  const end = run.endTime ?? start;
  
  // Build dotted_order string in LangSmith format:
  // Root: "20240429T004912090000Z<run_id>"
  // Child: "<parent_dotted_order>.20240429T004912090000Z<run_id>"
  const timestamp = start.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const segment = `${timestamp}${run.id}`;
  const dottedOrder = run.parentDottedOrder ? `${run.parentDottedOrder}.${segment}` : segment;
  
  return {
    id: run.id,
    name: run.name,
    run_type: run.runType,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    inputs: run.inputs,
    outputs: Object.keys(run.outputs).length > 0 ? run.outputs : undefined,
    error: run.error ? { message: run.error } : undefined,
    parent_run_id: run.parentId ?? undefined,
    trace_id: traceId,
    tags: run.tags,
    extra: Object.keys(run.metadata).length ? { metadata: run.metadata } : undefined,
    execution_order: run.order,
    dotted_order: dottedOrder,
    logs: run.logs.length ? run.logs.join("\n") : undefined,
  };
}function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return JSON.stringify(error);
}

function isModuleNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; message?: string };
  const messageMatches = err.message?.includes("Cannot find module") ?? false;
  return err.code === "ERR_MODULE_NOT_FOUND" || messageMatches;
}

async function safeReadBody(response: { text: () => Promise<string> }): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function cleanMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}
