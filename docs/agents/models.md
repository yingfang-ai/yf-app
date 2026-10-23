# Models: the「模型」settings tab

yingfang#31 (owner 2026-10-23, overturning the yingfang#28 deletion) restores pi-web's
model configuration surface: the 「模型」settings tab (in the old 「LLM 服务」position),
`/api/models*`, `/api/models-config*` and `/api/auth/api-key|providers`. The single
「LLM 服务」channel (`/api/yf/llm-config`, `lib/yf/llm-config.ts`, `llm/config.json`) is
gone entirely; `proxy.ts` answers that one path with a direct 404 at the gate (`REMOVED_LLM_CHANNEL_API`)
without forwarding — it cannot ride `DELETED_API`'s pass-through like the terminal family,
because `/api/yf/[...path]` catch-all would otherwise forward it verbatim to the yingfang
upstream (and, before the cookie check, hand anonymous callers a way in). The「模型」tab
is the only model source.

Not restored (spec non-goals, unchanged from #28): OAuth subscription login
(`/api/auth/login|logout`, `OAuthPastePanel`), the models.dev catalog fill
(`/api/models-config/catalog`) and the pi.dev catalog refresh (`/api/models/refresh`) —
the server never reaches out to those third parties.

## Visibility (operator-only)

Every handler of the restored families starts with `requireOperator`
(`lib/yf/route-policy.ts`): an ordinary user gets 403, an anonymous caller 401 (the yf
gate answers 401 first). The tab itself, the chat composer's `ModelSelector`, the Agents
page model dropdown and the AppShell quick button all resolve the operator identity
through the shared `useYfMe()` read face; ordinary users render none of them, and their
sessions never fetch `/api/models`.

## Storage (server-side agent dir, not the data root)

- Custom providers live in `<agent dir>/models.json`; built-in provider API keys in
  `<agent dir>/auth.json`. Both are mode 0600, written atomically
  (`writePrivateFileAtomicSync`), never in git or build output.
- **Write-only, never echoed**: `GET /api/models-config` serves the masked view
  (`toMaskedModelsConfig`, `lib/models-config-store.ts`) — apiKey and header VALUES never
  appear in any read-back; the panel shows `key_configured` / `headers_configured`
  「已配置」markers instead. Saving an empty key/header value keeps the stored one
  (留空=保持原值); a non-empty value overwrites. The server-side consumers (runtime
  composition, discover/test guards) still read the full config.
- **Literals only**: an apiKey or header value shaped like `!command` or `$VAR` is
  refused with 400 on the save face (`validateModelsConfigPayload`) and on built-in key
  entry (`/api/auth/api-key`) — the SDK's config resolver would otherwise run them
  against the SERVER's environment.
- discover/test keep the baseline's exfiltration guards
  (`lib/model-discovery-guards.ts`): a stored credential may only attach to the
  operator-configured base URL; because the panel reads masked drafts, the stored
  credential is merged in server-side (`mergeConfiguredCredentials`) when the destination
  is the configured one. The connectivity test's temp model runs with
  `supportsFinishReason: false` (OpenAI-compatible servers of the llama.cpp/vLLM class
  end streams without a finish_reason chunk).

## Session start (`startRpcSession()`, `lib/rpc-manager.ts`)

- A non-subagent session's model is the operator's **site default** — the agent global
  settings' default model (the「模型」tab's 设为默认 writes it via
  `PUT /api/models/default`). An explicit in-session `ModelSelector` pick (operator only)
  still wins.
- **No default configured** → a new session refuses with
  「全站默认模型未配置：请让运营者在设置「模型」tab 里设置默认模型后重试」 — never a
  silent pick from the enabled models. This is also the state right after deploying this
  change, until the operator re-enters the keys in the「模型」tab (the old
  `llm/config.json` is not migrated).
- A session recorded on the removed `yf-llm` channel falls back to the current site
  default on reopen; if no default is configured it answers with the same 「未配置」
  error. Subagent sessions resolve their model from their profile and never pass here.
- Two pieces of upstream model resolution still run inside this path:
  - `lib/model-scope.ts` (`resolveVisibleModels()` / `selectInitialModelScope()`) delegates
    `enabledModels` matching to the SDK's `resolveModelScopeWithDiagnostics()`. Never
    compare those patterns as strings.
  - `lib/deferred-provider-models.ts` covers a provider that an extension registers only
    at `session_start`. The session is built on the default model, then switched with
    `set_model` once its extensions are bound.

## In the chat

- Operators get the native `ModelSelector` in the composer (plus the reasoning-level
  control's save-as-default star); ordinary users get neither — their model is the site
  default, fixed server-side.
