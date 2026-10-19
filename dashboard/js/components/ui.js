/**
 * Small shared UI helpers used by the website pages and others.
 */
const STACKS = {
  node: { label: "Node.js", short: "JS", cls: "stack-node" },
  next: { label: "Next.js", short: "N", cls: "stack-next" },
  react: {
    label: "React / SPA",
    short: "R",
    cls: "stack-react",
    svg: '<svg viewBox="-12 -12 24 24" width="62%" height="62%" fill="none" stroke="currentColor" stroke-width="1.4"><circle r="2" fill="currentColor" stroke="none"/><ellipse rx="10" ry="4"/><ellipse rx="10" ry="4" transform="rotate(60)"/><ellipse rx="10" ry="4" transform="rotate(120)"/></svg>',
  },
  laravel: { label: "Laravel", short: "L", cls: "stack-laravel" },
  php: { label: "PHP", short: "php", cls: "stack-php" },
  wordpress: { label: "WordPress", short: "W", cls: "stack-wordpress" },
  static: { label: "Static site", short: "</>", cls: "stack-static" },
  python: { label: "Python", short: "Py", cls: "stack-python" },
  proxy: { label: "Reverse proxy", short: "⇄", cls: "stack-proxy" },
};

const UI = {
  STACKS,

  stack(type) {
    return STACKS[type] || STACKS.static;
  },

  stackAvatar(type, size = "md") {
    const s = UI.stack(type);
    return `<span class="stack-avatar stack-avatar-${size} ${s.cls}" title="${escapeHtml(s.label)}">${s.svg || escapeHtml(s.short)}</span>`;
  },

  /**
   * Health pill: { state: live|deploying|stopped|error|disabled|idle, label }
   */
  healthPill(health) {
    const state = health?.state || "idle";
    return `<span class="health-pill health-${state}"><span class="health-dot"></span>${escapeHtml(health?.label || "Unknown")}</span>`;
  },

  timeAgo(iso) {
    if (!iso) return "never";
    const sec = Math.round((Date.now() - new Date(iso)) / 1000);
    if (sec < 45) return "just now";
    if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
    if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
    if (sec < 86400 * 30) return `${Math.round(sec / 86400)} d ago`;
    return new Date(iso).toLocaleDateString();
  },

  duration(seconds) {
    if (seconds === null || seconds === undefined) return "—";
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}m ${seconds % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  },

  uptime(ms) {
    if (!ms) return "—";
    return UI.duration(Math.round(ms / 1000));
  },

  dateTime(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  },

  commit(commit, { link = false } = {}) {
    if (!commit) return '<span class="muted">—</span>';
    return `<span class="commit-ref"><code>${escapeHtml(commit.short || commit.hash?.slice(0, 7))}</code><span class="commit-msg truncate" title="${escapeHtml(commit.subject || "")}">${escapeHtml(commit.subject || "")}</span></span>`;
  },

  async copy(text, label = "Copied") {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast.success(label, "");
  },

  copyButton(text, label = "Copy") {
    return `<button class="btn btn-sm btn-secondary copy-btn" onclick="UI.copy(${jsArg(text)}, 'Copied to clipboard')" title="Copy">${Icons.get("copy", { size: 12 })}<span>${escapeHtml(label)}</span></button>`;
  },

  debounce(fn, ms = 300) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  },

  /**
   * Destructive action that must be confirmed by typing a name.
   * options: [{ id, label, hint, checked, danger }] rendered as checkboxes; onConfirm(values)
   */
  confirmTyped({
    title,
    message,
    expected,
    confirmText = "Delete",
    options = [],
    onConfirm,
  }) {
    const { overlay, close } = Modal.show(
      escapeHtml(title),
      `
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">${message}</p>
      ${
        options.length
          ? `<div class="option-list">${options
              .map(
                (o) => `
        <label class="option-row ${o.danger ? "option-danger" : ""}">
          <input type="checkbox" data-opt="${escapeHtml(o.id)}" ${o.checked ? "checked" : ""}>
          <span><span class="option-label">${escapeHtml(o.label)}</span>${o.hint ? `<span class="option-hint">${escapeHtml(o.hint)}</span>` : ""}</span>
        </label>`,
              )
              .join("")}</div>`
          : ""
      }
      <div class="form-group" style="margin-top:14px;margin-bottom:0;">
        <label class="form-label">Type <code>${escapeHtml(expected)}</code> to confirm</label>
        <input class="form-input mono-input" id="confirm-typed-input" autocomplete="off" spellcheck="false">
      </div>`,
      {
        submitText: confirmText,
        submitClass: "btn-danger-solid",
        onSubmit: async (el) => {
          if (
            el.querySelector("#confirm-typed-input").value.trim() !== expected
          )
            throw new Error(`Type ${expected} to confirm`);
          const values = {};
          el.querySelectorAll("[data-opt]").forEach(
            (c) => (values[c.dataset.opt] = c.checked),
          );
          await onConfirm(values);
        },
      },
    );
    const btn = overlay.querySelector("#modal-submit-btn");
    const input = overlay.querySelector("#confirm-typed-input");
    btn.disabled = true;
    input.addEventListener(
      "input",
      () => (btn.disabled = input.value.trim() !== expected),
    );
    input.focus();
    return { close };
  },

  /**
   * Tiny bar chart (inline SVG). values: numbers; labels: optional tooltips.
   */
  /**
   * Small bar chart. labels: tooltip per bar; ticks: short label under each bar ("" to skip).
   */
  bars(values, { labels = [], ticks = [], height = 120 } = {}) {
    const max = Math.max(1, ...values);
    return `<div class="bar-chart" style="height:${height}px;">${values
      .map(
        (v, i) => `
      <div class="bar-col" title="${escapeHtml(`${labels[i] || ""}${labels[i] ? ": " : ""}${Number(v).toLocaleString()}`)}">
        <div class="bar-area"><div class="bar ${v ? "" : "bar-empty"}" style="height:${Math.max(v ? 3 : 1, Math.round((v / max) * 100))}%"></div></div>
        <span class="bar-tick">${escapeHtml(ticks[i] ?? "")}</span>
      </div>`,
      )
      .join("")}</div>`;
  },

  /**
   * Remove terminal escape codes and collapse carriage-return progress bars.
   */
  cleanOutput(text) {
    return String(text || "")
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) =>
        line.includes("\r")
          ? line.split("\r").filter(Boolean).pop() || ""
          : line,
      )
      .join("\n");
  },

  emptyState(icon, title, desc, actionHtml = "") {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">${Icons.get(icon, { size: 20 })}</div>
        <div class="empty-state-title">${escapeHtml(title)}</div>
        <div class="empty-state-desc">${desc}</div>
        ${actionHtml}
      </div>`;
  },
};

window.UI = UI;
