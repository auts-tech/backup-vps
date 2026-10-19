/**
 * Dashboard — websites at a glance, server resources, hosting tools, activity.
 */
function renderDashboard(container) {
  const I = window.Icons;

  container.innerHTML = `
    <div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-header"><span class="stat-title">Websites</span><div class="stat-icon-wrapper">${I.get("globe", { size: 16 })}</div></div>
          <div class="stat-value" id="dash-sites">—</div>
          <div class="stat-footer" id="dash-sites-foot">Websites and apps</div>
        </div>
        <div class="stat-card">
          <div class="stat-header"><span class="stat-title">Needs attention</span><div class="stat-icon-wrapper">${I.get("alertTriangle", { size: 16 })}</div></div>
          <div class="stat-value" id="dash-attention">—</div>
          <div class="stat-footer" id="dash-attention-foot">Stopped, crashed or failed deploys</div>
        </div>
        <div class="stat-card">
          <div class="stat-header"><span class="stat-title">Disk Usage</span><div class="stat-icon-wrapper">${I.get("hardDrive", { size: 16 })}</div></div>
          <div class="stat-value" id="dash-disk-usage">—</div>
          <div class="stat-footer" id="dash-disk-foot">Storage capacity used</div>
        </div>
        <div class="stat-card">
          <div class="stat-header"><span class="stat-title">System Uptime</span><div class="stat-icon-wrapper">${I.get("clock", { size: 16 })}</div></div>
          <div class="stat-value" id="dash-uptime" style="font-size:20px;">—</div>
          <div class="stat-footer" id="dash-host">Continuous server run time</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <h3 class="card-title">${I.get("globe", { size: 16 })}<span>Your websites</span></h3>
          <div style="display:flex;gap:6px;">
            <a class="btn btn-sm btn-secondary" href="#sites">View all</a>
            <a class="btn btn-sm btn-primary" href="#new-site">${I.get("plus", { size: 12, color: "#fff" })}<span>New website</span></a>
          </div>
        </div>
        <div id="dash-site-list"><div style="text-align:center;padding:24px;"><div class="spinner"></div></div></div>
      </div>

      <div class="card" style="margin-bottom:24px;">
        <div class="card-header"><h3 class="card-title">${I.get("grid", { size: 16 })}<span>Hosting Tools</span></h3></div>
        <div class="card-body">${renderToolGroups()}</div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(360px, 1fr));gap:20px;">
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("server", { size: 16 })}<span>Server Resources</span></h3><a class="btn btn-sm btn-secondary" href="#monitor">Monitor</a></div>
          <div class="card-body" id="dash-server-stats"><div style="text-align:center;padding:24px;"><div class="spinner"></div></div></div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("fileText", { size: 16 })}<span>Recent Activity</span></h3><button class="btn btn-sm btn-secondary" onclick="window.app.navigate('logs')">View All</button></div>
          <div class="card-body" style="padding:0;" id="dash-activity"><div style="text-align:center;padding:24px;"><div class="spinner"></div></div></div>
        </div>
      </div>
    </div>
  `;

  loadDashboardSites();
  loadDashboardData();
}

async function loadDashboardSites() {
  const I = window.Icons;
  const el = document.getElementById("dash-site-list");
  try {
    const { sites } = await api.getSites();
    const live = sites.filter((s) => s.health.state === "live").length;
    const attention = sites.filter(
      (s) =>
        ["error", "stopped"].includes(s.health.state) ||
        s.deploy.last?.status === "failed",
    );
    const expiring = sites.filter(
      (s) => s.ssl.enabled && s.ssl.daysLeft !== null && s.ssl.daysLeft < 14,
    ).length;
    const httpOnly = sites.filter(
      (s) => s.domains.length && !s.ssl.enabled,
    ).length;
    const set = (id, text) => {
      const node = document.getElementById(id);
      if (node) node.textContent = text;
    };
    set("dash-sites", sites.length);
    set(
      "dash-sites-foot",
      sites.length
        ? `${live} live${httpOnly ? ` · ${httpOnly} without HTTPS` : ""}`
        : "None yet — create one",
    );
    set("dash-attention", attention.length + expiring);
    set(
      "dash-attention-foot",
      attention.length || expiring
        ? [
            attention.length ? `${attention.length} website(s)` : null,
            expiring ? `${expiring} certificate(s) expiring` : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : "Everything looks fine",
    );
    if (!el) return;
    if (!sites.length) {
      el.innerHTML = UI.emptyState(
        "globe",
        "No websites yet",
        "Deploy an app from Git (Node.js, Next.js, React, Laravel, PHP…), install WordPress, or create an empty site.",
        `<a class="btn btn-primary" href="#new-site">${I.get("plus", { size: 13, color: "#fff" })}<span>Create a website</span></a>`,
      );
      return;
    }
    const order = {
      error: 0,
      stopped: 1,
      deploying: 2,
      live: 3,
      disabled: 4,
      idle: 5,
    };
    const shown = [...sites]
      .sort(
        (a, b) => (order[a.health.state] ?? 9) - (order[b.health.state] ?? 9),
      )
      .slice(0, 8);
    el.innerHTML = `
      <div class="table-container" style="border:none;border-radius:0;">
        <table class="table">
          <tbody>${shown
            .map(
              (s) => `
            <tr style="cursor:pointer;" onclick="window.app.navigate('site/${s.id}')">
              <td style="width:46px;">${UI.stackAvatar(s.type, "sm")}</td>
              <td><div style="font-weight:600;">${escapeHtml(s.name)}</div><div class="muted" style="font-size:12px;">${s.primaryDomain ? `${s.ssl.enabled ? I.get("lock", { size: 10 }) + " " : ""}${escapeHtml(s.primaryDomain)}` : "No domain"}</div></td>
              <td>${UI.healthPill(s.health)}</td>
              <td class="muted" style="font-size:12px;">${s.deploy.last ? `${s.deploy.last.status === "failed" ? '<span style="color:var(--color-red);">Deploy failed</span>' : "Deployed"} ${UI.timeAgo(s.deploy.last.finishedAt || s.deploy.last.startedAt)}` : "—"}</td>
              <td style="text-align:right;" onclick="event.stopPropagation()">
                ${s.gitUrl ? `<button class="btn btn-sm btn-secondary" onclick="siteDeploy('${s.id}', ${jsArg(s.name)}, loadDashboardSites)" ${s.health.state === "deploying" ? "disabled" : ""}>${I.get("rocket", { size: 12 })}<span>Deploy</span></button>` : ""}
                ${s.url ? `<a class="btn btn-sm btn-ghost" href="${escapeHtml(s.url)}" target="_blank" rel="noopener" title="Visit">${I.get("externalLink", { size: 12 })}</a>` : ""}
              </td>
            </tr>`,
            )
            .join("")}</tbody>
        </table>
      </div>`;
  } catch (err) {
    if (el)
      el.innerHTML = `<div class="card-body muted">${escapeHtml(err.message)}</div>`;
  }
}

async function loadDashboardData() {
  const I = window.Icons;
  try {
    const stats = await api.getStats();
    const diskEl = document.getElementById("dash-disk-usage");
    if (diskEl) diskEl.textContent = (stats.disk?.percent || "0") + "%";
    const diskFoot = document.getElementById("dash-disk-foot");
    if (diskFoot && stats.disk?.availableHuman)
      diskFoot.textContent = `${stats.disk.availableHuman} free of ${stats.disk.totalHuman}`;
    const uptimeEl = document.getElementById("dash-uptime");
    if (uptimeEl) uptimeEl.textContent = stats.uptime?.human || "—";
    const host = document.getElementById("dash-host");
    if (host) host.textContent = stats.hostname || "Continuous server run time";

    const statsEl = document.getElementById("dash-server-stats");
    if (statsEl) {
      statsEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:16px;">
          ${renderMiniBar("CPU Load", stats.cpu?.percent || 0, `${stats.cpu?.cores || 1} core(s) · load ${(stats.cpu?.load || []).join(" / ")}`)}
          ${renderMiniBar("Memory Usage", stats.memory?.percent || 0, stats.memory?.usedHuman + " / " + stats.memory?.totalHuman)}
          ${renderMiniBar("Primary Disk", stats.disk?.percent || 0, stats.disk?.usedHuman + " / " + stats.disk?.totalHuman)}
        </div>
        <div style="margin-top:20px;padding-top:14px;border-top:1px solid var(--border-primary);display:flex;gap:20px;flex-wrap:wrap;font-size:12px;color:var(--text-secondary);">
          <div style="display:flex;align-items:center;gap:6px;">${I.get("terminal", { size: 14, color: "var(--text-tertiary)" })}<span><strong>Host:</strong> ${escapeHtml(stats.hostname || "localhost")}</span></div>
          <div style="display:flex;align-items:center;gap:6px;">${I.get("server", { size: 14, color: "var(--text-tertiary)" })}<span><strong>OS:</strong> ${escapeHtml(stats.os?.substring(0, 30) || "Linux")}</span></div>
        </div>`;
    }

    const { logs } = await api.getLogs(1, 7);
    const activityEl = document.getElementById("dash-activity");
    if (activityEl) {
      activityEl.innerHTML = logs.length
        ? `<div style="display:flex;flex-direction:column;">${logs
            .map((log) => {
              const iconType =
                log.level === "error"
                  ? "alertCircle"
                  : log.level === "warning"
                    ? "alertTriangle"
                    : "checkCircle";
              const color =
                log.level === "error"
                  ? "var(--color-red)"
                  : log.level === "warning"
                    ? "var(--color-amber)"
                    : "var(--color-green)";
              return `
              <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 18px;border-bottom:1px solid var(--border-secondary);">
                <div style="margin-top:2px;">${I.get(iconType, { size: 16, color })}</div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:500;color:var(--text-primary);word-break:break-word;">${escapeHtml(log.message.substring(0, 110))}</div>
                  <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">${escapeHtml(log.timestamp ? UI.timeAgo(log.timestamp) : "Just now")}</div>
                </div>
              </div>`;
            })
            .join("")}</div>`
        : UI.emptyState(
            "fileText",
            "No activity yet",
            "Deployments, backups and installs show up here.",
          );
    }
  } catch (err) {
    console.error("Dashboard load error:", err);
  }
}

const TOOL_GROUPS = [
  {
    title: "Websites & Domains",
    tools: [
      ["sites", "globe", "Websites", "Sites & apps: domains, deploys, .env"],
      [
        "new-site",
        "rocket",
        "New Website",
        "Git, WordPress, empty site, proxy",
      ],
      ["ssl", "shieldCheck", "SSL / TLS", "Free Let's Encrypt certificates"],
      ["files", "folder", "File Manager", "Browse, edit, upload & extract"],
    ],
  },
  {
    title: "Databases & Software",
    tools: [
      [
        "databases",
        "database",
        "MySQL Databases",
        "Databases, users & privileges",
      ],
      ["databases", "table", "Database Browser", "Tables and SQL console"],
      ["php", "code", "PHP Versions", "Multiple PHP-FPM versions & php.ini"],
      ["php", "package", "Composer", "Install & run Composer"],
    ],
  },
  {
    title: "Email",
    tools: [
      ["mail", "inbox", "Email Accounts", "Mailboxes on your domains"],
      ["mail", "send", "Forwarders", "Aliases & forwarding"],
      ["mail", "key", "Email Deliverability", "SPF, DKIM, DMARC & PTR checks"],
    ],
  },
  {
    title: "Security & Automation",
    tools: [
      ["firewall", "flame", "Firewall", "Open or block ports & IPs"],
      ["ssh-keys", "key", "SSH Keys", "Login keys & Git deploy key"],
      ["backups", "archive", "Backups", "Cloud backups & restores"],
      ["cron", "clock", "Cron Jobs", "Scheduled tasks"],
    ],
  },
  {
    title: "Advanced",
    tools: [
      ["terminal", "terminal", "Terminal", "Root shell in the browser"],
      ["services", "layers", "Services", "Start/stop nginx, MySQL, PHP…"],
      ["ports", "server", "Ports & Processes", "Which app runs on which port"],
      ["monitor", "activity", "Resource Monitor", "CPU, RAM, disk & processes"],
      ["logs", "fileText", "Logs", "Panel activity"],
    ],
  },
];

function renderToolGroups() {
  const I = window.Icons;
  return TOOL_GROUPS.map(
    (group) => `
    <div class="tool-group">
      <div class="tool-group-title">${group.title}</div>
      <div class="tool-grid">
        ${group.tools
          .map(
            ([page, icon, name, desc]) => `
          <button class="tool-tile" onclick="window.app.navigate('${page}')">
            <span class="tool-tile-icon">${I.get(icon, { size: 17 })}</span>
            <span>
              <span class="tool-tile-name" style="display:block;">${name}</span>
              <span class="tool-tile-desc" style="display:block;margin-top:2px;">${desc}</span>
            </span>
          </button>`,
          )
          .join("")}
      </div>
    </div>`,
  ).join("");
}

function renderMiniBar(label, percent, detail) {
  let barColor = "var(--accent-black)";
  if (percent > 85) barColor = "var(--color-red)";
  else if (percent > 70) barColor = "var(--color-amber)";

  return `
    <div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:12px;">
        <span style="font-weight:600;color:var(--text-primary);">${label}</span>
        <span style="font-weight:700;color:var(--text-primary);">${percent}%</span>
      </div>
      <div style="height:7px;background:#f4f4f5;border:1px solid var(--border-primary);border-radius:9999px;overflow:hidden;">
        <div style="height:100%;width:${Math.min(percent, 100)}%;background:${barColor};border-radius:9999px;transition:width 0.6s ease;"></div>
      </div>
      ${detail ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">${escapeHtml(detail)}</div>` : ""}
    </div>
  `;
}

window.renderDashboard = renderDashboard;
