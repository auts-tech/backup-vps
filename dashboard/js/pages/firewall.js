/**
 * Firewall — UFW status and rules. Enabling always allows SSH (and the way
 * you reach this panel) first, and rules that would lock out SSH are refused.
 */
const FW_PRESETS = [
  {
    label: "Web (HTTP + HTTPS)",
    rules: [
      { action: "allow", port: "80", proto: "tcp", comment: "HTTP" },
      { action: "allow", port: "443", proto: "tcp", comment: "HTTPS" },
    ],
  },
  {
    label: "Email (SMTP, IMAP)",
    rules: ["25", "465", "587", "993"].map((port) => ({
      action: "allow",
      port,
      proto: "tcp",
      comment: "Mail",
    })),
  },
  {
    label: "Panel (9090)",
    rules: [
      { action: "allow", port: "9090", proto: "tcp", comment: "VPS Panel" },
    ],
  },
];

function renderFirewall(container) {
  const I = window.Icons;
  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>Firewall</h2>
          <p>Choose which ports are reachable from the internet (UFW). SSH always stays open so you can't lock yourself out.</p>
        </div>
        <div style="display:flex;gap:8px;">
          <a class="btn btn-secondary" href="#ports">${I.get("server", { size: 13 })}<span>Listening ports</span></a>
          <button class="btn btn-secondary" onclick="loadFirewall()">${I.get("refresh", { size: 13 })}<span>Refresh</span></button>
        </div>
      </div>
      <div id="fw-root"><div class="spinner"></div></div>
    </div>`;
  loadFirewall();
}

async function loadFirewall() {
  const root = document.getElementById("fw-root");
  if (!root) return;
  const I = window.Icons;
  let fw;
  try {
    fw = await api.getFirewall();
  } catch (err) {
    root.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
    return;
  }
  if (!fw.installed) {
    root.innerHTML = `<div class="card">${UI.emptyState("flame", "UFW is not installed", "Install the Uncomplicated Firewall. It stays off until you enable it here.", `<button class="btn btn-primary" onclick="JobConsole.run(api.installFirewall(), 'Install ufw', { onDone: loadFirewall })">Install UFW</button>`)}</div>`;
    return;
  }
  const rules = fw.active ? fw.rules : [];
  root.innerHTML = `
    <div class="card" style="margin-bottom:20px;">
      <div class="card-body" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;">
        <div style="width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:${fw.active ? "var(--color-green-bg)" : "var(--bg-subtle)"};border:1px solid ${fw.active ? "var(--color-green-border)" : "var(--border-primary)"};">${I.get("shieldCheck", { size: 22, color: fw.active ? "var(--color-green)" : "var(--text-tertiary)" })}</div>
        <div style="flex:1;min-width:220px;">
          <div style="font-size:15px;font-weight:700;">Firewall is ${fw.active ? "on" : "off"}</div>
          <div class="muted" style="font-size:12px;margin-top:2px;">${fw.active ? `Incoming: <strong>${escapeHtml(fw.incoming || "?")}</strong> by default · outgoing: ${escapeHtml(fw.outgoing || "?")} · SSH port ${fw.sshPort}` : `Every port is reachable. Turning it on allows SSH (port ${fw.sshPort}) and the panel first.`}</div>
        </div>
        ${fw.active ? `<button class="btn btn-danger" onclick="fwToggle(false)">${I.get("power", { size: 13 })}<span>Turn off</span></button>` : `<button class="btn btn-primary" onclick="fwToggle(true)">${I.get("power", { size: 13, color: "#fff" })}<span>Turn on</span></button>`}
      </div>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-header"><h3 class="card-title">${I.get("list", { size: 16 })}<span>${fw.active ? "Rules" : "Rules (applied when turned on)"}</span></h3><span class="badge badge-neutral">${fw.active ? rules.length : fw.pending.length}</span></div>
        <div class="table-container" style="border:none;border-radius:0;">
          <table class="table">
            <thead><tr><th>#</th><th>Port / service</th><th>Action</th><th>From</th><th></th></tr></thead>
            <tbody>
              ${
                fw.active
                  ? rules.length
                    ? rules
                        .map(
                          (r) => `
                <tr>
                  <td class="mono-sm">${r.number}</td>
                  <td><strong>${escapeHtml(r.to)}</strong>${r.v6 ? ' <span class="badge badge-neutral">IPv6</span>' : ""}${r.comment ? `<div class="muted" style="font-size:11px;">${escapeHtml(r.comment)}</div>` : ""}</td>
                  <td><span class="badge ${r.action === "allow" ? "badge-success" : r.action === "limit" ? "badge-warning" : "badge-danger"}">${escapeHtml(r.action)}${r.direction !== "in" ? ` ${escapeHtml(r.direction)}` : ""}</span></td>
                  <td class="mono-sm">${escapeHtml(r.from)}</td>
                  <td style="text-align:right;"><button class="btn btn-sm btn-ghost" onclick="fwDelete({ number: ${r.number} }, ${jsArg(r.to)})" title="Delete">${I.get("trash", { size: 12 })}</button></td>
                </tr>`,
                        )
                        .join("")
                    : `<tr><td colspan="5" class="muted" style="padding:20px;">No rules.</td></tr>`
                  : fw.pending.length
                    ? fw.pending
                        .map(
                          (
                            spec,
                          ) => `<tr><td></td><td colspan="3" class="mono-sm">ufw ${escapeHtml(spec)}</td>
                  <td style="text-align:right;"><button class="btn btn-sm btn-ghost" onclick="fwDelete({ spec: ${jsArg(spec)} }, ${jsArg(spec)})">${I.get("trash", { size: 12 })}</button></td></tr>`,
                        )
                        .join("")
                    : `<tr><td colspan="5" class="muted" style="padding:20px;">No rules yet.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
      <div class="stack-gap">
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("plus", { size: 16 })}<span>Add rule</span></h3></div>
          <div class="card-body">
            <div class="field-row">
              <div class="form-group"><label class="form-label">Action</label>
                <select class="form-select" id="fw-action"><option value="allow">Allow</option><option value="deny">Deny (drop)</option><option value="reject">Reject</option><option value="limit">Limit (rate-limit brute force)</option></select></div>
              <div class="form-group"><label class="form-label">Protocol</label>
                <select class="form-select" id="fw-proto"><option value="tcp">TCP</option><option value="udp">UDP</option><option value="">Both</option></select></div>
            </div>
            <div class="field-row">
              <div class="form-group"><label class="form-label">Port</label><input class="form-input mono-input" id="fw-port" placeholder="443 or 8000:8100"></div>
              <div class="form-group"><label class="form-label">From</label><input class="form-input mono-input" id="fw-from" placeholder="anywhere, or 203.0.113.7"></div>
            </div>
            <div class="form-group"><label class="form-label">Comment</label><input class="form-input" id="fw-comment" placeholder="e.g. Office IP"></div>
            <button class="btn btn-primary" onclick="fwAdd()">${I.get("plus", { size: 13, color: "#fff" })}<span>Add rule</span></button>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("zap", { size: 16 })}<span>Quick rules</span></h3></div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:8px;">
            ${FW_PRESETS.map((p, i) => `<button class="btn btn-secondary" style="justify-content:flex-start;" onclick="fwPreset(${i})">${I.get("plus", { size: 13 })}<span>Allow ${escapeHtml(p.label)}</span></button>`).join("")}
            <div class="input-with-action" style="margin-top:6px;">
              <input class="form-input mono-input" id="fw-block-ip" placeholder="IP to block, e.g. 198.51.100.23">
              <button class="btn btn-danger" onclick="fwBlockIp()">${I.get("ban", { size: 13 })}<span>Block IP</span></button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function fwToggle(on) {
  if (on) {
    Modal.confirm(
      "Turn on the firewall",
      "Incoming connections are blocked except for the rules listed. SSH and the way you reach this panel are allowed automatically first. Make sure web ports (80/443) are allowed if you host websites.",
      async () => {
        try {
          const r = await api.enableFirewall();
          toast.success("Firewall on", `Allowed: ${r.allowed.join(", ")}`);
        } catch (err) {
          toast.error("Failed", err.message);
        }
        loadFirewall();
      },
    );
  } else {
    Modal.confirm(
      "Turn off the firewall",
      "Every port becomes reachable from the internet.",
      async () => {
        await api.disableFirewall();
        toast.success("Firewall off", "");
        loadFirewall();
      },
    );
  }
}

async function fwAdd() {
  const from = document.getElementById("fw-from").value.trim();
  try {
    await api.addFirewallRule({
      action: document.getElementById("fw-action").value,
      proto: document.getElementById("fw-proto").value,
      port: document.getElementById("fw-port").value.trim(),
      from: /^any(where)?$/i.test(from) ? "" : from,
      comment: document.getElementById("fw-comment").value.trim(),
    });
    toast.success("Rule added", "");
    loadFirewall();
  } catch (err) {
    toast.error("Could not add rule", err.message);
  }
}

async function fwPreset(i) {
  try {
    for (const rule of FW_PRESETS[i].rules) await api.addFirewallRule(rule);
    toast.success("Rules added", FW_PRESETS[i].label);
  } catch (err) {
    toast.error("Failed", err.message);
  }
  loadFirewall();
}

async function fwBlockIp() {
  const ip = document.getElementById("fw-block-ip").value.trim();
  if (!ip) return;
  try {
    await api.addFirewallRule({ action: "deny", from: ip, comment: "Blocked" });
    toast.success("Blocked", ip);
    loadFirewall();
  } catch (err) {
    toast.error("Could not block", err.message);
  }
}

function fwDelete(target, label) {
  Modal.confirm(
    "Delete rule",
    `Remove the rule for <strong>${escapeHtml(label)}</strong>?`,
    async () => {
      try {
        await api.deleteFirewallRule(target);
        toast.success("Rule deleted", label);
      } catch (err) {
        toast.error("Could not delete", err.message);
      }
      loadFirewall();
    },
  );
}

window.renderFirewall = renderFirewall;
