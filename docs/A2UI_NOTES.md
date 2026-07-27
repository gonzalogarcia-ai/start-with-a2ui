# A2UI Notes

Working reference for how A2UI is wired in this repo, the difference between the
fixed and dynamic schemas, and what to touch to add a new feature to a component.

## 1. What A2UI is here

A2UI (Agent-to-UI) is a JSON protocol the agent uses to describe UI declaratively.
Flow in this repo:

- The Python agent (`agent/`) emits A2UI v0.8 JSON operations from the LLM prompt
  in `agent/prompt_builder.py`.
- Each payload is wrapped as an A2A `DataPart` (mime `application/json+a2ui`) by
  `a2ui_extension/src/a2ui/a2ui_extension.py` (`create_a2ui_part`, activated via
  `try_activate_a2ui_extension`, URI `https://a2ui.org/a2a-extension/a2ui/v0.8`).
- The Next.js client (`app/`) receives operations and renders them.

The client is what makes the split: the **same agent output** is routed to either a
bespoke React component (fixed) or a generic runtime (dynamic), keyed on `surfaceId`.

## 2. Fixed vs dynamic at a glance

| `surfaceId`     | Rendered by                                                     | Kind    |
| --------------- | --------------------------------------------------------------- | ------- |
| `default`       | `RestaurantList` (hand-written React)                           | Fixed   |
| `confirmation`  | `BookingConfirmation` (hand-written React)                      | Fixed   |
| `booking-form`  | `DynamicBookingSurface` -> `A2UIRenderer` + `basicCatalog`      | Dynamic |

Router: `A2UIV08Surface` in `app/components/a2ui-v0-8-renderer.tsx`.

- **Fixed** = React defines the shape; the JSON is a data envelope for known keys/ids.
- **Dynamic** = JSON defines the shape; React just mounts a generic renderer that walks
  the component tree against v0.9 Zod schemas in `basicCatalog`.

## 3. Key files

Agent:
- `agent/prompt_builder.py` - `A2UI_SCHEMA` JSON Schema + few-shot `*_EXAMPLE` blocks
  (`SINGLE_COLUMN_LIST_EXAMPLE`, `TWO_COLUMN_LIST_EXAMPLE`, `BOOKING_FORM_EXAMPLE`,
  `CONFIRMATION_EXAMPLE`).
- `agent/agent.py` - validates agent output against `A2UI_SCHEMA` with `jsonschema`,
  one retry then plain-text fallback.
- `agent/agent_executor.py` - routes actions (`book_restaurant`, `submit_booking`) and
  wraps A2UI payloads via `create_a2ui_part`.
- `agent/tools.py`, `agent/restaurant_data.json` - data source for the LLM.

Client (fixed):
- `app/components/a2ui-v0-8-renderer.tsx` - contains everything:
  - Router: `A2UIV08Surface`.
  - Fixed renderers: `RestaurantList`, `BookingConfirmation`.
  - Extractors: `getOperations`, `getSurfaceId`, `getRestaurants`, `getBookingModel`,
    `dataEntriesToObject`, `getComponentLiteralText`.
  - Action dispatch: `useA2UIAction()`.
  - Exported entry point: `a2uiV08Renderer` (activityType `a2ui-surface`).

Client (dynamic):
- Same `a2ui-v0-8-renderer.tsx` - `DynamicBookingSurface` + `BookingSurfaceMessagePump`.
- `app/components/a2ui-v08-to-v09.ts` - `toV09(operations)` transform; the only local
  code that knows v0.9 component prop shapes.
- `app/a2ui-theme.css` - CSS variables consumed by `basicCatalog` (`--a2ui-primary-color`).
- External: `@copilotkit/a2ui-renderer` (`A2UIProvider`, `A2UIRenderer`, `basicCatalog`,
  hooks). v0.9 Zod schemas live in
  `node_modules/@copilotkit/a2ui-renderer/node_modules/@a2ui/web_core/.../basic_components.d.ts`.

## 4. Minimal example - fixed schema (surface `default`)

Agent output (excerpt of `SINGLE_COLUMN_LIST_EXAMPLE`):

```json
[
  { "beginRendering": { "surfaceId": "default", "root": "root-column" } },
  { "surfaceUpdate": { "surfaceId": "default", "components": [
      { "id": "root-column", "component": { "Column": {
          "children": { "explicitList": ["title-heading", "item-list"] } } } },
      { "id": "title-heading", "component": { "Text": {
          "text": { "literalString": "Top Restaurants" } } } }
  ] } },
  { "dataModelUpdate": { "surfaceId": "default", "contents": [
      { "key": "items", "valueMap": [
        { "key": "item1", "valueMap": [
          { "key": "name",   "valueString": "The Fancy Place" },
          { "key": "rating", "valueNumber": 4.8 } ] } ] } ] } }
]
```

Client render (fixed path):

```tsx
function RestaurantList({ operations, surfaceId }) {
  const restaurants = getRestaurants(operations);
  const title = getComponentLiteralText(operations, "title-heading") ?? "Top Restaurants";
  return (
    <div>
      <h2>{title}</h2>
      {restaurants.map(r => (
        <article key={r.name}>
          <img src={r.imageUrl} />
          <h3>{r.name}</h3>
          <button onClick={() => dispatch("book_restaurant", ...)}>Book Now</button>
        </article>
      ))}
    </div>
  );
}
```

Takeaway: **React defines the shape; JSON is a data envelope** for the fields
`RestaurantList` already knows to read (`items[].name`, `.rating`, `.imageUrl`, ...).

## 5. Minimal example - dynamic schema (surface `booking-form`)

Agent output (excerpt of `BOOKING_FORM_EXAMPLE`):

```json
[
  { "beginRendering": { "surfaceId": "booking-form", "root": "booking-form-column" } },
  { "surfaceUpdate": { "surfaceId": "booking-form", "components": [
      { "id": "booking-form-column", "component": { "Column": {
          "children": { "explicitList": ["party-size-field", "datetime-field", "submit-button"] } } } },
      { "id": "party-size-field", "component": { "TextField": {
          "label": { "literalString": "Party Size" },
          "text":  { "path": "partySize" }, "type": "number" } } },
      { "id": "submit-button", "component": { "Button": {
          "action": { "name": "submit_booking",
                      "context": [ { "key": "partySize", "value": { "path": "partySize" } } ] } } } }
  ] } },
  { "dataModelUpdate": { "surfaceId": "booking-form", "path": "/", "contents": [
      { "key": "partySize", "valueString": "2" } ] } }
]
```

Client render (dynamic path):

```tsx
function DynamicBookingSurface({ operations, surfaceId }) {
  return (
    <A2UIProvider catalog={basicCatalog} onAction={onAction}>
      <BookingSurfaceMessagePump operations={operations} surfaceId={surfaceId} />
      <A2UIRenderer surfaceId={surfaceId} />
    </A2UIProvider>
  );
}
// BookingSurfaceMessagePump: useEffect(() => processMessages(toV09(operations)), [...])
```

Takeaway: **JSON defines the shape; React just mounts a generic renderer.** No
restaurant-specific code exists in the render path.

## 6. Adding a feature - fixed schema

Example: add a `cuisine` chip under each restaurant card.

1. `agent/prompt_builder.py` - in `SINGLE_COLUMN_LIST_EXAMPLE` and
   `TWO_COLUMN_LIST_EXAMPLE`:
   - Add a new component (e.g. `{ "id": "template-cuisine", "component": { "Text":
     { "text": { "path": "cuisine" } } } }`) and reference it in the item template's
     `explicitList`.
   - Add `{ "key": "cuisine", "valueString": "..." }` under each `items[].valueMap`.
2. `agent/prompt_builder.py` - extend `A2UI_SCHEMA` **only** if you introduce a new
   component or value kind not already permitted.
3. `agent/restaurant_data.json` (+ `agent/tools.py` if the tool signature changes) -
   add `cuisine` to each entry so the LLM has it.
4. `app/components/a2ui-v0-8-renderer.tsx` - extend the `Restaurant` type with
   `cuisine?: string` and render it in the `RestaurantList` JSX. The extractors
   (`getRestaurants` / `dataEntriesToObject`) already round-trip arbitrary string
   keys, so usually no extractor change is needed.
5. Restart both the agent and the UI (prompt is baked into the LLM system message).

## 7. Adding a feature - dynamic schema

Example: add a `phone` field to the booking form.

1. `agent/prompt_builder.py` - in `BOOKING_FORM_EXAMPLE`:
   - Add `"phone-field"` to the root Column's `explicitList`.
   - Add the component:
     ```json
     { "id": "phone-field", "component": { "TextField": {
         "label": { "literalString": "Phone Number" },
         "text":  { "path": "phone" } } } }
     ```
   - Seed the data model: `{ "key": "phone", "valueString": "" }`.
   - Optionally add `phone` to `submit-button.action.context` if it must round-trip
     to the agent.
2. `agent/prompt_builder.py` - extend `A2UI_SCHEMA` only if the new component or value
   kind isn't already permitted (`TextField` already is).
3. `agent/agent_executor.py` - in the `submit_booking` branch, add the key to
   `ctx.get(...)` **only** if the field must appear in the follow-up query text.
4. `app/components/a2ui-v08-to-v09.ts` - usually **no change**. Extend the `switch` in
   `normalizeComponent` only if a new component's v0.8 and v0.9 prop shapes differ and
   the default shallow flatten doesn't produce a valid v0.9 payload.
5. React is untouched. Restart the agent (Python prompt isn't hot-reloaded); the UI
   can keep running.

## 8. Side-by-side: adding a field

| Step                 | Fixed (`cuisine`)                                        | Dynamic (`phone`)                                    |
| -------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| Prompt / example     | Both list examples in `prompt_builder.py`                | `BOOKING_FORM_EXAMPLE` in `prompt_builder.py`        |
| `A2UI_SCHEMA`        | Only if new component/value kind                         | Only if new component/value kind                     |
| Tool / data          | `restaurant_data.json` (+ maybe `tools.py`)              | N/A (unless prefilled from context)                  |
| `agent_executor.py`  | N/A unless value flows to another surface                | Add to `ctx.get(...)` only if round-trip needed      |
| Client React         | **Required** - type + JSX in `RestaurantList`            | **None**                                             |
| Client transform     | N/A                                                      | Only if v0.8/v0.9 prop shapes differ                 |
| Restart              | Agent + UI                                               | Agent only                                           |

## 9. A2A vs A2UI - where each protocol lives

Two protocols cooperate in this repo. They're independent but nested: A2UI JSON is
carried **inside** A2A messages.

- **A2A (Agent-to-Agent)** - the transport. Handles agent discovery, request/response
  framing, streaming, and extension negotiation between the Next.js client and the
  Python agent.
  - Server side: `agent/agent_executor.py` (extends `AgentExecutor` from the `a2a`
    Python SDK), `agent/__main__.py` (starts the A2A server), the `A2ACardResolver` /
    `A2AClient` usage on the client.
  - Extension negotiation: `a2ui_extension/src/a2ui/a2ui_extension.py` exposes
    `try_activate_a2ui_extension` (server) and the URI
    `https://a2ui.org/a2a-extension/a2ui/v0.8`, which the client requests via the
    A2A extension header. Only when this activates does the agent switch to the A2UI
    prompt.
  - Payloads travel as A2A `Part`s (`TextPart`, `DataPart`, ...). Client-side, the
    activity messages flow through CopilotKit's runtime.

- **A2UI (Agent-to-UI)** - the UI description. A JSON operation stream describing
  surfaces, components, and data model.
  - Emitted by: the LLM, following the schema + examples in `agent/prompt_builder.py`.
  - Validated by: `agent/agent.py` (`jsonschema.validate` against `A2UI_SCHEMA`).
  - Wrapped as an A2A `DataPart` with mime `application/json+a2ui` by
    `create_a2ui_part` in `a2ui_extension.py`.
  - Consumed by: `app/components/a2ui-v0-8-renderer.tsx` (activityType
    `a2ui-surface`), which then routes to fixed React or the dynamic
    `A2UIRenderer` from `@copilotkit/a2ui-renderer`.

Rule of thumb: if you're touching **agent lifecycle, streaming, or transport**, that's
A2A. If you're touching **what the user sees**, that's A2UI.

## 10. v0.8 vs v0.9 and the conversion

The repo emits **v0.8** on the agent side but renders the dynamic surface with a
**v0.9** runtime (`@copilotkit/a2ui-renderer` + `basicCatalog`). The fixed surfaces
never see v0.9 - they read v0.8 directly. The transform only exists for the dynamic
path.

### Key differences

| Aspect                | v0.8 (agent output)                                            | v0.9 (runtime input)                                          |
| --------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| Top-level ops         | `beginRendering`, `surfaceUpdate`, `dataModelUpdate`           | `createSurface`, `updateComponents`, `updateDataModel`        |
| Version tag           | implicit                                                       | each op carries `version: "v0.9"`                             |
| Catalog reference     | none (agent assumes fixed vocabulary)                          | `createSurface.catalogId` (e.g. `.../basic_catalog.json`)     |
| Theme / styles        | `beginRendering.styles`                                        | `createSurface.theme`                                         |
| Root component        | `beginRendering.root` = arbitrary id (e.g. `booking-form-column`) | must be the literal id `"root"`                            |
| Component shape       | `{ id, component: { <Name>: { ...props } } }` (nested)         | `{ id, component: "<Name>", ...props }` (flattened)           |
| Dynamic strings       | `{ literalString: "..." }` or `{ path: "..." }`                | plain string, or `{ path: "..." }`                            |
| Child lists           | `children: { explicitList: [...] }`                            | `children: [...]` (bare array)                                |
| Actions               | `{ name, context: [{ key, value }, ...] }`                     | `{ event: { name, context: { key: value, ... } } }`           |
| Data model            | adjacency list of `{ key, valueString, valueMap }`             | plain nested object at `path` (default `"/"`)                 |
| Prop renames          | `Text.usageHint`, `TextField.type` / `textFieldType`, `Button.primary: true` | `Text.variant`, `TextField.variant`, `Button.variant: "primary"` |
| Prop renames (fields) | `TextField.text`                                               | `TextField.value`                                             |

### What the transform does

Entry point: `toV09(operations)` in `app/components/a2ui-v08-to-v09.ts`. Called from
`BookingSurfaceMessagePump` inside `DynamicBookingSurface`
(`app/components/a2ui-v0-8-renderer.tsx`) and pumped into the runtime via
`processMessages` from `useA2UIActions()`.

Per-op mapping:

- `beginRendering` -> `createSurface` (moves `styles` -> `theme`, injects
  `catalogId = https://a2ui.org/specification/v0_9/basic_catalog.json`, records the
  original root id for later renaming).
- `surfaceUpdate` -> `updateComponents`. Each component is passed through
  `normalizeComponent`, then `renameRoot` rewrites the recorded root id (and any
  references to it in `children`/`child`) to the literal string `"root"`.
- `dataModelUpdate` -> `updateDataModel`. `entriesToObject` collapses the v0.8
  adjacency-list contents into a plain nested JS object placed at `path` (defaults
  to `"/"`).

Per-component rewrites in `normalizeComponent` (`a2ui-v08-to-v09.ts:78-133`):

- `Text` - unwrap `text` via `normalizeDynamicString`; rename `usageHint` -> `variant`.
- `Image` - unwrap `url` and `description`.
- `Column` / `Row` / `List` - `children.explicitList` -> `children` (bare array).
- `TextField` - `text` -> `value` (unwrapped); unwrap `label`; rename
  `textFieldType` / `type` -> `variant`.
- `DateTimeInput` - unwrap `value`, `label`, `min`, `max`.
- `Button` - `primary: true` -> `variant: "primary"`; run action through
  `normalizeAction`.
- Anything else falls back to a shallow flatten (`{ id, component: name, ...props }`)
  without deep prop rewrites.

Actions (`normalizeAction`): `{ name, context: [{key, value}] }` becomes
`{ event: { name, context: { key: value } } }`, with each `value` unwrapped via
`normalizeDynamicString`.

### Practical consequences

- Fixed renderers (`RestaurantList`, `BookingConfirmation`) never call `toV09` - they
  read v0.8 shapes directly through the extractors in `a2ui-v0-8-renderer.tsx`.
- The dynamic surface must have a component whose id resolves to `"root"` after
  `renameRoot` - the runtime crashes otherwise. Always keep exactly one root in
  `beginRendering.root`.
- The transform is intentionally partial: only the components used by the booking
  form (`Text`, `Image`, `Column`/`Row`/`List`, `TextField`, `DateTimeInput`,
  `Button`) get real prop rewrites. Anything new (e.g. `ChoicePicker`, `Slider`,
  `CheckBox`) will hit the shallow-flatten fallback and likely render wrong until a
  case is added to `normalizeComponent`.

## 11. Gotchas

- v0.8 -> v0.9 transform fallback in `normalizeComponent` is **shallow flatten**. A new
  dynamic component whose v0.8 and v0.9 prop shapes differ will render wrong until you
  extend the `switch` in `app/components/a2ui-v08-to-v09.ts`.
- Dynamic surface ignores `app/theme.ts` (v0.8 lit theme, incompatible with v0.9
  `Theme`). Set `--a2ui-primary-color` on an ancestor to restore brand color.
- `RestaurantAgent` only emits A2UI when `try_activate_a2ui_extension` returns true;
  otherwise it uses the plain-text prompt.
- `LITELLM_MODEL` default in `agent/agent.py` is
  `bedrock/eu.anthropic.claude-3-5-sonnet-20241022-v2:0`. The README's Gemini note is
  stale relative to the default.
- The parked `BookingForm` component in `a2ui-v0-8-renderer.tsx` is dead code (kept as
  a TODO fallback); the router sends `booking-form` to `DynamicBookingSurface`.
