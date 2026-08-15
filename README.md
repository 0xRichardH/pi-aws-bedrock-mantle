# pi-aws-bedrock-mantle

Pi extension: all [Amazon Bedrock Mantle](https://bedrock-mantle.us-east-2.api.aws) models (GPT-5.5, DeepSeek, Qwen3, Mistral, Kimi, and more) with **SigV4 auth** — no long-term API key needed.

## Why SigV4?

Bedrock-mantle accepts both a long-term `AWS_BEARER_TOKEN_BEDROCK` key *and* standard SigV4-signed requests. 

## Models

Dynamically discovered at startup from the live `/v1/models` endpoint. As of June 2026, includes:

- **OpenAI**: GPT-5.5, GPT-5.4 (+ dated variants), GPT-OSS 120B/20B
- **DeepSeek**: V3.1, V3.2
- **Qwen3**: 32B, 235B, Coder variants, VL (vision)
- **Mistral**: Magistral, Devstral, Ministral, Voxtral
- **Moonshot Kimi**: K2 Thinking, K2.5
- **MiniMax**: M2, M2.1, M2.5
- **NVIDIA**: Nemotron Nano, Nemotron Super
- **Google**: Gemma 3 (4B, 12B, 27B)
- **ZAI**: GLM-4.6, GLM-4.7, GLM-5
- **Writer**: Palmyra Vision 7B

Falls back to a curated static list if discovery fails (expired creds at startup).

## How it works

1. At startup, the extension binds one **per-process loopback proxy on an ephemeral port** for the configured region. Each pi process owns its proxy — no singleton state, port conflicts, or stale credentials shared across processes.
2. The proxy signs every inbound request with SigV4 (using `BEDROCK_MANTLE_AWS_PROFILE` if set, else the default credential chain) and forwards it to `bedrock-mantle.<region>.api.aws`.
3. Live model discovery runs in the background — `/v1/models` is queried in the configured region. While discovery runs, pi uses a cached or curated fallback list so startup never blocks.
4. Pi routes each model to the right driver based on the model id:
   - Anthropic Claude → `anthropic-messages` via `/anthropic/v1/messages`
   - GPT-5.x → `openai-responses` via `/openai/v1/responses`
   - GPT OSS and other OpenAI-compatible models → `openai-completions` via `/v1/chat/completions`
5. Streaming SSE responses are piped back to pi unchanged.

## Setup

### 1. Install

```bash
# Via pi (recommended)
pi install npm:pi-aws-bedrock-mantle

# Or via GitHub
pi install git:github.com/0xRichardH/pi-aws-bedrock-mantle

# Or manually
npm install -g pi-aws-bedrock-mantle
```

### 2. Register with pi

If installed via `pi install`, it's already active. Otherwise add to `~/.pi/settings.json`:

```json
{
  "packages": ["npm:pi-aws-bedrock-mantle"]
}
```

### 3. Configure credentials

Add to `~/.aws/config`:

```ini
[profile bedrock-mantle]
region=us-east-2
output=json
credential_process=...
```

Add to shell init:

```bash
export BEDROCK_MANTLE_AWS_PROFILE=bedrock-mantle
```

Select the region and, optionally, scope model discovery and inference to a specific Bedrock project:

```bash
export AWS_REGION=us-east-1
export BEDROCK_MANTLE_PROJECT_ID=proj_stbnz3nemrsrofpgdzq6
```

`BEDROCK_MANTLE_REGION` overrides `AWS_REGION` when this extension needs a different region from other AWS tooling:

```bash
export BEDROCK_MANTLE_REGION=us-east-1
```

The region is required. The extension discovers models only in that region and routes every model family through its regional signing proxy. Startup fails with a clear configuration error if neither `AWS_REGION` nor `BEDROCK_MANTLE_REGION` is set.

The project ID is sent as `OpenAI-Project` for model discovery and OpenAI-compatible requests, and as `anthropic-workspace-id` for native Anthropic requests. Both headers are included in the SigV4 signature. If unset, Bedrock Mantle uses the account's default project.

> The `credential_process` auto-refreshes credentials on demand — no manual `ada credentials update` needed.

### 4. Use

Start pi and use `/model` → `bedrock-mantle` → pick a model.

Or launch directly:

```bash
pi --model bedrock-mantle/openai.gpt-5.5
```

## Credential options

The extension and proxy first honor `BEDROCK_MANTLE_AWS_PROFILE` via `fromIni({ profile })` (recommended, because other pi extensions may set `AWS_PROFILE`). If that is unset, they fall back to [`fromNodeProviderChain`](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-credential-providers/), which tries:

1. `AWS_PROFILE` env var
2. `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` env vars
3. `~/.aws/credentials` + `~/.aws/config`
4. EC2/ECS instance metadata

## Troubleshooting

**Models don't appear** — extension not loading. Check that the path in `settings.json` is correct and `npm install` has been run.

**`[bedrock-mantle] Model discovery failed`** — AWS creds unavailable at startup. Models fall back to a static list. 

**HTTP 401** — role doesn't have `bedrock-mantle:CreateInference`. Use a role with Bedrock access (e.g. `IibsAdminAccess-DO-NOT-DELETE` on your personal dev account).

**HTTP 403** — account not allowlisted for bedrock-mantle.

**Proxy port conflict** — by default, each pi process binds one ephemeral port, so port conflicts are impossible. If you've explicitly pinned `BEDROCK_MANTLE_PROXY_PORT` to a fixed value (e.g. for an external consumer that needs a stable URL), and that port is taken, change the value or unset the env var to fall back to ephemeral.

## Logging

The extension logs to stderr with a leveled, key=value format:

```
[bedrock-mantle] level=info kind=ready port=54321 profile=openclaw-bedrock project_id=default region=us-east-2
[bedrock-mantle] level=debug kind=request id=Az3kP9 region=us-east-2 method=POST path=/openai/v1/responses status=200 latency_ms=412 bytes_in=2851 bytes_out=18432
[bedrock-mantle] level=warn kind=request id=Bx7mQ2 region=us-east-1 status=403 latency_ms=98
```

Level is controlled by `BEDROCK_MANTLE_LOG`:

| Value | Behavior |
|---|---|
| `silent` / `off` / `none` | nothing |
| `error` | upstream/network failures only |
| `warn` | + non-2xx responses |
| `info` *(default)* | + startup, model discovery |
| `debug` | + per-request line for every call |

Every proxied response carries an `x-bedrock-mantle-request-id` header that
matches the `id=` field in the log line, so callers (pi, dashboards) can
correlate a user-visible failure to the matching server log.

### Durable log file (`BEDROCK_MANTLE_LOG_FILE`)

Stderr is ephemeral when pi runs over RPC (e.g. under pi-dashboard, where a
parent process consumes the child's stderr and it never reaches disk). To
capture log lines durably, set `BEDROCK_MANTLE_LOG_FILE` to a path:

```
BEDROCK_MANTLE_LOG_FILE=~/.pi/logs/bedrock-mantle.log
```

Every line that passes the `BEDROCK_MANTLE_LOG` level filter is appended to the
file in addition to stderr (parent directories are created automatically).
This is the reliable way to audit `kind=empty_completion` and
`kind=empty_completion_retry` events after the fact:

```
grep empty_completion ~/.pi/logs/bedrock-mantle.log
```

If the file can't be written, the sink disables itself after one warning and
stderr logging continues unaffected.

### Empty Responses API completions

The proxy watches `/openai/v1/responses` streams for completions with no
actionable output. It retries once by default, including transient upstream
`response.failed` events, and never retries more than once. The response is
streamed live whenever no content has been sent yet.

Control retries with `BEDROCK_MANTLE_EMPTY_COMPLETION_RETRY`:

| Value | Behavior |
|---|---|
| unset, `stream`, `1`, `on` | Streaming retry (default) |
| `buffer`, `full` | Buffer the response and retry even after content |
| `0`, `false`, `off` | Disable retries and pass responses through |

The proxy logs empty, non-terminal, and transient-failure retry events with
request IDs. For local diagnosis, set `BEDROCK_MANTLE_EMPTY_DUMP_DIR`:

```bash
BEDROCK_MANTLE_EMPTY_DUMP_DIR=~/.pi/logs/empty-dumps
```

Captures can contain full prompts, tool definitions, and request metadata.
Keep them outside the repository and delete them after diagnosis. Search the
file sink with:

```bash
grep -E 'empty_completion|upstream_failed_retry' ~/.pi/logs/bedrock-mantle.log
```
