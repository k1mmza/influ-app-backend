/**
 * Extract the first balanced top-level JSON value (object or array) from a model
 * response.
 *
 * Gemini's JSON mode (`responseMimeType: 'application/json'`) occasionally appends
 * stray characters after the closing brace — a partial code fence, a duplicate
 * `}`, etc. Parsing the whole string then throws
 * "Unexpected non-whitespace character after JSON". This walks the string with a
 * string-aware brace/bracket counter and returns just the first complete value,
 * so `JSON.parse` sees valid JSON. Falls back to the trimmed input when no `{`/`[`
 * is present (letting the caller's parse decide/throw).
 */
export function extractFirstJson(raw: string): string {
  const text = raw.trim();
  const start = text.search(/[{[]/);
  if (start === -1) return text;

  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  // Never balanced — genuinely truncated. Return from the first brace so the
  // caller's JSON.parse throws a meaningful error.
  return text.slice(start);
}
