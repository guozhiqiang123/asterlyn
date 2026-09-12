export const ACTIVITY_TOOLS = ["files", "branches", "changes"] as const;

export type ActivityTool = (typeof ACTIVITY_TOOLS)[number];
export type ActivityDropPosition = "before" | "after";

export const ACTIVITY_ORDER_KEY = "asterlyn.activityOrder.v1";

interface ActivityOrderStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function normalizeActivityOrder(value: unknown): ActivityTool[] {
  if (!Array.isArray(value)) return [...ACTIVITY_TOOLS];
  const known = new Set<ActivityTool>();
  for (const item of value) {
    if (isActivityTool(item)) known.add(item);
  }
  return [
    ...Array.from(known),
    ...ACTIVITY_TOOLS.filter((tool) => !known.has(tool)),
  ];
}

export function moveActivityTool(
  order: readonly ActivityTool[],
  source: ActivityTool,
  target: ActivityTool,
  position: ActivityDropPosition,
): ActivityTool[] {
  const normalized = normalizeActivityOrder(order);
  if (source === target) return normalized;
  const withoutSource = normalized.filter((tool) => tool !== source);
  const targetIndex = withoutSource.indexOf(target);
  if (targetIndex < 0) return normalized;
  withoutSource.splice(targetIndex + (position === "after" ? 1 : 0), 0, source);
  return withoutSource;
}

export function moveActivityToolByOffset(
  order: readonly ActivityTool[],
  tool: ActivityTool,
  offset: -1 | 1,
): ActivityTool[] {
  const normalized = normalizeActivityOrder(order);
  const index = normalized.indexOf(tool);
  const target = normalized[index + offset];
  if (!target) return normalized;
  return moveActivityTool(
    normalized,
    tool,
    target,
    offset < 0 ? "before" : "after",
  );
}

export function loadActivityOrder(storage: ActivityOrderStorage): ActivityTool[] {
  try {
    const encoded = storage.getItem(ACTIVITY_ORDER_KEY);
    return encoded ? normalizeActivityOrder(JSON.parse(encoded)) : [...ACTIVITY_TOOLS];
  } catch {
    return [...ACTIVITY_TOOLS];
  }
}

export function saveActivityOrder(
  storage: ActivityOrderStorage,
  order: readonly ActivityTool[],
): void {
  try {
    storage.setItem(ACTIVITY_ORDER_KEY, JSON.stringify(normalizeActivityOrder(order)));
  } catch {
    // Activity order is a presentation preference; storage denial is non-fatal.
  }
}

function isActivityTool(value: unknown): value is ActivityTool {
  return ACTIVITY_TOOLS.includes(value as ActivityTool);
}
