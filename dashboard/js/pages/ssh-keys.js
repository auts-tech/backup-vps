/**
 * SSH Keys — keys allowed to log in to this server, and the server's own
 * deploy key for pulling private Git repositories.
 */
function renderSshKeys(container) {
  const I = window.Icons;
  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>SSH Keys</h2>
          <p>Log in without passwords, and let this server pull your private Git repositories.</p>
        </div>
      </div>
      <div class="two-col">
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("users", { size: 16 })}<span>Authorized keys</span></h3><button class="btn btn-sm btn-primary" onclick="sshAddKey()">${I.get("plus", { size: 12, color: "#fff" })}<span>Add key</span></button></div>
          <div id="ssh-keys-list"><div class="card-body"><div class="spinner"></div></div></div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">${I.get("gitBranch", { size: 16 })}<span>Deploy key (this server)</span></h3></div>
          <div class="card-body" id="ssh-deploy-key"><div class="spinner"></div></div>
        </div>
      </div>
    </div>`;
  loadSshKeys();
  loadDeployKey();
}

async function loadSshKeys() {
  const el = document.getElementById("ssh-keys-list");
  if (!el) return;
  const I = window.Icons;
  try {
    const { keys, file, passwordLoginDisabled } = await api.getSshKeys();
    el.innerHTML = `
      ${passwordLoginDisabled ? `<div class="alert alert-info" style="margin:14px 18px 0;font-size:12px;">${I.get("lock", { size: 14 })}<div>Password login is disabled — these keys are the only way in. The last key can't be removed here.</div></div>` : ""}
      <div class="table-container" style="border:none;border-radius:0;">
        <table class="table"><thead><tr><th>Key</th><th>Fingerprint</th><th></th></tr></thead><tbody>
        ${
          keys.length
            ? keys
                .map(
                  (k) => `<tr>
              <td><div style="font-weight:600;">${escapeHtml(k.comment || "(no comment)")}</div><div class="mono-sm">${escapeHtml(k.type)}${k.options ? ` · ${escapeHtml(k.options)}` : ""}</div></td>
              <td class="mono-sm" style="word-break:break-all;">${escapeHtml(k.fingerprint)}</td>
              <td style="text-align:right;"><button class="btn btn-sm btn-ghost" onclick="sshDeleteKey(${jsArg(k.fingerprint)}, ${jsArg(k.comment || k.type)})">${I.get("trash", { size: 12 })}</button></td>
            </tr>`,
                )
                .join("")
            : `<tr><td colspan="3" class="muted" style="padding:20px;">No keys yet — add your laptop's public key (~/.ssh/id_ed25519.pub).</td></tr>`
        }
        </tbody></table>
      </div>
      <div class="card-body form-hint" style="padding-top:8px;">${escapeHtml(file)}</div>`;
  } catch (err) {
    el.innerHTML = `<div class="card-body"><div class="alert alert-danger">${escapeHtml(err.message)}</div></div>`;
  }
}

function sshAddKey() {
  Modal.show(
    "Add SSH key",
    `<div class="form-group"><label class="form-label">Public key</label>
       <textarea class="form-textarea textarea-code" id="ssh-new-key" rows="4" placeholder="ssh-ed25519 AAAAC3Nza… you@laptop"></textarea>
       <div class="form-hint">On your computer: <code>cat ~/.ssh/id_ed25519.pub</code> (create one with <code>ssh-keygen -t ed25519</code>).</div></div>
     <div class="form-group"><label class="form-label">Label</label><input class="form-input" id="ssh-new-label" placeholder="e.g. Work laptop"></div>`,
    {
      submitText: "Add key",
      width: 620,
      onSubmit: async () => {
        await api.addSshKey(document.getElementById("ssh-new-key").value, document.getElementById("ssh-new-label").value.trim());
        toast.success("Key added", "You can now log in with it");
        loadSshKeys();
      },
    },
  );
}

function sshDeleteKey(fingerprint, label) {
  Modal.confirm("Remove SSH key", `<strong>${escapeHtml(label)}</strong> will no longer be able to log in.`, async () => {
    await api.deleteSshKey(fingerprint);
    toast.success("Key removed", label);
    loadSshKeys();
  });
}

async function loadDeployKey() {
  const el = document.getElementById("ssh-deploy-key");
  if (!el) return;
  const I = window.Icons;
  const key = await api.getDeployKey().catch(() => ({ exists: false }));
  if (!key.exists) {
    el.innerHTML = `
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">This server has no SSH key yet. Generate one, then add it to your private repositories as a read-only <strong>deploy key</strong>.</p>
      <button class="btn btn-primary" onclick="sshGenerateDeployKey()">${I.get("key", { size: 13, color: "#fff" })}<span>Generate deploy key</span></button>`;
    return;
  }
  el.innerHTML = `
    <div class="secret-box" style="margin-bottom:10px;">${escapeHtml(key.publicKey)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">${UI.copyButton(key.publicKey, "Copy public key")}<span class="mono-sm" style="align-self:center;">${escapeHtml(key.fingerprint)}</span></div>
    <ol style="font-size:13px;color:var(--text-secondary);padding-left:18px;line-height:1.7;margin-bottom:14px;">
      <li><strong>GitHub:</strong> repository → Settings → Deploy keys → Add deploy key (read access).</li>
      <li><strong>GitLab:</strong> repository → Settings → Repository → Deploy keys.</li>
      <li><strong>Bitbucket:</strong> repository settings → Access keys.</li>
      <li>Create the website with the <strong>SSH</strong> URL, e.g. <code>git@github.com:you/app.git</code>.</li>
    </ol>
    <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Test the connection</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      ${["github", "gitlab", "bitbucket"].map((h) => `<button class="btn btn-sm btn-secondary" onclick="sshTest('${h}')">${h[0].toUpperCase() + h.slice(1)}</button>`).join("")}
    </div>
    <div id="ssh-test-result" style="margin-top:10px;"></div>`;
}

async function sshGenerateDeployKey() {
  try {
    await api.generateDeployKey();
    toast.success("Deploy key created", "Add it to your repositories");
    loadDeployKey();
  } catch (err) {
    toast.error("Failed", err.message);
  }
}

async function sshTest(host) {
  const el = document.getElementById("ssh-test-result");
  el.innerHTML = `<span class="spinner spinner-sm"></span>`;
  try {
    const r = await api.testGitHost(host);
    el.innerHTML = `<div class="inline-status ${r.ok ? "ok" : "bad"}">${Icons.get(r.ok ? "checkCircle" : "alertCircle", { size: 13 })}<span>${r.ok ? `Connected to ${escapeHtml(r.host)}` : `${escapeHtml(r.host)}: not authorized yet`}</span></div><pre class="job-output" style="min-height:0;margin-top:6px;">${escapeHtml(r.output)}</pre>`;
  } catch (err) {
    el.innerHTML = `<span class="inline-status bad">${escapeHtml(err.message)}</span>`;
  }
}

window.renderSshKeys = renderSshKeys;
