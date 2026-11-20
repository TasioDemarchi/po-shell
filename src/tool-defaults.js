export function taskAction(params = {}) {
  if (params.action) return params.action;
  if (params.title) return "new";
  if (params.phase) return "phase";
  return "show";
}

export function memoryAction(params = {}) {
  if (params.action) return params.action;
  if (params.query) return "search";
  return "save";
}
