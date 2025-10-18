# LangSmith Integration for Codex

This document describes how to integrate Codex with [LangSmith](https://smith.langchain.com/), LangChain's observability platform, to gain deep insights into agent planning, reasoning, and decision-making processes.

## Overview

The LangSmith integration provides comprehensive observability of Codex agent behavior by capturing and sending telemetry data to LangSmith. This enables you to:

- **Trace agent decision-making**: See every step the agent takes from receiving a prompt to completing a task
- **Debug agent behavior**: Understand why the agent made specific decisions or took certain actions
- **Monitor performance**: Track API requests, response times, and token usage
- **Analyze tool usage**: See which tools the agent calls, with what arguments, and what results they return
- **Optimize prompts and configurations**: Experiment with different settings and measure their impact

## What Gets Traced

When LangSmith integration is enabled, Codex automatically exports the following events:

### Conversation Events
- **Conversation Starts**: Initial configuration, model settings, reasoning effort, approval policy, sandbox policy, MCP servers
- **User Prompts**: User input (optionally redacted for privacy)

### API Events
- **API Requests**: HTTP requests to OpenAI/model provider APIs with status codes, duration, and retry information
- **SSE Events**: Server-sent events from the streaming API including response chunks, function calls, and completion

### Tool Events
- **Tool Decisions**: When the agent decides to call a tool, whether it requires approval, and the approval decision
- **Tool Results**: Tool execution results including arguments, output, duration, and success/failure status

### Error Events
- **API Failures**: Failed API requests with error messages
- **Tool Failures**: Failed tool executions with error details

## Setup

### Prerequisites

1. **LangSmith Account**: Sign up at [smith.langchain.com](https://smith.langchain.com/)
2. **API Key**: Get your API key from the LangSmith Settings page
3. **Project** (optional): Create a project in LangSmith to organize your traces

### Configuration

Add the following to your `~/.codex/config.toml`:

```toml
[otel]
environment = "dev"  # or "staging", "prod", "test"
log_user_prompt = false  # set to true to include prompt text in traces
exporter = { langsmith = {
    api_key = "${LANGSMITH_API_KEY}",
    project = "my-codex-project"  # optional
}}
```

#### Configuration Options

- **`api_key`** (required): Your LangSmith API key. Use environment variable `${LANGSMITH_API_KEY}` for security.
- **`endpoint`** (optional): LangSmith API endpoint. Defaults to `https://api.smith.langchain.com`.
- **`project`** (optional): Project name in LangSmith. If not specified, traces go to your default project.
- **`environment`** (optional): Environment label for filtering traces. Defaults to `"dev"`.
- **`log_user_prompt`** (optional): Whether to include actual user prompt text. Defaults to `false` (redacted).

### Environment Variables

Set your API key as an environment variable:

```bash
export LANGSMITH_API_KEY="your-api-key-here"
```

Or add it to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
echo 'export LANGSMITH_API_KEY="your-api-key-here"' >> ~/.bashrc
source ~/.bashrc
```

## Usage

Once configured, simply run Codex normally. All agent activity will automatically be sent to LangSmith:

```bash
codex "implement a fibonacci function in Python"
```

### Viewing Traces in LangSmith

1. Go to [smith.langchain.com](https://smith.langchain.com/)
2. Navigate to your project
3. View the list of traces (runs)
4. Click on a trace to see detailed information:
   - Timeline of events
   - Input/output for each step
   - Tool calls and results
   - API requests and responses
   - Errors and failures

### Filtering Traces

Use the LangSmith UI to filter traces by:
- **Environment**: Filter by `dev`, `staging`, `prod`, etc.
- **Conversation ID**: Find all traces for a specific conversation
- **Model**: Filter by which model was used
- **Time range**: View traces from a specific time period
- **Status**: Filter by successful vs failed traces

## Privacy Considerations

### User Prompt Redaction

By default, user prompts are **redacted** (`[REDACTED]`) in traces to protect privacy. Only the prompt length is logged.

To include actual prompt text (e.g., in development environments), set:

```toml
[otel]
log_user_prompt = true
```

### Sensitive Data

Be careful not to include sensitive data in:
- Configuration files (use environment variables)
- Tool outputs (consider what data your tools might return)
- Error messages

## Troubleshooting

### Traces Not Appearing

1. **Check API key**: Ensure `LANGSMITH_API_KEY` is set correctly
2. **Verify configuration**: Check `~/.codex/config.toml` syntax
3. **Check logs**: Look at `~/.codex/log/codex-tui.log` for errors
4. **Network connectivity**: Ensure you can reach `api.smith.langchain.com`

### Authentication Errors

If you see "LangSmith API error 401" or "403":
- Verify your API key is correct
- Check that the API key hasn't expired
- Ensure you have permissions for the specified project

### Missing Events

- Ensure the `otel` feature is enabled (it is in prebuilt binaries)
- Check that exporter is not set to `"none"`
- Verify network isn't blocking requests to LangSmith

## Advanced Usage

### Multiple Environments

Use different configurations for different environments:

**Development** (`~/.codex/config.toml`):
```toml
[otel]
environment = "dev"
log_user_prompt = true
exporter = { langsmith = { api_key = "${LANGSMITH_API_KEY}", project = "codex-dev" }}
```

**Production** (separate config):
```toml
[otel]
environment = "prod"
log_user_prompt = false
exporter = { langsmith = { api_key = "${LANGSMITH_API_KEY_PROD}", project = "codex-prod" }}
```

### Custom Projects

Organize traces by creating multiple projects in LangSmith:
- `codex-experiments`: Testing new prompts/configurations
- `codex-prod`: Production usage
- `codex-benchmarks`: Performance testing

Specify the project in your config:

```toml
[otel]
exporter = { langsmith = { api_key = "${LANGSMITH_API_KEY}", project = "codex-experiments" }}
```

## Integration with Other Tools

### Combining with OTLP

You cannot use both LangSmith and OTLP exporters simultaneously. Choose one based on your needs:

- **LangSmith**: Best for AI-specific observability, user-friendly UI, built-in analysis tools
- **OTLP**: Best for integrating with existing observability infrastructure (Jaeger, Tempo, etc.)

## Example: Analyzing Agent Behavior

1. Run Codex with a complex task:
   ```bash
   codex "create a web server with authentication and database integration"
   ```

2. Go to LangSmith and find the trace for this conversation

3. Analyze the trace to understand:
   - How many planning steps did the agent take?
   - Which tools were called and in what order?
   - Were there any failures or retries?
   - How much time was spent on each step?
   - What was the total token usage?

4. Use insights to:
   - Optimize your prompts for better performance
   - Adjust approval policies based on tool usage patterns
   - Identify bottlenecks in the agent's workflow

## Support

For issues with the LangSmith integration:
- Check the [Codex repository](https://github.com/openai/codex) for updates
- Review the [LangSmith documentation](https://docs.smith.langchain.com/)
- Open an issue on GitHub with logs from `~/.codex/log/codex-tui.log`

For LangSmith-specific questions:
- Visit [LangSmith documentation](https://docs.smith.langchain.com/)
- Contact LangChain support through their channels
