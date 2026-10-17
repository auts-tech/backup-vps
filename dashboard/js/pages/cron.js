/**
 * Cron & Automation Management Page
 * Built-in panel tasks, custom commands, enable/disable, run now, live schedule preview
 */
let cronState = { jobs: [], tasks: [], daemon: null, logFile: "" };

function renderCron(container) {
  const I = window.Icons;

  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>Cron Jobs</h2>
          <p>Schedule backups and recurring commands. Times use the server's timezone.</p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" onclick="loadCronJobs()">
            ${I.get("refresh", { size: 13 })}
            <span>Refresh</span>
          </button>
          <button class="btn btn-primary" onclick="showCronModal()">
            ${I.get("plus", { size: 13, color: "#ffffff" })}
            <span>Add Cron Job</span>
          </button>
        </div>
      </div>

      <div id="cron-daemon-banner"></div>

      <!-- Quick presets -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <h3 class="card-title">
            ${I.get("zap", { size: 16 })}
            <span>Quick Automation Presets</span>
          </h3>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;padding:16px;">
          ${cronPresetButton("0 12 * * *", "backup-all", "Daily at 12 PM", "Backup all projects at noon", "clock")}
          ${cronPresetButton("0 0 * * *", "backup-all", "Nightly at 00:00", "Backup all projects at midnight", "moon")}
          ${cronPresetButton("0 2 * * 0", "vps-snapshot", "Weekly Snapshot", "Full VPS snapshot, Sundays 02:00", "calendar")}
          ${cronPresetButton("0 3 * * *", "cleanup", "Prune Expired", "Delete backups past retention, 03:00", "trash")}
        </div>
      </div>

      <!-- Jobs table -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <h3 class="card-title">
            ${I.get("clock", { size: 16 })}
            <span>Scheduled Jobs</span>
          </h3>
          <span class="badge badge-neutral" id="cron-count-badge">0 Jobs</span>
        </div>
        <div class="table-container" style="border:none;border-radius:0;">
          <table class="table">
            <thead>
              <tr>
                <th style="width:70px;">Active</th>
                <th>Job</th>
                <th>Schedule</th>
                <th>Next Run</th>
                <th style="text-align:right">Actions</th>
              </tr>
            </thead>
            <tbody id="cron-table-body">
              <tr>
                <td colspan="5" style="text-align:center;padding:40px;">
                  <div class="spinner spinner-lg" style="margin:0 auto 12px;"></div>
                  <div style="color:var(--text-tertiary);font-size:13px;">Reading server crontab...</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Cron log -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">
            ${I.get("fileText", { size: 16 })}
            <span>Cron Output Log</span>
          </h3>
          <button class="btn btn-sm btn-secondary" onclick="loadCronLog()">${I.get("refresh", { size: 12 })}<span>Reload</span></button>
        </div>
        <div class="card-body">
          <pre class="job-output" id="cron-log" style="max-height:320px;">Loading…</pre>
          <div class="form-hint" id="cron-log-path" style="margin-top:6px;"></div>
        </div>
      </div>
    </div>
  `;

  loadCronJobs();
  loadCronLog();
}

function cronPresetButton(schedule, task, title, desc, icon) {
  const I = window.Icons;
  return `
    <button class="btn btn-secondary" onclick="quickAddCron('${schedule}', '${task}', '${escapeHtml(title)}')" style="justify-content:flex-start;padding:12px 14px;height:auto;">
      <div style="width:32px;height:32px;border-radius:6px;background:#f4f4f5;display:flex;align-items:center;justify-content:center;margin-right:10px;flex-shrink:0;">
        ${I.get(icon, { size: 16 })}
      </div>
      <div style="text-align:left;white-space:normal;">
        <div style="font-weight:600;color:var(--text-primary);font-size:13px;">${title}</div>
        <div style="font-size:11px;color:var(--text-tertiary);">${desc}</div>
      </div>
    </button>
  `;
}

function formatNextRun(iso) {
  if (!iso) return '<span style="color:var(--text-tertiary);">—</span>';
  const d = new Date(iso);
  const mins = Math.round((d - Date.now()) / 60000);
  let rel;
  if (mins < 60) rel = `in ${mins} min`;
  else if (mins < 1440) rel = `in ${Math.round(mins / 60)} h`;
  else rel = `in ${Math.round(mins / 1440)} d`;
  return `<div style="font-size:13px;">${escapeHtml(d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</div><div style="font-size:11px;color:var(--text-tertiary);">${rel}</div>`;
}

async function loadCronJobs() {
  const tbody = document.getElementById("cron-table-body");
  const countBadge = document.getElementById("cron-count-badge");
  const I = window.Icons;
  if (!tbody) return;

  try {
    const [res, tasksRes] = await Promise.all([
      api.getCronJobs(),
      api.getCronTasks(),
    ]);
    cronState = {
      jobs: res.jobs || [],
      tasks: tasksRes.tasks || [],
      daemon: res.daemon,
      logFile: res.logFile,
    };
    const jobs = cronState.jobs;

    renderCronDaemonBanner(res.daemon);
    if (countBadge)
      countBadge.textContent = `${jobs.length} Job${jobs.length === 1 ? "" : "s"}`;

    if (jobs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5">
            <div class="empty-state" style="padding:36px 20px;">
              <div class="empty-state-icon">${I.get("clock", { size: 20 })}</div>
              <div class="empty-state-title">No Cron Jobs Yet</div>
              <div class="empty-state-desc">Use a preset above or add a custom schedule.</div>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = jobs
      .map((job) => {
        const task = cronState.tasks.find((t) => t.command === job.command);
        const title = job.label || task?.label || "";
        return `
        <tr style="${job.enabled ? "" : "opacity:0.6;"}">
          <td>
            <label class="switch" title="${job.enabled ? "Disable" : "Enable"}">
              <input type="checkbox" ${job.enabled ? "checked" : ""} onchange="toggleCronJob('${job.id}', this.checked)">
              <span class="switch-slider"></span>
            </label>
          </td>
          <td style="max-width:420px;">
            ${title ? `<div style="font-weight:600;font-size:13px;margin-bottom:2px;">${escapeHtml(title)}</div>` : ""}
            <div class="truncate mono-sm" title="${escapeHtml(job.command)}">${escapeHtml(job.command)}</div>
          </td>
          <td>
            <code style="font-weight:600;">${escapeHtml(job.schedule)}</code>
            <div style="font-size:12px;color:${job.valid ? "var(--text-secondary)" : "var(--color-red)"};margin-top:3px;">${escapeHtml(job.valid ? job.human : job.error)}</div>
          </td>
          <td>${job.enabled ? formatNextRun(job.nextRun) : '<span class="badge badge-neutral">Paused</span>'}</td>
          <td style="text-align:right;white-space:nowrap;">
            <button class="btn btn-sm btn-secondary" onclick="runCronJobNow('${job.id}')" title="Run now and show output">${I.get("play", { size: 12 })}<span>Run</span></button>
            <button class="btn btn-sm btn-secondary" onclick="showCronModal('${job.id}')" title="Edit">${I.get("edit", { size: 12 })}</button>
            <button class="btn btn-sm btn-danger" onclick="deleteCronJob('${job.id}')" title="Delete">${I.get("trash", { size: 12 })}</button>
          </td>
        </tr>
      `;
      })
      .join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--color-red);padding:24px;">Failed to load crontab: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderCronDaemonBanner(daemon) {
  const el = document.getElementById("cron-daemon-banner");
  if (!el) return;
  if (!daemon || daemon.running) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `
    <div class="alert alert-warning" style="margin-bottom:20px;">
      ${window.Icons.get("alertTriangle", { size: 16 })}
      <div style="flex:1;">
        <strong>The cron service is ${daemon.installed ? "not running" : "not installed"}.</strong>
        Scheduled jobs will not run until it is started.
      </div>
      <button class="btn btn-sm btn-primary" onclick="startCronDaemon()">${daemon.installed ? "Start cron" : "Install & start cron"}</button>
    </div>
  `;
}

async function startCronDaemon() {
  try {
    const res = await api.startCronDaemon();
    if (res.jobId)
      JobConsole.open(res.jobId, "Install cron service", {
        onDone: loadCronJobs,
      });
    else {
      toast.success("Cron started", "The cron service is running");
      loadCronJobs();
    }
  } catch (err) {
    toast.error("Failed", err.message);
  }
}

async function loadCronLog() {
  const el = document.getElementById("cron-log");
  if (!el) return;
  try {
    const res = await api.getCronLog(200);
    el.textContent = res.lines.length
      ? res.lines.join("\n")
      : "No output yet. Built-in tasks write here every time they run.";
    el.scrollTop = el.scrollHeight;
    const p = document.getElementById("cron-log-path");
    if (p) p.innerHTML = `Log file: <code>${escapeHtml(res.path)}</code>`;
  } catch (err) {
    el.textContent = `Could not read log: ${err.message}`;
  }
}

async function quickAddCron(schedule, task, label) {
  try {
    await api.addCronJob({ schedule, task, label });
    toast.success("Preset Added", label);
    loadCronJobs();
  } catch (err) {
    toast.error("Failed", err.message || "Failed to add cron preset");
  }
}

function showCronModal(jobId) {
  const job = jobId ? cronState.jobs.find((j) => j.id === jobId) : null;
  const matchedTask = job
    ? cronState.tasks.find((t) => t.command === job.command)
    : null;
  const taskOptions = cronState.tasks
    .map(
      (t) =>
        `<option value="${escapeHtml(t.id)}" ${matchedTask?.id === t.id ? "selected" : ""}>${escapeHtml(t.label)}</option>`,
    )
    .join("");
  const isCustom = job ? !matchedTask : false;

  Modal.show(
    job ? "Edit Cron Job" : "Add Cron Job",
    `
    <div class="form-group">
      <label class="form-label">What should run?</label>
      <select id="cron-task" class="form-select" onchange="onCronTaskChange()">
        <optgroup label="Panel tasks">${taskOptions}</optgroup>
        <option value="__custom" ${isCustom ? "selected" : ""}>Custom command…</option>
      </select>
    </div>
    <div class="form-group" id="cron-command-group" style="display:${isCustom ? "block" : "none"};">
      <label class="form-label">Command *</label>
      <input type="text" id="cron-command" class="form-input mono-input" placeholder="/usr/bin/php /var/www/app/artisan schedule:run" value="${escapeHtml(isCustom ? job.command : "")}">
      <label class="form-check" style="margin-top:8px;">
        <input type="checkbox" id="cron-log-output" ${job ? "" : "checked"}>
        <span style="font-size:12px;color:var(--text-secondary);">Save output to the cron log</span>
      </label>
      <div class="form-hint">Use absolute paths — cron runs with a minimal PATH.</div>
    </div>
    <div class="form-group">
      <label class="form-label">Label</label>
      <input type="text" id="cron-label" class="form-input" placeholder="e.g. Laravel scheduler" value="${escapeHtml(job?.label || "")}">
    </div>
    <div class="form-group">
      <label class="form-label">Schedule *</label>
      <div style="display:flex;gap:8px;">
        <select id="cron-preset" class="form-select" style="max-width:220px;" onchange="applyCronPreset(this.value)">
          <option value="">Common schedules…</option>
          <option value="* * * * *">Every minute</option>
          <option value="*/5 * * * *">Every 5 minutes</option>
          <option value="*/15 * * * *">Every 15 minutes</option>
          <option value="0 * * * *">Every hour</option>
          <option value="0 */6 * * *">Every 6 hours</option>
          <option value="0 0 * * *">Daily at midnight</option>
          <option value="0 12 * * *">Daily at noon</option>
          <option value="0 9 * * 1-5">Weekdays at 09:00</option>
          <option value="0 2 * * 0">Sundays at 02:00</option>
          <option value="0 0 1 * *">Monthly (1st, 00:00)</option>
          <option value="@reboot">At server startup</option>
        </select>
        <input type="text" id="cron-schedule" class="form-input mono-input" placeholder="0 12 * * *" value="${escapeHtml(job?.schedule || "0 12 * * *")}" oninput="previewCronSchedule()">
      </div>
      <div class="form-hint">minute (0-59) · hour (0-23) · day of month (1-31) · month (1-12) · day of week (0-6, Sun=0)</div>
      <div id="cron-preview" class="cron-preview"></div>
    </div>
  `,
    {
      submitText: job ? "Save Changes" : "Add Job",
      width: 600,
      onSubmit: async () => {
        const taskId = document.getElementById("cron-task").value;
        const payload = {
          schedule: document.getElementById("cron-schedule").value.trim(),
          label: document.getElementById("cron-label").value.trim(),
        };
        if (taskId === "__custom") {
          payload.command = document
            .getElementById("cron-command")
            .value.trim();
          payload.logOutput =
            document.getElementById("cron-log-output").checked;
          if (!payload.command) throw new Error("Enter a command");
        } else {
          payload.task = taskId;
        }
        if (job) await api.updateCronJob(job.id, payload);
        else await api.addCronJob(payload);
        toast.success(
          job ? "Cron Updated" : "Cron Added",
          payload.label || payload.schedule,
        );
        loadCronJobs();
      },
    },
  );
  previewCronSchedule();
}

function onCronTaskChange() {
  const custom = document.getElementById("cron-task").value === "__custom";
  document.getElementById("cron-command-group").style.display = custom
    ? "block"
    : "none";
}

function applyCronPreset(val) {
  if (!val) return;
  const input = document.getElementById("cron-schedule");
  if (input) input.value = val;
  previewCronSchedule();
}

let cronPreviewTimer = null;
function previewCronSchedule() {
  clearTimeout(cronPreviewTimer);
  cronPreviewTimer = setTimeout(async () => {
    const input = document.getElementById("cron-schedule");
    const out = document.getElementById("cron-preview");
    if (!input || !out) return;
    try {
      const res = await api.previewCron(input.value.trim());
      if (!res.valid) {
        out.className = "cron-preview invalid";
        out.textContent = res.error;
        return;
      }
      out.className = "cron-preview";
      const next = res.nextRuns.map((d) =>
        new Date(d).toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      out.innerHTML = `<strong>${escapeHtml(res.human)}</strong>${next.length ? `<div style="margin-top:4px;">Next: ${next.map(escapeHtml).join(" · ")}</div>` : ""}`;
    } catch {}
  }, 250);
}

async function toggleCronJob(id, enabled) {
  try {
    await api.toggleCronJob(id, enabled);
    toast.success(enabled ? "Job enabled" : "Job paused", "");
  } catch (err) {
    toast.error("Failed", err.message);
  }
  loadCronJobs();
}

async function runCronJobNow(id) {
  const job = cronState.jobs.find((j) => j.id === id);
  await JobConsole.run(
    api.runCronJob(id),
    `Run: ${job?.label || job?.command || "cron job"}`,
    { onDone: loadCronLog },
  );
}

function deleteCronJob(id) {
  const job = cronState.jobs.find((j) => j.id === id);
  Modal.confirm(
    "Delete Cron Job",
    `Remove <code>${escapeHtml(job?.schedule || "")}</code> ${escapeHtml(job?.label || job?.command || "")} from the crontab?`,
    async () => {
      await api.deleteCronJob(id);
      toast.success("Deleted", "Cron job removed");
      loadCronJobs();
    },
  );
}

window.renderCron = renderCron;
