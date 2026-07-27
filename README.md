# CopilotKit <> A2A + A2UI Starter

First project about the A2UI protocol and how to generate A2UI declarative (fixed- and dynamic-schema A2UI) components with Agents.

This is a starter template for building AI agents that use [A2UI](https://a2ui.org) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with an integrated restaurant finder agent that can find restaurants and book reservations

![Demo](Demo.gif)

## Prerequisites

- Gemeni API Key (for the ADK/A2A agent)
- Python 3.12+
- uv
- Node.js 20+
- Any of the following package managers:
  - npm (default)
  - [pnpm](https://pnpm.io/installation)
  - [yarn](https://classic.yarnpkg.com/lang/en/docs/install/)
  - [bun](https://bun.sh/)

## Getting Started

1. Install dependencies using your preferred package manager:

```bash
# Using npm (default)
npm install

# Using pnpm
pnpm install

# Using yarn
yarn install

# Using bun
bun install
```

> **Note:** This will automatically setup the Python environment as well.
>
> If you have manual issues, you can run:
>
> ```sh
> npm run install:agent
> ```

3. Set up your API keys:

The agent will not start unless a `GEMINI_API_KEY` is present in the environment (via `agent/.env`). This is required even if you don't plan to use Gemini as your LLM provider — if it is missing, the app breaks and never comes up.

Create a `.env` file with the following content:

```
GEMINI_API_KEY=your-gemini-api-key
```

If you don't have a Gemini API key, you need to:

- put a placeholder value there just to satisfy the check (e.g. `GEMINI_API_KEY=placeholder`), and
- use a different LLM provider by adding its API key alongside and pointing `LITELLM_MODEL` at that provider's model.

Example — use AWS Bedrock (Claude 3.5 Sonnet) instead of Gemini:

```
GEMINI_API_KEY=placeholder
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=eu-west-1
LITELLM_MODEL=bedrock/eu.anthropic.claude-3-5-sonnet-20241022-v2:0
```

The `LITELLM_MODEL` env var is read in `agent/agent.py` and passed to LiteLLM, so any LiteLLM-supported provider works (Bedrock, OpenAI, Anthropic, etc.) as long as the matching credentials are in the environment.

4. Start the development server:

```bash
# Using npm (default)
npm run dev

# Using pnpm
pnpm dev

# Using yarn
yarn dev

# Using bun
bun run dev
```

This will start both the UI and agent servers concurrently.

## Available Scripts

The following scripts can also be run using your preferred package manager:

- `dev` - Starts both UI and agent servers in development mode
- `dev:debug` - Starts development servers with debug logging enabled
- `dev:ui` - Starts only the Next.js UI server
- `dev:agent` - Starts only the A2A agent server
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `install:agent` - Installs Python dependencies for the agent

## Documentation

The main UI component is in `app/page.tsx`, but most of the UI comes from from the agent in the form of A2UI declarative components. To see and edit the components it can generate, look in `agent/prompt_builder.py`.
To generate new components, try the [A2UI Composer](https://a2ui-editor.ag-ui.com)

## Hybrid schema: fixed views + dynamic booking form (demo)

This starter renders A2UI surfaces two different ways depending on which surface the agent emits:

| Surface | Renderer | Kind |
|---|---|---|
| `default` (restaurant list) | Bespoke React (`RestaurantList` in `app/components/a2ui-v0-8-renderer.tsx`) | Fixed schema |
| `confirmation` (post-booking) | Bespoke React (`BookingConfirmation` in the same file) | Fixed schema |
| `booking-form` | Dynamic A2UI via `@copilotkit/a2ui-renderer` (`DynamicBookingSurface`) | Dynamic schema |

The list and confirmation are visually polished cards that rarely change, so they stay fixed. The booking form is the surface most likely to change (new fields, reordering, different labels), so it is rendered dynamically — you can add fields to the form by editing only the prompt, no React changes required.

### Data flow

1. `agent/prompt_builder.py` still emits the same v0.8 A2UI JSON shape it always did (ops named `beginRendering` / `surfaceUpdate` / `dataModelUpdate`, components wrapped as `{Text: {...}}`, bindings wrapped as `{literalString}` / `{path}`).
2. `agent/agent_executor.py` still routes actions (`book_restaurant`, `submit_booking`) into the executor branches exactly as before.
3. On the client, `app/components/a2ui-v0-8-renderer.tsx` switches on `surfaceId`:
   - `default` / `confirmation` → bespoke React components.
   - `booking-form` → `DynamicBookingSurface`, which mounts an `A2UIProvider` with `basicCatalog`, transforms the incoming v0.8 ops to v0.9 (via `app/components/a2ui-v08-to-v09.ts`), and lets `A2UIRenderer` paint the tree.
4. The button `submit_booking` action from `A2UIProvider.onAction` is translated to the wire shape the Python executor already expects (`{userAction: {actionName, sourceComponentId, surfaceId, timestamp, context}}`) before being dispatched via `copilotkit.setProperties({a2uiAction}) + runAgent`.

### The v0.8 → v0.9 transform (`app/components/a2ui-v08-to-v09.ts`)

Exports a single pure function `toV09(operations)` that:

- Renames ops: `beginRendering` → `createSurface` (with `styles` → `theme` and `catalogId: basicCatalog.id`), `surfaceUpdate` → `updateComponents`, `dataModelUpdate` → `updateDataModel`.
- Renames the top-level component to `id: "root"` (the id `A2UIRenderer` looks for), rewriting any references in `children` / `child`.
- Flattens `{component: {Name: {...props}}}` → `{component: "Name", ...props}`.
- Applies per-component prop rewrites so the payload matches the v0.9 `basicCatalog` Zod schemas:
  - `Text.usageHint` → `variant`
  - `TextField.text` → `value`, `TextField.type` / `textFieldType` → `variant`
  - `Button.primary: true` → `variant: "primary"`
  - `Button.action.{name, context:[{key, value}]}` → `{event: {name, context: {key1: value1, …}}}`
- Unwraps `{literalString: "x"}` → `"x"` and `{explicitList: [...]}` → `[...]`.
- Converts `dataModelUpdate.contents` adjacency-list entries to a plain object (`{key, valueString}` / `{key, valueMap}` → `{key: value}`), recursively.

Any component name not in the switch falls through with a shallow wrapper flatten only, so the LLM can experiment with other `basicCatalog` components without needing an immediate transform update.

### How to change the booking form (dynamic demo)

To add, remove, or reorder fields in the booking form, you only edit `agent/prompt_builder.py`. **No client code changes needed.**

Example — add a "Phone Number" field between Date & Time and Dietary Requirements:

1. In the `BOOKING_FORM_EXAMPLE` template around line 899, add `"phone-field"` to the root Column's `explicitList`:

   ```json
   "explicitList": ["booking-title", "restaurant-image", "restaurant-address", "party-size-field", "datetime-field", "phone-field", "dietary-field", "submit-button"]
   ```

2. Add the TextField component to the `components` array:

   ```json
   { "id": "phone-field", "component": { "TextField": { "label": { "literalString": "Phone Number" }, "text": { "path": "phone" } } } },
   ```

3. Seed the data model:

   ```json
   { "key": "phone", "valueString": "" },
   ```

Restart the agent (`npm run dev` — the Python prompt is not hot-reloaded), search for restaurants, click Book Now. The new field appears with the correct binding and styling from `basicCatalog`, no React edits.

### Components available in the dynamic form

Anything from `basicCatalog` in `@copilotkit/a2ui-renderer` — Text, Image, Column, Row, List, Card, Divider, Button, TextField, DateTimeInput, CheckBox, Slider, ChoicePicker, and more. See the schemas in `node_modules/@copilotkit/a2ui-renderer/node_modules/@a2ui/web_core/src/v0_9/basic_catalog/components/basic_components.d.ts` for exact prop shapes.

If you add a component the transform doesn't yet special-case, the shallow-flatten fallback covers it as long as its props are already v0.9-shaped. Extend the switch in `toV09.normalizeComponent` when a new component needs bespoke prop rewrites.

### Constraints and non-goals

- The agent's `A2UI_SCHEMA` validator (used in `agent/agent.py`) still expects v0.8. If you change the prompt to emit v0.9 op names directly, that validator will reject the response — the transform lives on the client because the schema lives on the server.
- Only the `booking-form` surface is dynamic. Restaurant list and confirmation surfaces stay bespoke — changing them still requires editing React.
- Theme: the dynamic surface currently ignores `app/theme.ts` (a v0.8 lit theme, not compatible with the v0.9 `Theme` interface). Set the `--a2ui-primary-color` CSS variable on a wrapping element to restore brand color for buttons.

## Security: why the A2UI schema validator matters

Dynamic UI lets the LLM decide what to render. That is powerful — and, without a guardrail, dangerous. The `A2UI_SCHEMA` JSON Schema in `agent/prompt_builder.py`, enforced by `jsonschema.validate(...)` inside `agent/agent.py` (`stream()`), is that guardrail. It's a server-side allowlist that runs *before* any A2UI payload leaves the agent.

**What the validator protects against:**

- **Rogue operations.** Only the four op names in the schema (`beginRendering`, `surfaceUpdate`, `dataModelUpdate`, `deleteSurface`) can be sent. The model cannot invent new op types that the client might route to unintended handlers.
- **Rogue components.** The schema pins the allowed component set (Text, Image, Column, Row, List, Card, Button, TextField, DateTimeInput, …). The LLM cannot invoke a component that doesn't exist in the catalog, so it cannot smuggle raw HTML, `<script>`, `iframe`, or arbitrary URLs into the DOM via a component the renderer would blindly instantiate.
- **Rogue actions.** Button `action` shapes are constrained to `{name, context}` where `name` is a string and `context` is a list of `{key, value}` pairs — no eval-style payloads, no `href: "javascript:..."` tricks, no arbitrary function-call objects unless the schema lets them through.
- **Prop injection.** Each component's props are typed. A `TextField` cannot arrive with an `onError: "fetch('...')"` prop, because that prop isn't in the schema — the whole message is rejected.
- **Silent corruption.** Truncated, malformed, or hallucinated JSON (missing `surfaceId`, unbalanced maps, wrong types) fails validation and triggers a single retry with a corrective prompt. If the retry also fails, the agent responds with a plain text apology instead of shipping broken UI parts.

**Trust boundary:** the LLM output is treated as untrusted input. It's validated at the *server* edge (`agent/agent.py`) before being turned into `DataPart`s and streamed to the browser. The client-side v0.8→v0.9 transform in `app/components/a2ui-v08-to-v09.ts` is a rendering shim, **not** a security layer — validation must stay on the server.

**When you extend the prompt (add components, new bindings, new actions), extend the schema too.** If a new field isn't in the schema, one of two things happens:

1. Validation rejects the response entirely (safe default — the demo will show an apology instead of your new component).
2. Schema was loosened without care (`additionalProperties: true`, `anyOf: [{}]`) and now anything the model emits is passed through — that's where injection risk creeps in.

Keep the schema strict. The dynamic-render pattern is only safe because the allowlist is tight.

## 📚 Documentation

- [A2UI + CopilotKit Documentation](https://docs.copilotkit.ai/a2a) - Learn more about how to use A2UI with CopilotKit
- [A2UI Documentation](https://a2ui.org) - Learn more about A2UI and its capabilities
- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues

If you see "I'm having trouble connecting to my tools", make sure:

1. The ADK agent is running on port 10002
2. Your Gemini API key is set correctly
3. Both servers started successfully

### Python Dependencies

If you encounter Python import errors:

```bash
cd agent
uv sync
uv run .
```
