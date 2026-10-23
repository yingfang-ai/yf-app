# Models: the single LLM channel

yingfang#28 removed pi-web's model configuration surface: the Models settings panel, provider
sign-in, the `enabledModels` editor and catalog refresh, with their routes `/api/models*`,
`/api/models-config*` and `/api/auth/*`. `proxy.ts` (`DELETED_API`) lets these paths through
without a session, so they answer Next's plain 404 rather than a login redirect. One channel
configured on the server is the only model source.

## The channel (`lib/yf/llm-config.ts`)
- One config for the whole site: `{ base_url, key, model_id }` in `<YF_DATA_DIR>/llm/config.json`.
  The file is mode 0600, written atomically, and kept out of git and logs.
- Only operators can read or change it: Settings → LLM (`components/yf/LlmConfigCard.tsx`) through
  `GET`/`PUT /api/yf/llm-config` (`requireOperator`). An ordinary user gets 403; an anonymous
  caller gets 401.
- The key is write-only. `GET` returns `{ base_url, model_id, key_configured }` and never the
  key's bytes, so after saving even an operator sees only "已配置". A new `PUT` overwrites it.
- The old `YF_LLM_*` environment variables are gone. The UI channel is the only source.

## Session start (`startRpcSession()`, `lib/rpc-manager.ts`)
- A non-subagent session reads the channel. `llmChannelModelRuntime()` regenerates the derived
  `<YF_DATA_DIR>/llm/runtime-models.json` (0600) on each start. It defines one provider,
  `yf-llm` (`LLM_CHANNEL_PROVIDER_ID`, `openai-completions`), with the channel's one model. The
  session's `ModelRuntime` is created from that file with `allowModelNetwork: false`, and the
  channel model becomes the requested model.
- If the channel is not configured, a new session with no explicit `initialModel` fails with
  "LLM 配置通道未配置…". A restored session (`sessionFile`) still opens; if its model cannot be
  resolved, the SDK reports that. Subagent sessions resolve their model from their profile and
  do not use the channel.
- Two pieces of upstream model resolution still run inside this path:
  - `lib/model-scope.ts` (`resolveVisibleModels()` / `selectInitialModelScope()`) delegates
    `enabledModels` matching to the SDK's `resolveModelScopeWithDiagnostics()`. Never compare
    those patterns as strings.
  - `lib/deferred-provider-models.ts` covers a provider that an extension registers only at
    `session_start`. The session is built on the default model, then switched with `set_model`
    once its extensions are bound.

## In the chat
- The composer has no model list. `useAgentSession`'s `modelList` is a constant empty array, so
  nobody picks a model in the browser. The reasoning-level control still sends
  `set_thinking_level` for the open session.
