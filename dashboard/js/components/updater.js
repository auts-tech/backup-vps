/**
 * Panel self-update: checks git for new commits, shows a "What's new" popup,
 * runs the update with live progress, waits for the restart, then signs out
 * so the user logs in to the new version.
 */
const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000;
const UPDATE_STEPS = [
  ["download", "Downloading changes"],
  ["deps", "Installing dependencies"],
  ["verify", "Verifying files"],
  ["restart", "Restarting panel"],
  ["reconnect", "Reconnecting"],
];

function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return "just now";
  const units = [
    [31536000, "year"],
    [2592000, "month"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [secs, name] of units) {
    const n = Math.floor(s / secs);
    if (n >= 1) return `${n} ${name}${n > 1 ? "s" : ""} ago`;
  }
  return "";
}

class PanelUpdater {
  static info = null;
  static timer = null;
  static overlay = null;
  static busy = false;

  static init() {
    PanelUpdater.renderVersion();
    clearInterval(PanelUpdater.timer);
    // Fresh check right after login (so a just-pushed commit shows up); background checks may use the server cache
    setTimeout(() => PanelUpdater.check({ auto: true, force: true }), 2500);
    PanelUpdater.timer = setInterval(
      () => PanelUpdater.check({ auto: true }),
      UPDATE_CHECK_INTERVAL,
    );
  }

  static async renderVersion() {
    const el = document.getElementById("sidebar-version");
    if (!el) return;
    try {
      const v = await api.getVersion();
      el.innerHTML = `v${escapeHtml(v.version)}${v.commit ? ` · <span class="mono-sm">${escapeHtml(v.commit.short)}</span>` : ""}`;
      el.title = v.commit
        ? `${v.commit.subject}\n${new Date(v.commit.date).toLocaleString()}\nClick to check for updates`
        : "Click to check for updates";
    } catch {}
  }

  static async check({ auto = false, force = false } = {}) {
    if (PanelUpdater.busy) return;
    let info;
    try {
      info = await api.checkUpdate(force || !auto);
    } catch (err) {
      if (!auto) toast.error("Update check failed", err.message);
      return;
    }
    PanelUpdater.info = info;
    PanelUpdater.renderIndicator();
    let dismissed = null;
    try {
      dismissed = localStorage.getItem("update_dismissed");
    } catch {}
    if (!auto) PanelUpdater.showPopup();
    else if (
      info.updateAvailable &&
      info.latest &&
      dismissed !== info.latest.hash
    )
      PanelUpdater.showPopup();
  }

  static renderIndicator() {
    const btn = document.getElementById("topbar-update-btn");
    if (!btn) return;
    const info = PanelUpdater.info;
    btn.style.display = "inline-flex";
    const label = btn.querySelector("span:last-child");
    if (!label) return;
    label.textContent = info?.updateAvailable
      ? `Update available (${info.behind})`
      : "Check for updates";
    btn.title = info?.updateAvailable
      ? "A new version of the panel is available"
      : "Check for panel updates";
  }

  // ── Popup ──────────────────────────────────────────────────

  static open(html, { locked = false } = {}) {
    PanelUpdater.close();
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay update-overlay";
    overlay.innerHTML = `<div class="modal update-modal">${html}</div>`;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay && !PanelUpdater.busy && !locked)
        PanelUpdater.close();
    });
    document.body.appendChild(overlay);
    PanelUpdater.overlay = overlay;
    return overlay;
  }

  static close() {
    PanelUpdater.overlay?.remove();
    PanelUpdater.overlay = null;
  }

  static header(icon, color, title, subtitle) {
    return `
      <div class="update-hero">
        <div class="update-hero-icon" style="background:${color}1a;color:${color};">${window.Icons.get(icon, { size: 22, color })}</div>
        <div>
          <div class="update-title">${title}</div>
          <div class="update-subtitle">${subtitle}</div>
        </div>
        <button class="modal-close" style="margin-left:auto;" onclick="PanelUpdater.close()" ${PanelUpdater.busy ? "disabled" : ""}>${window.Icons.get("x", { size: 16 })}</button>
      </div>`;
  }

  static versionBox(info) {
    const cur = info.commit;
    const next = info.latest;
    return `
      <div class="update-versions">
        <div>
          <div class="update-v-label">Installed</div>
          <div class="update-v-value">v${escapeHtml(info.version)} · ${escapeHtml(cur?.short || "—")}</div>
          <div class="update-v-date">${escapeHtml(timeAgo(cur?.date))}</div>
        </div>
        ${window.Icons.get("arrowRight", { size: 18, color: "var(--text-tertiary)" })}
        <div>
          <div class="update-v-label">Available</div>
          <div class="update-v-value" style="color:var(--color-green);">${escapeHtml(next?.short || "—")}</div>
          <div class="update-v-date">${escapeHtml(timeAgo(next?.date))} · ${escapeHtml(info.upstream || "")}</div>
        </div>
      </div>`;
  }

  static showPopup() {
    const info = PanelUpdater.info;
    const I = window.Icons;
    if (!info) return;

    if (!info.supported) {
      PanelUpdater.open(`${PanelUpdater.header("info", "#2563eb", "Automatic updates unavailable", `v${escapeHtml(info.version)}`)}
        <div class="modal-body"><p style="font-size:13px;color:var(--text-secondary);">${escapeHtml(info.reason)}</p></div>
        <div class="modal-footer"><button class="btn btn-secondary" onclick="PanelUpdater.close()">Close</button></div>`);
      return;
    }
    if (info.error) {
      PanelUpdater.open(`${PanelUpdater.header("alertTriangle", "#d97706", "Couldn’t check for updates", escapeHtml(info.remoteUrl || info.upstream || ""))}
        <div class="modal-body">
          <pre class="job-output" style="min-height:0;">${escapeHtml(info.error)}</pre>
          <p class="form-hint" style="margin-top:8px;">The server needs access to the git remote (for private repositories: a deploy key or saved credentials for root).</p>
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" onclick="PanelUpdater.close()">Close</button><button class="btn btn-primary" onclick="PanelUpdater.check({ force: true })">Try again</button></div>`);
      return;
    }
    if (!info.updateAvailable) {
      PanelUpdater.open(`${PanelUpdater.header("checkCircle", "#16a34a", "You’re up to date", `v${escapeHtml(info.version)} · ${escapeHtml(info.commit?.short || "")} on ${escapeHtml(info.branch)}`)}
        <div class="modal-body">
          <dl class="kv">
            <dt>Latest change</dt><dd>${escapeHtml(info.commit?.subject || "—")}</dd>
            <dt>Installed</dt><dd>${escapeHtml(info.commit?.date ? new Date(info.commit.date).toLocaleString() : "—")}</dd>
            <dt>Source</dt><dd class="mono-sm">${escapeHtml(info.remoteUrl || info.upstream)}</dd>
            <dt>Checked</dt><dd>${escapeHtml(timeAgo(info.checkedAt))}</dd>
          </dl>
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" onclick="PanelUpdater.check({ force: true })">${I.get("refresh", { size: 13 })}<span>Check again</span></button><button class="btn btn-primary" onclick="PanelUpdater.close()">Done</button></div>`);
      return;
    }

    const commits = info.commits
      .map(
        (c) => `
      <li class="update-commit">
        <span class="update-commit-dot"></span>
        <div style="min-width:0;">
          <div class="update-commit-subject">${escapeHtml(c.subject)}</div>
          <div class="update-commit-meta">${escapeHtml(c.short)} · ${escapeHtml(c.author)} · ${escapeHtml(timeAgo(c.date))}</div>
        </div>
      </li>`,
      )
      .join("");
    const notices = [
      info.depsChanged
        ? `<div class="alert alert-info">${I.get("package", { size: 15 })}<div>Includes new dependencies — they are installed automatically.</div></div>`
        : "",
      info.setupChanged
        ? `<div class="alert alert-warning">${I.get("terminal", { size: 15 })}<div><strong>setup.sh changed.</strong> After updating, run <code>sudo bash setup.sh</code> from the Terminal to apply system-level changes.</div></div>`
        : "",
      info.blocked
        ? `<div class="alert alert-danger">${I.get("alertCircle", { size: 15 })}<div>${escapeHtml(info.blocked)}</div></div>`
        : "",
    ].join("");

    PanelUpdater.open(`${PanelUpdater.header("sparkles", "#16a34a", "Update available", `${info.behind} new change${info.behind === 1 ? "" : "s"} ready to install`)}
      <div class="modal-body">
        ${PanelUpdater.versionBox(info)}
        <div class="update-section-title">What’s new</div>
        <ul class="update-commits">${commits}</ul>
        ${info.behind > info.commits.length ? `<div class="form-hint">…and ${info.behind - info.commits.length} more</div>` : ""}
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px;">${notices}</div>
      </div>
      <div class="modal-footer" style="justify-content:space-between;">
        <span class="form-hint" style="margin:0;max-width:300px;">You’ll be signed out while the panel restarts — usually under 30 seconds.</span>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" onclick="PanelUpdater.later()">Later</button>
          <button class="btn btn-primary" onclick="PanelUpdater.start()" ${info.canUpdate ? "" : "disabled"}>${I.get("download", { size: 13, color: "#fff" })}<span>Update now</span></button>
        </div>
      </div>`);
  }

  static later() {
    try {
      localStorage.setItem(
        "update_dismissed",
        PanelUpdater.info?.latest?.hash || "",
      );
    } catch {}
    PanelUpdater.close();
    toast.info(
      "Update postponed",
      "Use “Update available” in the top bar when you’re ready",
    );
  }

  // ── Running the update ────────────────────────────────────

  static renderProgress(active, { failed = false, detail = "" } = {}) {
    const order = UPDATE_STEPS.map((s) => s[0]);
    const activeIdx = order.indexOf(active);
    const list = UPDATE_STEPS.map(([key, label], i) => {
      let state =
        i < activeIdx
          ? "done"
          : i === activeIdx
            ? failed
              ? "failed"
              : "active"
            : "pending";
      if (active === "complete") state = "done";
      const icon =
        state === "done"
          ? window.Icons.get("checkCircle", {
              size: 18,
              color: "var(--color-green)",
            })
          : state === "failed"
            ? window.Icons.get("xCircle", {
                size: 18,
                color: "var(--color-red)",
              })
            : state === "active"
              ? '<span class="spinner spinner-sm"></span>'
              : '<span class="update-step-idle"></span>';
      return `<li class="update-step ${state}">${icon}<span>${label}</span></li>`;
    }).join("");
    const stepsEl = PanelUpdater.overlay?.querySelector("#update-steps");
    if (stepsEl) stepsEl.innerHTML = list;
    const detailEl = PanelUpdater.overlay?.querySelector("#update-detail");
    if (detailEl && detail) detailEl.innerHTML = detail;
  }

  static async start() {
    const info = PanelUpdater.info;
    if (!info?.canUpdate) return;
    PanelUpdater.busy = true;
    const target = info.latest;
    PanelUpdater.open(
      `${PanelUpdater.header("download", "#09090b", "Updating the panel…", `Installing ${escapeHtml(target?.short || "latest")} — please keep this window open`)}
      <div class="modal-body">
        <ul class="update-steps" id="update-steps"></ul>
        <div id="update-detail" class="update-detail"></div>
        <details class="update-log"><summary>Show details</summary><pre class="job-output" id="update-output" style="max-height:260px;"></pre></details>
      </div>
      <div class="modal-footer" id="update-footer" style="display:none;"></div>`,
      { locked: true },
    );
    PanelUpdater.renderProgress("download");

    let bootId = null;
    try {
      bootId = (
        await (await fetch("/api/v1/health", { cache: "no-store" })).json()
      ).bootId;
    } catch {}

    let jobId;
    try {
      jobId = (await api.applyUpdate()).jobId;
    } catch (err) {
      return PanelUpdater.fail("download", err.message);
    }

    // Follow the job output; "::step <name>" lines drive the progress list
    let offset = 0;
    let step = "download";
    let partial = ""; // output can arrive mid-line; keep the unfinished tail for the next poll
    const out = PanelUpdater.overlay.querySelector("#update-output");
    while (true) {
      let job;
      try {
        job = await api.getJob(jobId, offset);
      } catch (err) {
        // The panel may already be restarting right after the job finished
        if (step === "restart") break;
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      offset = job.nextOffset;
      const lines = (partial + job.output).split("\n");
      partial = job.status === "running" ? lines.pop() : "";
      for (const line of lines) {
        const m = line.match(/^::step (\w+)/);
        if (m) {
          step = m[1];
          PanelUpdater.renderProgress(step);
        } else if (line && out) {
          out.textContent += line + "\n";
          out.scrollTop = out.scrollHeight;
        }
      }
      if (job.status === "completed") break;
      if (job.status !== "running") {
        const rolledBack = /Rolling back/.test(out?.textContent || "");
        return PanelUpdater.fail(
          step,
          rolledBack
            ? "The update failed and was rolled back — the panel is still running the previous version."
            : "The update failed. The panel was not restarted.",
        );
      }
      await new Promise((r) => setTimeout(r, 800));
    }

    PanelUpdater.renderProgress("restart");
    const back = await PanelUpdater.waitForRestart(bootId);
    if (!back) {
      PanelUpdater.renderProgress("reconnect", {
        failed: true,
        detail:
          "The panel hasn’t come back yet. It may still be starting — reload this page in a minute.",
      });
      PanelUpdater.showFooter(
        '<button class="btn btn-primary" onclick="location.reload()">Reload</button>',
      );
      PanelUpdater.busy = false;
      return;
    }

    PanelUpdater.renderProgress("complete", {
      detail: `<div class="alert alert-success">${window.Icons.get("checkCircle", { size: 16 })}<div><strong>Update complete.</strong> Signing you out so you can log in to the new version…</div></div>`,
    });
    try {
      sessionStorage.setItem(
        "panel_updated",
        JSON.stringify({ short: target?.short, subject: target?.subject }),
      );
      localStorage.removeItem("update_dismissed");
    } catch {}
    setTimeout(() => {
      api.clearToken();
      location.reload(); // fresh page so the new dashboard code loads
    }, 2200);
  }

  static async waitForRestart(oldBootId, timeoutMs = 120000) {
    const started = Date.now();
    PanelUpdater.renderProgress("restart");
    let sawDown = false;
    while (Date.now() - started < timeoutMs) {
      await new Promise((r) => setTimeout(r, 1200));
      try {
        const res = await fetch("/api/v1/health", { cache: "no-store" });
        const h = await res.json();
        if (h.bootId && h.bootId !== oldBootId) {
          PanelUpdater.renderProgress("reconnect");
          await new Promise((r) => setTimeout(r, 700));
          return true;
        }
      } catch {
        if (!sawDown) {
          sawDown = true;
          PanelUpdater.renderProgress("reconnect");
        }
      }
    }
    return false;
  }

  static fail(step, message) {
    PanelUpdater.busy = false;
    PanelUpdater.renderProgress(step, {
      failed: true,
      detail: `<div class="alert alert-danger">${window.Icons.get("alertCircle", { size: 16 })}<div>${escapeHtml(message)}</div></div>`,
    });
    PanelUpdater.overlay
      ?.querySelector(".update-log")
      ?.setAttribute("open", "");
    PanelUpdater.showFooter(
      '<button class="btn btn-secondary" onclick="PanelUpdater.close()">Close</button>',
    );
  }

  static showFooter(html) {
    const footer = PanelUpdater.overlay?.querySelector("#update-footer");
    if (!footer) return;
    footer.innerHTML = html;
    footer.style.display = "flex";
  }
}

window.PanelUpdater = PanelUpdater;
