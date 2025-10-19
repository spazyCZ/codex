import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { ThreadEvent } from "../src/events";
import type { ReasoningItem } from "../src/items";

describe("LangSmith tracer", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv } as NodeJS.ProcessEnv;
    global.fetch = originalFetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("initializes the tracer only when tracing is enabled", async () => {
    const { createLangSmithTracer } = await import("../src/langsmith");

    const disabled = await createLangSmithTracer({
      options: undefined,
      input: "Trace initialization",
      threadId: null,
      threadOptions: {},
      turnOptions: {},
    });
    expect(disabled).toBeNull();

    process.env.LANGSMITH_TRACING = "true";
    process.env.LANGSMITH_API_KEY = "sdk-key";

    const fetchMock = jest.fn(async (..._args: Parameters<typeof fetch>) => ({
      ok: true,
      status: 200,
      text: async () => "",
    }) as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const enabled = await createLangSmithTracer({
      options: { tags: ["sdk"], metadata: { env: "test" } },
      input: "Trace initialization",
      threadId: "thread-abc",
      threadOptions: { model: "gpt-test" },
      turnOptions: {},
    });

    expect(enabled).not.toBeNull();

    if (!enabled) {
      throw new Error("Expected LangSmith tracer to be created");
    }

    await enabled.handleEvent({ type: "thread.started", thread_id: "thread-abc" });
    await enabled.handleEvent({ type: "turn.started" });
    await enabled.handleEvent({
      type: "turn.completed",
      usage: { input_tokens: 2, cached_input_tokens: 0, output_tokens: 1 },
    });

    await enabled.finalize();

    expect(fetchMock).toHaveBeenCalled();
  });

  it("emits run payloads for streamed events", async () => {
    process.env.LANGSMITH_TRACING = "true";
    process.env.LANGSMITH_API_KEY = "http-key";
    process.env.LANGSMITH_ENDPOINT = "https://traces.example";

    const fetchMock = jest.fn(async (..._args: Parameters<typeof fetch>) => ({
      ok: true,
      status: 200,
      text: async () => "",
    }) as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const { createLangSmithTracer } = await import("../src/langsmith");

    const tracer = await createLangSmithTracer({
      options: {
        enabled: true,
        tags: ["http"],
        metadata: { release: "dev" },
      },
      input: "Follow the chain of thoughts",
      threadId: null,
      threadOptions: {
        model: "gpt-test",
        sandboxMode: "read-only",
        workingDirectory: "/tmp/project",
        skipGitRepoCheck: true,
      },
      turnOptions: { outputSchema: { type: "object" } },
    });

    if (!tracer) {
      throw new Error("Expected LangSmith tracer to be created");
    }

    const reasoning: ReasoningItem = { id: "item-1", type: "reasoning", text: "" };
    const events: ThreadEvent[] = [
      { type: "thread.started", thread_id: "thread-123" },
      { type: "turn.started" },
      { type: "item.started", item: reasoning },
      { type: "item.updated", item: { ...reasoning, text: "First thought" } },
      { type: "item.completed", item: { ...reasoning, text: "Final thought" } },
      {
        type: "turn.completed",
        usage: { input_tokens: 12, cached_input_tokens: 2, output_tokens: 4 },
      },
    ];

    for (const event of events) {
      await tracer.handleEvent(event);
    }

    await tracer.finalize();

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const rootCall = fetchMock.mock.calls[0];
    const itemCall = fetchMock.mock.calls[1];
    expect(rootCall).toBeDefined();
    expect(itemCall).toBeDefined();
    const rootOptions = rootCall![1];
    const itemOptions = itemCall![1];
    expect(rootOptions).toBeDefined();
    expect(itemOptions).toBeDefined();

    const rootInit = rootOptions as { body: string; headers: Record<string, string> };
    const itemInit = itemOptions as { body: string };
    expect(rootInit.headers).toMatchObject({
      Authorization: "Bearer http-key",
      "x-api-key": "http-key",
    });

    const rootPayload = JSON.parse(rootInit.body);
    const itemPayload = JSON.parse(itemInit.body);

    expect(rootPayload).toMatchObject({
      run_type: "chain",
      inputs: { prompt: "Follow the chain of thoughts" },
      outputs: { usage: { input_tokens: 12, cached_input_tokens: 2, output_tokens: 4 } },
      tags: ["http"],
    });
    expect(rootPayload.extra?.metadata).toMatchObject({
      input_preview: "Follow the chain of thoughts",
      model: "gpt-test",
      sandbox_mode: "read-only",
      working_directory: "/tmp/project",
      skip_git_repo_check: true,
      output_schema_requested: true,
      release: "dev",
      thread_id: "thread-123",
    });

    expect(itemPayload).toMatchObject({
      run_type: "chain",
      name: "Reasoning",
      parent_run_id: rootPayload.id,
      tags: ["http"],
      outputs: { reasoning: "Final thought" },
      logs: "First thought\nFinal thought",
    });
    expect(itemPayload.extra?.metadata).toMatchObject({
      item_id: "item-1",
      item_type: "reasoning",
    });
  });
});
