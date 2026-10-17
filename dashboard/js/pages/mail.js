/**
 * Email hosting — docker-mailserver (Postfix/Dovecot/Rspamd) + Roundcube webmail
 */
let mailState = {
  tab: "mailboxes",
  status: null,
  accounts: [],
  aliases: [],
  domains: [],
  dnsDomain: "",
};

function renderMail(container) {
  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>Email Hosting</h2>
          <p>Mailboxes on your own domain with IMAP/SMTP, spam filtering, DKIM signing and webmail</p>
        </div>
        <div style="display:flex;gap:8px;" id="mail-header-actions"></div>
      </div>
      <div id="mail-content"><div class="spinner"></div></div>
    </div>
  `;
  loadMail();
}

async function loadMail() {
  const el = document.getElementById("mail-content");
  if (!el) return;
  try {
    const status = await api.getMailStatus();
    mailState.status = status;
    mailState.domains = status.domains || [];
    if (!status.installed) return mailRenderSetup(el);
    mailRenderDashboard(el);
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

// ── Setup (not installed) ───────────────────────────────────

function checkRow(state, title, detail) {
  const I = window.Icons;
  const icon =
    state === "ok"
      ? I.get("checkCircle", { size: 16, color: "var(--color-green)" })
      : state === "warn"
        ? I.get("alertTriangle", { size: 16, color: "var(--color-amber)" })
        : state === "bad"
          ? I.get("xCircle", { size: 16, color: "var(--color-red)" })
          : '<span class="spinner spinner-sm"></span>';
  return `<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border-secondary);">${icon}<div><div style="font-size:13px;font-weight:600;">${title}</div><div style="font-size:12px;color:var(--text-secondary);">${detail}</div></div></div>`;
}

function mailRenderSetup(el) {
  const I = window.Icons;
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:20px;align-items:start;">
      <div class="card">
        <div class="card-header"><h3 class="card-title">${I.get("info", { size: 16 })}<span>Should you host email yourself?</span></h3></div>
        <div class="card-body" style="font-size:13px;color:var(--text-secondary);line-height:1.6;">
          <p style="margin-bottom:10px;">Self-hosted mail works well <strong>if</strong> your server passes the checks below. Receiving mail is easy — the hard part is <strong>deliverability</strong>: Gmail and Outlook only trust servers with correct reverse DNS, SPF, DKIM and DMARC, and an IP that isn't on a blocklist.</p>
          <p style="margin-bottom:10px;"><strong style="color:var(--text-primary);">Choose self-hosting</strong> for many mailboxes at no per-user cost, full control, and app/notification mail from this server.</p>
          <p style="margin-bottom:14px;"><strong style="color:var(--text-primary);">Choose a provider</strong> (Google Workspace, Microsoft 365, Zoho Mail, Migadu, Fastmail) if mail is business-critical or port 25 is blocked — just add their MX/SPF/DKIM records at your DNS host. Your websites here keep working either way.</p>
          <div style="font-weight:600;color:var(--text-primary);margin-bottom:4px;">Server pre-flight checks</div>
          <div id="mail-checks">${checkRow("wait", "Running checks…", "")}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3 class="card-title">${I.get("mail", { size: 16 })}<span>Set up the mail server</span></h3></div>
        <div class="card-body">
          <div class="form-group">
            <label class="form-label">Primary email domain *</label>
            <input type="text" id="mail-domain" class="form-input" placeholder="example.com" oninput="mailSyncHostname()">
          </div>
          <div class="form-group">
            <label class="form-label">Mail server hostname *</label>
            <input type="text" id="mail-hostname" class="form-input mono-input" placeholder="mail.example.com">
            <div class="form-hint">Create a DNS <strong>A record</strong> for this name pointing to this server <strong>before</strong> you start — it is needed for the TLS certificate.</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group">
              <label class="form-label">First mailbox *</label>
              <input type="email" id="mail-first" class="form-input" placeholder="admin@example.com">
            </div>
            <div class="form-group">
              <label class="form-label">Mailbox password *</label>
              <input type="password" id="mail-first-pass" class="form-input" placeholder="min. 8 characters">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Contact email for Let's Encrypt</label>
            <input type="email" id="mail-contact" class="form-input" placeholder="you@gmail.com">
          </div>
          <label class="form-check" style="margin-bottom:16px;"><input type="checkbox" id="mail-webmail" checked><span style="font-size:13px;">Install Roundcube webmail at <code id="mail-webmail-host">https://mail.example.com</code></span></label>
          <div class="alert alert-info" style="font-size:12px;margin-bottom:16px;">Installs Docker and docker-mailserver (Postfix, Dovecot, Rspamd, Fail2ban) in <code>/opt/vps-mail</code> and opens ports 25, 465, 587 and 993. Needs about 1 GB of free RAM.</div>
          <button class="btn btn-primary" style="width:100%;" onclick="mailInstall()">${I.get("download", { size: 13, color: "#fff" })}<span>Install Email Server</span></button>
        </div>
      </div>
    </div>
  `;
  mailLoadChecks();
}

function mailSyncHostname() {
  const domain = document
    .getElementById("mail-domain")
    .value.trim()
    .toLowerCase();
  const host = document.getElementById("mail-hostname");
  if (!host.dataset.touched) host.value = domain ? `mail.${domain}` : "";
  host.oninput = () => {
    host.dataset.touched = "1";
  };
  const first = document.getElementById("mail-first");
  if (!first.dataset.touched) first.value = domain ? `admin@${domain}` : "";
  first.oninput = () => {
    first.dataset.touched = "1";
  };
  document.getElementById("mail-webmail-host").textContent =
    `https://${host.value || "mail.example.com"}`;
}

async function mailLoadChecks() {
  const el = document.getElementById("mail-checks");
  if (!el) return;
  try {
    const c = await api.getMailChecks();
    const gb = c.memory ? (c.memory / 1024 ** 3).toFixed(1) : null;
    el.innerHTML = [
      checkRow(
        c.port25.open ? "ok" : "bad",
        "Outbound port 25",
        c.port25.open
          ? "Open — this server can deliver mail to other mail servers."
          : `${escapeHtml(c.port25.detail)}. Ask your provider to unblock port 25 (Contabo, Hetzner and most VPS hosts do on request), or use an SMTP relay.`,
      ),
      checkRow(
        c.ptr.values.length ? "warn" : "bad",
        "Reverse DNS (PTR)",
        c.ptr.values.length
          ? `${escapeHtml(c.ip)} → ${escapeHtml(c.ptr.values.join(", "))}. Set it to your mail hostname in the VPS provider's control panel.`
          : `No PTR record for ${escapeHtml(c.ip || "this IP")}. Set it to your mail hostname (e.g. mail.example.com) in your VPS provider's panel.`,
      ),
      checkRow(
        !gb ? "warn" : gb >= 2 ? "ok" : gb >= 1 ? "warn" : "bad",
        "Memory",
        gb
          ? `${gb} GB total — 2 GB+ recommended for mail plus websites.`
          : "Unknown",
      ),
      checkRow(
        c.port25InUse ? "bad" : "ok",
        "Port 25 free on this server",
        c.port25InUse
          ? `Something already listens on port 25:<br><code style="font-size:11px;">${escapeHtml(c.port25InUse)}</code><br>Remove it first (e.g. <code>apt purge postfix</code>).`
          : "Nothing else is using the SMTP port.",
      ),
      checkRow(
        c.docker ? "ok" : "warn",
        "Docker",
        c.docker
          ? "Installed."
          : "Not installed yet — the setup installs it automatically.",
      ),
    ].join("");
  } catch (err) {
    el.innerHTML = checkRow("bad", "Checks failed", escapeHtml(err.message));
  }
}

async function mailInstall() {
  const payload = {
    domain: document.getElementById("mail-domain").value.trim().toLowerCase(),
    hostname: document
      .getElementById("mail-hostname")
      .value.trim()
      .toLowerCase(),
    firstMailbox: document
      .getElementById("mail-first")
      .value.trim()
      .toLowerCase(),
    password: document.getElementById("mail-first-pass").value,
    email:
      document.getElementById("mail-contact").value.trim() ||
      document.getElementById("mail-first").value.trim(),
    webmail: document.getElementById("mail-webmail").checked,
  };
  if (
    !payload.domain ||
    !payload.hostname ||
    !payload.firstMailbox ||
    !payload.password
  ) {
    toast.error(
      "Missing fields",
      "Fill in the domain, hostname, first mailbox and password",
    );
    return;
  }
  JobConsole.run(
    api.installMail(payload),
    `Install email server (${payload.hostname})`,
    { onDone: loadMail },
  );
}

// ── Dashboard (installed) ───────────────────────────────────

function mailRenderDashboard(el) {
  const I = window.Icons;
  const s = mailState.status;
  const running = s.container?.status === "running";
  const host = s.settings?.hostname;
  document.getElementById("mail-header-actions").innerHTML = `
    <button class="btn btn-secondary" onclick="mailShowLogs()">${I.get("fileText", { size: 13 })}<span>Logs</span></button>
    <button class="btn btn-secondary" onclick="mailControl('restart')">${I.get("refresh", { size: 13 })}<span>Restart</span></button>
    <button class="btn btn-primary" onclick="mailAddMailbox()">${I.get("plus", { size: 13, color: "#fff" })}<span>New Mailbox</span></button>`;

  el.innerHTML = `
    <div class="status-row" style="margin-bottom:16px;">
      <span class="badge ${running ? "badge-success" : "badge-danger"}"><span class="badge-dot"></span>Mail server ${escapeHtml(s.container?.status || "missing")}${s.container?.health ? ` · ${escapeHtml(s.container.health)}` : ""}</span>
      ${s.settings?.webmail ? `<span class="badge ${s.webmail?.status === "running" ? "badge-success" : "badge-warning"}">Webmail ${escapeHtml(s.webmail?.status || "missing")}</span>` : ""}
      ${host ? `<span class="badge badge-neutral">${escapeHtml(host)}</span>` : ""}
      ${s.settings?.webmail && host ? `<a class="btn btn-sm btn-secondary" href="https://${escapeHtml(host)}" target="_blank" rel="noopener">${I.get("externalLink", { size: 12 })}<span>Open Webmail</span></a>` : ""}
      ${running ? "" : `<button class="btn btn-sm btn-primary" onclick="mailControl('start')">Start</button>`}
    </div>
    <div class="tabs">
      <button class="tab" data-tab="mailboxes" onclick="mailSwitchTab('mailboxes')">${I.get("inbox", { size: 14 })}Mailboxes</button>
      <button class="tab" data-tab="aliases" onclick="mailSwitchTab('aliases')">${I.get("send", { size: 14 })}Forwarders</button>
      <button class="tab" data-tab="dns" onclick="mailSwitchTab('dns')">${I.get("globe", { size: 14 })}DNS Records</button>
      <button class="tab" data-tab="clients" onclick="mailSwitchTab('clients')">${I.get("settings", { size: 14 })}Email Client Setup</button>
    </div>
    <div id="mail-tab"></div>`;
  mailSwitchTab(mailState.tab);
}

function mailSwitchTab(tab) {
  mailState.tab = tab;
  document
    .querySelectorAll("#mail-content .tab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  const el = document.getElementById("mail-tab");
  if (!el) return;
  if (tab === "mailboxes") mailRenderMailboxes(el);
  else if (tab === "aliases") mailRenderAliases(el);
  else if (tab === "dns") mailRenderDns(el);
  else mailRenderClients(el);
}

async function mailRenderMailboxes(el) {
  const I = window.Icons;
  el.innerHTML = '<div class="spinner"></div>';
  try {
    const { accounts, domains } = await api.getMailboxes();
    mailState.accounts = accounts;
    mailState.domains = domains;
    el.innerHTML = `
      <div class="card"><div class="table-container" style="border:none;border-radius:0;">
        <table class="table">
          <thead><tr><th>Email</th><th>Usage</th><th>Quota</th><th>Forwarded from</th><th style="text-align:right;">Actions</th></tr></thead>
          <tbody>
            ${
              accounts
                .map(
                  (a) => `
              <tr>
                <td><strong>${escapeHtml(a.email)}</strong></td>
                <td>${a.usedBytes !== null ? formatBytes(a.usedBytes) : '<span class="muted">—</span>'}</td>
                <td>${a.quota ? escapeHtml(a.quota) : '<span class="muted">unlimited</span>'}</td>
                <td class="mono-sm">${a.aliases.length ? escapeHtml(a.aliases.join(", ")) : '<span class="muted">—</span>'}</td>
                <td style="text-align:right;white-space:nowrap;">
                  <button class="btn btn-sm btn-secondary" onclick="mailChangePassword(${jsArg(a.email)})" title="Change password">${I.get("lock", { size: 12 })}<span>Password</span></button>
                  <button class="btn btn-sm btn-secondary" onclick="mailSetQuota(${jsArg(a.email)}, ${jsArg(a.quota || "")})" title="Quota">${I.get("hardDrive", { size: 12 })}</button>
                  <button class="btn btn-sm btn-danger" onclick="mailDeleteMailbox(${jsArg(a.email)})" title="Delete">${I.get("trash", { size: 12 })}</button>
                </td>
              </tr>`,
                )
                .join("") ||
              `<tr><td colspan="5"><div class="empty-state" style="padding:24px;"><div class="empty-state-title">No mailboxes</div></div></td></tr>`
            }
          </tbody>
        </table>
      </div></div>`;
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

function mailAddMailbox() {
  const domain =
    mailState.domains[0] || mailState.status?.settings?.domain || "example.com";
  Modal.show(
    "New Mailbox",
    `
    <div class="form-group">
      <label class="form-label">Email address *</label>
      <input type="email" id="mb-email" class="form-input" placeholder="name@${escapeHtml(domain)}">
      <div class="form-hint">Any domain works — a DKIM key is generated automatically for new domains. Add its DNS records afterwards.</div>
    </div>
    <div class="form-group"><label class="form-label">Password *</label><input type="text" id="mb-pass" class="form-input mono-input" value="${generatePassword()}"></div>
  `,
    {
      submitText: "Create Mailbox",
      onSubmit: async () => {
        const email = document
          .getElementById("mb-email")
          .value.trim()
          .toLowerCase();
        await api.addMailbox(email, document.getElementById("mb-pass").value);
        toast.success("Mailbox created", email);
        mailSwitchTab("mailboxes");
      },
    },
  );
}

function mailChangePassword(email) {
  Modal.show(
    `Password — ${escapeHtml(email)}`,
    `<div class="form-group"><label class="form-label">New password</label><input type="text" id="mb-newpass" class="form-input mono-input" value="${generatePassword()}"></div>`,
    {
      submitText: "Change Password",
      onSubmit: async () => {
        await api.setMailboxPassword(
          email,
          document.getElementById("mb-newpass").value,
        );
        toast.success("Password changed", email);
      },
    },
  );
}

function mailSetQuota(email, current) {
  Modal.show(
    `Quota — ${escapeHtml(email)}`,
    `<div class="form-group"><label class="form-label">Mailbox size limit</label><input type="text" id="mb-quota" class="form-input mono-input" value="${escapeHtml(current)}" placeholder="e.g. 2G, 500M — empty for unlimited"></div>`,
    {
      submitText: "Save",
      onSubmit: async () => {
        await api.setMailboxQuota(
          email,
          document.getElementById("mb-quota").value.trim(),
        );
        toast.success("Quota updated", email);
        mailSwitchTab("mailboxes");
      },
    },
  );
}

function mailDeleteMailbox(email) {
  Modal.confirm(
    "Delete mailbox",
    `Delete <strong>${escapeHtml(email)}</strong> and <strong>all of its stored mail</strong>? This cannot be undone.`,
    async () => {
      await api.deleteMailbox(email);
      toast.success("Mailbox deleted", email);
      mailSwitchTab("mailboxes");
    },
  );
}

async function mailRenderAliases(el) {
  const I = window.Icons;
  el.innerHTML = '<div class="spinner"></div>';
  try {
    const { aliases } = await api.getMailAliases();
    const rows = aliases.flatMap((a) =>
      a.targets.map((t) => ({ alias: a.alias, target: t })),
    );
    el.innerHTML = `
      <div class="card" style="margin-bottom:16px;"><div class="card-body" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;"><label class="form-label">Forward mail sent to</label><input type="email" id="alias-from" class="form-input" placeholder="info@${escapeHtml(mailState.domains[0] || "example.com")}"></div>
        <div style="flex:1;min-width:200px;"><label class="form-label">Deliver to</label><input type="email" id="alias-to" class="form-input" placeholder="you@example.com or any external address"></div>
        <button class="btn btn-primary" onclick="mailAddAlias()">${I.get("plus", { size: 13, color: "#fff" })}<span>Add Forwarder</span></button>
      </div></div>
      <div class="card"><div class="table-container" style="border:none;border-radius:0;">
        <table class="table">
          <thead><tr><th>Address</th><th></th><th>Delivers to</th><th style="text-align:right;">Actions</th></tr></thead>
          <tbody>${
            rows
              .map(
                (r) => `
            <tr><td><strong>${escapeHtml(r.alias)}</strong></td><td>${I.get("arrowRight", { size: 14, color: "var(--text-tertiary)" })}</td><td class="mono-sm">${escapeHtml(r.target)}</td>
            <td style="text-align:right;"><button class="btn btn-sm btn-danger" onclick="mailDeleteAlias(${jsArg(r.alias)}, ${jsArg(r.target)})">${I.get("trash", { size: 12 })}</button></td></tr>`,
              )
              .join("") ||
            '<tr><td colspan="4" class="muted" style="padding:20px;">No forwarders yet.</td></tr>'
          }
          </tbody>
        </table>
      </div></div>`;
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

async function mailAddAlias() {
  try {
    await api.addMailAlias(
      document.getElementById("alias-from").value.trim().toLowerCase(),
      document.getElementById("alias-to").value.trim().toLowerCase(),
    );
    toast.success("Forwarder added", "");
    mailSwitchTab("aliases");
  } catch (err) {
    toast.error("Failed", err.message);
  }
}

function mailDeleteAlias(alias, target) {
  Modal.confirm(
    "Delete forwarder",
    `Stop forwarding <strong>${escapeHtml(alias)}</strong> to ${escapeHtml(target)}?`,
    async () => {
      await api.deleteMailAlias(alias, target);
      toast.success("Forwarder removed", alias);
      mailSwitchTab("aliases");
    },
  );
}

async function mailRenderDns(el) {
  const I = window.Icons;
  const domains = mailState.domains.length
    ? mailState.domains
    : [mailState.status?.settings?.domain].filter(Boolean);
  if (!mailState.dnsDomain || !domains.includes(mailState.dnsDomain))
    mailState.dnsDomain = domains[0] || "";
  el.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap;">
      <select class="form-select" style="max-width:280px;" onchange="mailState.dnsDomain=this.value; mailRenderDns(document.getElementById('mail-tab'))">
        ${domains.map((d) => `<option value="${escapeHtml(d)}" ${d === mailState.dnsDomain ? "selected" : ""}>${escapeHtml(d)}</option>`).join("")}
      </select>
      <button class="btn btn-secondary btn-sm" onclick="mailRenderDns(document.getElementById('mail-tab'))">${I.get("refresh", { size: 12 })}<span>Re-check DNS</span></button>
      <span class="form-hint">Add these at your DNS provider (Cloudflare, Namecheap, GoDaddy…). Changes can take up to an hour to appear.</span>
    </div>
    <div id="dns-report"><div class="spinner"></div></div>`;
  if (!mailState.dnsDomain) {
    document.getElementById("dns-report").innerHTML =
      '<p class="muted">Create a mailbox first.</p>';
    return;
  }
  try {
    const r = await api.getMailDns(mailState.dnsDomain);
    document.getElementById("dns-report").innerHTML = `
      ${r.dkimGenerated ? "" : `<div class="alert alert-warning" style="margin-bottom:12px;">${I.get("alertTriangle", { size: 16 })}<div style="flex:1;">No DKIM key for ${escapeHtml(r.domain)} yet — mail from this domain won't be signed.</div><button class="btn btn-sm btn-primary" onclick="mailGenerateDkim(${jsArg(r.domain)})">Generate DKIM Key</button></div>`}
      <div class="card"><div class="table-container" style="border:none;border-radius:0;">
        <table class="table">
          <thead><tr><th style="width:60px;">Status</th><th style="width:60px;">Type</th><th>Name / Host</th><th>Value to set</th><th>Currently published</th></tr></thead>
          <tbody>${r.records
            .map(
              (rec, i) => `
            <tr>
              <td>${rec.ok ? I.get("checkCircle", { size: 18, color: "var(--color-green)" }) : I.get("xCircle", { size: 18, color: "var(--color-red)" })}</td>
              <td><span class="badge badge-neutral">${escapeHtml(rec.type)}</span></td>
              <td class="dns-value"><strong>${escapeHtml(rec.name)}</strong>${rec.note ? `<div class="muted" style="font-family:var(--font-sans);margin-top:2px;">${escapeHtml(rec.note)}</div>` : ""}</td>
              <td class="dns-value">${escapeHtml(rec.value)} <button class="btn btn-sm btn-ghost copy-btn" title="Copy" onclick="mailCopyDns(${i})">${I.get("copy", { size: 12 })}</button></td>
              <td class="dns-value" style="color:${rec.ok ? "var(--color-green)" : "var(--text-tertiary)"};">${rec.live ? escapeHtml(rec.live) : "not found"}</td>
            </tr>`,
            )
            .join("")}
          </tbody>
        </table>
      </div></div>
      <div class="form-hint" style="margin-top:10px;">Tip: after everything is green, send a message to <a href="https://www.mail-tester.com" target="_blank" rel="noopener" style="text-decoration:underline;">mail-tester.com</a> to confirm a 10/10 deliverability score.</div>`;
    mailState.dnsRecords = r.records;
  } catch (err) {
    document.getElementById("dns-report").innerHTML =
      `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
  }
}

function mailCopyDns(i) {
  const rec = mailState.dnsRecords?.[i];
  if (!rec) return;
  navigator.clipboard
    .writeText(rec.value)
    .then(() => toast.success("Copied", `${rec.type} ${rec.name}`));
}

async function mailGenerateDkim(domain) {
  try {
    await api.generateDkim(domain);
    toast.success("DKIM key generated", domain);
    mailRenderDns(document.getElementById("mail-tab"));
  } catch (err) {
    toast.error("Failed", err.message);
  }
}

function mailRenderClients(el) {
  const host = mailState.status?.settings?.hostname || "mail.example.com";
  const row = (k, v) =>
    `<dt>${k}</dt><dd class="mono-sm" style="color:var(--text-primary);">${v}</dd>`;
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;">
      <div class="card"><div class="card-header"><h3 class="card-title">Incoming mail (IMAP)</h3></div><div class="card-body"><dl class="kv">
        ${row("Server", escapeHtml(host))}${row("Port", "993")}${row("Security", "SSL/TLS")}${row("Username", "full email address")}${row("Password", "mailbox password")}
      </dl></div></div>
      <div class="card"><div class="card-header"><h3 class="card-title">Outgoing mail (SMTP)</h3></div><div class="card-body"><dl class="kv">
        ${row("Server", escapeHtml(host))}${row("Port", "587 (STARTTLS) or 465 (SSL/TLS)")}${row("Authentication", "required — same as IMAP")}${row("Username", "full email address")}
      </dl></div></div>
      <div class="card"><div class="card-header"><h3 class="card-title">Send from your apps</h3></div><div class="card-body" style="font-size:13px;color:var(--text-secondary);">
        Laravel / WordPress / Node can send through this server:
        <pre class="job-output" style="min-height:0;margin-top:8px;">MAIL_MAILER=smtp
MAIL_HOST=${escapeHtml(host)}
MAIL_PORT=587
MAIL_ENCRYPTION=tls
MAIL_USERNAME=noreply@yourdomain
MAIL_PASSWORD=********</pre>
      </div></div>
    </div>`;
}

async function mailControl(action) {
  try {
    toast.info("Mail server", `${action}…`);
    await api.mailControl(action);
    toast.success("Mail server", `${action} completed`);
  } catch (err) {
    toast.error("Failed", err.message);
  }
  loadMail();
}

async function mailShowLogs() {
  try {
    const { lines } = await api.getMailLogs();
    Modal.show(
      "Mail server logs",
      `<pre class="job-output" style="max-height:65vh;">${escapeHtml(lines.join("\n"))}</pre>`,
      { width: 1000 },
    );
  } catch (err) {
    toast.error("Failed", err.message);
  }
}

window.renderMail = renderMail;
