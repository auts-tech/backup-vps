/**
 * Websites — every site and app on the server in one list. A website joins
 * its domains (nginx), code (Git), app process (PM2), database and backups;
 * open one to manage all of it from a single page.
 */
let sitesState = { sites: [], unlinked: [], tools: {}, filter: "all", search: "" };

function renderSites(container) {
  const I = window.Icons;
  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>Websites</h2>
          <p>Every website and app on this server — open one to manage its domains, deployments, environment, database and backups.</p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" onclick="loadSites()">${I.get("refresh", { size: 13 })}<span>Refresh</span></button>
          <button class="btn btn-primary" onclick="window.app.navigate('new-site')">${I.get("plus", { size: 13, color: "#fff" })}<span>New Website</span></button>
        </div>
      </div>
      <div id="sites-banners"></div>
      <div class="sites-toolbar">
        <input type="search" class="form-input" id="sites-search" placeholder="Search name, domain, repository…" value="${escapeHtml(sitesState.search)}">
        <div class="chip-group" id="sites-filters"></div>
      </div>
      <div id="sites-grid" class="site-grid"><div style="grid-column:1/-1;text-align:center;padding:48px;"><div class="spinner spinner-lg"></div></div></div>
      <div id="sites-unlinked" style="margin-top:28px;"></div>
    </div>`;
  document.getElementById("sites-search").addEventListener(
    "input",
    UI.debounce((e) => {
      sitesState.search = e.target.value.trim().toLowerCase();
      renderSitesGrid();
    }, 150),
  );
  loadSites();
  // Live status: faster while something is deploying
  const tick = () => {
    const busy = sitesState.sites.some((s) => s.health.state === "deploying");
    sitesTimer = setTimeout(async () => {
      if (window.app.currentPage !== "sites") return;
      await loadSites(true);
      tick();
    }, busy ? 3000 : 15000);
  };
  let sitesTimer;
  tick();
  window.app.onLeave(() => clearTimeout(sitesTimer));
}

async function loadSites(quiet = false) {
  try {
    const data = await api.getSites();
    sitesState = { ...sitesState, ...data };
    renderSitesBanners();
    renderSitesGrid();
    renderUnlinkedSites();
  } catch (err) {
    if (quiet) return;
    const grid = document.getElementById("sites-grid");
    if (grid) grid.innerHTML = `<div class="card" style="grid-column:1/-1;">${UI.emptyState("alertTriangle", "Could not load websites", escapeHtml(err.message))}</div>`;
  }
}

function renderSitesBanners() {
  const el = document.getElementById("sites-banners");
  if (!el) return;
  const I = window.Icons;
  const { tools, sites } = sitesState;
  const banners = [];
  if (!tools.nginx)
    banners.push(`
      <div class="alert alert-warning" style="margin-bottom:12px;">
        ${I.get("alertTriangle", { size: 16 })}
        <div style="flex:1;"><strong>nginx is not installed.</strong> It is installed automatically with your first website that has a domain — or install it now.</div>
        <button class="btn btn-sm btn-primary" onclick="JobConsole.run(api.installNginx(), 'Install nginx', { onDone: () => loadSites() })">Install nginx</button>
      </div>`);
  if (!tools.pm2 && sites.some((s) => s.features.process))
    banners.push(`
      <div class="alert alert-warning" style="margin-bottom:12px;">
        ${I.get("alertTriangle", { size: 16 })}
        <div style="flex:1;"><strong>PM2 is not installed.</strong> Node.js, Next.js and Python apps need it to run and restart automatically.</div>
        <button class="btn btn-sm btn-primary" onclick="JobConsole.run(api.installPm2(), 'Install PM2', { onDone: () => loadSites() })">Install PM2</button>
      </div>`);
  el.innerHTML = banners.join("");
}

function siteMatchesFilter(site) {
  const f = sitesState.filter;
  if (f === "live" && site.health.state !== "live") return false;
  if (f === "attention" && !["error", "stopped"].includes(site.health.state) && site.deploy.last?.status !== "failed") return false;
  if (f === "deploying" && site.health.state !== "deploying") return false;
  const q = sitesState.search;
  if (!q) return true;
  return [site.name, site.description, site.gitUrl, site.stackLabel, ...(site.domains || [])].some((v) => String(v || "").toLowerCase().includes(q));
}

function renderSitesGrid() {
  const grid = document.getElementById("sites-grid");
  if (!grid) return;
  const I = window.Icons;
  const { sites } = sitesState;
  const counts = {
    all: sites.length,
    live: sites.filter((s) => s.health.state === "live").length,
    attention: sites.filter((s) => ["error", "stopped"].includes(s.health.state) || s.deploy.last?.status === "failed").length,
    deploying: sites.filter((s) => s.health.state === "deploying").length,
  };
  const filters = document.getElementById("sites-filters");
  if (filters)
    filters.innerHTML = [
      ["all", "All"],
      ["live", "Live"],
      ["attention", "Needs attention"],
      ["deploying", "Deploying"],
    ]
      .map(([id, label]) => `<button class="chip ${sitesState.filter === id ? "active" : ""}" onclick="sitesState.filter='${id}';renderSitesGrid()">${label} · ${counts[id]}</button>`)
      .join("");

  if (!sites.length) {
    grid.innerHTML = `
      <div class="card" style="grid-column:1/-1;">
        ${UI.emptyState(
          "globe",
          "No websites yet",
          "Deploy a Node.js, Next.js, Laravel or PHP app from Git, install WordPress in one click, or create an empty site and upload files.",
          `<button class="btn btn-primary" onclick="window.app.navigate('new-site')">${I.get("plus", { size: 13, color: "#fff" })}<span>Create your first website</span></button>`,
        )}
      </div>`;
    return;
  }
  const shown = sites.filter(siteMatchesFilter);
  grid.innerHTML =
    (shown.length ? shown.map(siteCardHtml).join("") : `<div class="muted" style="grid-column:1/-1;padding:30px;text-align:center;">No websites match.</div>`) +
    `<button class="site-card site-card-new" onclick="window.app.navigate('new-site')">${I.get("plus", { size: 18 })}<span>New website</span></button>`;
}

function siteRuntimeText(site) {
  if (site.features.process) {
    const parts = [site.stackLabel, site.port ? `port ${site.port}` : null];
    if (site.app?.status === "online" && site.app.memory) parts.push(formatBytes(site.app.memory));
    return parts.filter(Boolean).join(" · ");
  }
  if (site.features.external) return `→ ${site.proxyTarget || site.nginx?.proxyPass || "?"}`;
  if (site.features.php) return `${site.stackLabel} · PHP ${site.phpVersion || site.nginx?.phpVersion || "?"}`;
  return site.stackLabel;
}

function siteCardHtml(site) {
  const I = window.Icons;
  const last = site.deploy.last;
  const domain = site.primaryDomain
    ? `${I.get(site.ssl.enabled ? "lock" : "globe", { size: 12 })}<a href="${escapeHtml(site.url || "#")}" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="truncate">${escapeHtml(site.primaryDomain)}</a>${site.domains.length > 1 ? `<span class="muted">+${site.domains.length - 1}</span>` : ""}`
    : `${I.get("globe", { size: 12 })}<span class="muted">No domain</span>`;
  const gitRow = site.gitUrl
    ? `<div class="site-meta-row">${I.get("gitBranch", { size: 13 })}<span>${escapeHtml(site.git?.branch || site.branch || "")}</span>${site.git?.commit ? UI.commit(site.git.commit) : ""}</div>`
    : `<div class="site-meta-row">${I.get("folder", { size: 13 })}<span class="truncate mono-sm" title="${escapeHtml(site.deployPath || "")}">${escapeHtml(site.deployPath || "No folder")}</span></div>`;
  const deployRow = site.provision?.status === "failed"
    ? `<div class="site-meta-row" style="color:var(--color-red);">${I.get("alertCircle", { size: 13, color: "var(--color-red)" })}<span class="truncate">Setup failed — open to retry</span></div>`
    : last
      ? `<div class="site-meta-row">${I.get(last.status === "failed" ? "alertCircle" : "rocket", { size: 13, color: last.status === "failed" ? "var(--color-red)" : undefined })}<span>${last.status === "running" ? "Deploying now…" : `${last.trigger === "setup" ? "Set up" : "Deployed"} ${UI.timeAgo(last.finishedAt || last.startedAt)}`}</span>${last.status === "failed" ? '<span class="badge badge-danger">failed</span>' : last.status === "warning" ? '<span class="badge badge-warning">warning</span>' : ""}</div>`
      : "";
  const ssl = site.primaryDomain
    ? site.ssl.enabled
      ? `<span class="badge ${site.ssl.daysLeft !== null && site.ssl.daysLeft < 14 ? "badge-warning" : "badge-success"}">${I.get("lock", { size: 10 })} HTTPS${site.ssl.daysLeft !== null ? ` · ${site.ssl.daysLeft}d` : ""}</span>`
      : `<span class="badge badge-neutral">${I.get("unlock", { size: 10 })} HTTP only</span>`
    : "";
  return `
    <div class="site-card" onclick="window.app.navigate('site/${site.id}')">
      <div class="site-card-head">
        ${UI.stackAvatar(site.type)}
        <div style="flex:1;min-width:0;">
          <div class="site-card-title truncate">${escapeHtml(site.name)}</div>
          <div class="site-card-domain">${domain}</div>
        </div>
        ${UI.healthPill(site.health)}
      </div>
      <div class="site-card-meta">
        ${gitRow}
        <div class="site-meta-row">${I.get(site.features.process ? "cpu" : site.features.php ? "code" : "layers", { size: 13 })}<span class="truncate">${escapeHtml(siteRuntimeText(site))}</span>${ssl}</div>
        ${deployRow}
      </div>
      <div class="site-card-foot" onclick="event.stopPropagation()">
        ${site.gitUrl ? `<button class="btn btn-sm btn-primary" onclick="siteDeploy('${site.id}', ${jsArg(site.name)}, () => loadSites(true))" ${site.health.state === "deploying" ? "disabled" : ""}>${I.get("rocket", { size: 12, color: "#fff" })}<span>Deploy</span></button>` : ""}
        ${site.url ? `<a class="btn btn-sm btn-secondary" href="${escapeHtml(site.url)}" target="_blank" rel="noopener">${I.get("externalLink", { size: 12 })}<span>Visit</span></a>` : ""}
        <div style="flex:1;"></div>
        <button class="btn btn-sm btn-ghost" onclick="window.app.navigate('site/${site.id}')"><span>Manage</span>${I.get("arrowRight", { size: 12 })}</button>
      </div>
    </div>`;
}

function renderUnlinkedSites() {
  const el = document.getElementById("sites-unlinked");
  if (!el) return;
  const I = window.Icons;
  const list = sitesState.unlinked || [];
  if (!list.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">${I.get("server", { size: 16 })}<span>Other nginx sites</span><span class="badge badge-neutral">${list.length}</span></h3>
        <span class="muted" style="font-size:12px;">Configured in nginx but not managed as websites yet</span>
      </div>
      <div class="table-container" style="border:none;border-radius:0;">
        <table class="table">
          <thead><tr><th>Site</th><th>Serves</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
          <tbody>
            ${list
              .map(
                (s) => `
              <tr>
                <td>
                  <div style="font-weight:600;">${escapeHtml(s.domains[0] || s.name)}${s.catchAll ? ' <span class="badge badge-neutral">catch-all</span>' : ""}</div>
                  <div class="mono-sm">${escapeHtml(s.name)}${s.domains.length > 1 ? ` · +${s.domains.length - 1} domain(s)` : ""}</div>
                </td>
                <td class="mono-sm truncate" style="max-width:320px;">${escapeHtml(s.proxyPass ? `→ ${s.proxyPass}` : s.root || "—")}${s.phpVersion ? ` · PHP ${escapeHtml(s.phpVersion)}` : ""}</td>
                <td>
                  <span class="badge ${s.enabled ? "badge-success" : "badge-neutral"}">${s.enabled ? "Enabled" : "Disabled"}</span>
                  ${s.ssl ? `<span class="badge badge-success">${I.get("lock", { size: 10 })} HTTPS</span>` : ""}
                </td>
                <td style="text-align:right;white-space:nowrap;">
                  ${s.catchAll ? "" : `<button class="btn btn-sm btn-primary" onclick="importNginxSite(${jsArg(s.name)})" title="Manage as a website: deployments, backups, logs…">${I.get("download", { size: 12, color: "#fff" })}<span>Manage as website</span></button>`}
                  <button class="btn btn-sm btn-secondary" onclick="editNginxConfig(${jsArg(s.name)}, () => loadSites(true))" title="Edit nginx config">${I.get("code", { size: 12 })}</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteNginxSite(${jsArg(s.name)})" title="Delete nginx site">${I.get("trash", { size: 12 })}</button>
                </td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function importNginxSite(name) {
  try {
    const { site } = await api.importSite(name);
    toast.success("Website added", `${name} is now managed here`);
    window.app.navigate(`site/${site.id}`);
  } catch (err) {
    toast.error("Import failed", err.message);
  }
}

function deleteNginxSite(name) {
  Modal.confirm(
    "Delete nginx site",
    `Remove the nginx config for <strong>${escapeHtml(name)}</strong>? Its files and certificate are kept.`,
    async () => {
      await api.deleteNginxSite(name);
      toast.success("Deleted", name);
      loadSites(true);
    },
  );
}

/**
 * nginx config editor (tested with nginx -t, rolled back if invalid).
 */
async function editNginxConfig(name, onSaved) {
  try {
    const site = await api.getNginxSite(name);
    CodeEditor.open({
      title: `nginx: ${name}`,
      subtitle: `${site.path} — tested with nginx -t before applying; rolled back if invalid`,
      content: site.content,
      mode: "nginx",
      onSave: async (content) => {
        await api.saveNginxSite(name, content);
        toast.success("Saved & reloaded", name);
        onSaved?.();
      },
    });
  } catch (err) {
    toast.error("Failed", err.message);
  }
}

/**
 * Deploy a website and show the live log. Attaches to a deployment that is already running.
 */
async function siteDeploy(id, name, onDone) {
  try {
    const res = await api.deploySite(id);
    JobConsole.open(res.jobId, `Deploy ${name}`, { onDone });
  } catch (err) {
    if (err.data?.jobId) JobConsole.open(err.data.jobId, `Deploy ${name} (already running)`, { onDone });
    else toast.error("Deploy failed", err.message);
  }
  setTimeout(() => onDone?.(), 600);
}

function openInFileManager(path) {
  try {
    localStorage.setItem("fm_path", path);
  } catch {}
  window.app.navigate("files");
}

function openTerminalIn(path) {
  try {
    localStorage.setItem("terminal_cwd", path);
  } catch {}
  window.app.navigate("terminal");
}

window.renderSites = renderSites;
window.openInFileManager = openInFileManager;
window.openTerminalIn = openTerminalIn;
window.siteDeploy = siteDeploy;
window.editNginxConfig = editNginxConfig;
