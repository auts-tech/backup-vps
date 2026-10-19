/**
 * SSL / TLS — certbot (Let's Encrypt) status, every certificate on the
 * server, and which websites still run without HTTPS.
 */
let sslState = { certbot: null, certs: [], sites: [] };

function renderSsl(container) {
  const I = window.Icons;
  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>SSL / TLS</h2>
          <p>Free Let's Encrypt certificates for your websites. They renew automatically — enable HTTPS per website on its Domains tab.</p>
        </div>
        <button class="btn btn-secondary" onclick="JobConsole.run(api.renewCertificates(), 'Renew SSL certificates', { onDone: loadSsl })">${I.get("refresh", { size: 13 })}<span>Renew all now</span></button>
      </div>
      <div class="card" style="margin-bottom:20px;"><div id="ssl-certbot" class="certbot-area"><div class="card-body"><div class="spinner"></div></div></div></div>
      <div class="card" style="margin-bottom:20px;">
        <div class="card-header"><h3 class="card-title">${I.get("globe", { size: 16 })}<span>Websites</span></h3></div>
        <div class="table-container" style="border:none;border-radius:0;">
          <table class="table"><thead><tr><th>Website</th><th>Domains</th><th>HTTPS</th><th style="text-align:right;"></th></tr></thead><tbody id="ssl-sites"></tbody></table>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3 class="card-title">${I.get("shieldCheck", { size: 16 })}<span>Certificates on this server</span></h3></div>
        <div class="table-container" style="border:none;border-radius:0;">
          <table class="table"><thead><tr><th>Certificate</th><th>Domains</th><th>Expires</th><th style="text-align:right;"></th></tr></thead><tbody id="ssl-certs"></tbody></table>
        </div>
      </div>
    </div>`;
  loadSsl();
}

async function loadSsl() {
  try {
    const [certbot, { certificates }, sites] = await Promise.all([
      api.getCertbot(),
      api.getCertificates().catch(() => ({ certificates: [] })),
      api.getSites().catch(() => ({ sites: [] })),
    ]);
    sslState = { certbot, certs: certificates, sites: sites.sites || [] };
    renderSslCertbot();
    renderSslSites();
    renderSslCerts();
  } catch (err) {
    const el = document.getElementById("ssl-certbot");
    if (el) el.innerHTML = `<div class="card-body"><div class="alert alert-danger">${escapeHtml(err.message)}</div></div>`;
  }
}

function renderSslCertbot() {
  const el = document.getElementById("ssl-certbot");
  const c = sslState.certbot;
  if (!el || !c) return;
  const I = window.Icons;
  if (!c.installed) {
    el.innerHTML = `
      <div class="certbot-install">
        <div style="flex:1;min-width:240px;">
          <div style="font-weight:600;font-size:13px;margin-bottom:2px;">Install certbot to enable free HTTPS</div>
          <div class="muted" style="font-size:12px;">Let's Encrypt sends expiry warnings to this email. (It is also installed automatically with your first certificate.)</div>
        </div>
        <input type="email" id="certbot-email" class="form-input" placeholder="you@example.com" value="${escapeHtml(c.defaultEmail || "")}" style="max-width:260px;">
        <button class="btn btn-primary" onclick="sslInstallCertbot()">${I.get("download", { size: 13, color: "#fff" })}<span>Install certbot</span></button>
      </div>`;
    return;
  }
  const account =
    c.accountEmail === null
      ? `<span class="muted">No Let's Encrypt account yet — created with the first certificate</span>`
      : `Account: <strong>${escapeHtml(c.accountEmail || "(no email)")}</strong>`;
  el.innerHTML = `
    <div class="certbot-status" style="border-bottom:none;">
      <span class="badge badge-success">${I.get("checkCircle", { size: 11 })} certbot ${escapeHtml(c.version || "")}</span>
      <span class="badge ${c.nginxPlugin ? "badge-success" : "badge-danger"}">${c.nginxPlugin ? "nginx plugin" : "nginx plugin missing"}</span>
      <span class="badge ${c.autoRenew ? "badge-success" : "badge-warning"}">${c.autoRenew ? `Auto-renew: ${escapeHtml(c.autoRenew)}` : "Auto-renew not scheduled"}</span>
      <span style="font-size:12px;color:var(--text-secondary);">${account}</span>
      <div style="flex:1;"></div>
      <span style="font-size:12px;color:var(--text-secondary);">Default email: <strong>${escapeHtml(c.defaultEmail || "not set")}</strong></span>
      <button class="btn btn-sm btn-secondary" onclick="sslChangeEmail()">${I.get("mail", { size: 12 })}<span>Change</span></button>
      <button class="btn btn-sm btn-secondary" onclick="JobConsole.run(api.testCertbotRenewal(), 'Test certificate renewal')" ${sslState.certs.length ? "" : 'disabled title="No certificates yet"'}>${I.get("zap", { size: 12 })}<span>Test renewal</span></button>
      ${c.nginxPlugin && c.autoRenew ? "" : `<button class="btn btn-sm btn-primary" onclick="sslInstallCertbot(${jsArg(c.defaultEmail || "")})">Repair</button>`}
    </div>`;
}

function renderSslSites() {
  const tbody = document.getElementById("ssl-sites");
  if (!tbody) return;
  const I = window.Icons;
  const sites = sslState.sites.filter((s) => s.domains.length);
  if (!sites.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted" style="padding:20px;">No websites with a domain yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = sites
    .map(
      (s) => `
    <tr>
      <td><div style="display:flex;align-items:center;gap:10px;">${UI.stackAvatar(s.type, "sm")}<a href="#site/${s.id}" style="font-weight:600;">${escapeHtml(s.name)}</a></div></td>
      <td class="mono-sm">${escapeHtml(s.domains.join(", "))}</td>
      <td>${s.ssl.enabled ? `<span class="badge ${s.ssl.daysLeft !== null && s.ssl.daysLeft < 14 ? "badge-warning" : "badge-success"}">${I.get("lock", { size: 10 })} ${s.ssl.daysLeft ?? "?"} days</span>` : '<span class="badge badge-neutral">HTTP only</span>'}</td>
      <td style="text-align:right;"><button class="btn btn-sm ${s.ssl.enabled ? "btn-secondary" : "btn-primary"}" onclick="JobConsole.run(api.issueSiteSsl('${s.id}'), 'HTTPS for ${escapeHtml(s.primaryDomain)}', { onDone: loadSsl })">${I.get("lock", { size: 12, color: s.ssl.enabled ? undefined : "#fff" })}<span>${s.ssl.enabled ? "Re-issue" : "Enable HTTPS"}</span></button></td>
    </tr>`,
    )
    .join("");
}

function renderSslCerts() {
  const tbody = document.getElementById("ssl-certs");
  if (!tbody) return;
  const I = window.Icons;
  if (!sslState.certs.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted" style="padding:20px;">No certificates yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = sslState.certs
    .map(
      (c) => `
    <tr>
      <td style="font-weight:600;">${escapeHtml(c.name)}</td>
      <td class="mono-sm">${escapeHtml(c.domains.join(", "))}</td>
      <td><span class="badge ${c.daysLeft < 14 ? "badge-warning" : "badge-success"}">${c.daysLeft} days</span> <span class="muted" style="font-size:12px;">${escapeHtml(new Date(c.expires).toLocaleDateString())}</span></td>
      <td style="text-align:right;"><button class="btn btn-sm btn-danger" onclick="sslDeleteCert(${jsArg(c.name)})">${I.get("trash", { size: 12 })}</button></td>
    </tr>`,
    )
    .join("");
}

function sslInstallCertbot(presetEmail) {
  const email = presetEmail || document.getElementById("certbot-email")?.value.trim();
  if (!email) {
    toast.error("Email required", "Enter the email for Let's Encrypt notices");
    return;
  }
  JobConsole.run(api.installCertbot(email), "Install certbot", { onDone: loadSsl });
}

function sslChangeEmail() {
  const c = sslState.certbot || {};
  Modal.show(
    "Let's Encrypt email",
    `<div class="form-group"><label class="form-label">Email for certificate expiry notices</label>
      <input type="email" id="certbot-new-email" class="form-input" value="${escapeHtml(c.defaultEmail || "")}" placeholder="you@example.com">
      <div class="form-hint">${c.accountEmail === null ? "Used when the first certificate is requested." : "Also updates the existing Let's Encrypt account."}</div></div>`,
    {
      submitText: "Save",
      onSubmit: async () => {
        const email = document.getElementById("certbot-new-email").value.trim();
        const res = await api.setCertbotEmail(email);
        if (res.jobId) JobConsole.open(res.jobId, "Update Let's Encrypt account email", { onDone: loadSsl });
        else {
          toast.success("Email saved", email);
          loadSsl();
        }
      },
    },
  );
}

function sslDeleteCert(name) {
  Modal.confirm(
    "Delete certificate",
    `Delete the certificate <strong>${escapeHtml(name)}</strong>? Sites still using it fail the nginx config test until they get a new one.`,
    async () => {
      await api.deleteCertificate(name);
      toast.success("Certificate deleted", name);
      loadSsl();
    },
  );
}

window.renderSsl = renderSsl;
