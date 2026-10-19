/**
 * Website page — everything about one website: overview, deployments
 * (Git, history, rollback, push-to-deploy), domains & HTTPS, .env, the app
 * process, database, backups, logs & traffic, settings.
 */
let sd = { id: null, site: null, tab: "overview", consoles: [] };

const SD_TABS = [
  { id: "overview", label: "Overview", icon: "dashboard" },
  { id: "deployments", label: "Deployments", icon: "rocket" },
  { id: "domains", label: "Domains & SSL", icon: "globe" },
  {
    id: "env",
    label: "Environment",
    icon: "sliders",
    when: (s) => s.features.env && s.deployPath,
  },
  { id: "app", label: "App", icon: "cpu", when: (s) => s.features.process },
  { id: "php", label: "PHP", icon: "code", when: (s) => s.features.php },
  {
    id: "database",
    label: "Database",
    icon: "database",
    when: (s) => !s.features.external,
  },
  {
    id: "backups",
    label: "Backups",
    icon: "archive",
    when: (s) => !!s.deployPath,
  },
  { id: "logs", label: "Logs & Traffic", icon: "barChart" },
  { id: "settings", label: "Settings", icon: "settings" },
];

function renderSiteDetail(container, params = []) {
  sd = {
    id: params[0],
    site: null,
    tab: params[1] || "overview",
    consoles: [],
  };
  container.innerHTML = `<div id="sd-root"><div style="text-align:center;padding:60px;"><div class="spinner spinner-lg"></div></div></div>`;
  window.app.onLeave(() => {
    clearInterval(sd.timer);
    sd.consoles.forEach((c) => c.stop());
  });
  sdLoad().then(() => {
    // Keep status fresh; quick while something runs
    sd.timer = setInterval(() => {
      if (window.app.currentPage !== "site") return clearInterval(sd.timer);
      const busy =
        sd.site &&
        (sd.site.health.state === "deploying" ||
          sd.site.provision?.status === "running");
      if (busy || Date.now() - (sd.loadedAt || 0) > 20000)
        sdLoad({ quiet: true });
    }, 4000);
  });
}

async function sdLoad({ quiet = false, rerenderTab = false } = {}) {
  try {
    const prev = sd.site;
    sd.site = await api.getSite(sd.id);
    sd.loadedAt = Date.now();
    const s = sd.site;
    window.app.setTitle(s.name);
    if (!document.getElementById("sd-header") || !quiet) {
      sdRenderShell();
      return;
    }
    document.getElementById("sd-header").innerHTML = sdHeaderHtml();
    // Re-render a tab only when its data changed state (finished deploy, app status…), never while editing
    const changed =
      rerenderTab ||
      prev?.health.state !== s.health.state ||
      prev?.deploy.last?.id !== s.deploy.last?.id ||
      prev?.deploy.last?.status !== s.deploy.last?.status ||
      prev?.provision?.status !== s.provision?.status;
    if (changed && ["overview", "deployments", "app"].includes(sd.tab))
      sdRenderTab();
  } catch (err) {
    if (quiet) return;
    document.getElementById("sd-root").innerHTML = `
      <a class="back-link" href="#sites">${Icons.get("chevronLeft", { size: 13 })}All websites</a>
      <div class="card">${UI.emptyState("alertTriangle", "Website not found", escapeHtml(err.message), `<a class="btn btn-primary" href="#sites">Back to websites</a>`)}</div>`;
  }
}

function sdTabs() {
  return SD_TABS.filter((t) => !t.when || t.when(sd.site));
}

function sdRenderShell() {
  const tabs = sdTabs();
  if (!tabs.some((t) => t.id === sd.tab)) sd.tab = "overview";
  document.getElementById("sd-root").innerHTML = `
    <a class="back-link" href="#sites">${Icons.get("chevronLeft", { size: 13 })}All websites</a>
    <div id="sd-header">${sdHeaderHtml()}</div>
    <div class="tabs site-tabs" id="sd-tabs">
      ${tabs.map((t) => `<button class="tab ${t.id === sd.tab ? "active" : ""}" data-tab="${t.id}" onclick="sdSwitchTab('${t.id}')">${Icons.get(t.icon, { size: 14 })}${t.label}</button>`).join("")}
    </div>
    <div id="sd-tab"></div>`;
  sdRenderTab();
}

function sdSwitchTab(tab) {
  sd.consoles.forEach((c) => c.stop());
  sd.consoles = [];
  sd.tab = tab;
  history.replaceState(null, "", `#site/${sd.id}/${tab}`);
  document
    .querySelectorAll("#sd-tabs .tab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  sdRenderTab();
}

function sdRenderTab() {
  const el = document.getElementById("sd-tab");
  if (!el) return;
  sd.consoles.forEach((c) => c.stop());
  sd.consoles = [];
  const render = {
    overview: sdOverview,
    deployments: sdDeployments,
    domains: sdDomains,
    env: sdEnv,
    app: sdApp,
    php: sdPhp,
    database: sdDatabase,
    backups: sdBackups,
    logs: sdLogs,
    settings: sdSettings,
  }[sd.tab];
  render(el);
}

function sdHeaderHtml() {
  const s = sd.site;
  const I = window.Icons;
  const sub = [];
  if (s.url)
    sub.push(
      `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${I.get(s.ssl.enabled ? "lock" : "globe", { size: 12 })} ${escapeHtml(s.primaryDomain)}</a>`,
    );
  else sub.push(`<span>${I.get("globe", { size: 12 })} No domain yet</span>`);
  sub.push(`<span>${escapeHtml(s.stackLabel)}</span>`);
  if (s.gitUrl)
    sub.push(
      `<span>${I.get("gitBranch", { size: 12 })} ${escapeHtml(s.branch || "")}</span>`,
    );
  if (s.deployPath)
    sub.push(
      `<span class="mono-sm truncate" style="max-width:420px;" title="${escapeHtml(s.deployPath)}">${escapeHtml(s.deployPath)}</span>`,
    );
  const deploying = s.health.state === "deploying";
  return `
    <div class="site-hero">
      <div class="site-hero-main">
        ${UI.stackAvatar(s.type, "lg")}
        <div style="min-width:0;">
          <div class="site-hero-title"><span class="truncate">${escapeHtml(s.name)}</span>${UI.healthPill(s.health)}</div>
          <div class="site-hero-sub">${sub.join('<span class="muted">·</span>')}</div>
        </div>
      </div>
      <div class="site-hero-actions">
        ${s.url ? `<a class="btn btn-secondary" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${I.get("externalLink", { size: 13 })}<span>Visit</span></a>` : ""}
        ${s.features.process ? `<button class="btn btn-secondary" onclick="sdAppAction('restart')" ${deploying ? "disabled" : ""}>${I.get("refresh", { size: 13 })}<span>Restart</span></button>` : ""}
        ${
          s.deployPath
            ? `<button class="btn btn-secondary" onclick="openInFileManager(${jsArg(s.deployPath)})" title="Open in File Manager">${I.get("folder", { size: 13 })}</button>
        <button class="btn btn-secondary" onclick="openTerminalIn(${jsArg(s.deployPath)})" title="Terminal in this folder">${I.get("terminal", { size: 13 })}</button>`
            : ""
        }
        ${s.deployPath && !s.features.external ? `<button class="btn btn-primary" onclick="sdDeploy()" ${deploying ? "disabled" : ""}>${I.get("rocket", { size: 13, color: "#fff" })}<span>${deploying ? "Deploying…" : s.gitUrl ? "Deploy" : "Rebuild"}</span></button>` : ""}
      </div>
    </div>`;
}

async function sdDeploy() {
  const s = sd.site;
  try {
    await api.deploySite(s.id);
  } catch (err) {
    if (!err.data?.jobId) return toast.error("Deploy failed", err.message);
  }
  toast.info("Deployment started", s.name);
  await sdLoad({ quiet: true });
  if (sd.tab !== "deployments") sdSwitchTab("deployments");
  else sdRenderTab();
}

// ── Overview ────────────────────────────────────────────────

function sdOverview(el) {
  const s = sd.site;
  const I = window.Icons;
  const last = s.deploy.last;
  const provisioning = s.provision?.status === "running";
  const failed = s.provision?.status === "failed";

  const runtime = s.features.process
    ? s.app && s.app.status === "online"
      ? {
          value: `Online · pid ${s.app.pid}`,
          sub: `Up ${UI.uptime(s.app.uptime)} · ${s.app.memory ? formatBytes(s.app.memory) : "—"} RAM · ${s.app.cpu ?? 0}% CPU · ${s.app.restarts} restarts`,
        }
      : {
          value: s.health.label,
          sub: `${s.startCommand || "no start command"} · port ${s.port || "—"}`,
        }
    : s.features.php
      ? {
          value: `PHP ${s.phpVersion || s.nginx?.phpVersion || "—"}`,
          sub: "Served by PHP-FPM through nginx",
        }
      : s.features.external
        ? {
            value: "Reverse proxy",
            sub: `→ ${s.proxyTarget || s.nginx?.proxyPass || "—"}`,
          }
        : {
            value: "Static files",
            sub: s.webRoot
              ? `Serving ${s.webRoot}/`
              : "Served directly by nginx",
          };

  const checks = [
    {
      done: s.domains.length > 0,
      title: "Add a domain",
      desc: "Point a domain at this website",
      tab: "domains",
    },
    {
      done: s.ssl.enabled,
      title: "Enable HTTPS",
      desc: "Free Let's Encrypt certificate, renewed automatically",
      tab: "domains",
      show: s.domains.length > 0,
    },
    {
      done: !!s.history.find(
        (h) => h.status === "success" || h.status === "warning",
      ),
      title: "Deploy successfully",
      desc: "Build and start the latest code",
      tab: "deployments",
      show: !s.features.external,
    },
    {
      done: s.deploy.autoDeploy,
      title: "Deploy on every push",
      desc: "Connect a GitHub/GitLab webhook",
      tab: "deployments",
      show: !!s.gitUrl,
    },
    {
      done: !!s.database,
      title: "Create a database",
      desc: "MySQL database + user, credentials in .env",
      tab: "database",
      show: ["laravel", "wordpress"].includes(s.type),
    },
    {
      done: s.cron.backups.length > 0,
      title: "Schedule backups",
      desc: "Daily backup of files, .env and database",
      tab: "backups",
      show: !!s.deployPath,
    },
    {
      done: s.cron.scheduler,
      title: "Run the Laravel scheduler",
      desc: "php artisan schedule:run every minute",
      tab: "php",
      show: s.type === "laravel",
    },
  ].filter((c) => c.show !== false);
  const doneCount = checks.filter((c) => c.done).length;

  el.innerHTML = `
    ${provisioning ? `<div class="card" style="margin-bottom:20px;"><div class="card-header"><h3 class="card-title">${I.get("rocket", { size: 16 })}<span>Setting up this website…</span></h3></div><div class="card-body" id="sd-provision"></div></div>` : ""}
    ${
      failed
        ? `<div class="alert alert-danger" style="margin-bottom:20px;">${I.get("alertCircle", { size: 18 })}<div style="flex:1;"><strong>Setup did not finish.</strong> ${escapeHtml(s.provision.error || "")}</div>
      <button class="btn btn-sm btn-secondary" onclick="sdShowJobOrLog(${jsArg(s.provision.jobId)})">View log</button>
      <button class="btn btn-sm btn-primary" onclick="sdRetrySetup()">${I.get("refresh", { size: 12, color: "#fff" })}<span>Retry setup</span></button></div>`
        : ""
    }
    <div class="info-grid">
      <div class="info-card">
        <div class="info-card-label">${I.get("globe", { size: 12 })}Website</div>
        <div class="info-card-value truncate">${s.url ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.url.replace(/^https?:\/\//, ""))}</a>` : '<span class="muted">No domain</span>'}</div>
        <div class="info-card-sub">${s.ssl.enabled ? `${I.get("lock", { size: 11 })} HTTPS · expires in ${s.ssl.daysLeft ?? "?"} days` : s.domains.length ? "HTTP only — enable HTTPS on Domains" : `<a href="#" onclick="sdSwitchTab('domains');return false;" style="text-decoration:underline;">Add a domain</a>`}${s.domains.length > 1 ? ` · +${s.domains.length - 1} more` : ""}</div>
      </div>
      <div class="info-card">
        <div class="info-card-label">${I.get(s.gitUrl ? "gitBranch" : "folder", { size: 12 })}Code</div>
        <div class="info-card-value">${s.git?.commit ? UI.commit(s.git.commit) : s.gitUrl ? '<span class="muted">Not cloned yet</span>' : "Uploaded files"}</div>
        <div class="info-card-sub truncate">${s.gitUrl ? `${escapeHtml(s.gitUrl)} · ${escapeHtml(s.branch || "")}` : escapeHtml(s.deployPath || "—")}${s.git?.localChanges ? ` · <span style="color:var(--color-amber);">${s.git.localChanges} file(s) changed on server</span>` : ""}</div>
      </div>
      <div class="info-card">
        <div class="info-card-label">${I.get("rocket", { size: 12 })}Last deployment</div>
        <div class="info-card-value">${last ? `${sdStatusText(last.status)} <span class="muted" style="font-weight:500;font-size:13px;">${UI.timeAgo(last.finishedAt || last.startedAt)}</span>` : '<span class="muted">Never</span>'}</div>
        <div class="info-card-sub">${last ? `${escapeHtml(sdTriggerText(last))}${last.duration !== undefined ? ` · ${UI.duration(last.duration)}` : ""}${last.commit ? ` · <code>${escapeHtml(last.commit.short)}</code>` : ""}` : "Deploy builds and starts the latest code"}</div>
      </div>
      <div class="info-card">
        <div class="info-card-label">${I.get(s.features.process ? "cpu" : "server", { size: 12 })}${s.features.process ? "App" : "Runtime"}</div>
        <div class="info-card-value">${escapeHtml(runtime.value)}</div>
        <div class="info-card-sub truncate" title="${escapeHtml(runtime.sub)}">${escapeHtml(runtime.sub)}</div>
      </div>
      <div class="info-card">
        <div class="info-card-label">${I.get("hardDrive", { size: 12 })}Disk usage</div>
        <div class="info-card-value" id="sd-disk">${s.disk ? (s.disk.bytes !== null ? formatBytes(s.disk.bytes) : '<span class="muted">measuring…</span>') : "—"}</div>
        <div class="info-card-sub">${s.disk?.measuredAt ? `measured ${UI.timeAgo(s.disk.measuredAt)}` : "Website folder incl. dependencies"}</div>
      </div>
      <div class="info-card">
        <div class="info-card-label">${I.get("database", { size: 12 })}Database</div>
        <div class="info-card-value">${s.database ? escapeHtml(s.database.name) : '<span class="muted">None</span>'}</div>
        <div class="info-card-sub">${s.database ? (s.databaseInfo && !s.databaseInfo.error ? `${s.databaseInfo.tables} tables · ${formatBytes(s.databaseInfo.size)}` : `user ${escapeHtml(s.database.user || "—")}`) : s.features.external ? "—" : `<a href="#" onclick="sdSwitchTab('database');return false;" style="text-decoration:underline;">Create one</a>`}</div>
      </div>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-header"><h3 class="card-title">${I.get("checkCircle", { size: 16 })}<span>Setup checklist</span></h3><span class="progress-ring">${doneCount}/${checks.length} done</span></div>
        <ul class="checklist">
          ${checks
            .map(
              (c) => `
            <li class="${c.done ? "check-done" : ""}">
              ${c.done ? I.get("checkCircle", { size: 18, color: "var(--color-green)" }) : '<span class="check-box"></span>'}
              <span class="check-title">${escapeHtml(c.title)}<span class="check-desc">${escapeHtml(c.desc)}</span></span>
              ${c.done ? "" : `<button class="btn btn-sm btn-secondary" onclick="sdSwitchTab('${c.tab}')">Set up ${I.get("arrowRight", { size: 12 })}</button>`}
            </li>`,
            )
            .join("")}
        </ul>
      </div>
      <div class="stack-gap">
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("zap", { size: 16 })}<span>Quick actions</span></h3></div>
          <div class="card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            ${
              s.deployPath
                ? `<button class="btn btn-secondary" onclick="openInFileManager(${jsArg(s.deployPath)})">${I.get("folder", { size: 13 })}<span>Files</span></button>
            <button class="btn btn-secondary" onclick="openTerminalIn(${jsArg(s.deployPath)})">${I.get("terminal", { size: 13 })}<span>Terminal</span></button>`
                : ""
            }
            ${s.features.env && s.deployPath ? `<button class="btn btn-secondary" onclick="sdSwitchTab('env')">${I.get("sliders", { size: 13 })}<span>Edit .env</span></button>` : ""}
            ${s.deployPath ? `<button class="btn btn-secondary" onclick="sdBackupNow()">${I.get("archive", { size: 13 })}<span>Back up now</span></button>` : ""}
            <button class="btn btn-secondary" onclick="sdSwitchTab('logs')">${I.get("fileText", { size: 13 })}<span>Logs</span></button>
            ${s.nginx ? `<button class="btn btn-secondary" onclick="editNginxConfig(${jsArg(s.nginx.name)}, () => sdLoad())">${I.get("code", { size: 13 })}<span>nginx config</span></button>` : ""}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("clock", { size: 16 })}<span>Recent deployments</span></h3><button class="btn btn-sm btn-ghost" onclick="sdSwitchTab('deployments')">All</button></div>
          ${
            s.history.length
              ? `<ul class="checklist">${s.history
                  .slice(0, 5)
                  .map(
                    (h) =>
                      `<li>${sdStatusIcon(h.status)}<span class="check-title">${h.commit ? UI.commit(h.commit) : escapeHtml(sdTriggerText(h))}<span class="check-desc">${escapeHtml(sdTriggerText(h))} · ${UI.timeAgo(h.finishedAt || h.startedAt)}</span></span></li>`,
                  )
                  .join("")}</ul>`
              : `<div class="card-body muted" style="font-size:13px;">No deployments yet.</div>`
          }
        </div>
      </div>
    </div>`;

  if (provisioning && s.provision.jobId) {
    sd.consoles.push(
      JobConsole.attach(
        document.getElementById("sd-provision"),
        s.provision.jobId,
        { onDone: () => sdLoad({ rerenderTab: true }) },
      ),
    );
  }
  if (s.disk && s.disk.bytes === null) setTimeout(() => sdRefreshDisk(), 3000);
}

async function sdRefreshDisk() {
  const el = document.getElementById("sd-disk");
  if (!el) return;
  const d = await api.getSiteDisk(sd.id).catch(() => null);
  if (!d) return;
  if (d.bytes === null) return setTimeout(sdRefreshDisk, 3000);
  el.textContent = formatBytes(d.bytes);
}

function sdStatusText(status) {
  return (
    {
      success: "Succeeded",
      warning: "Succeeded with warnings",
      failed: "Failed",
      running: "Running",
      cancelled: "Cancelled",
    }[status] || status
  );
}

function sdStatusIcon(status) {
  if (status === "success")
    return Icons.get("checkCircle", { size: 16, color: "var(--color-green)" });
  if (status === "warning")
    return Icons.get("alertTriangle", {
      size: 16,
      color: "var(--color-amber)",
    });
  if (status === "running") return '<span class="spinner spinner-sm"></span>';
  return Icons.get("xCircle", { size: 16, color: "var(--color-red)" });
}

function sdTriggerText(h) {
  const t =
    {
      manual: "Deployed manually",
      webhook: "Git push",
      rollback: "Rollback",
      setup: "Initial setup",
      api: "API",
    }[h.trigger] || h.trigger;
  return h.by ? `${t} by ${h.by}` : t;
}

async function sdRetrySetup() {
  try {
    await api.retrySiteSetup(sd.id);
    toast.info("Setup restarted", sd.site.name);
    sdLoad({ rerenderTab: true });
  } catch (err) {
    toast.error("Retry failed", err.message);
  }
}

/**
 * A job's live console if it still runs, otherwise its saved deployment log.
 */
async function sdShowJobOrLog(jobId) {
  try {
    const job = await api.getJob(jobId, 0);
    if (job.status === "running") return JobConsole.open(jobId, job.title);
    Modal.show(
      escapeHtml(job.title),
      `<ul class="job-steps">${JobConsole.stepsHtml(job.steps)}</ul><pre class="job-output" style="max-height:60vh;">${escapeHtml(UI.cleanOutput(job.output))}</pre>`,
      { width: 900 },
    );
  } catch {
    const entry = sd.site.history.find((h) => h.jobId === jobId);
    if (entry) sdShowLog(entry.id);
    else toast.error("Log unavailable", "It was removed after a panel restart");
  }
}

// ── Deployments ─────────────────────────────────────────────

async function sdDeployments(el) {
  const s = sd.site;
  const I = window.Icons;
  const running = s.deploy.running;
  const hookUrl = `${location.origin}/api/v1/hooks/deploy/${s.id}`;
  el.innerHTML = `
    <div class="two-col">
      <div class="stack-gap">
        ${
          running
            ? `<div class="card"><div class="card-header"><h3 class="card-title">${I.get("rocket", { size: 16 })}<span>Deploying now</span></h3></div><div class="card-body" id="sd-live"></div></div>`
            : `<div class="card"><div class="card-body" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
                <div style="flex:1;min-width:220px;">
                  <div style="font-weight:600;font-size:14px;">${s.gitUrl ? `Deploy the latest <code>${escapeHtml(s.branch || "")}</code>` : "Rebuild & restart"}</div>
                  <div class="muted" style="font-size:12px;margin-top:2px;">${s.gitUrl ? "Pulls the branch, runs the deploy script, then restarts the app." : "This website isn't connected to Git: the deploy script runs on the files in the folder."}</div>
                </div>
                ${s.gitUrl ? `<button class="btn btn-secondary" onclick="sdCheckPending()">${I.get("search", { size: 13 })}<span>Check for new commits</span></button>` : ""}
                <button class="btn btn-primary" onclick="sdDeploy()" ${s.features.external ? "disabled" : ""}>${I.get("rocket", { size: 13, color: "#fff" })}<span>Deploy now</span></button>
              </div><div id="sd-pending"></div></div>`
        }
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("clock", { size: 16 })}<span>History</span></h3><span class="badge badge-neutral">${s.history.length}</span></div>
          <div class="table-container" style="border:none;border-radius:0;">
            <table class="table">
              <thead><tr><th>Status</th><th>Commit</th><th>When</th><th>Took</th><th style="text-align:right;"></th></tr></thead>
              <tbody>${s.history.length ? s.history.map((h, i) => sdHistoryRow(h, i)).join("") : `<tr><td colspan="5" class="muted" style="padding:24px;text-align:center;">No deployments yet — click Deploy now.</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="stack-gap">
        ${
          s.gitUrl
            ? `<div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("webhook", { size: 16 })}<span>Deploy on push</span></h3>
            <label class="switch"><input type="checkbox" ${s.deploy.autoDeploy ? "checked" : ""} onchange="sdToggleAutoDeploy(this.checked)"><span class="switch-slider"></span></label></div>
          <div class="card-body">
            ${
              s.deploy.autoDeploy
                ? `<div class="webhook-box">
                <div><label class="form-label">Payload URL</label><div class="copy-field"><input class="form-input" readonly value="${escapeHtml(hookUrl)}">${UI.copyButton(hookUrl, "Copy")}</div></div>
                <div><label class="form-label">Secret</label><div class="copy-field"><input class="form-input" readonly value="${escapeHtml(s.deploy.webhookSecret || "")}">${UI.copyButton(s.deploy.webhookSecret || "", "Copy")}</div></div>
                <div class="form-hint" style="font-size:12px;line-height:1.5;">
                  <strong>GitHub:</strong> repo → Settings → Webhooks → Add webhook · content type <code>application/json</code> · paste the secret · “Just the push event”.<br>
                  <strong>GitLab:</strong> Settings → Webhooks · paste the secret as <em>Secret token</em> · Push events.<br>
                  Only pushes to <code>${escapeHtml(s.branch || "")}</code> deploy. ${location.protocol === "http:" ? "<br><span style='color:#92400e;'>The panel is on plain HTTP — Git hosts must reach this URL from the internet.</span>" : ""}
                </div>
                <button class="btn btn-sm btn-secondary" style="align-self:flex-start;" onclick="sdRotateSecret()">${I.get("refresh", { size: 12 })}<span>New secret</span></button>
              </div>`
                : `<p class="muted" style="font-size:13px;">Turn on to get a webhook URL for GitHub, GitLab, Gitea or Bitbucket — every push to <code>${escapeHtml(s.branch || "")}</code> then deploys automatically.</p>`
            }
          </div>
        </div>`
            : ""
        }
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("terminal", { size: 16 })}<span>Deploy script</span></h3><button class="btn btn-sm btn-primary" onclick="sdSaveScript()">${I.get("save", { size: 12, color: "#fff" })}<span>Save</span></button></div>
          <div class="card-body">
            <textarea class="form-textarea textarea-code" id="sd-script" rows="8" spellcheck="false">${escapeHtml(s.deploy.script || "")}</textarea>
            <div class="form-hint">Runs in <code>${escapeHtml(s.deployPath || "")}</code> with <code>set -e</code>${s.features.php ? ` · <code>php</code>/<code>composer</code> use PHP ${escapeHtml(s.phpVersion || "")}` : ""}${s.port ? ` · <code>$PORT</code>=${s.port}` : ""}. ${s.features.process ? "The app restarts afterwards." : s.features.php ? "PHP-FPM reloads afterwards." : ""}</div>
            ${s.gitUrl ? `<label class="form-check" style="margin-top:12px;"><input type="checkbox" id="sd-reset" ${s.deploy.resetHard ? "checked" : ""} onchange="sdSaveResetHard(this.checked)"><span style="font-size:13px;">Discard changes made on the server when deploying (<code>git reset --hard</code>)</span></label>` : ""}
          </div>
        </div>
      </div>
    </div>`;
  if (running) {
    sd.consoles.push(
      JobConsole.attach(document.getElementById("sd-live"), running, {
        onDone: (job) => {
          toast[job.status === "completed" ? "success" : "error"](
            job.status === "completed" ? "Deployed" : "Deployment failed",
            s.name,
          );
          sdLoad({ rerenderTab: true });
        },
      }),
    );
  }
}

function sdHistoryRow(h, index) {
  const I = window.Icons;
  const current =
    sd.site.git?.commit?.hash && h.commit?.hash === sd.site.git.commit.hash;
  const canRollback =
    h.commit &&
    sd.site.gitUrl &&
    !current &&
    (h.status === "success" || h.status === "warning") &&
    !sd.site.deploy.running;
  return `
    <tr>
      <td><span class="deploy-row-status">${sdStatusIcon(h.status)}${escapeHtml(sdStatusText(h.status))}</span>${h.error ? `<div class="muted truncate" style="font-size:11px;max-width:220px;" title="${escapeHtml(h.error)}">${escapeHtml(h.error)}</div>` : ""}</td>
      <td style="max-width:280px;">${h.commit ? UI.commit(h.commit) : '<span class="muted">—</span>'}<div style="margin-top:3px;"><span class="trigger-chip">${escapeHtml(sdTriggerText(h))}</span>${current ? ' <span class="badge badge-success">live</span>' : ""}</div></td>
      <td style="white-space:nowrap;font-size:12px;">${escapeHtml(UI.dateTime(h.startedAt))}<div class="muted" style="font-size:11px;">${UI.timeAgo(h.startedAt)}</div></td>
      <td class="mono-sm">${h.status === "running" ? '<span class="spinner spinner-sm"></span>' : UI.duration(h.duration)}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn btn-sm btn-secondary btn-icon-only" onclick="sdShowLog(${jsArg(h.id)})" title="View log">${I.get("fileText", { size: 13 })}</button>
        ${canRollback ? `<button class="btn btn-sm btn-secondary btn-icon-only" onclick="sdRollback(${jsArg(h.commit.hash)}, ${jsArg(h.commit.short)})" title="Roll back to this commit">${I.get("rotateCcw", { size: 13 })}</button>` : ""}
      </td>
    </tr>`;
}

async function sdShowLog(deployId) {
  try {
    const { entry, log } = await api.getDeploymentLog(sd.id, deployId);
    Modal.show(
      `${escapeHtml(sdTriggerText(entry))} · ${escapeHtml(UI.dateTime(entry.startedAt))}`,
      `<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">${sdStatusIcon(entry.status)}<strong>${escapeHtml(sdStatusText(entry.status))}</strong>${entry.commit ? UI.commit(entry.commit) : ""}<span class="muted">${UI.duration(entry.duration)}</span></div>
       ${entry.error ? `<div class="alert alert-danger" style="margin-bottom:10px;font-size:12px;">${escapeHtml(entry.error)}</div>` : ""}
       <pre class="job-output" style="max-height:62vh;">${escapeHtml(UI.cleanOutput(log))}</pre>`,
      { width: 940 },
    );
  } catch (err) {
    toast.error("Log unavailable", err.message);
  }
}

function sdRollback(hash, short) {
  Modal.confirm(
    "Roll back",
    `Deploy commit <code>${escapeHtml(short)}</code> again? The branch on the server is moved back to it; the next normal deploy brings it forward again.`,
    async () => {
      try {
        await api.rollbackSite(sd.id, hash);
        toast.info("Rolling back", short);
        await sdLoad({ quiet: true });
        sdRenderTab();
      } catch (err) {
        toast.error("Rollback failed", err.message);
      }
    },
  );
}

async function sdCheckPending() {
  const el = document.getElementById("sd-pending");
  if (!el) return;
  el.innerHTML = `<div class="card-body" style="border-top:1px solid var(--border-secondary);"><span class="spinner spinner-sm"></span> Fetching ${escapeHtml(sd.site.branch || "")}…</div>`;
  try {
    const p = await api.getPendingCommits(sd.id);
    el.innerHTML = `<div class="card-body" style="border-top:1px solid var(--border-secondary);">${
      p.commits.length
        ? `<div style="font-size:13px;font-weight:600;margin-bottom:8px;">${p.commits.length} new commit(s) on ${escapeHtml(p.branch)}</div><ul class="bar-list">${p.commits.map((c) => `<li><span>${UI.commit(c)}</span><span class="muted">${escapeHtml(c.author || "")} · ${UI.timeAgo(c.date)}</span></li>`).join("")}</ul>`
        : `<span class="inline-status ok">${Icons.get("checkCircle", { size: 13 })}<span>Up to date with ${escapeHtml(p.branch)}</span></span>`
    }${p.localOnly ? `<div class="inline-status warn">The server has ${p.localOnly} commit(s) that are not on the remote.</div>` : ""}</div>`;
  } catch (err) {
    el.innerHTML = `<div class="card-body" style="border-top:1px solid var(--border-secondary);"><span class="inline-status bad">${escapeHtml(err.message)}</span></div>`;
  }
}

async function sdToggleAutoDeploy(enabled) {
  try {
    await api.setAutoDeploy(sd.id, enabled);
    toast.success(
      enabled ? "Push-to-deploy on" : "Push-to-deploy off",
      sd.site.name,
    );
  } catch (err) {
    toast.error("Failed", err.message);
  }
  await sdLoad({ quiet: true });
  sdRenderTab();
}

function sdRotateSecret() {
  Modal.confirm(
    "New webhook secret",
    "The old secret stops working — update it in GitHub/GitLab afterwards.",
    async () => {
      await api.setAutoDeploy(sd.id, true, true);
      await sdLoad({ quiet: true });
      sdRenderTab();
    },
  );
}

async function sdSaveScript() {
  try {
    await api.updateSite(sd.id, {
      deploy: { script: document.getElementById("sd-script").value },
    });
    toast.success("Deploy script saved", "Used from the next deployment");
    await sdLoad({ quiet: true });
  } catch (err) {
    toast.error("Save failed", err.message);
  }
}

async function sdSaveResetHard(on) {
  try {
    await api.updateSite(sd.id, { deploy: { resetHard: on } });
    toast.success(
      "Saved",
      on
        ? "Server changes are discarded on deploy"
        : "Deploys keep server changes (fast-forward only)",
    );
  } catch (err) {
    toast.error("Save failed", err.message);
  }
}

// ── Domains & SSL ───────────────────────────────────────────

function sdDomains(el) {
  const s = sd.site;
  const I = window.Icons;
  sd.domainDraft = [...s.domains];
  const webRootEditable = ["static", "react", "php", "wordpress"].includes(
    s.type,
  );
  el.innerHTML = `
    <div class="two-col">
      <div class="stack-gap">
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("globe", { size: 16 })}<span>Domains</span></h3><button class="btn btn-sm btn-primary" onclick="sdSaveDomains()">${I.get("save", { size: 12, color: "#fff" })}<span>Save domains</span></button></div>
          <div class="card-body">
            ${s.nginx ? "" : `<div class="alert alert-info" style="margin-bottom:12px;font-size:13px;">${I.get("info", { size: 15 })}<div>Add a domain to publish this website — nginx is configured automatically${s.features.process ? ` to proxy it to port ${s.port}` : ""}.</div></div>`}
            <div id="sd-domain-list"></div>
            <div class="input-with-action" style="margin-top:10px;">
              <input class="form-input" id="sd-domain-add" placeholder="example.com" onkeydown="if(event.key==='Enter'){sdAddDomain();}">
              <button class="btn btn-secondary" onclick="sdAddDomain()">${I.get("plus", { size: 13 })}<span>Add</span></button>
            </div>
            <div class="form-hint">Each domain needs a DNS A record pointing to this server. ${s.ssl.enabled ? "Saving re-issues the certificate for the new list." : ""}</div>
          </div>
        </div>
        ${
          s.nginx
            ? `<div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("server", { size: 16 })}<span>Web server</span></h3>
            <button class="btn btn-sm btn-secondary" onclick="editNginxConfig(${jsArg(s.nginx.name)}, () => sdLoad({ rerenderTab: true }))">${I.get("code", { size: 12 })}<span>Edit nginx config</span></button></div>
          <div class="card-body">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
              <label class="switch"><input type="checkbox" ${s.nginx.enabled ? "checked" : ""} onchange="sdSetEnabled(this.checked)"><span class="switch-slider"></span></label>
              <span style="font-size:13px;"><strong>${s.nginx.enabled ? "Online" : "Offline"}</strong> — ${s.nginx.enabled ? "nginx serves this website" : "visitors get no response"}</span>
            </div>
            <div class="field-row">
              ${webRootEditable ? `<div class="form-group"><label class="form-label">Web root</label><div class="input-with-action"><span class="muted mono-sm" style="align-self:center;">${escapeHtml(s.deployPath || "")}/</span><input class="form-input mono-input" id="sd-webroot" value="${escapeHtml(s.webRoot || "")}" placeholder="(folder root)"></div></div>` : ""}
              <div class="form-group"><label class="form-label">Upload limit</label><input class="form-input mono-input" id="sd-maxbody" value="${escapeHtml(s.maxBodySize || "")}" placeholder="64M"></div>
            </div>
            <button class="btn btn-sm btn-secondary" onclick="sdSaveWebServer()">${I.get("save", { size: 12 })}<span>Save</span></button>
            <div class="form-hint" style="margin-top:8px;">${s.nginx.proxyPass ? `Proxies to <code>${escapeHtml(s.nginx.proxyPass)}</code> · ` : ""}Every change is checked with <code>nginx -t</code> and rolled back if invalid.</div>
          </div>
        </div>`
            : ""
        }
      </div>
      <div class="card">
        <div class="card-header"><h3 class="card-title">${I.get("shieldCheck", { size: 16 })}<span>HTTPS</span></h3>${s.ssl.enabled ? `<span class="badge ${s.ssl.daysLeft < 14 ? "badge-warning" : "badge-success"}">${I.get("lock", { size: 10 })} ${s.ssl.daysLeft} days left</span>` : '<span class="badge badge-neutral">Off</span>'}</div>
        <div class="card-body">
          ${
            s.ssl.enabled
              ? `<p style="font-size:13px;margin-bottom:12px;">Certificate from Let's Encrypt, valid until <strong>${escapeHtml(new Date(s.ssl.expires).toLocaleDateString())}</strong>. It renews automatically.</p>`
              : `<p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">Get a free certificate from Let's Encrypt. The domains must already point to this server and port 80 must be open.</p>`
          }
          <div class="form-group"><label class="form-label">Contact email (expiry notices)</label><input class="form-input" id="sd-ssl-email" type="email" value="${escapeHtml(s.certbotEmail || "")}" placeholder="you@example.com"></div>
          <label class="form-check" style="margin-bottom:14px;"><input type="checkbox" id="sd-ssl-redirect" checked><span style="font-size:13px;">Redirect HTTP to HTTPS</span></label>
          <button class="btn btn-primary" onclick="sdIssueSsl()" ${s.domains.length ? "" : "disabled"}>${I.get("lock", { size: 13, color: "#fff" })}<span>${s.ssl.enabled ? "Re-issue certificate" : "Enable HTTPS"}</span></button>
          <div class="form-hint" style="margin-top:10px;">All certificates on the server: <a href="#ssl" style="text-decoration:underline;">SSL / TLS</a></div>
        </div>
      </div>
    </div>`;
  sdRenderDomainList();
}

function sdRenderDomainList() {
  const el = document.getElementById("sd-domain-list");
  if (!el) return;
  const I = window.Icons;
  if (!sd.domainDraft.length) {
    el.innerHTML = `<div class="muted" style="font-size:13px;">No domains yet.</div>`;
    return;
  }
  el.innerHTML = `<ul class="bar-list">${sd.domainDraft
    .map(
      (d, i) => `
    <li style="align-items:center;border:1px solid var(--border-primary);">
      <span style="display:flex;gap:8px;align-items:center;min-width:0;">${i === 0 ? '<span class="badge badge-neutral">primary</span>' : ""}<a href="http://${escapeHtml(d)}" target="_blank" rel="noopener" class="truncate" style="font-weight:600;">${escapeHtml(d)}</a><span class="dns-status muted" data-domain="${escapeHtml(d)}" style="font-size:11px;"></span></span>
      <span style="display:flex;gap:4px;">
        ${i > 0 ? `<button class="btn btn-sm btn-ghost" title="Make primary" onclick="sdDomainPrimary(${i})">${I.get("arrowUp", { size: 12 })}</button>` : ""}
        <button class="btn btn-sm btn-ghost" title="Remove" onclick="sdDomainRemove(${i})">${I.get("x", { size: 12 })}</button>
      </span>
    </li>`,
    )
    .join("")}</ul>`;
  // DNS status per domain
  el.querySelectorAll(".dns-status").forEach(async (span) => {
    try {
      const r = await api.checkDns(span.dataset.domain);
      span.innerHTML = r.pointsHere
        ? `<span style="color:var(--color-green);">● points here</span>`
        : r.resolves
          ? `<span style="color:#92400e;" title="${escapeHtml([...r.a, ...r.aaaa].join(", "))}">● points elsewhere</span>`
          : `<span style="color:var(--color-red);">● no DNS record</span>`;
    } catch {}
  });
}

function sdAddDomain() {
  const input = document.getElementById("sd-domain-add");
  const parts = input.value
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  for (const d of parts)
    if (!sd.domainDraft.includes(d)) sd.domainDraft.push(d);
  input.value = "";
  sdRenderDomainList();
}

function sdDomainRemove(i) {
  sd.domainDraft.splice(i, 1);
  sdRenderDomainList();
}

function sdDomainPrimary(i) {
  const [d] = sd.domainDraft.splice(i, 1);
  sd.domainDraft.unshift(d);
  sdRenderDomainList();
}

async function sdSaveDomains() {
  sdAddDomain();
  if (!sd.domainDraft.length)
    return toast.error(
      "Add a domain",
      "A website needs at least one domain — use the Online switch to take it offline",
    );
  try {
    const res = await api.setSiteDomains(sd.id, sd.domainDraft);
    toast.success("Domains saved", sd.domainDraft.join(", "));
    if (res.jobId)
      JobConsole.open(res.jobId, "Update HTTPS certificate", {
        onDone: () => sdLoad({ rerenderTab: true }),
      });
    sdLoad({ rerenderTab: true });
  } catch (err) {
    Modal.show(
      "Could not save domains",
      `<pre class="job-output">${escapeHtml(err.message)}</pre>`,
    );
  }
}

async function sdSaveWebServer() {
  const body = {};
  const wr = document.getElementById("sd-webroot");
  if (wr && wr.value.trim() !== (sd.site.webRoot || ""))
    body.webRoot = wr.value.trim();
  const mb = document.getElementById("sd-maxbody").value.trim();
  if (mb && mb !== sd.site.maxBodySize) body.maxBodySize = mb;
  if (!Object.keys(body).length) return toast.info("Nothing changed", "");
  try {
    await api.updateSite(sd.id, body);
    toast.success("Saved & reloaded", "nginx");
    sdLoad({ rerenderTab: true });
  } catch (err) {
    Modal.show(
      "Could not save",
      `<pre class="job-output">${escapeHtml(err.message)}</pre>`,
    );
  }
}

async function sdSetEnabled(enabled) {
  try {
    await api.setSiteEnabled(sd.id, enabled);
    toast.success(enabled ? "Website online" : "Website offline", sd.site.name);
  } catch (err) {
    toast.error("Failed", err.message);
  }
  sdLoad({ rerenderTab: true });
}

function sdIssueSsl() {
  const email = document.getElementById("sd-ssl-email").value.trim();
  const redirect = document.getElementById("sd-ssl-redirect").checked;
  JobConsole.run(
    api.issueSiteSsl(sd.id, { email: email || undefined, redirect }),
    `HTTPS for ${sd.site.primaryDomain}`,
    {
      onDone: () => sdLoad({ rerenderTab: true }),
    },
  );
}

// ── Environment ─────────────────────────────────────────────

async function sdEnv(el) {
  const I = window.Icons;
  el.innerHTML = `<div class="spinner"></div>`;
  let env;
  try {
    env = await api.getSiteEnv(sd.id);
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
    return;
  }
  sd.envRows = env.vars.map((v) => ({ ...v }));
  const missing = env.example.filter(
    (e) => !env.vars.some((v) => v.key === e.key),
  );
  const s = sd.site;
  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">${I.get("sliders", { size: 16 })}<span>Environment variables</span><span class="mono-sm" style="font-weight:400;">${escapeHtml(env.path)}</span></h3>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm btn-secondary" onclick="sdEnvRaw()">${I.get("code", { size: 12 })}<span>Edit as file</span></button>
          <button class="btn btn-sm btn-secondary" onclick="sdEnvSave(false)">${I.get("save", { size: 12 })}<span>Save</span></button>
          <button class="btn btn-sm btn-primary" onclick="sdEnvSave(true)">${I.get("zap", { size: 12, color: "#fff" })}<span>${s.features.process ? "Save & restart" : s.type === "laravel" ? "Save & cache config" : "Save & apply"}</span></button>
        </div>
      </div>
      ${!env.exists ? `<div class="alert alert-info" style="margin:14px 18px 0;font-size:13px;">${I.get("info", { size: 15 })}<div>No .env file yet — add variables below and save to create it.</div></div>` : ""}
      ${
        missing.length
          ? `<div class="alert alert-warning" style="margin:14px 18px 0;font-size:13px;">${I.get("alertTriangle", { size: 15 })}<div style="flex:1;">${missing.length} variable(s) from <code>.env.example</code> are missing: ${missing
              .slice(0, 6)
              .map((m) => `<code>${escapeHtml(m.key)}</code>`)
              .join(
                " ",
              )}${missing.length > 6 ? "…" : ""}</div><button class="btn btn-sm btn-secondary" onclick='sdEnvAddMissing(${escapeHtml(JSON.stringify(missing))})'>Add them</button></div>`
          : ""
      }
      <div class="table-container" style="border:none;border-radius:0;margin-top:8px;">
        <table class="table env-table"><thead><tr><th class="env-key">Name</th><th>Value</th><th style="width:50px;"></th></tr></thead><tbody id="sd-env-rows"></tbody></table>
      </div>
      <div class="card-body" style="padding-top:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <button class="btn btn-sm btn-secondary" onclick="sdEnvAdd()">${I.get("plus", { size: 12 })}<span>Add variable</span></button>
        <span class="form-hint" style="margin:0;">${s.type === "react" || s.type === "static" ? "Build-time values (e.g. VITE_API_URL) — deploy again to apply." : s.features.process ? "Your app reads .env when it starts — restart to apply." : s.type === "laravel" ? "Laravel caches config — “Save & cache config” applies changes." : "Comments and order in the file are kept."}</span>
      </div>
    </div>`;
  sdEnvRender();
}

function sdEnvRender() {
  const tbody = document.getElementById("sd-env-rows");
  if (!tbody) return;
  const I = window.Icons;
  const secret = (k) => /pass|secret|key|token|private|dsn|url/i.test(k);
  tbody.innerHTML = sd.envRows.length
    ? sd.envRows
        .map(
          (r, i) => `
      <tr>
        <td class="env-key"><input class="form-input" value="${escapeHtml(r.key)}" placeholder="NAME" oninput="sd.envRows[${i}].key=this.value.trim()"></td>
        <td><div class="env-value-wrap"><input class="form-input" type="${secret(r.key) && !r.show ? "password" : "text"}" value="${escapeHtml(r.value)}" oninput="sd.envRows[${i}].value=this.value" autocomplete="off" spellcheck="false">
          ${secret(r.key) ? `<button class="btn btn-sm btn-ghost" onclick="sd.envRows[${i}].show=!sd.envRows[${i}].show;sdEnvRender()" title="Show/hide">${I.get(r.show ? "eyeOff" : "eye", { size: 13 })}</button>` : ""}</div></td>
        <td><button class="btn btn-sm btn-ghost" onclick="sd.envRows.splice(${i},1);sdEnvRender()" title="Remove">${I.get("trash", { size: 13 })}</button></td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="muted" style="padding:18px;">No variables.</td></tr>`;
}

function sdEnvAdd() {
  sd.envRows.push({ key: "", value: "", show: true });
  sdEnvRender();
  const inputs = document.querySelectorAll("#sd-env-rows tr:last-child input");
  inputs[0]?.focus();
}

function sdEnvAddMissing(missing) {
  for (const m of missing)
    if (!sd.envRows.some((r) => r.key === m.key))
      sd.envRows.push({ key: m.key, value: m.value, show: true });
  sdEnvRender();
  toast.info("Added", "Review the values, then save");
}

async function sdEnvSave(apply) {
  const vars = sd.envRows.filter((r) => r.key);
  const dup = vars.find((r, i) => vars.findIndex((x) => x.key === r.key) !== i);
  if (dup) return toast.error("Duplicate name", dup.key);
  try {
    await api.saveSiteEnv(sd.id, {
      vars: vars.map(({ key, value }) => ({ key, value })),
    });
    if (apply) {
      const r = await api.applySiteEnv(sd.id);
      toast.success("Saved", r.message);
    } else toast.success("Saved", ".env updated");
    sdRenderTab();
  } catch (err) {
    toast.error("Save failed", err.message);
  }
}

async function sdEnvRaw() {
  const env = await api.getSiteEnv(sd.id);
  CodeEditor.open({
    title: `.env — ${sd.site.name}`,
    subtitle: env.path,
    content: env.content,
    mode: "sh",
    onSave: async (content) => {
      await api.saveSiteEnv(sd.id, { content });
      toast.success("Saved", ".env");
      if (sd.tab === "env") sdRenderTab();
    },
  });
}

// ── App (PM2) ───────────────────────────────────────────────

function sdApp(el) {
  const s = sd.site;
  const I = window.Icons;
  const a = s.app || { status: "unknown" };
  const online = a.status === "online";
  el.innerHTML = `
    ${!s.tools.pm2 ? `<div class="alert alert-warning" style="margin-bottom:16px;">${I.get("alertTriangle", { size: 16 })}<div style="flex:1;"><strong>PM2 is not installed.</strong> It runs and restarts your app (also installed automatically on the next deploy).</div><button class="btn btn-sm btn-primary" onclick="JobConsole.run(api.installPm2(), 'Install PM2', { onDone: () => sdLoad({ rerenderTab: true }) })">Install PM2</button></div>` : ""}
    <div class="two-col">
      <div class="stack-gap">
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("cpu", { size: 16 })}<span>Process</span></h3>${UI.healthPill(s.health)}</div>
          <div class="card-body">
            <div class="stat-mini">
              <div><div class="stat-mini-label">Status</div><div class="stat-mini-value" style="font-size:16px;text-transform:capitalize;">${escapeHtml(String(a.status).replace("-", " "))}</div></div>
              <div><div class="stat-mini-label">Uptime</div><div class="stat-mini-value" style="font-size:16px;">${online ? UI.uptime(a.uptime) : "—"}</div></div>
              <div><div class="stat-mini-label">Memory</div><div class="stat-mini-value" style="font-size:16px;">${online && a.memory ? formatBytes(a.memory) : "—"}</div></div>
              <div><div class="stat-mini-label">CPU</div><div class="stat-mini-value" style="font-size:16px;">${online ? `${a.cpu ?? 0}%` : "—"}</div></div>
              <div><div class="stat-mini-label">Restarts</div><div class="stat-mini-value" style="font-size:16px;">${a.restarts ?? 0}</div></div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${online ? `<button class="btn btn-secondary" onclick="sdAppAction('restart')">${I.get("refresh", { size: 13 })}<span>Restart</span></button><button class="btn btn-danger" onclick="sdAppAction('stop')">${I.get("square", { size: 13 })}<span>Stop</span></button>` : `<button class="btn btn-primary" onclick="sdAppAction('start')">${I.get("play", { size: 13, color: "#fff" })}<span>Start</span></button>`}
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">${I.get("fileText", { size: 16 })}<span>App output</span></h3>
            <div style="display:flex;gap:8px;align-items:center;">
              <div class="segmented"><button class="active" data-log="out" onclick="sdAppLogs('out')">Output</button><button data-log="err" onclick="sdAppLogs('err')">Errors</button></div>
              <button class="btn btn-sm btn-secondary" onclick="sdAppLogs()">${I.get("refresh", { size: 12 })}</button>
            </div>
          </div>
          <div class="card-body"><pre class="job-output" id="sd-app-log" style="max-height:420px;">Loading…</pre><div class="form-hint" id="sd-app-log-path"></div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3 class="card-title">${I.get("sliders", { size: 16 })}<span>Run settings</span></h3></div>
        <div class="card-body">
          <div class="form-group"><label class="form-label">Start command</label><input class="form-input mono-input" id="sd-start" value="${escapeHtml(s.startCommand || "")}" placeholder="npm start"><div class="form-hint">Runs in ${escapeHtml(s.deployPath || "")} under PM2, restarted automatically if it crashes</div></div>
          <div class="form-group"><label class="form-label">Port</label><input class="form-input mono-input" id="sd-port" value="${escapeHtml(s.port || "")}" placeholder="3000"><div class="form-hint">Given to the app as <code>PORT</code>${s.nginx ? "; nginx follows automatically" : ""}</div></div>
          <button class="btn btn-primary" onclick="sdSaveRun()">${I.get("save", { size: 13, color: "#fff" })}<span>Save</span></button>
        </div>
      </div>
    </div>`;
  sd.appLogType = "out";
  sdAppLogs("out");
}

async function sdAppLogs(type) {
  if (type) sd.appLogType = type;
  document
    .querySelectorAll("[data-log]")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.log === sd.appLogType),
    );
  const pre = document.getElementById("sd-app-log");
  if (!pre) return;
  try {
    const r = await api.getSiteLogs(sd.id, sd.appLogType, 300);
    pre.textContent = r.lines.length
      ? UI.cleanOutput(r.lines.join("\n"))
      : "No output yet.";
    pre.scrollTop = pre.scrollHeight;
    const p = document.getElementById("sd-app-log-path");
    if (p && r.path) p.innerHTML = `<code>${escapeHtml(r.path)}</code>`;
  } catch (err) {
    pre.textContent = err.message;
  }
}

async function sdAppAction(action) {
  try {
    toast.info(`${action[0].toUpperCase()}${action.slice(1)}ing`, sd.site.name);
    await api.siteApp(sd.id, action);
    toast.success(action === "stop" ? "Stopped" : "Running", sd.site.name);
  } catch (err) {
    Modal.show(
      `Could not ${action} the app`,
      `<pre class="job-output">${escapeHtml(err.message)}</pre>`,
    );
  }
  setTimeout(() => sdLoad({ rerenderTab: true }), 1500);
}

async function sdSaveRun() {
  try {
    const res = await api.updateSite(sd.id, {
      startCommand: document.getElementById("sd-start").value.trim(),
      port: document.getElementById("sd-port").value.trim(),
    });
    if (res.restartNeeded) {
      Modal.show(
        "Restart to apply",
        `<p style="font-size:13px;">Saved. The app keeps running with the old settings until it restarts.</p>`,
        {
          submitText: "Restart now",
          onSubmit: () => sdAppAction("restart"),
        },
      );
    } else toast.success("Saved", "");
    sdLoad({ quiet: true });
  } catch (err) {
    toast.error("Save failed", err.message);
  }
}

// ── PHP (PHP-FPM, Composer, Laravel scheduler) ──────────────

function sdPhp(el) {
  const s = sd.site;
  const I = window.Icons;
  el.innerHTML = `
    <div class="two-col">
      <div class="stack-gap">
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("code", { size: 16 })}<span>PHP version</span></h3></div>
          <div class="card-body">
            ${
              s.phpVersions.length
                ? `<div class="input-with-action" style="max-width:360px;"><select class="form-select" id="sd-php">${[...new Set([s.phpVersion, ...s.phpVersions].filter(Boolean))].map((v) => `<option value="${v}" ${v === s.phpVersion ? "selected" : ""}>PHP ${v}</option>`).join("")}</select>
                   <button class="btn btn-primary" onclick="sdSavePhp()">${I.get("save", { size: 13, color: "#fff" })}<span>Switch</span></button></div>
                   <div class="form-hint">nginx is pointed at the chosen PHP-FPM; deploy scripts use the same version for <code>php</code> and <code>composer</code>. Install more versions on the <a href="#php" style="text-decoration:underline;">PHP page</a>.</div>`
                : `<div class="alert alert-warning">No PHP-FPM version installed. <a href="#php" style="text-decoration:underline;margin-left:4px;">Install PHP</a></div>`
            }
          </div>
        </div>
        ${
          s.deployPath
            ? `<div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("package", { size: 16 })}<span>Composer</span></h3>${s.tools.composer === false ? '<span class="badge badge-warning">not installed</span>' : '<span class="badge badge-success">installed</span>'}</div>
          <div class="card-body">
            ${
              s.tools.composer === false
                ? `<p style="font-size:13px;margin-bottom:10px;">Composer is installed automatically on the next deploy that uses it — or now:</p><button class="btn btn-primary" onclick="JobConsole.run(api.installComposer(), 'Install Composer', { onDone: () => sdLoad({ rerenderTab: true }) })">Install Composer</button>`
                : `
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-secondary" onclick="sdComposer('install', ['--no-dev','--optimize-autoloader'])">composer install --no-dev</button>
              <button class="btn btn-secondary" onclick="sdComposer('update', [])">composer update</button>
              <button class="btn btn-secondary" onclick="sdComposer('dump-autoload', ['--optimize'])">dump-autoload -o</button>
              <a class="btn btn-ghost" href="#php">More…</a>
            </div>
            <div class="form-hint" style="margin-top:8px;">Runs in ${escapeHtml(s.deployPath)} with PHP ${escapeHtml(s.phpVersion || "")}.</div>`
            }
          </div>
        </div>`
            : ""
        }
      </div>
      ${
        s.type === "laravel"
          ? `<div class="card">
        <div class="card-header"><h3 class="card-title">${I.get("clock", { size: 16 })}<span>Laravel scheduler</span></h3>
          <label class="switch"><input type="checkbox" ${s.cron.scheduler ? "checked" : ""} onchange="sdToggleScheduler(this.checked)"><span class="switch-slider"></span></label></div>
        <div class="card-body"><p style="font-size:13px;color:var(--text-secondary);">Runs <code>php artisan schedule:run</code> every minute (cron), which starts the tasks defined in your app's scheduler.</p></div>
      </div>`
          : ""
      }
    </div>`;
}

async function sdSavePhp() {
  try {
    await api.updateSite(sd.id, {
      phpVersion: document.getElementById("sd-php").value,
    });
    toast.success(
      "PHP version switched",
      document.getElementById("sd-php").value,
    );
    sdLoad({ rerenderTab: true });
  } catch (err) {
    Modal.show(
      "Could not switch PHP",
      `<pre class="job-output">${escapeHtml(err.message)}</pre>`,
    );
  }
}

function sdComposer(command, flags) {
  JobConsole.run(
    api.runComposer({
      dir: sd.site.deployPath,
      version: sd.site.phpVersion || "default",
      command,
      flags,
    }),
    `composer ${command} — ${sd.site.name}`,
  );
}

async function sdToggleScheduler(enabled) {
  try {
    await api.setLaravelScheduler(sd.id, enabled);
    toast.success(enabled ? "Scheduler on" : "Scheduler off", sd.site.name);
  } catch (err) {
    toast.error("Failed", err.message);
  }
  sdLoad({ quiet: true });
}

// ── Database ────────────────────────────────────────────────

function sdDatabase(el) {
  const s = sd.site;
  const I = window.Icons;
  if (!s.tools.mysql && !s.database) {
    el.innerHTML = `<div class="card">${UI.emptyState("database", "Database server not connected", "Install and connect MySQL/MariaDB on the Databases page, then come back to create a database for this website.", `<a class="btn btn-primary" href="#databases">Open Databases</a>`)}</div>`;
    return;
  }
  if (!s.database) {
    el.innerHTML = `
      <div class="two-col">
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("plus", { size: 16 })}<span>Create a database</span></h3></div>
          <div class="card-body">
            <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">A MySQL database and a user with full access to it — names and a strong password are generated.</p>
            ${s.features.env ? `<label class="form-check" style="margin-bottom:14px;"><input type="checkbox" id="sd-db-env" checked><span style="font-size:13px;">Write the credentials to <code>.env</code></span></label>` : ""}
            <button class="btn btn-primary" onclick="sdCreateDb()">${I.get("database", { size: 13, color: "#fff" })}<span>Create database</span></button>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("link", { size: 16 })}<span>Link an existing database</span></h3></div>
          <div class="card-body">
            <div class="form-group"><label class="form-label">Database name</label><input class="form-input mono-input" id="sd-link-name"></div>
            <div class="field-row"><div class="form-group"><label class="form-label">User</label><input class="form-input mono-input" id="sd-link-user"></div>
            <div class="form-group"><label class="form-label">Password</label><input class="form-input" type="password" id="sd-link-pass"></div></div>
            <button class="btn btn-secondary" onclick="sdLinkDb()">Link database</button>
            <div class="form-hint">Linked databases are included in this website's backups.</div>
          </div>
        </div>
      </div>`;
    return;
  }
  const info = s.databaseInfo;
  el.innerHTML = `
    <div class="two-col">
      <div class="card">
        <div class="card-header"><h3 class="card-title">${I.get("database", { size: 16 })}<span>${escapeHtml(s.database.name)}</span></h3>${info?.exists === false ? '<span class="badge badge-danger">missing</span>' : '<span class="badge badge-success">MySQL</span>'}</div>
        <div class="card-body">
          <dl class="kv" style="margin-bottom:16px;">
            <dt>Database</dt><dd class="mono-sm">${escapeHtml(s.database.name)}</dd>
            <dt>User</dt><dd class="mono-sm">${escapeHtml(s.database.user || "—")}</dd>
            <dt>Host</dt><dd class="mono-sm">127.0.0.1:3306</dd>
            ${info && !info.error ? `<dt>Size</dt><dd>${formatBytes(info.size)} · ${info.tables} tables</dd>` : ""}
          </dl>
          <div id="sd-db-creds"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-secondary" onclick="sdShowDbCreds()">${I.get("key", { size: 13 })}<span>Show credentials</span></button>
            <a class="btn btn-secondary" href="#databases">${I.get("table", { size: 13 })}<span>Browse tables</span></a>
            <a class="btn btn-secondary" href="${escapeHtml(api.exportDbUrl(s.database.name))}">${I.get("download", { size: 13 })}<span>Export .sql.gz</span></a>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3 class="card-title">${I.get("alertTriangle", { size: 16 })}<span>Remove</span></h3></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:10px;align-items:flex-start;">
          <button class="btn btn-secondary" onclick="sdUnlinkDb(false)">Unlink (keep the database)</button>
          <button class="btn btn-danger" onclick="sdUnlinkDb(true)">${I.get("trash", { size: 13 })}<span>Delete database and user</span></button>
        </div>
      </div>
    </div>`;
}

async function sdShowDbCreds() {
  try {
    const c = await api.getSiteDbCredentials(sd.id);
    document.getElementById("sd-db-creds").innerHTML = `
      <div class="webhook-box" style="margin-bottom:12px;">
        <div class="copy-field"><input class="form-input" readonly value="${escapeHtml(c.password)}">${UI.copyButton(c.password, "Copy password")}</div>
        <div class="copy-field"><input class="form-input" readonly value="${escapeHtml(`mysql://${c.user}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${c.name}`)}">${UI.copyButton(`mysql://${c.user}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${c.name}`, "Copy URL")}</div>
      </div>`;
  } catch (err) {
    toast.error("Failed", err.message);
  }
}

async function sdCreateDb() {
  try {
    const writeEnv = document.getElementById("sd-db-env")?.checked ?? false;
    const r = await api.createSiteDatabase(sd.id, writeEnv);
    toast.success(
      "Database created",
      `${r.database.name}${r.envUpdated ? " · .env updated" : ""}`,
    );
    await sdLoad({ rerenderTab: true });
  } catch (err) {
    toast.error("Could not create the database", err.message);
  }
}

async function sdLinkDb() {
  try {
    await api.linkSiteDatabase(sd.id, {
      name: document.getElementById("sd-link-name").value.trim(),
      user: document.getElementById("sd-link-user").value.trim(),
      password: document.getElementById("sd-link-pass").value,
    });
    toast.success("Database linked", "");
    sdLoad({ rerenderTab: true });
  } catch (err) {
    toast.error("Could not link", err.message);
  }
}

function sdUnlinkDb(drop) {
  const name = sd.site.database.name;
  if (!drop)
    return Modal.confirm(
      "Unlink database",
      `Stop managing <code>${escapeHtml(name)}</code> with this website? The database is kept.`,
      async () => {
        await api.unlinkSiteDatabase(sd.id, false);
        sdLoad({ rerenderTab: true });
      },
    );
  UI.confirmTyped({
    title: "Delete database",
    message: `This permanently deletes <strong>${escapeHtml(name)}</strong> and its user. Make a backup first if you might need the data.`,
    expected: name,
    onConfirm: async () => {
      await api.unlinkSiteDatabase(sd.id, true);
      toast.success("Database deleted", name);
      sdLoad({ rerenderTab: true });
    },
  });
}

// ── Backups ─────────────────────────────────────────────────

const BACKUP_SCHEDULES = [
  ["", "Off"],
  ["0 2 * * *", "Every day at 02:00"],
  ["0 12 * * *", "Every day at 12:00"],
  ["0 */6 * * *", "Every 6 hours"],
  ["0 3 * * 0", "Every Sunday at 03:00"],
];

async function sdBackups(el) {
  const I = window.Icons;
  el.innerHTML = `<div class="spinner"></div>`;
  let b;
  try {
    b = await api.getSiteBackups(sd.id);
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
    return;
  }
  const s = sd.site;
  const current = b.schedule[0]?.schedule || "";
  const known = BACKUP_SCHEDULES.some(([v]) => v === current);
  el.innerHTML = `
    ${!b.targetEnabled ? `<div class="alert alert-warning" style="margin-bottom:16px;">${I.get("alertTriangle", { size: 16 })}<div style="flex:1;">No backup storage is configured — backups are created but not uploaded.</div><a class="btn btn-sm btn-primary" href="#settings">Configure storage</a></div>` : ""}
    <div class="two-col">
      <div class="stack-gap">
        <div class="card">
          <div class="card-body" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
            <div style="flex:1;min-width:220px;">
              <div style="font-weight:600;">Back up ${escapeHtml(s.name)}</div>
              <div class="muted" style="font-size:12px;margin-top:2px;">${[b.includes.database ? `database ${escapeHtml(b.includes.database)}` : null, `${b.includes.dirs.length} folder(s)`, b.includes.env ? ".env" : null].filter(Boolean).join(" + ")} → ${escapeHtml(b.target)}</div>
              ${b.running ? `<div class="inline-status" style="margin-top:6px;">${b.running.status === "running" ? '<span class="spinner spinner-sm"></span>' : ""}<span>${escapeHtml(b.running.status)}${b.running.progress ? ` — ${escapeHtml(b.running.progress)}` : ""}${b.running.error ? ` — ${escapeHtml(b.running.error)}` : ""}</span></div>` : ""}
            </div>
            <button class="btn btn-primary" onclick="sdBackupNow()" ${b.running?.status === "running" ? "disabled" : ""}>${I.get("archive", { size: 13, color: "#fff" })}<span>Back up now</span></button>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("cloud", { size: 16 })}<span>Backups</span></h3><button class="btn btn-sm btn-secondary" onclick="sdRenderTab()">${I.get("refresh", { size: 12 })}</button></div>
          <div class="table-container" style="border:none;border-radius:0;">
            <table class="table"><thead><tr><th>Backup</th><th>Date</th><th style="text-align:right;"></th></tr></thead>
              <tbody>${
                b.backups.length
                  ? b.backups
                      .map(
                        (
                          x,
                        ) => `<tr><td class="mono-sm">${escapeHtml(x.name)}</td><td style="font-size:12px;">${x.date ? escapeHtml(new Date(x.date).toLocaleString()) : "—"}</td>
                  <td style="text-align:right;"><button class="btn btn-sm btn-secondary" onclick="sdRestore(${jsArg(x.name)})">${I.get("rotateCcw", { size: 12 })}<span>Restore</span></button></td></tr>`,
                      )
                      .join("")
                  : `<tr><td colspan="3" class="muted" style="padding:20px;">No backups found in ${escapeHtml(b.target)} yet.</td></tr>`
              }</tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="stack-gap">
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("calendar", { size: 16 })}<span>Automatic backups</span></h3>${b.schedule.length ? '<span class="badge badge-success">on</span>' : '<span class="badge badge-neutral">off</span>'}</div>
          <div class="card-body">
            <select class="form-select" id="sd-backup-schedule">
              ${BACKUP_SCHEDULES.map(([v, l]) => `<option value="${v}" ${v === current ? "selected" : ""}>${l}</option>`).join("")}
              ${!known ? `<option value="${escapeHtml(current)}" selected>Custom: ${escapeHtml(current)}</option>` : ""}
            </select>
            ${b.schedule[0]?.nextRun ? `<div class="form-hint">Next: ${escapeHtml(new Date(b.schedule[0].nextRun).toLocaleString())} · ${escapeHtml(b.schedule[0].human)}</div>` : ""}
            <button class="btn btn-primary btn-sm" style="margin-top:10px;" onclick="sdSaveBackupSchedule()">Save schedule</button>
            <div class="form-hint">Old backups are pruned after the retention period set in <a href="#settings" style="text-decoration:underline;">Settings</a>.</div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("folder", { size: 16 })}<span>What is backed up</span></h3></div>
          <div class="card-body">
            <div class="form-group"><label class="form-label">Folders (one per line)</label><textarea class="form-textarea textarea-code" id="sd-backup-dirs" rows="3">${escapeHtml(b.includes.dirs.join("\n"))}</textarea></div>
            <div class="form-group"><label class="form-label">Skip</label><input class="form-input mono-input" id="sd-backup-excludes" value="${escapeHtml(b.includes.excludes.join(", "))}" placeholder="node_modules, vendor"><div class="form-hint">Folders that can be rebuilt, e.g. node_modules</div></div>
            <button class="btn btn-secondary btn-sm" onclick="sdSaveBackupContents()">Save</button>
          </div>
        </div>
      </div>
    </div>`;
}

async function sdBackupNow() {
  try {
    const r = await api.backupSite(sd.id);
    if (r.success === false) throw new Error(r.error);
    toast.success("Backup started", sd.site.name);
    if (sd.tab === "backups")
      setTimeout(() => sd.tab === "backups" && sdRenderTab(), 1500);
  } catch (err) {
    toast.error("Backup failed", err.message);
  }
}

async function sdSaveBackupSchedule() {
  const schedule = document.getElementById("sd-backup-schedule").value;
  try {
    await api.setSiteBackupSchedule(sd.id, schedule || null);
    toast.success(
      schedule ? "Automatic backups on" : "Automatic backups off",
      "",
    );
    await sdLoad({ quiet: true });
    sdRenderTab();
  } catch (err) {
    toast.error("Failed", err.message);
  }
}

async function sdSaveBackupContents() {
  try {
    await api.updateSite(sd.id, {
      backupDirs: document.getElementById("sd-backup-dirs").value,
      backupExcludes: document.getElementById("sd-backup-excludes").value,
    });
    toast.success("Saved", "Used for the next backup");
  } catch (err) {
    toast.error("Save failed", err.message);
  }
}

function sdRestore(name) {
  const s = sd.site;
  Modal.show(
    `Restore ${escapeHtml(name)}`,
    `<p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">Files are extracted over the current ones; the database is replaced by the dump. Consider backing up first.</p>
     <div class="option-list">
       ${s.database ? `<label class="option-row"><input type="checkbox" id="rs-db" checked><span><span class="option-label">Database</span><span class="option-hint">${escapeHtml(s.database.name)}</span></span></label>` : ""}
       <label class="option-row"><input type="checkbox" id="rs-files" checked><span><span class="option-label">Files</span><span class="option-hint">${escapeHtml(s.backupDirs.join(", "))}</span></span></label>
       <label class="option-row"><input type="checkbox" id="rs-env" checked><span><span class="option-label">.env</span></span></label>
     </div>`,
    {
      submitText: "Restore",
      submitClass: "btn-danger-solid",
      onSubmit: async (o) => {
        const res = await api.restoreSite(sd.id, {
          backup: name,
          restoreDb: o.querySelector("#rs-db")?.checked ?? false,
          restoreFiles: o.querySelector("#rs-files").checked,
          restoreEnv: o.querySelector("#rs-env").checked,
        });
        setTimeout(() => JobConsole.open(res.jobId, `Restore ${s.name}`), 50);
      },
    },
  );
}

// ── Logs & traffic ──────────────────────────────────────────

async function sdLogs(el) {
  const s = sd.site;
  const I = window.Icons;
  const types = [
    ["access", "Access"],
    ["error", "Errors"],
    ...(s.features.process
      ? [
          ["out", "App output"],
          ["err", "App errors"],
        ]
      : []),
  ];
  sd.logType =
    sd.logType && types.some(([t]) => t === sd.logType)
      ? sd.logType
      : s.nginx
        ? "access"
        : types[types.length - 1][0];
  el.innerHTML = `
    <div id="sd-traffic"></div>
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">${I.get("fileText", { size: 16 })}<span>Logs</span></h3>
        <div style="display:flex;gap:8px;align-items:center;">
          <div class="segmented">${types.map(([t, l]) => `<button data-sdlog="${t}" class="${t === sd.logType ? "active" : ""}" onclick="sdLoadLog('${t}')">${l}</button>`).join("")}</div>
          <button class="btn btn-sm btn-secondary" onclick="sdLoadLog()">${I.get("refresh", { size: 12 })}</button>
        </div>
      </div>
      <div class="card-body"><pre class="job-output" id="sd-log" style="max-height:480px;">Loading…</pre><div class="form-hint" id="sd-log-path"></div></div>
    </div>`;
  sdLoadLog();
  if (s.nginx) sdTraffic(7);
}

async function sdLoadLog(type) {
  if (type) sd.logType = type;
  document
    .querySelectorAll("[data-sdlog]")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.sdlog === sd.logType),
    );
  const pre = document.getElementById("sd-log");
  if (!pre) return;
  try {
    const r = await api.getSiteLogs(sd.id, sd.logType, 400);
    pre.textContent = r.lines.length
      ? UI.cleanOutput(r.lines.join("\n"))
      : "No entries yet.";
    pre.scrollTop = pre.scrollHeight;
    document.getElementById("sd-log-path").innerHTML = r.path
      ? `<code>${escapeHtml(r.path)}</code>`
      : "";
  } catch (err) {
    pre.textContent = err.message;
  }
}

async function sdTraffic(days) {
  const el = document.getElementById("sd-traffic");
  if (!el) return;
  const I = window.Icons;
  let t;
  try {
    t = await api.getSiteStats(sd.id, days);
  } catch {
    return;
  }
  if (!t.available) {
    el.innerHTML = "";
    return;
  }
  const errors = (t.status["4xx"] || 0) + (t.status["5xx"] || 0);
  const list = (items, fmt = (x) => x) =>
    items.length
      ? `<ul class="bar-list">${items.map((i) => `<li><span class="bar-fill" style="width:${Math.round((i.count / items[0].count) * 100)}%;"></span><span class="truncate mono-sm">${escapeHtml(fmt(i.key))}</span><span>${i.count}</span></li>`).join("")}</ul>`
      : '<div class="muted" style="font-size:12px;">No data yet</div>';
  el.innerHTML = `
    <div class="card" style="margin-bottom:20px;">
      <div class="card-header"><h3 class="card-title">${I.get("trendingUp", { size: 16 })}<span>Traffic</span></h3>
        <div class="segmented">${[1, 7, 30].map((d) => `<button class="${d === days ? "active" : ""}" onclick="sdTraffic(${d})">${d === 1 ? "24 h" : `${d} days`}</button>`).join("")}</div></div>
      <div class="card-body">
        <div class="stat-mini">
          <div><div class="stat-mini-label">Requests</div><div class="stat-mini-value">${t.totals.requests.toLocaleString()}</div></div>
          <div><div class="stat-mini-label">Visitors</div><div class="stat-mini-value">${t.totals.visitors.toLocaleString()}</div></div>
          <div><div class="stat-mini-label">Bandwidth</div><div class="stat-mini-value">${formatBytes(t.totals.bytes)}</div></div>
          <div><div class="stat-mini-label">Errors (4xx/5xx)</div><div class="stat-mini-value" style="color:${t.status["5xx"] ? "var(--color-red)" : "inherit"};">${errors.toLocaleString()}</div></div>
        </div>
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;">${days === 1 ? "Requests per hour (last 24 h)" : `Requests per day (last ${days} days)`}</div>
        ${
          days === 1
            ? UI.bars(
                t.hourly.map((h) => h.requests),
                { labels: t.hourly.map((_, i) => `${23 - i}h ago`) },
              )
            : UI.bars(
                t.daily.map((d) => d.requests),
                { labels: t.daily.map((d) => d.date) },
              )
        }
        <div class="field-row" style="margin-top:18px;align-items:start;">
          <div><div style="font-size:12px;font-weight:600;margin-bottom:6px;">Top pages</div>${list(t.topPaths)}</div>
          <div><div style="font-size:12px;font-weight:600;margin-bottom:6px;">Referrers</div>${list(t.topReferrers)}<div style="font-size:12px;font-weight:600;margin:12px 0 6px;">Not found (404)</div>${list(t.notFound)}</div>
        </div>
        <div class="form-hint" style="margin-top:10px;">From the nginx access log · bots (${t.totals.bots.toLocaleString()} requests) are not counted as visitors.</div>
      </div>
    </div>`;
}

// ── Settings ────────────────────────────────────────────────

function sdSettings(el) {
  const s = sd.site;
  const I = window.Icons;
  el.innerHTML = `
    <div class="two-col">
      <div class="stack-gap">
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("settings", { size: 16 })}<span>General</span></h3><button class="btn btn-sm btn-primary" onclick="sdSaveSettings()">${I.get("save", { size: 12, color: "#fff" })}<span>Save</span></button></div>
          <div class="card-body">
            <div class="form-group"><label class="form-label">Description</label><input class="form-input" id="st-desc" value="${escapeHtml(s.description || "")}" placeholder="Production API"></div>
            ${
              s.gitUrl
                ? `<div class="field-row" style="grid-template-columns:minmax(0,3fr) minmax(0,1fr);">
              <div class="form-group"><label class="form-label">Repository URL</label><input class="form-input mono-input" id="st-git" value="${escapeHtml(s.gitUrl)}"></div>
              <div class="form-group"><label class="form-label">Branch</label><input class="form-input mono-input" id="st-branch" value="${escapeHtml(s.branch || "")}"></div>
            </div><div class="form-hint" style="margin-top:-8px;margin-bottom:12px;">A new branch is checked out on the next deploy.</div>`
                : ""
            }
            ${s.features.external ? `<div class="form-group"><label class="form-label">Proxy target</label><input class="form-input mono-input" id="st-proxy" value="${escapeHtml(s.proxyTarget || "")}" placeholder="http://127.0.0.1:8080"></div>` : ""}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("info", { size: 16 })}<span>Details</span></h3></div>
          <div class="card-body">
            <dl class="kv">
              <dt>Type</dt><dd>${escapeHtml(s.stackLabel)}</dd>
              <dt>Folder</dt><dd class="mono-sm">${escapeHtml(s.deployPath || "—")}${s.webRoot ? ` (serving ${escapeHtml(s.webRoot)}/)` : ""}</dd>
              ${s.nginx ? `<dt>nginx site</dt><dd class="mono-sm">${escapeHtml(s.nginx.name)}</dd>` : ""}
              ${s.features.process ? `<dt>PM2 process</dt><dd class="mono-sm">${escapeHtml(s.name)}</dd>` : ""}
              <dt>Created</dt><dd>${escapeHtml(UI.dateTime(s.createdAt))}</dd>
              <dt>Website ID</dt><dd class="mono-sm">${escapeHtml(s.id)}</dd>
            </dl>
          </div>
        </div>
      </div>
      <div class="card" style="border-color:var(--color-red-border);">
        <div class="card-header"><h3 class="card-title" style="color:var(--color-red);">${I.get("alertTriangle", { size: 16, color: "var(--color-red)" })}<span>Danger zone</span></h3></div>
        <div class="card-body">
          <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">Delete this website from the panel. You choose what else goes: its nginx site, files and database.</p>
          <button class="btn btn-danger-solid" onclick="sdDeleteSite()">${I.get("trash", { size: 13, color: "#fff" })}<span>Delete website</span></button>
        </div>
      </div>
    </div>`;
}

async function sdSaveSettings() {
  const body = { description: document.getElementById("st-desc").value.trim() };
  const git = document.getElementById("st-git");
  if (git) {
    body.gitUrl = git.value.trim();
    body.branch = document.getElementById("st-branch").value.trim();
  }
  const proxy = document.getElementById("st-proxy");
  if (proxy) body.proxyTarget = proxy.value.trim();
  try {
    await api.updateSite(sd.id, body);
    toast.success("Settings saved", "");
    sdLoad({ rerenderTab: true });
  } catch (err) {
    toast.error("Save failed", err.message);
  }
}

function sdDeleteSite() {
  const s = sd.site;
  UI.confirmTyped({
    title: `Delete ${s.name}`,
    message: `This removes the website from the panel${s.features.process ? ", stops its app" : ""} and its scheduled jobs.`,
    expected: s.name,
    confirmText: "Delete website",
    options: [
      ...(s.nginx
        ? [
            {
              id: "removeNginx",
              label: "Remove the nginx site and its certificate",
              hint: `${s.domains.join(", ")} stop being served`,
              checked: true,
            },
          ]
        : []),
      ...(s.deployPath
        ? [
            {
              id: "deleteFiles",
              label: `Delete all files in ${s.deployPath}`,
              hint: "Cannot be undone",
              danger: true,
            },
          ]
        : []),
      ...(s.database
        ? [
            {
              id: "dropDatabase",
              label: `Delete database ${s.database.name} and its user`,
              hint: "Cannot be undone",
              danger: true,
            },
          ]
        : []),
    ],
    onConfirm: async (opts) => {
      const res = await api.deleteSite(s.id, {
        removeNginx: opts.removeNginx !== false,
        deleteFiles: !!opts.deleteFiles,
        dropDatabase: !!opts.dropDatabase,
      });
      JobConsole.open(res.jobId, `Delete ${s.name}`, {
        onDone: (job) => {
          if (job.status === "completed") {
            toast.success("Website deleted", s.name);
            Modal.closeAll();
            window.app.navigate("sites");
          }
        },
      });
    },
  });
}

window.renderSiteDetail = renderSiteDetail;
