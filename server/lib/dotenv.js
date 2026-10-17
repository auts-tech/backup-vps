// KEY=value lines (optionally prefixed with `export`), as read by Laravel, Node dotenv, Vite, Django-environ
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/;

function unquote(raw) {
  const v = raw.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"'))
    return v.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  const comment = v.search(/\s#/);
  return comment === -1 ? v : v.slice(0, comment).trim();
}

/**
 * Format a value so dotenv parsers read it back unchanged.
 */
export function quoteEnv(value) {
  const v = String(value ?? "");
  if (/^[A-Za-z0-9_./:@%+,=^~-]*$/.test(v)) return v;
  // Single quotes keep $ literal (no variable expansion)
  if (v.includes("$") && !v.includes("'") && !v.includes("\n")) return `'${v}'`;
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/**
 * [{ key, value }] in file order (the last occurrence wins, like dotenv).
 */
export function parseEnv(text) {
  const map = new Map();
  for (const line of String(text || "").split("\n")) {
    const m = line.match(LINE);
    if (m) map.set(m[1], unquote(m[2]));
  }
  return [...map.entries()].map(([key, value]) => ({ key, value }));
}

/**
 * Apply { KEY: value | null } to an env file, keeping comments, blank lines
 * and order. null removes the key; unknown keys are appended at the end.
 */
export function mergeEnv(text, updates) {
  const keys = new Set(Object.keys(updates));
  const written = new Set();
  const lines = String(text || "").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const out = [];
  for (const line of lines) {
    const m = line.match(LINE);
    if (!m || !keys.has(m[1])) {
      out.push(line);
      continue;
    }
    const value = updates[m[1]];
    if (written.has(m[1]) || value === null || value === undefined) continue;
    written.add(m[1]);
    out.push(`${m[1]}=${quoteEnv(value)}`);
  }
  for (const key of keys) {
    if (written.has(key) || updates[key] === null || updates[key] === undefined) continue;
    out.push(`${key}=${quoteEnv(updates[key])}`);
  }
  return `${out.join("\n")}\n`;
}

export function isValidEnvKey(key) {
  return /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(key || "");
}
