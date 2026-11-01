// The settings page's picker logic, kept apart from React so it can be tested on its own.

export type PickerOption = { value: string; label: string; group?: string; detail?: string; icon?: string };

// The options matching every typed word (in label, value or group). With `allowCustom`, what was
// typed is offered as a value of its own unless an option already has it, labelled by `customLabel`.
export function matchOptions(options: PickerOption[], query: string, allowCustom: boolean, customLabel = (value: string) => `Use “${value}”`): PickerOption[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = options.filter((o) => words.every((w) => `${o.label} ${o.value} ${o.group ?? ''}`.toLowerCase().includes(w)));
  const custom = query.trim();
  return allowCustom && custom && !options.some((o) => o.value === custom) ? [...matches, { value: custom, label: customLabel(custom) }] : matches;
}

// Runs requests where only the last one started may apply its answer, e.g. the models of the
// provider picked last, however late an earlier provider's list arrives. A failed request applies
// `fallback` when one is given.
export function latestOnly<T>() {
  let latest = 0;
  return async (request: () => Promise<T>, apply: (value: T) => void, ...fallback: [T?]) => {
    const id = ++latest;
    let value: T;
    try {
      value = await request();
    } catch (error) {
      if (!fallback.length) throw error;
      value = fallback[0] as T;
    }
    if (id === latest) apply(value);
  };
}
