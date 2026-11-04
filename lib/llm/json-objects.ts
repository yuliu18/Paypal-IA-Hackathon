// Finding the JSON a model wrapped in prose, shared by the intent judge and the document rules.

// Top-level `{...}` spans of a model's answer, found in one pass that treats braces inside JSON strings
// as text. Linear in the answer's length, so adversarial output can't stall the event loop.
export function topLevelObjects(text: string): string[] {
  const spans: string[] = [];
  let depth = 0;
  let start = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"' && depth > 0) {
      inString = true;
    } else if (ch === '{') {
      if (depth++ === 0) start = i;
    } else if (ch === '}' && depth > 0 && --depth === 0) {
      spans.push(text.slice(start, i + 1));
    }
  }
  return spans;
}
