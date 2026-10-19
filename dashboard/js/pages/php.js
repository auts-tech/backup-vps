/**
 * PHP Manager — install multiple PHP-FPM versions, extensions, php.ini, default CLI
 */
let phpState = { data: null };

function renderPhp(container) {
  const I = window.Icons;
  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>PHP &amp; Composer</h2>
          <p>Run several PHP versions side by side — each website picks its own on its PHP tab — plus Composer for PHP dependencies.</p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" onclick="loadPhp()">${I.get("refresh", { size: 13 })}<span>Refresh</span></button>
          <button class="btn btn-primary" onclick="showInstallPhpModal()">${I.get("plus", { size: 13, color: "#fff" })}<span>Install PHP Version</span></button>
        </div>
      </div>
      <div id="php-repo-area"></div>
      <div id="php-versions"><div class="spinner"></div></div>
      <div id="php-composer" style="margin-top:24px;"></div>
    </div>
  `;
  loadPhp().then(loadComposer);
}

async function loadPhp() {
  const wrap = document.getElementById("php-versions");
  if (!wrap) return;
  const I = window.Icons;
  try {
    const data = await api.getPhp();
    phpState.data = data;
    const repo = document.getElementById("php-repo-area");
    if (!data.repo.supported) {
      repo.innerHTML = `<div class="alert alert-warning" style="margin-bottom:20px;">${I.get("alertTriangle", { size: 16 })}<div>PHP management needs Ubuntu or Debian (apt). This server reports <strong>${escapeHtml(data.repo.distro)}</strong>.</div></div>`;
    } else if (!data.repo.configured) {
      repo.innerHTML = `
        <div class="alert alert-info" style="margin-bottom:20px;">
          ${I.get("info", { size: 16 })}
          <div style="flex:1;">Add the <strong>${data.repo.distro === "ubuntu" ? "ondrej/php PPA" : "packages.sury.org"}</strong> repository to install any PHP version (5.6 – 8.x). Without it, only the distribution's default PHP is available.</div>
          <button class="btn btn-sm btn-primary" onclick="JobConsole.run(api.addPhpRepo(), 'Add PHP repository', { onDone: loadPhp })">Add Repository</button>
        </div>`;
    } else {
      repo.innerHTML = "";
    }

    if (!data.versions.length) {
      wrap.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-state-icon">${I.get("code", { size: 20 })}</div><div class="empty-state-title">No PHP installed</div><div class="empty-state-desc">Install a PHP version to host PHP, Laravel or WordPress sites.</div><button class="btn btn-primary" onclick="showInstallPhpModal()">Install PHP</button></div></div>`;
      return;
    }

    wrap.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;">${data.versions
      .map(
        (v) => `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">${I.get("code", { size: 16 })}<span>PHP ${escapeHtml(v.fullVersion)}</span></h3>
          <div style="display:flex;gap:6px;">
            ${data.defaultCli === v.version ? '<span class="badge badge-info">CLI default</span>' : ""}
            ${v.fpmInstalled ? `<span class="badge ${v.running ? "badge-success" : "badge-danger"}"><span class="badge-dot"></span>FPM ${v.running ? "running" : "stopped"}</span>` : '<span class="badge badge-neutral">no FPM</span>'}
          </div>
        </div>
        <div class="card-body">
          <dl class="kv" style="margin-bottom:14px;">
            <dt>Socket</dt><dd class="mono-sm">${escapeHtml(v.socket)}</dd>
            <dt>Websites</dt><dd>${v.sites.length ? escapeHtml(v.sites.join(", ")) : '<span class="muted">none</span>'}</dd>
            <dt>Extensions</dt><dd style="font-weight:400;font-size:12px;color:var(--text-secondary);">${escapeHtml(v.extensions.slice(0, 40).join(", "))}${v.extensions.length > 40 ? "…" : ""}</dd>
          </dl>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            <button class="btn btn-sm btn-secondary" onclick="showPhpIniModal(${jsArg(v.version)})">${I.get("settings", { size: 12 })}<span>php.ini</span></button>
            <button class="btn btn-sm btn-secondary" onclick="showPhpExtensionsModal(${jsArg(v.version)})">${I.get("package", { size: 12 })}<span>Extensions</span></button>
            ${v.fpmInstalled ? `<button class="btn btn-sm btn-secondary" onclick="phpControl(${jsArg(v.version)}, '${v.running ? "restart" : "start"}')">${I.get(v.running ? "refresh" : "play", { size: 12 })}<span>${v.running ? "Restart FPM" : "Start FPM"}</span></button>` : ""}
            ${data.defaultCli !== v.version && v.cliInstalled ? `<button class="btn btn-sm btn-secondary" onclick="phpSetDefault(${jsArg(v.version)})">Make CLI default</button>` : ""}
            ${v.poolConf ? `<button class="btn btn-sm btn-secondary" onclick="phpEditFile(${jsArg(v.poolConf)}, 'FPM pool')">${I.get("edit", { size: 12 })}<span>FPM pool</span></button>` : ""}
            <button class="btn btn-sm btn-danger" onclick="phpUninstall(${jsArg(v.version)}, ${v.sites.length})">${I.get("trash", { size: 12 })}</button>
          </div>
        </div>
      </div>`,
      )
      .join("")}</div>`;
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

async function showInstallPhpModal() {
  const I = window.Icons;
  const { overlay, close } = Modal.show(
    "Install PHP Version",
    '<div class="spinner"></div>',
  );
  const body = overlay.querySelector(".modal-body");
  try {
    const { versions, installed } = await api.getPhpAvailable();
    const available = versions.filter((v) => !installed.includes(v));
    const exts = phpState.data?.defaultExtensions || [];
    if (!available.length) {
      body.innerHTML = `<p style="font-size:13px;">${versions.length ? "All available versions are already installed." : "No PHP versions found in apt."} ${phpState.data?.repo?.configured ? "" : "Add the PHP repository first to get every version."}</p>`;
      return;
    }
    body.innerHTML = `
      <div class="form-group">
        <label class="form-label">Version</label>
        <select id="php-install-version" class="form-select">${available.map((v) => `<option value="${v}">PHP ${v}</option>`).join("")}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Extensions (installed if available for this version)</label>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
          ${exts
            .filter((e) => !["cli", "fpm", "common"].includes(e))
            .map(
              (e) =>
                `<label class="form-check"><input type="checkbox" class="php-ext" value="${e}" checked><span style="font-size:12px;">${e}</span></label>`,
            )
            .join("")}
        </div>
        <div class="form-hint">cli, fpm and common are always installed. Add more later from “Extensions”.</div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button class="btn btn-primary" id="php-install-go">${I.get("download", { size: 13, color: "#fff" })}<span>Install</span></button>
      </div>`;
    body.querySelector("#php-install-go").addEventListener("click", () => {
      const version = body.querySelector("#php-install-version").value;
      const extensions = [...body.querySelectorAll(".php-ext:checked")].map(
        (c) => c.value,
      );
      close();
      JobConsole.run(
        api.installPhp(version, extensions),
        `Install PHP ${version}`,
        { onDone: loadPhp },
      );
    });
  } catch (err) {
    body.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

async function showPhpExtensionsModal(version) {
  const { overlay } = Modal.show(
    `Extensions — PHP ${escapeHtml(version)}`,
    '<div class="spinner"></div>',
    { width: 720 },
  );
  const body = overlay.querySelector(".modal-body");
  try {
    const { extensions } = await api.getPhpExtensions(version);
    body.innerHTML = `
      <input type="text" class="form-input" placeholder="Filter extensions…" style="margin-bottom:12px;" oninput="document.querySelectorAll('.php-ext-row').forEach(r => r.style.display = r.dataset.name.includes(this.value.toLowerCase()) ? '' : 'none')">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px;max-height:55vh;overflow:auto;">
        ${
          extensions
            .map(
              (e) => `
          <div class="php-ext-row" data-name="${escapeHtml(e.name)}" style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border:1px solid var(--border-primary);border-radius:var(--radius-sm);">
            <span class="mono-sm" style="color:var(--text-primary);">${escapeHtml(e.name)}</span>
            ${
              e.installed
                ? `<button class="btn btn-sm btn-danger" onclick="phpExtension(${jsArg(version)}, ${jsArg(e.name)}, 'remove')">Remove</button>`
                : `<button class="btn btn-sm btn-secondary" onclick="phpExtension(${jsArg(version)}, ${jsArg(e.name)}, 'install')">Install</button>`
            }
          </div>`,
            )
            .join("") ||
          '<p class="muted">No extension packages found in apt for this version.</p>'
        }
      </div>`;
  } catch (err) {
    body.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

function phpExtension(version, name, action) {
  Modal.closeAll();
  JobConsole.run(
    api.phpExtension(version, name, action),
    `${action === "install" ? "Install" : "Remove"} php${version}-${name}`,
    { onDone: loadPhp },
  );
}

async function showPhpIniModal(version, sapi = "fpm") {
  try {
    const res = await api.getPhpIni(version, sapi);
    const hints = {
      memory_limit: "e.g. 256M",
      upload_max_filesize: "e.g. 64M",
      post_max_size: "≥ upload size",
      max_execution_time: "seconds",
      max_input_time: "seconds",
      max_input_vars: "e.g. 3000",
      display_errors: "Off in production",
      error_reporting: "E_ALL & ~E_DEPRECATED & ~E_STRICT",
      "date.timezone": "e.g. Europe/London",
      short_open_tag: "Off",
      allow_url_fopen: "On/Off",
    };
    Modal.show(
      `php.ini — PHP ${escapeHtml(version)} (${sapi.toUpperCase()})`,
      `
      <div class="tabs" style="margin-bottom:14px;">
        <button class="tab ${sapi === "fpm" ? "active" : ""}" onclick="Modal.closeAll(); showPhpIniModal(${jsArg(version)}, 'fpm')">FPM (websites)</button>
        <button class="tab ${sapi === "cli" ? "active" : ""}" onclick="Modal.closeAll(); showPhpIniModal(${jsArg(version)}, 'cli')">CLI (cron, artisan)</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;">
        ${Object.entries(res.settings)
          .map(
            ([k, v]) => `
          <div class="form-group" style="margin-bottom:6px;">
            <label class="form-label mono-sm" style="color:var(--text-primary);">${escapeHtml(k)}</label>
            <input type="text" class="form-input mono-input php-ini-field" data-key="${escapeHtml(k)}" value="${escapeHtml(v)}" placeholder="${escapeHtml(hints[k] || "")}">
          </div>`,
          )
          .join("")}
      </div>
      <div class="form-hint" style="margin-top:6px;">${escapeHtml(res.path)} · <a style="cursor:pointer;text-decoration:underline;" onclick="Modal.closeAll(); phpEditFile(${jsArg(res.path)}, 'php.ini')">edit the full file</a></div>
    `,
      {
        submitText: sapi === "fpm" ? "Save & Restart FPM" : "Save",
        width: 680,
        onSubmit: async (overlay) => {
          const settings = {};
          overlay.querySelectorAll(".php-ini-field").forEach((i) => {
            if (i.value.trim() !== (res.settings[i.dataset.key] || ""))
              settings[i.dataset.key] = i.value.trim();
          });
          if (!Object.keys(settings).length) return;
          await api.savePhpIni(version, sapi, settings);
          toast.success(
            "php.ini saved",
            `PHP ${version} ${sapi.toUpperCase()}`,
          );
        },
      },
    );
  } catch (err) {
    toast.error("Failed", err.message);
  }
}

async function phpEditFile(path, label) {
  try {
    const file = await api.readFile(path);
    const version = (path.match(/\/etc\/php\/([\d.]+)\//) || [])[1];
    CodeEditor.open({
      title: `${label} — PHP ${version}`,
      subtitle: `${path} — PHP-FPM restarts after saving`,
      path,
      mode: "ini",
      content: file.content,
      onSave: async (content) => {
        await api.writeFile(path, content);
        if (version && path.includes("/fpm/"))
          await api.phpControl(version, "restart");
        toast.success("Saved", path);
      },
    });
  } catch (err) {
    toast.error("Failed", err.message);
  }
}

async function phpControl(version, action) {
  try {
    await api.phpControl(version, action);
    toast.success(`PHP ${version} FPM`, `${action} completed`);
  } catch (err) {
    Modal.show(
      "PHP-FPM",
      `<pre class="job-output">${escapeHtml(err.message)}</pre>`,
    );
  }
  loadPhp();
}

async function phpSetDefault(version) {
  try {
    await api.setPhpDefault(version);
    toast.success("CLI default changed", `php → PHP ${version}`);
  } catch (err) {
    toast.error("Failed", err.message);
  }
  loadPhp();
}

function phpUninstall(version, siteCount) {
  Modal.confirm(
    `Uninstall PHP ${escapeHtml(version)}`,
    `${siteCount ? `<strong style="color:var(--color-red);">${siteCount} website(s) use this version and will stop working</strong> until switched to another version.<br><br>` : ""}All php${escapeHtml(version)}-* packages will be removed.`,
    async () => {
      JobConsole.run(api.uninstallPhp(version), `Uninstall PHP ${version}`, {
        onDone: loadPhp,
      });
    },
  );
}

// ── Composer ────────────────────────────────────────────────

const COMPOSER_LABELS = {
  install: "Install dependencies from composer.lock",
  update: "Update dependencies to the newest allowed versions",
  require: "Add a package",
  remove: "Remove a package",
  "dump-autoload": "Regenerate the autoloader",
  validate: "Check composer.json",
  diagnose: "Diagnose Composer setup",
};

async function loadComposer() {
  const el = document.getElementById("php-composer");
  if (!el) return;
  const I = window.Icons;
  const [status, sites] = await Promise.all([
    api.getComposer().catch((err) => ({ error: err.message })),
    api.getSites().catch(() => ({ sites: [] })),
  ]);
  if (status.error) {
    el.innerHTML = `<div class="alert alert-danger">${escapeHtml(status.error)}</div>`;
    return;
  }
  const phpSites = (sites.sites || []).filter(
    (s) => s.features?.php && s.deployPath,
  );
  const versions = (phpState.data?.versions || [])
    .filter((v) => v.cliInstalled)
    .map((v) => v.version);
  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">${I.get("package", { size: 16 })}<span>Composer</span>
          ${status.installed ? `<span class="badge badge-success">${escapeHtml(status.version || "installed")}</span>${status.phpVersion ? `<span class="badge badge-neutral">runs on PHP ${escapeHtml(status.phpVersion)}</span>` : ""}` : '<span class="badge badge-warning">not installed</span>'}
        </h3>
        <div style="display:flex;gap:6px;">
          ${
            status.installed
              ? `<button class="btn btn-sm btn-secondary" onclick="JobConsole.run(api.updateComposer(), 'Update Composer', { onDone: loadComposer })">${I.get("refresh", { size: 12 })}<span>Update Composer</span></button>`
              : `<button class="btn btn-sm btn-primary" onclick="JobConsole.run(api.installComposer(), 'Install Composer', { onDone: loadComposer })">${I.get("download", { size: 12, color: "#fff" })}<span>Install Composer</span></button>`
          }
        </div>
      </div>
      <div class="card-body">
        ${
          status.installed
            ? `<div class="field-row">
            <div class="form-group"><label class="form-label">Project</label>
              <select class="form-select" id="cmp-site" onchange="composerPickSite()">
                ${phpSites.map((s) => `<option value="${escapeHtml(s.deployPath)}" data-php="${escapeHtml(s.phpVersion || "")}">${escapeHtml(s.name)} — ${escapeHtml(s.deployPath)}</option>`).join("")}
                <option value="">Other folder…</option>
              </select></div>
            <div class="form-group" id="cmp-dir-group" style="${phpSites.length ? "display:none;" : ""}"><label class="form-label">Folder</label><input class="form-input mono-input" id="cmp-dir" placeholder="/var/www/my-app"></div>
            <div class="form-group"><label class="form-label">PHP version</label>
              <select class="form-select" id="cmp-php"><option value="default">Default CLI${phpState.data?.defaultCli ? ` (${escapeHtml(phpState.data.defaultCli)})` : ""}</option>${versions.map((v) => `<option value="${v}">PHP ${v}</option>`).join("")}</select></div>
          </div>
          <div class="field-row">
            <div class="form-group"><label class="form-label">Command</label>
              <select class="form-select" id="cmp-cmd" onchange="composerRenderFlags()">${Object.keys(
                status.commands,
              )
                .map(
                  (c) =>
                    `<option value="${c}">composer ${c} — ${escapeHtml(COMPOSER_LABELS[c] || "")}</option>`,
                )
                .join("")}</select></div>
            <div class="form-group" id="cmp-pkg-group" style="display:none;"><label class="form-label">Package(s)</label><input class="form-input mono-input" id="cmp-pkg" placeholder="laravel/sanctum  or  guzzlehttp/guzzle:^7.9"></div>
          </div>
          <div id="cmp-flags" style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px;"></div>
          <button class="btn btn-primary" onclick="composerRun()">${I.get("play", { size: 13, color: "#fff" })}<span>Run</span></button>
          <span class="form-hint" style="margin-left:8px;">Output appears live; new files get the folder's owner.</span>`
            : `<p style="font-size:13px;color:var(--text-secondary);">Composer installs PHP packages (Laravel needs it). It is downloaded from getcomposer.org with its checksum verified, and also installed automatically by the first deploy that uses it.</p>`
        }
      </div>
    </div>`;
  window.composerCommands = status.commands;
  if (status.installed) {
    composerPickSite();
    composerRenderFlags();
  }
}

function composerPickSite() {
  const sel = document.getElementById("cmp-site");
  if (!sel) return;
  document.getElementById("cmp-dir-group").style.display = sel.value
    ? "none"
    : "";
  const php = sel.selectedOptions[0]?.dataset.php;
  const phpSel = document.getElementById("cmp-php");
  if (php && [...phpSel.options].some((o) => o.value === php))
    phpSel.value = php;
}

function composerRenderFlags() {
  const cmd = document.getElementById("cmp-cmd").value;
  const defaults = {
    install: ["--no-dev", "--optimize-autoloader"],
    "dump-autoload": ["--optimize"],
  };
  document.getElementById("cmp-pkg-group").style.display = [
    "require",
    "remove",
  ].includes(cmd)
    ? ""
    : "none";
  document.getElementById("cmp-flags").innerHTML = (
    window.composerCommands[cmd] || []
  )
    .map(
      (f) =>
        `<label class="form-check"><input type="checkbox" class="cmp-flag" value="${f}" ${(defaults[cmd] || []).includes(f) ? "checked" : ""}><code>${f}</code></label>`,
    )
    .join("");
}

function composerRun() {
  const site = document.getElementById("cmp-site")?.value;
  const dir = site || document.getElementById("cmp-dir").value.trim();
  if (!dir)
    return toast.error("Folder missing", "Choose a project or enter a folder");
  const command = document.getElementById("cmp-cmd").value;
  const flags = [...document.querySelectorAll(".cmp-flag:checked")].map(
    (c) => c.value,
  );
  JobConsole.run(
    api.runComposer({
      dir,
      command,
      flags,
      version: document.getElementById("cmp-php").value,
      packageName: document.getElementById("cmp-pkg")?.value.trim(),
    }),
    `composer ${command}`,
  );
}

window.renderPhp = renderPhp;
