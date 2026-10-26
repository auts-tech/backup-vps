const NEW_SITE_SOURCES = [
  {
    id: "git",
    icon: "gitBranch",
    title: "Deploy from Git",
    desc: "GitHub, GitLab, Bitbucket or any Git URL — Node.js, Next.js, React, Laravel, PHP, static, Python",
  },
  {
    id: "wordpress",
    icon: "globe",
    title: "WordPress",
    desc: "One-click install with its own database and admin account",
  },
  {
    id: "empty",
    icon: "upload",
    title: "Empty website",
    desc: "A domain and a folder — upload HTML or PHP files yourself",
  },
  {
    id: "proxy",
    icon: "plug",
    title: "Reverse proxy",
    desc: "Point a domain at an app on a port (Docker, another service…)",
  },
];

const GIT_STACKS = [
  { id: "node", desc: "Express, Nest, Fastify… runs with PM2" },
  { id: "next", desc: "next build + next start under PM2" },
  {
    id: "react",
    desc: "Vite / Create React App / Vue — built, served as files",
  },
  { id: "laravel", desc: "composer install, migrations, caches" },
  { id: "php", desc: "Any PHP app (index.php front controller)" },
  { id: "static", desc: "Plain HTML/CSS/JS, or another static build" },
  { id: "python", desc: "Flask, FastAPI, Django… runs with PM2" },
];

const PROCESS_STACKS = new Set(["node", "next", "python"]);
const PHP_STACKS = new Set(["laravel", "php", "wordpress"]);
const WEBROOT_STACKS = new Set(["static", "react", "php"]);

let ns = null; // form state

function newSiteDefaults() {
  return {
    source: "git",
    type: "node",
    gitUrl: "",
    branch: "",
    branches: [],
    inspect: null, // { loading, error, data }
    domain: "",
    www: true,
    aliases: "",
    ssl: false,
    sslTouched: false,
    dns: null,
    name: "",
    nameTouched: false,
    deployPath: "",
    pathTouched: false,
    port: "",
    portTouched: false,
    phpVersion: "",
    webRoot: "",
    webRootTouched: false,
    deployScript: "",
    scriptTouched: false,
    startCommand: "",
    startTouched: false,
    env: "",
    proxyTarget: "",
    proxyPath: "",
    proxyGit: "",
    proxyBranch: "main",
    proxyScript: "",
    emptyType: "static",
    dbCreate: false,
    dbTouched: false,
    writeEnv: true,
    wpTitle: "",
    wpUser: "admin",
    wpEmail: "",
    wpPassword: generatePassword(18),
    suggest: null,
    creating: false,
  };
}

function nsSlug(text) {
  return (
    String(text || "")
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\.git$/, "")
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
      .slice(0, 63) || ""
  );
}

function nsType() {
  if (ns.source === "wordpress") return "wordpress";
  if (ns.source === "proxy") return "proxy";
  if (ns.source === "empty") return ns.emptyType;
  return ns.type;
}

function renderSiteNew(container) {
  ns = newSiteDefaults();
  const I = window.Icons;
  container.innerHTML = `
    <div class="wizard" id="new-site">
      <a class="back-link" href="#sites">${I.get("chevronLeft", { size: 13 })}All websites</a>
      <div class="page-header">
        <div class="page-header-title">
          <h2>New website</h2>
          <p>Fill in what you know — the folder, port and PHP version are suggested automatically and can be changed.</p>
        </div>
      </div>
      <div id="ns-body">
        <div class="wizard-section">
          <div class="wizard-step-title"><span class="wizard-step-num">1</span>What are you creating?</div>
          <div class="choice-grid" id="ns-sources"></div>
        </div>
        <div class="wizard-section" id="ns-source-section"></div>
        <div class="wizard-section" id="ns-domain-section"></div>
        <div class="wizard-section" id="ns-settings-section"></div>
        <div class="wizard-section" id="ns-db-section"></div>
        <div class="wizard-footer">
          <div class="summary-chips" id="ns-summary"></div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-secondary" onclick="window.app.navigate('sites')">Cancel</button>
            <button class="btn btn-primary btn-lg" id="ns-create" onclick="nsCreate()">${I.get("rocket", { size: 14, color: "#fff" })}<span>Create website</span></button>
          </div>
        </div>
      </div>
    </div>`;
  nsRenderSources();
  nsRenderAll();
  api
    .suggestSite({})
    .then((s) => {
      ns.suggest = s;
      if (!ns.portTouched && s.port) ns.port = String(s.port);
      if (!ns.phpVersion && s.phpVersion) ns.phpVersion = s.phpVersion;
      nsRenderAll();
    })
    .catch(() => {});
}

function nsRenderAll() {
  nsRenderSourceSection();
  nsRenderDomainSection();
  nsRenderSettingsSection();
  nsRenderDbSection();
  nsRenderSummary();
}

function nsRenderSources() {
  const el = document.getElementById("ns-sources");
  if (!el) return;
  el.innerHTML = NEW_SITE_SOURCES.map(
    (s) => `
    <button class="choice ${ns.source === s.id ? "active" : ""}" onclick="nsSetSource('${s.id}')">
      <span class="choice-head">${Icons.get(s.icon, { size: 16 })}${escapeHtml(s.title)}</span>
      <span class="choice-desc">${escapeHtml(s.desc)}</span>
    </button>`,
  ).join("");
}

function nsSetSource(source) {
  ns.source = source;
  if (source === "wordpress" && !ns.dbTouched) ns.dbCreate = true;
  nsRenderSources();
  nsTypeChanged();
}

function nsTypeChanged() {
  const type = nsType();
  if (!ns.dbTouched) ns.dbCreate = type === "laravel" || type === "wordpress";
  if (
    !ns.scriptTouched &&
    ns.source === "git" &&
    ns.inspect?.data?.stack !== type
  )
    ns.deployScript = "";
  nsSuggestNames();
  nsRenderAll();
}

// ── Section 2: source details ───────────────────────────────

function nsRenderSourceSection() {
  const el = document.getElementById("ns-source-section");
  if (!el) return;
  const I = window.Icons;
  let body = "";
  if (ns.source === "git") {
    const ins = ns.inspect;
    let status = "";
    if (ins?.loading)
      status = `<div class="inline-status"><span class="spinner spinner-sm"></span> Inspecting repository…</div>`;
    else if (ins?.error)
      status = `<div class="inline-status bad">${I.get("alertCircle", { size: 13 })}<span>${escapeHtml(ins.error)}</span></div>
        <div class="form-hint" style="margin-top:6px;">Private repository? <a href="#" onclick="nsShowDeployKey();return false;" style="text-decoration:underline;">Add this server's deploy key</a> to it, or use <code>https://&lt;token&gt;@github.com/org/repo.git</code>.</div>`;
    else if (ins?.data) {
      const d = ins.data;
      status = `<div class="detect-box" style="margin-top:10px;">${I.get("checkCircle", { size: 16, color: "var(--color-green)" })}<div>
        <strong>${d.empty ? "Empty repository" : `Looks like a ${escapeHtml(UI.stack(d.stack).label)} project`}</strong>
        <div style="font-size:12px;margin-top:2px;">${d.branches.length} branch(es)${d.commit ? ` · latest: <code>${escapeHtml(d.commit.short)}</code> ${escapeHtml(d.commit.subject)}` : ""}${d.phpConstraint ? ` · needs PHP ${escapeHtml(d.phpConstraint)}` : ""}${d.nodeEngine ? ` · Node ${escapeHtml(d.nodeEngine)}` : ""}</div>
      </div></div>`;
    }
    const branchOptions = (
      ns.branches.length ? ns.branches : [ns.branch || "main"]
    )
      .map(
        (b) =>
          `<option value="${escapeHtml(b)}" ${b === ns.branch ? "selected" : ""}>${escapeHtml(b)}</option>`,
      )
      .join("");
    body = `
      <div class="field-row" style="grid-template-columns:minmax(0,3fr) minmax(0,1fr);">
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Repository URL</label>
          <div class="input-with-action">
            <input class="form-input mono-input" id="ns-git" placeholder="https://github.com/you/app.git  or  git@github.com:you/app.git" value="${escapeHtml(ns.gitUrl)}">
            <button class="btn btn-secondary" onclick="nsInspect()">${I.get("search", { size: 13 })}<span>Check</span></button>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Branch</label>
          <select class="form-select" id="ns-branch" onchange="ns.branch=this.value;nsInspect(true)">${branchOptions}</select>
        </div>
      </div>
      ${status}
      <div style="margin-top:16px;">
        <label class="form-label">Framework${ns.inspect?.data?.stack ? '<span class="auto-tag">detected</span>' : ""}</label>
        <div class="choice-grid choice-grid-sm">
          ${GIT_STACKS.map(
            (s) => `
            <button class="choice ${ns.type === s.id ? "active" : ""}" onclick="ns.type='${s.id}';nsTypeChanged()">
              <span class="choice-head">${UI.stackAvatar(s.id, "sm")}${escapeHtml(UI.stack(s.id).label)}</span>
              <span class="choice-desc">${escapeHtml(s.desc)}</span>
            </button>`,
          ).join("")}
        </div>
      </div>`;
  } else if (ns.source === "wordpress") {
    body = `
      <div class="field-row">
        <div class="form-group"><label class="form-label">Site title</label><input class="form-input" id="ns-wp-title" placeholder="My blog" value="${escapeHtml(ns.wpTitle)}" oninput="ns.wpTitle=this.value"></div>
        <div class="form-group"><label class="form-label">Admin email</label><input class="form-input" id="ns-wp-email" type="email" placeholder="you@example.com" value="${escapeHtml(ns.wpEmail || ns.suggest?.adminEmail || "")}" oninput="ns.wpEmail=this.value"></div>
      </div>
      <div class="field-row">
        <div class="form-group"><label class="form-label">Admin username</label><input class="form-input" value="${escapeHtml(ns.wpUser)}" oninput="ns.wpUser=this.value"></div>
        <div class="form-group"><label class="form-label">Admin password <span class="auto-tag">generated</span></label>
          <div class="input-with-action"><input class="form-input mono-input" id="ns-wp-pass" value="${escapeHtml(ns.wpPassword)}" oninput="ns.wpPassword=this.value"><button class="btn btn-secondary" onclick="UI.copy(ns.wpPassword, 'Password copied')">${I.get("copy", { size: 13 })}</button></div>
        </div>
      </div>
      <div class="form-hint">WordPress is downloaded with WP-CLI, gets its own MySQL database, and is installed with this admin account — no setup screen.</div>`;
  } else if (ns.source === "empty") {
    body = `
      <label class="form-label">Files</label>
      <div class="choice-grid choice-grid-sm" style="max-width:520px;">
        ${["static", "php"]
          .map(
            (t) => `
          <button class="choice ${ns.emptyType === t ? "active" : ""}" onclick="ns.emptyType='${t}';nsTypeChanged()">
            <span class="choice-head">${UI.stackAvatar(t, "sm")}${t === "static" ? "HTML / static" : "PHP"}</span>
            <span class="choice-desc">${t === "static" ? "HTML, CSS, JS, images" : "index.php and other PHP files"}</span>
          </button>`,
          )
          .join("")}
      </div>
      <div class="form-hint" style="margin-top:8px;">You get an empty <code>public_html</code> folder — upload with the File Manager (drag a .zip in and extract) or SFTP.</div>`;
  } else {
    body = `
      <div class="form-group" style="max-width:420px;margin-bottom:0;">
        <label class="form-label">App port or URL</label>
        <input class="form-input mono-input" placeholder="8080  or  http://127.0.0.1:8080" value="${escapeHtml(ns.proxyTarget)}" oninput="ns.proxyTarget=this.value.trim();nsRenderSummary()">
        <div class="form-hint">For apps the panel doesn't run itself, e.g. a Docker container. WebSockets and streaming work.</div>
      </div>
      <div class="form-group" style="max-width:560px;margin:16px 0 0;">
        <label class="form-label">App folder <span class="muted" style="font-weight:400;">(optional)</span></label>
        <input class="form-input mono-input" placeholder="/opt/my-app" value="${escapeHtml(ns.proxyPath)}" oninput="ns.proxyPath=this.value.trim();nsRenderDbSection();nsRenderSummary()">
        <div class="form-hint">Where the app's code or <code>docker-compose.yml</code> lives. With a folder you can edit its <code>.env</code>, back it up, link a database, open it in Files and Terminal, and deploy. An existing folder is used as it is — if it's a Git checkout, deployments pull its branch.</div>
      </div>
      <details class="advanced" ${ns.proxyGit || ns.proxyScript ? "open" : ""} style="max-width:640px;">
        <summary>${Icons.get("rocket", { size: 14 })}Deploy settings <span class="muted" style="font-weight:400;">— optional</span></summary>
        <div class="field-row" style="grid-template-columns:minmax(0,3fr) minmax(0,1fr);">
          <div class="form-group"><label class="form-label">Clone from Git</label>
            <input class="form-input mono-input" placeholder="https://github.com/you/app.git" value="${escapeHtml(ns.proxyGit)}" oninput="ns.proxyGit=this.value.trim();nsRenderDbSection();nsRenderSummary()"></div>
          <div class="form-group"><label class="form-label">Branch</label>
            <input class="form-input mono-input" value="${escapeHtml(ns.proxyBranch)}" oninput="ns.proxyBranch=this.value.trim()"></div>
        </div>
        <div class="form-hint" style="margin:-6px 0 12px;">Cloned into the app folder (default <code>${escapeHtml((ns.suggest?.sitesRoot || "/var/www") + "/" + (ns.name || "name"))}</code>). Leave empty to use an existing folder.</div>
        <div class="form-group"><label class="form-label">Deploy script <span class="muted" style="font-weight:400;">(runs in the app folder on every deploy)</span></label>
          <textarea class="form-textarea textarea-code" rows="3" placeholder="docker compose up -d --build" oninput="ns.proxyScript=this.value">${escapeHtml(ns.proxyScript)}</textarea>
          <div class="form-hint">Leave empty to use <code>docker compose up -d --build</code> when the folder has a compose file.</div></div>
      </details>`;
  }
  el.innerHTML = `<div class="wizard-step-title"><span class="wizard-step-num">2</span>${ns.source === "git" ? "Repository" : ns.source === "wordpress" ? "WordPress" : ns.source === "empty" ? "Website files" : "Target app"}</div>${body}`;

  const git = document.getElementById("ns-git");
  if (git) {
    git.addEventListener("input", () => {
      ns.gitUrl = git.value.trim();
      nsSuggestNames();
      nsRenderSummary();
    });
    git.addEventListener("change", () => nsInspect());
    git.addEventListener("paste", () => setTimeout(() => nsInspect(), 50));
  }
}

async function nsInspect(keepBranch = false) {
  if (!ns.gitUrl) return;
  const url = ns.gitUrl;
  ns.inspect = { loading: true };
  nsRenderSourceSection();
  try {
    const data = await api.inspectRepo(url, keepBranch ? ns.branch : undefined);
    if (url !== ns.gitUrl) return;
    ns.inspect = { data };
    ns.branches = data.branches || [];
    ns.branch = data.branch || ns.branch || "main";
    if (data.stack) ns.type = data.stack;
    if (!ns.scriptTouched) ns.deployScript = data.deployScript || "";
    if (!ns.startTouched) ns.startCommand = data.startCommand || "";
    if (!ns.webRootTouched) ns.webRoot = data.webRoot || "";
    if (data.phpVersion && !ns.phpTouched) ns.phpVersion = data.phpVersion;
    if (!ns.dbTouched) ns.dbCreate = ns.type === "laravel";
  } catch (err) {
    if (url !== ns.gitUrl) return;
    ns.inspect = { error: err.message };
  }
  nsSuggestNames();
  nsRenderAll();
}

async function nsShowDeployKey() {
  const I = window.Icons;
  let key = await api.getDeployKey().catch(() => ({ exists: false }));
  const body = () =>
    key.exists
      ? `<p style="font-size:13px;color:var(--text-secondary);margin-bottom:10px;">Add this key to the repository as a <strong>deploy key</strong> (GitHub: Settings → Deploy keys → Add; read access is enough), then use the <strong>SSH</strong> URL, e.g. <code>git@github.com:you/app.git</code>.</p>
         <div class="secret-box" id="dk-key">${escapeHtml(key.publicKey)}</div>
         <div style="margin-top:10px;display:flex;gap:8px;">${UI.copyButton(key.publicKey, "Copy key")}<a class="btn btn-sm btn-secondary" href="#ssh-keys">${I.get("key", { size: 12 })}<span>SSH Keys page</span></a></div>`
      : `<p style="font-size:13px;color:var(--text-secondary);">This server has no SSH key yet. Generate one, then add it to your repository as a deploy key.</p>
         <button class="btn btn-primary" id="dk-gen">${I.get("key", { size: 13, color: "#fff" })}<span>Generate deploy key</span></button>`;
  const { overlay } = Modal.show(
    "Deploy key for private repositories",
    `<div id="dk-body">${body()}</div>`,
    { width: 640 },
  );
  const wire = () =>
    overlay.querySelector("#dk-gen")?.addEventListener("click", async () => {
      try {
        key = await api.generateDeployKey();
        overlay.querySelector("#dk-body").innerHTML = body();
        wire();
      } catch (err) {
        toast.error("Failed", err.message);
      }
    });
  wire();
}

// ── Section 3: domain ───────────────────────────────────────

function nsRenderDomainSection() {
  const el = document.getElementById("ns-domain-section");
  if (!el) return;
  const I = window.Icons;
  const optional = ns.source === "git";
  const dns = ns.dns;
  let dnsHtml = "";
  if (ns.domain && dns?.loading)
    dnsHtml = `<div class="inline-status"><span class="spinner spinner-sm"></span> Checking DNS…</div>`;
  else if (ns.domain && dns?.data) {
    const d = dns.data;
    dnsHtml = d.pointsHere
      ? `<div class="inline-status ok">${I.get("checkCircle", { size: 13 })}<span>Points to this server (${escapeHtml([...d.a, ...d.aaaa].join(", "))}) — HTTPS can be issued right away</span></div>`
      : d.resolves
        ? `<div class="inline-status warn">${I.get("alertTriangle", { size: 13 })}<span>Points to ${escapeHtml([...d.a, ...d.aaaa].join(", "))}, not this server (${escapeHtml(d.serverIps.filter((ip) => !ip.includes(":")).join(", ") || d.serverIps[0] || "?")}). Update the A record, or enable HTTPS later.</span></div>`
        : `<div class="inline-status warn">${I.get("alertTriangle", { size: 13 })}<span>No DNS record yet — create an A record pointing to ${escapeHtml(d.serverIps.filter((ip) => !ip.includes(":"))[0] || "this server")}.</span></div>`;
  }
  el.innerHTML = `
    <div class="wizard-step-title"><span class="wizard-step-num">3</span>Domain${optional ? ' <span class="muted" style="font-weight:500;font-size:12px;">optional — an app can run without one and get it later</span>' : ""}</div>
    <div class="field-row" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);">
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label">Domain</label>
        <input class="form-input" id="ns-domain" placeholder="example.com or app.example.com" value="${escapeHtml(ns.domain)}" autocomplete="off">
        ${dnsHtml}
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label">Extra domains</label>
        <input class="form-input" placeholder="shop.example.com example.net" value="${escapeHtml(ns.aliases)}" oninput="ns.aliases=this.value">
      </div>
    </div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:12px;">
      <label class="form-check"><input type="checkbox" ${ns.www ? "checked" : ""} onchange="ns.www=this.checked;nsRenderSummary()"><span style="font-size:13px;">Also answer on <strong>www.</strong>${escapeHtml(ns.domain.replace(/^www\./, "") || "example.com")}</span></label>
      <label class="form-check"><input type="checkbox" ${ns.ssl ? "checked" : ""} onchange="ns.ssl=this.checked;ns.sslTouched=true;nsRenderSummary()"><span style="font-size:13px;">Enable HTTPS (free Let's Encrypt certificate)</span></label>
    </div>`;
  const input = document.getElementById("ns-domain");
  const check = UI.debounce(async () => {
    const domain = ns.domain;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return;
    ns.dns = { loading: true };
    try {
      const data = await api.checkDns(domain);
      if (domain !== ns.domain) return;
      ns.dns = { data };
      if (!ns.sslTouched) ns.ssl = data.pointsHere;
    } catch {
      ns.dns = null;
    }
    nsRenderDomainSection();
    nsRenderSummary();
  }, 600);
  input.addEventListener("input", () => {
    ns.domain = input.value.trim().toLowerCase();
    ns.dns = null;
    nsSuggestNames();
    nsRenderSummary();
    check();
  });
  input.addEventListener("blur", () => nsRenderDomainSection());
}

// ── Section 4: name, folder, port, PHP, build ───────────────

const nsSuggestNames = UI.debounce(async () => {
  const repo = ns.gitUrl
    ? ns.gitUrl
        .replace(/\.git$/, "")
        .split(/[/:]/)
        .pop()
    : "";
  const base = ns.domain || repo;
  if (!ns.nameTouched) ns.name = nsSlug(base);
  const root = ns.suggest?.sitesRoot || "/var/www";
  if (!ns.pathTouched) ns.deployPath = ns.name ? `${root}/${ns.name}` : "";
  try {
    const s = await api.suggestSite({
      ...(ns.nameTouched ? { name: ns.name } : { domain: ns.domain, repo }),
      type: nsType(),
    });
    if (!ns.nameTouched && ns.name) ns.name = s.name;
    if (!ns.pathTouched && ns.name) ns.deployPath = `${s.sitesRoot}/${ns.name}`;
    if (!ns.portTouched && s.port) ns.port = String(s.port);
    ns.suggest = { ...ns.suggest, ...s };
  } catch {}
  nsFillAutoFields();
  nsRenderSummary();
}, 350);

/**
 * Update auto-filled inputs in place (without re-rendering what the user is typing in).
 */
function nsFillAutoFields() {
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = value;
  };
  if (!ns.nameTouched) set("ns-name", ns.name);
  if (!ns.pathTouched) set("ns-path", ns.deployPath);
  if (!ns.portTouched) set("ns-port", ns.port);
}

function nsRenderSettingsSection() {
  const el = document.getElementById("ns-settings-section");
  if (!el) return;
  const type = nsType();
  const process = PROCESS_STACKS.has(type);
  const php = PHP_STACKS.has(type);
  const versions = ns.suggest?.phpVersions || [];
  const auto = (touched) =>
    touched ? "" : '<span class="auto-tag">auto</span>';
  const phpField = php
    ? versions.length
      ? `<div class="form-group"><label class="form-label">PHP version${ns.inspect?.data?.phpConstraint ? `<span class="auto-tag">${escapeHtml(ns.inspect.data.phpConstraint)}</span>` : auto(false)}</label>
          <select class="form-select" onchange="ns.phpVersion=this.value;ns.phpTouched=true">${versions.map((v) => `<option value="${v}" ${v === ns.phpVersion ? "selected" : ""}>PHP ${v}</option>`).join("")}</select></div>`
      : `<div class="form-group"><label class="form-label">PHP version</label><div class="alert alert-warning" style="font-size:12px;padding:8px 10px;">No PHP installed yet. <a href="#php" style="text-decoration:underline;margin-left:4px;">Install PHP first</a></div></div>`
    : "";
  const webRootField =
    ns.source === "git" && WEBROOT_STACKS.has(type)
      ? `<div class="form-group"><label class="form-label">Web root (folder to serve)${ns.webRootTouched ? "" : '<span class="auto-tag">auto</span>'}</label>
          <input class="form-input mono-input" placeholder="(repository root)" value="${escapeHtml(ns.webRoot)}" oninput="ns.webRoot=this.value.trim();ns.webRootTouched=true">
          <div class="form-hint">${type === "react" ? "Build output: dist (Vite) or build (Create React App)" : "Leave empty to serve the repository root"}</div></div>`
      : "";
  const showBuild = ns.source === "git";
  el.innerHTML = `
    <div class="wizard-step-title"><span class="wizard-step-num">4</span>Name &amp; location</div>
    <div class="field-row">
      <div class="form-group"><label class="form-label">Website name${auto(ns.nameTouched)}</label>
        <input class="form-input mono-input" id="ns-name" value="${escapeHtml(ns.name)}" placeholder="my-site" oninput="ns.name=this.value.trim().toLowerCase();ns.nameTouched=!!ns.name;if(!ns.pathTouched){ns.deployPath=(ns.suggest?.sitesRoot||'/var/www')+'/'+ns.name;nsFillAutoFields();}nsRenderSummary()">
        <div class="form-hint">Used for the folder, PM2 process, nginx config and backups</div></div>
      ${
        ns.source === "proxy"
          ? ""
          : `<div class="form-group"><label class="form-label">Folder${auto(ns.pathTouched)}</label>
        <input class="form-input mono-input" id="ns-path" value="${escapeHtml(ns.deployPath)}" placeholder="/var/www/my-site" oninput="ns.deployPath=this.value.trim();ns.pathTouched=!!ns.deployPath;nsRenderSummary()"></div>`
      }
      ${
        process
          ? `<div class="form-group"><label class="form-label">Port${auto(ns.portTouched)}</label>
        <input class="form-input mono-input" id="ns-port" value="${escapeHtml(ns.port)}" placeholder="3000" oninput="ns.port=this.value.trim();ns.portTouched=!!ns.port;nsRenderSummary()">
        <div class="form-hint">A free port, passed to the app as <code>PORT</code>; nginx proxies the domain to it</div></div>`
          : ""
      }
      ${phpField}
      ${webRootField}
    </div>
    ${
      showBuild
        ? `<details class="advanced" ${ns.inspect?.error ? "open" : ""}>
        <summary>${Icons.get("sliders", { size: 14 })}Build &amp; start commands ${ns.inspect?.data ? '<span class="auto-tag">detected</span>' : '<span class="muted" style="font-weight:400;">— detected from the repository</span>'}</summary>
        <div class="form-group"><label class="form-label">Deploy script <span class="muted" style="font-weight:400;">(runs in the website folder on every deploy)</span></label>
          <textarea class="form-textarea textarea-code" rows="5" placeholder="Detected after checking the repository, e.g.&#10;npm ci&#10;npm run build" oninput="ns.deployScript=this.value;ns.scriptTouched=true">${escapeHtml(ns.deployScript)}</textarea></div>
        ${process ? `<div class="form-group"><label class="form-label">Start command</label><input class="form-input mono-input" value="${escapeHtml(ns.startCommand)}" placeholder="npm start" oninput="ns.startCommand=this.value;ns.startTouched=true"></div>` : ""}
        <div class="form-group"><label class="form-label">Environment variables <span class="muted" style="font-weight:400;">(written to .env — one KEY=value per line)</span></label>
          <textarea class="form-textarea textarea-code" rows="3" placeholder="API_URL=https://api.example.com" oninput="ns.env=this.value">${escapeHtml(ns.env)}</textarea></div>
      </details>`
        : ""
    }`;
}

// ── Section 5: database ─────────────────────────────────────

function nsRenderDbSection() {
  const el = document.getElementById("ns-db-section");
  if (!el) return;
  const type = nsType();
  const proxyFolder = type === "proxy" && !!(ns.proxyPath || ns.proxyGit);
  if (
    (type === "proxy" && !proxyFolder) ||
    type === "static" ||
    type === "react"
  ) {
    el.innerHTML = "";
    return;
  }
  const connected = ns.suggest?.tools?.mysql;
  const required = type === "wordpress";
  el.innerHTML = `
    <div class="wizard-step-title"><span class="wizard-step-num">5</span>Database</div>
    ${
      connected === false
        ? `<div class="alert alert-info" style="font-size:13px;">${Icons.get("info", { size: 15 })}<div style="flex:1;">The database server isn't connected yet. <a href="#databases" style="text-decoration:underline;">Set up MySQL/MariaDB</a>${required ? " — WordPress needs it." : ", or add a database to this website later."}</div></div>`
        : `<label class="option-row" style="max-width:640px;">
        <input type="checkbox" ${ns.dbCreate || required ? "checked" : ""} ${required ? "disabled" : ""} onchange="ns.dbCreate=this.checked;ns.dbTouched=true;nsRenderDbSection();nsRenderSummary()">
        <span><span class="option-label">Create a MySQL database and user for this website</span>
        <span class="option-hint">Name and a strong password are generated; backups include the database automatically.</span></span>
      </label>
      ${
        (ns.dbCreate || required) && type !== "wordpress"
          ? `<label class="form-check" style="margin-top:10px;"><input type="checkbox" ${ns.writeEnv ? "checked" : ""} onchange="ns.writeEnv=this.checked"><span style="font-size:13px;">Write the credentials to <code>.env</code> (${type === "laravel" ? "DB_DATABASE, DB_USERNAME, DB_PASSWORD…" : "DATABASE_URL, DB_HOST, DB_NAME…"})</span></label>`
          : ""
      }`
    }`;
}

// ── Summary & create ────────────────────────────────────────

function nsRenderSummary() {
  const el = document.getElementById("ns-summary");
  if (!el) return;
  const type = nsType();
  const chips = [UI.stack(type).label];
  if (ns.domain) chips.push(`${ns.ssl ? "https" : "http"}://${ns.domain}`);
  if (ns.deployPath && ns.source !== "proxy") chips.push(ns.deployPath);
  if (ns.source === "proxy" && ns.proxyPath) chips.push(ns.proxyPath);
  if (ns.source === "proxy" && ns.proxyGit) chips.push("from Git");
  if (PROCESS_STACKS.has(type) && ns.port) chips.push(`port ${ns.port}`);
  if (PHP_STACKS.has(type) && ns.phpVersion) chips.push(`PHP ${ns.phpVersion}`);
  if (ns.dbCreate || type === "wordpress") chips.push("+ database");
  el.innerHTML = chips.map((c) => `<span>${escapeHtml(c)}</span>`).join("");
}

async function nsCreate() {
  const type = nsType();
  if (ns.source === "git" && !ns.gitUrl)
    return toast.error(
      "Repository missing",
      "Enter the Git URL of your project",
    );
  if (ns.source !== "git" && !ns.domain)
    return toast.error("Domain missing", "Enter the domain for this website");
  const payload = {
    source: ns.source,
    type,
    name: ns.name || undefined,
    deployPath:
      (ns.source === "proxy" ? ns.proxyPath : ns.deployPath) || undefined,
    domains: [ns.domain, ...ns.aliases.split(/[\s,]+/)].filter(Boolean),
    www: ns.www,
    ssl: ns.ssl,
  };
  if (ns.source === "git") {
    Object.assign(payload, {
      gitUrl: ns.gitUrl,
      branch: ns.branch || "main",
      env: ns.env,
    });
    if (ns.deployScript.trim()) payload.deployScript = ns.deployScript;
    if (ns.startCommand.trim()) payload.startCommand = ns.startCommand.trim();
    if (WEBROOT_STACKS.has(type))
      payload.webRoot =
        ns.webRootTouched || ns.inspect?.data ? ns.webRoot : "auto";
  }
  if (PROCESS_STACKS.has(type)) payload.port = ns.port || undefined;
  if (PHP_STACKS.has(type)) payload.phpVersion = ns.phpVersion || undefined;
  if (ns.source === "proxy") {
    payload.proxyTarget = ns.proxyTarget;
    if (ns.proxyGit)
      Object.assign(payload, {
        gitUrl: ns.proxyGit,
        branch: ns.proxyBranch || "main",
      });
    if (ns.proxyScript.trim()) payload.deployScript = ns.proxyScript;
  }
  if (type === "wordpress")
    payload.wordpress = {
      title: ns.wpTitle || ns.domain,
      adminUser: ns.wpUser,
      adminEmail: ns.wpEmail,
      adminPassword: ns.wpPassword,
    };
  payload.database = {
    create: ns.dbCreate || type === "wordpress",
    writeEnv: ns.writeEnv,
  };

  const btn = document.getElementById("ns-create");
  btn.disabled = true;
  btn.innerHTML =
    '<span class="spinner spinner-sm"></span><span>Creating…</span>';
  try {
    const res = await api.createSite(payload);
    nsShowProgress(res);
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = `${Icons.get("rocket", { size: 14, color: "#fff" })}<span>Create website</span>`;
    toast.error("Could not create the website", err.message);
  }
}

function nsShowProgress(res) {
  const I = window.Icons;
  const { site, jobId, wordpress } = res;
  window.app.setTitle(`Setting up ${site.name}`);
  document.getElementById("ns-body").innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">${UI.stackAvatar(site.type, "sm")}<span>Setting up ${escapeHtml(site.name)}</span></h3>
        <a class="btn btn-sm btn-secondary" href="#site/${site.id}">Open website page ${I.get("arrowRight", { size: 12 })}</a>
      </div>
      <div class="card-body">
        <div id="ns-done"></div>
        <div id="ns-console"></div>
      </div>
    </div>`;
  JobConsole.attach(document.getElementById("ns-console"), jobId, {
    showCancel: true,
    onDone: async (job) => {
      const done = document.getElementById("ns-done");
      if (!done) return;
      const detail = await api.getSite(site.id).catch(() => null);
      const ok = job.status === "completed";
      const url = detail?.url;
      window.app.setTitle(
        ok ? `${site.name} is ready` : `Setup of ${site.name} stopped`,
      );
      done.innerHTML = ok
        ? `<div class="alert alert-success" style="margin-bottom:14px;">${I.get("checkCircle", { size: 18 })}<div style="flex:1;"><strong>${escapeHtml(site.name)} is ready.</strong>${url ? ` It answers on <a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="text-decoration:underline;">${escapeHtml(url)}</a>${url.startsWith("http:") ? " (point the DNS here, then enable HTTPS on the Domains tab)" : ""}.` : " Add a domain on the Domains tab when you're ready."}</div>
            ${url ? `<a class="btn btn-sm btn-secondary" href="${escapeHtml(url)}" target="_blank" rel="noopener">${I.get("externalLink", { size: 12 })}<span>Visit</span></a>` : ""}
            <a class="btn btn-sm btn-primary" href="#site/${site.id}">Manage ${I.get("arrowRight", { size: 12, color: "#fff" })}</a></div>
           ${wordpress ? `<div class="alert alert-info" style="margin-bottom:14px;">${I.get("key", { size: 16 })}<div style="flex:1;">WordPress admin: <a href="${escapeHtml((url || "") + "/wp-admin")}" target="_blank" rel="noopener" style="text-decoration:underline;">${escapeHtml((url || "") + "/wp-admin")}</a> — user <code>${escapeHtml(wordpress.adminUser)}</code>, password <code>${escapeHtml(wordpress.adminPassword)}</code>. Save it now.</div>${UI.copyButton(wordpress.adminPassword, "Copy password")}</div>` : ""}`
        : `<div class="alert alert-danger" style="margin-bottom:14px;">${I.get("alertCircle", { size: 18 })}<div style="flex:1;"><strong>Setup stopped.</strong> Check the log below, fix the cause (e.g. repository access, build errors), then retry — finished steps are skipped.</div>
            <button class="btn btn-sm btn-primary" onclick="nsRetry('${site.id}')">${I.get("refresh", { size: 12, color: "#fff" })}<span>Retry setup</span></button>
            <a class="btn btn-sm btn-secondary" href="#site/${site.id}/settings">Settings</a></div>`;
    },
  });
}

async function nsRetry(id) {
  try {
    const { jobId } = await api.retrySiteSetup(id);
    const site = await api.getSite(id);
    nsShowProgress({ site, jobId });
  } catch (err) {
    toast.error("Retry failed", err.message);
  }
}

window.renderSiteNew = renderSiteNew;
