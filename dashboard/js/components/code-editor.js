/**
 * Full-screen code editor (Ace, loaded on demand from jsDelivr).
 * Used by the file manager, nginx site editor and php.ini editor.
 */
const ACE_BASE =
  "https://cdn.jsdelivr.net/npm/ace-builds@1.44.0/src-min-noconflict";

const EDITOR_MODES = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  json: "json",
  html: "html",
  htm: "html",
  vue: "html",
  css: "css",
  scss: "scss",
  less: "less",
  php: "php",
  py: "python",
  rb: "ruby",
  go: "golang",
  java: "java",
  c: "c_cpp",
  h: "c_cpp",
  cpp: "c_cpp",
  sh: "sh",
  bash: "sh",
  zsh: "sh",
  env: "sh",
  ini: "ini",
  cnf: "ini",
  cfg: "ini",
  toml: "toml",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  sql: "sql",
  xml: "xml",
  svg: "svg",
  conf: "nginx",
  dockerfile: "dockerfile",
  txt: "text",
  log: "text",
};

class CodeEditor {
  static loadAce() {
    if (window.ace) return Promise.resolve();
    if (CodeEditor._loading) return CodeEditor._loading;
    CodeEditor._loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `${ACE_BASE}/ace.js`;
      s.onload = () => {
        window.ace.config.set("basePath", ACE_BASE);
        resolve();
      };
      s.onerror = () => {
        CodeEditor._loading = null;
        reject(
          new Error(
            "Could not load the code editor (no internet access to cdn.jsdelivr.net?)",
          ),
        );
      };
      document.head.appendChild(s);
    });
    return CodeEditor._loading;
  }

  static modeFor(path) {
    const name = (path || "").split("/").pop().toLowerCase();
    if (name === "dockerfile") return "dockerfile";
    if (name.startsWith(".env") || name === ".bashrc" || name === ".profile")
      return "sh";
    if (name === "crontab") return "sh";
    if ((path || "").startsWith("/etc/nginx/")) return "nginx";
    const ext = name.includes(".") ? name.split(".").pop() : "";
    return EDITOR_MODES[ext] || "text";
  }

  /**
   * @param {object} opts { title, subtitle, content, path, mode, readOnly, onSave(content) → Promise }
   */
  static async open({
    title,
    subtitle = "",
    content = "",
    path = "",
    mode,
    readOnly = false,
    onSave,
  }) {
    const I = window.Icons;
    const overlay = document.createElement("div");
    overlay.className = "editor-overlay";
    overlay.innerHTML = `
      <div class="editor-shell">
        <div class="editor-header">
          <div style="min-width:0;">
            <div class="editor-title">${escapeHtml(title)}</div>
            ${subtitle ? `<div class="editor-subtitle">${escapeHtml(subtitle)}</div>` : ""}
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <span class="editor-status" id="editor-status"></span>
            ${readOnly ? "" : `<button class="btn btn-primary btn-sm" id="editor-save">${I.get("save", { size: 13, color: "#fff" })}<span>Save</span></button>`}
            <button class="btn btn-secondary btn-sm" id="editor-close">${I.get("x", { size: 13 })}<span>Close</span></button>
          </div>
        </div>
        <div class="editor-body" id="editor-body"><div style="display:flex;align-items:center;justify-content:center;height:100%;"><div class="spinner spinner-lg"></div></div></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const status = overlay.querySelector("#editor-status");
    let dirty = false;
    let editor = null;
    let fallback = null;

    const getValue = () => (editor ? editor.getValue() : fallback.value);
    const close = () => {
      if (dirty && !confirm("Discard unsaved changes?")) return;
      document.removeEventListener("keydown", onKey, true);
      editor?.destroy();
      overlay.remove();
    };
    const save = async () => {
      if (readOnly || !onSave) return;
      const btn = overlay.querySelector("#editor-save");
      btn.disabled = true;
      status.textContent = "Saving…";
      try {
        await onSave(getValue());
        dirty = false;
        status.textContent = `Saved ${new Date().toLocaleTimeString()}`;
      } catch (err) {
        status.textContent = "Save failed";
        Modal.show(
          "Save failed",
          `<pre class="job-output" style="max-height:340px;">${escapeHtml(err.message)}</pre>`,
        );
      } finally {
        btn.disabled = false;
      }
    };
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      } else if (
        e.key === "Escape" &&
        !document.querySelector(".modal-overlay")
      ) {
        close();
      }
    };
    document.addEventListener("keydown", onKey, true);
    overlay.querySelector("#editor-close").addEventListener("click", close);
    overlay.querySelector("#editor-save")?.addEventListener("click", save);

    const body = overlay.querySelector("#editor-body");
    try {
      await CodeEditor.loadAce();
      body.innerHTML =
        '<div id="ace-host" style="position:absolute;inset:0;"></div>';
      editor = window.ace.edit(body.querySelector("#ace-host"));
      editor.setTheme("ace/theme/github");
      editor.session.setMode(`ace/mode/${mode || CodeEditor.modeFor(path)}`);
      editor.setOptions({
        fontSize: "13px",
        fontFamily: "JetBrains Mono, monospace",
        showPrintMargin: false,
        tabSize: 4,
        useSoftTabs: true,
        readOnly,
      });
      editor.setValue(content, -1);
      editor.session.getUndoManager().reset();
      editor.session.on("change", () => {
        dirty = true;
        status.textContent = "Unsaved changes";
      });
      editor.focus();
    } catch (err) {
      // Plain textarea if the CDN is unreachable
      body.innerHTML =
        '<textarea class="editor-fallback" spellcheck="false"></textarea>';
      fallback = body.querySelector("textarea");
      fallback.value = content;
      fallback.readOnly = readOnly;
      fallback.addEventListener("input", () => {
        dirty = true;
        status.textContent = "Unsaved changes";
      });
      status.textContent = "Basic editor (syntax highlighting unavailable)";
    }
    return { close };
  }
}

window.CodeEditor = CodeEditor;
