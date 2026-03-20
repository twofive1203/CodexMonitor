const PLAN_READY_TAG_PREFIX = "[[cm_plan_ready:";

export function isPlanReadyTaggedMessage(text: string) {
  return text.trimStart().startsWith(PLAN_READY_TAG_PREFIX);
}

export function makePlanReadyAcceptMessage() {
  return `${PLAN_READY_TAG_PREFIX}accept]] 按此计划执行。`;
}

export function makePlanReadyChangesMessage(changes: string) {
  const trimmed = changes.trim();
  return `${PLAN_READY_TAG_PREFIX}changes]] 请按以下修改调整计划：\n\n${trimmed}`;
}
