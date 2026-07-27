const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

type A2UIOperation = {
  beginRendering?: {
    surfaceId?: string;
    root?: string;
    styles?: Record<string, unknown>;
  };
  surfaceUpdate?: {
    surfaceId?: string;
    components?: Array<{ id?: string; component?: Record<string, unknown> }>;
  };
  dataModelUpdate?: {
    surfaceId?: string;
    path?: string;
    contents?: A2UIDataEntry[];
  };
};

type A2UIDataEntry = {
  key: string;
  valueString?: string;
  valueMap?: A2UIDataEntry[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function normalizeDynamicString(v: unknown): unknown {
  if (isRecord(v)) {
    if (typeof v.literalString === "string") return v.literalString;
    if (typeof v.path === "string") return { path: v.path };
  }
  return v;
}

function normalizeChildList(v: unknown): unknown {
  if (isRecord(v) && Array.isArray(v.explicitList)) {
    return v.explicitList;
  }
  return v;
}

function normalizeAction(v: unknown): unknown {
  if (!isRecord(v)) return v;
  if (isRecord(v.event) || isRecord(v.functionCall)) return v;
  if (typeof v.name === "string") {
    const context: Record<string, unknown> = {};
    if (Array.isArray(v.context)) {
      for (const entry of v.context) {
        if (isRecord(entry) && typeof entry.key === "string") {
          context[entry.key] = normalizeDynamicString(entry.value);
        }
      }
    }
    return { event: { name: v.name, context } };
  }
  return v;
}

function normalizeComponent(
  raw: { id?: string; component?: Record<string, unknown> } | undefined,
): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const { id, component } = raw;
  if (!isRecord(component)) {
    return { id, component } as Record<string, unknown>;
  }
  const entries = Object.entries(component);
  if (entries.length !== 1) {
    return { id, component } as Record<string, unknown>;
  }
  const [name, rawProps] = entries[0];
  const props: Record<string, unknown> = isRecord(rawProps) ? { ...rawProps } : {};

  switch (name) {
    case "Text": {
      if ("text" in props) props.text = normalizeDynamicString(props.text);
      if ("usageHint" in props) {
        props.variant = props.usageHint;
        delete props.usageHint;
      }
      break;
    }
    case "Image": {
      if ("url" in props) props.url = normalizeDynamicString(props.url);
      if ("description" in props)
        props.description = normalizeDynamicString(props.description);
      break;
    }
    case "Column":
    case "Row":
    case "List": {
      if ("children" in props) props.children = normalizeChildList(props.children);
      break;
    }
    case "TextField": {
      if ("text" in props) {
        props.value = normalizeDynamicString(props.text);
        delete props.text;
      }
      if ("value" in props) props.value = normalizeDynamicString(props.value);
      if ("label" in props) props.label = normalizeDynamicString(props.label);
      if ("textFieldType" in props) {
        props.variant = props.textFieldType;
        delete props.textFieldType;
      }
      if ("type" in props) {
        props.variant = props.type;
        delete props.type;
      }
      break;
    }
    case "DateTimeInput": {
      if ("value" in props) props.value = normalizeDynamicString(props.value);
      if ("label" in props) props.label = normalizeDynamicString(props.label);
      if ("min" in props) props.min = normalizeDynamicString(props.min);
      if ("max" in props) props.max = normalizeDynamicString(props.max);
      break;
    }
    case "Button": {
      if (props.primary === true) {
        props.variant = "primary";
        delete props.primary;
      }
      if ("action" in props) props.action = normalizeAction(props.action);
      break;
    }
    default:
      break;
  }

  return { id, component: name, ...props };
}

function entriesToObject(entries: A2UIDataEntry[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of entries) {
    if (!entry || typeof entry.key !== "string") continue;
    if (Array.isArray(entry.valueMap)) {
      out[entry.key] = entriesToObject(entry.valueMap);
    } else {
      out[entry.key] = entry.valueString ?? "";
    }
  }
  return out;
}

function renameRoot(
  component: Record<string, unknown>,
  fromId: string,
): Record<string, unknown> {
  const c = { ...component };
  if (c.id === fromId) c.id = "root";
  // Rewrite child id references in Column/Row/List.children arrays.
  if (Array.isArray(c.children)) {
    c.children = (c.children as unknown[]).map((child) =>
      child === fromId ? "root" : child,
    );
  }
  // Button.child (single id reference).
  if (typeof c.child === "string" && c.child === fromId) c.child = "root";
  return c;
}

export function toV09(
  operations: A2UIOperation[],
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];

  // The A2UIRenderer expects the top-level component to have id "root".
  // v0.8 templates use `beginRendering.root: "<some-id>"` to declare it;
  // we rewrite that id (and any references to it) to "root".
  let rootId: string | undefined;
  for (const op of operations) {
    if (isRecord(op) && op.beginRendering && typeof op.beginRendering.root === "string") {
      rootId = op.beginRendering.root;
      break;
    }
  }

  for (const op of operations) {
    if (!isRecord(op)) continue;

    if (op.beginRendering) {
      out.push({
        version: "v0.9",
        createSurface: {
          surfaceId: op.beginRendering.surfaceId,
          catalogId: BASIC_CATALOG_ID,
          theme: op.beginRendering.styles ?? {},
        },
      });
      continue;
    }

    if (op.surfaceUpdate) {
      const components = (op.surfaceUpdate.components ?? [])
        .map(normalizeComponent)
        .filter((c): c is Record<string, unknown> => !!c)
        .map((c) => (rootId ? renameRoot(c, rootId) : c));
      out.push({
        version: "v0.9",
        updateComponents: {
          surfaceId: op.surfaceUpdate.surfaceId,
          components,
        },
      });
      continue;
    }

    if (op.dataModelUpdate) {
      out.push({
        version: "v0.9",
        updateDataModel: {
          surfaceId: op.dataModelUpdate.surfaceId,
          path: op.dataModelUpdate.path ?? "/",
          value: entriesToObject(op.dataModelUpdate.contents ?? []),
        },
      });
      continue;
    }
  }

  return out;
}
