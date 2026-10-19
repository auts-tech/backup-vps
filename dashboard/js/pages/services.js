/**
 * Services — systemd services (nginx, MariaDB, PHP-FPM, cron, Docker…):
 * status, start/stop/restart, start at boot, and their journal logs.
 */
let servicesState = { services: [], filter: "hosting", search: "" };

function renderServices(container) {
  const I = window.Icons;
  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>Services</h2>
          <p>System services running on this server. Hosting services are listed first.</p>
        </div>
        <button class="btn btn-secondary" onclick="loadServices()">${I.get("refresh", { size: 13 })}<span>Refresh</span></button>
      </div>
      <div class="sites-toolbar">
        <input type="search" class="form-input" id="svc-search" placeholder="Search services…">
        <div class="chip-group" id="svc-filters"></div>
      </div>
      <div class="card"><div class="table-container" style="border:none;border-radius:0;">
        <table class="table"><thead><tr><th>Service</th><th>Status</th><th>At boot</th><th style="text-align:right;">Actions</th></tr></thead><tbody id="svc-body"><tr><td colspan="4" style="padding:30px;text-align:center;"><div class="spinner"></div></td></tr></tbody></table>
      </div></div>
    </div>`;
  document.getElementById("svc-search").addEventListener(
    "input",
    UI.debounce((e) => {
      servicesState.search = e.target.value.trim().toLowerCase();
      renderServicesTable();
    }, 150),
  );
  loadServices();
}

async function loadServices() {
  try {
    const r = await api.getServices();
    if (!r.supported) {
      document.getElementById("svc-body").innerHTML = `<tr><td colspan="4">${UI.emptyState("layers", "systemd is not available", "Service management needs a server with systemd (Ubuntu / Debian).")}</td></tr>`;
      return;
    }
    servicesState.services = r.services;
    renderServicesTable();
  } catch (err) {
    document.getElementById("svc-body").innerHTML = `<tr><td colspan="4" style="color:var(--color-red);padding:20px;">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderServicesTable() {
  const tbody = document.getElementById("svc-body");
  if (!tbody) return;
  const I = window.Icons;
  const all = servicesState.services;
  const groups = {
    hosting: all.filter((s) => s.important),
    running: all.filter((s) => s.active === "active"),
    failed: all.filter((s) => s.active === "failed"),
    all,
  };
  document.getElementById("svc-filters").innerHTML = [
    ["hosting", "Hosting"],
    ["running", "Running"],
    ["failed", "Failed"],
    ["all", "All"],
  ]
    .map(([id, label]) => `<button class="chip ${servicesState.filter === id ? "active" : ""}" onclick="servicesState.filter='${id}';renderServicesTable()">${label} · ${groups[id].length}</button>`)
    .join("");
  const q = servicesState.search;
  const list = groups[servicesState.filter].filter((s) => !q || s.unit.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted" style="padding:20px;">No services.</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((s) => {
      const name = s.unit.replace(/\.service$/, "");
      const running = s.active === "active";
      const badge = running
        ? '<span class="badge badge-success"><span class="badge-dot"></span>running</span>'
        : s.active === "failed"
          ? '<span class="badge badge-danger"><span class="badge-dot"></span>failed</span>'
          : `<span class="badge badge-neutral">${escapeHtml(s.sub || s.active)}</span>`;
      const locked = s.protected;
      return `
      <tr>
        <td><div style="font-weight:600;">${escapeHtml(name)}${s.panel ? ' <span class="badge badge-info">this panel</span>' : ""}${locked ? ' <span class="badge badge-neutral" title="Keeps the server reachable">protected</span>' : ""}</div><div class="muted" style="font-size:12px;">${escapeHtml(s.description)}</div></td>
        <td>${badge}</td>
        <td>${s.enabled === "enabled" ? '<span class="badge badge-success">enabled</span>' : s.enabled ? `<span class="badge badge-neutral">${escapeHtml(s.enabled)}</span>` : '<span class="muted">—</span>'}</td>
        <td style="text-align:right;white-space:nowrap;">
          ${running ? `<button class="btn btn-sm btn-secondary" ${locked && !s.panel ? "disabled" : ""} onclick="svcAction(${jsArg(s.unit)}, 'restart')" title="Restart">${I.get("refresh", { size: 12 })}<span>Restart</span></button>` : `<button class="btn btn-sm btn-primary" onclick="svcAction(${jsArg(s.unit)}, 'start')">${I.get("play", { size: 12, color: "#fff" })}<span>Start</span></button>`}
          ${running && !locked && !s.panel ? `<button class="btn btn-sm btn-secondary" onclick="svcAction(${jsArg(s.unit)}, 'stop')" title="Stop">${I.get("square", { size: 12 })}</button>` : ""}
          ${!locked && !s.panel && ["enabled", "disabled"].includes(s.enabled) ? `<button class="btn btn-sm btn-ghost" onclick="svcAction(${jsArg(s.unit)}, '${s.enabled === "enabled" ? "disable" : "enable"}')">${s.enabled === "enabled" ? "Disable at boot" : "Enable at boot"}</button>` : ""}
          <button class="btn btn-sm btn-secondary" onclick="svcLogs(${jsArg(s.unit)})" title="Logs">${I.get("fileText", { size: 12 })}</button>
        </td>
      </tr>`;
    })
    .join("");
}

async function svcAction(unit, action) {
  const run = async () => {
    try {
      const r = await api.serviceAction(unit, action);
      toast.success(r.restarting ? "Restarting the panel" : `${action} done`, unit);
      if (r.restarting) return setTimeout(() => location.reload(), 6000);
    } catch (err) {
      Modal.show(`Could not ${action} ${escapeHtml(unit)}`, `<pre class="job-output">${escapeHtml(err.message)}</pre>`);
    }
    loadServices();
  };
  if (action === "stop" || action === "disable") Modal.confirm(`${action[0].toUpperCase()}${action.slice(1)} ${escapeHtml(unit)}?`, "Websites that depend on it may stop working.", run);
  else run();
}

async function svcLogs(unit) {
  const { overlay } = Modal.show(`Logs: ${escapeHtml(unit)}`, `<pre class="job-output" id="svc-log" style="max-height:65vh;">Loading…</pre>`, { width: 1000 });
  try {
    const r = await api.getServiceLogs(unit, 300);
    const pre = overlay.querySelector("#svc-log");
    pre.textContent = r.lines.length ? r.lines.join("\n") : "No journal entries.";
    pre.scrollTop = pre.scrollHeight;
  } catch (err) {
    overlay.querySelector("#svc-log").textContent = err.message;
  }
}

window.renderServices = renderServices;
