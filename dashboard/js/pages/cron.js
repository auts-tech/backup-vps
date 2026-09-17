/**
 * Cron & Automation Management Page
 */
function renderCron(container) {
  container.innerHTML = `
    <div class="animate-in">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h2 style="font-size:20px;font-weight:700;">Cron Job Automation</h2>
          <p style="font-size:13px;color:var(--text-tertiary);margin-top:4px;">Manage scheduled backups and recurring VPS tasks</p>
        </div>
        <div class="btn-group">
          <button class="btn btn-secondary" onclick="loadCronJobs()">🔄 Refresh</button>
          <button class="btn btn-primary" onclick="showAddCronModal()">➕ Add Cron Job</button>
        </div>
      </div>

      <!-- Quick Preset Schedule Banner -->
      <div class="card mb-6 animate-in stagger-1">
        <div class="card-header">
          <h3 class="card-title">⚡ Quick Automation Presets</h3>
        </div>
        <div class="quick-actions">
          <div class="quick-action" onclick="quickAddCron('0 12 * * *', 'Daily Backup (12:00 PM UK)')">
            <div class="quick-action-icon" style="background:rgba(6,182,212,0.1);color:var(--color-cyan)">🕛</div>
            <div>
              <div class="quick-action-text">Daily Backup (12 PM)</div>
              <div class="quick-action-sub">Run all backups at 12:00 PM</div>
            </div>
          </div>
          <div class="quick-action" onclick="quickAddCron('0 0 * * *', 'Midnight Backup')">
            <div class="quick-action-icon" style="background:rgba(139,92,246,0.1);color:var(--color-purple)">🌙</div>
            <div>
              <div class="quick-action-text">Midnight Backup</div>
              <div class="quick-action-sub">Nightly backup at 00:00</div>
            </div>
          </div>
          <div class="quick-action" onclick="quickAddCron('0 2 * * 0', 'Weekly VPS Snapshot')">
            <div class="quick-action-icon" style="background:rgba(16,185,129,0.1);color:var(--color-green)">🗓️</div>
            <div>
              <div class="quick-action-text">Weekly Full Snapshot</div>
              <div class="quick-action-sub">Sundays at 02:00 AM</div>
            </div>
          </div>
          <div class="quick-action" onclick="quickAddCron('0 3 * * *', 'Daily Retention Cleanup')">
            <div class="quick-action-icon" style="background:rgba(249,115,22,0.1);color:var(--color-orange)">🧹</div>
            <div>
              <div class="quick-action-text">Cleanup Expired</div>
              <div class="quick-action-sub">Prune backups older than 30d</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Active Cron Table -->
      <div class="card animate-in stagger-2">
        <div class="card-header">
          <h3 class="card-title">Active System Cron Jobs</h3>
          <span class="badge badge-neutral" id="cron-count-badge">0 Jobs</span>
        </div>
        <div class="table-container">
          <table class="table">
            <thead>
              <tr>
                <th style="width:60px;">#</th>
                <th>Schedule</th>
                <th>Human Description</th>
                <th>Command</th>
                <th style="width:120px;">Actions</th>
              </tr>
            </thead>
            <tbody id="cron-table-body">
              <tr>
                <td colspan="5" style="text-align:center;padding:40px;">
                  <div class="spinner spinner-lg" style="margin:0 auto 12px;"></div>
                  <div style="color:var(--text-tertiary);">Loading crontab...</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  loadCronJobs();
}

async function loadCronJobs() {
  const tbody = document.getElementById('cron-table-body');
  const countBadge = document.getElementById('cron-count-badge');
  if (!tbody) return;

  try {
    const res = await api.getCronJobs();
    const jobs = res.jobs || [];

    if (countBadge) countBadge.textContent = `${jobs.length} Job${jobs.length === 1 ? '' : 's'}`;

    if (jobs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center;padding:40px;color:var(--text-tertiary);">
            No cron jobs currently configured. Use the presets above or click "Add Cron Job" to schedule one.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = jobs.map((job, idx) => {
      const desc = describeCron(job.schedule);
      return `
        <tr>
          <td><span style="color:var(--text-tertiary);">${idx + 1}</span></td>
          <td>
            <code style="background:var(--bg-tertiary);padding:4px 8px;border-radius:4px;font-size:12px;color:var(--color-cyan);">
              ${escapeHtml(job.schedule)}
            </code>
          </td>
          <td>
            <span style="font-weight:500;color:var(--text-primary);">${escapeHtml(desc)}</span>
          </td>
          <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(job.command)}">
            <span style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);">${escapeHtml(job.command)}</span>
          </td>
          <td>
            <button class="btn btn-sm btn-danger" onclick="deleteCronJob(${job.id || idx})">🗑️ Delete</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--color-red);padding:24px;">Failed to load crontab: ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

function describeCron(cronStr) {
  if (!cronStr) return 'Custom';
  const parts = cronStr.trim().split(/\s+/);
  if (parts.length < 5) return cronStr;

  const [min, hour, dom, mon, dow] = parts;
  if (min === '0' && hour === '12' && dom === '*' && mon === '*' && dow === '*') return 'Every day at 12:00 PM';
  if (min === '0' && hour === '0' && dom === '*' && mon === '*' && dow === '*') return 'Every day at midnight (00:00)';
  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every hour on the hour';
  if (min === '*/15' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every 15 minutes';
  if (min === '*/30' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every 30 minutes';
  if (dow === '0' && min === '0' && hour === '2') return 'Every Sunday at 2:00 AM';
  if (dow === '1' && min === '0' && hour === '0') return 'Every Monday at midnight';

  return `At minute ${min}, hour ${hour}`;
}

async function quickAddCron(schedule, label) {
  const command = `curl -s -X POST http://127.0.0.1:9090/api/v1/backups/trigger > /dev/null 2>&1`;
  try {
    await api.addCronJob(schedule, command);
    Toast.success(`Added preset: ${label}`);
    loadCronJobs();
  } catch (err) {
    Toast.error(err.message || 'Failed to add cron preset');
  }
}

function showAddCronModal() {
  Modal.show('Add Scheduled Cron Job', `
    <div class="form-group">
      <label class="form-label">Schedule Preset</label>
      <select id="modal-cron-preset" class="form-select" onchange="applyCronPreset(this.value)">
        <option value="custom">-- Custom Schedule --</option>
        <option value="0 12 * * *">Daily at 12:00 PM</option>
        <option value="0 0 * * *">Daily at Midnight (00:00)</option>
        <option value="0 * * * *">Every Hour</option>
        <option value="*/30 * * * *">Every 30 Minutes</option>
        <option value="0 2 * * 0">Weekly on Sunday at 2:00 AM</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Cron Expression (min hour day month weekday)</label>
      <input type="text" id="modal-cron-schedule" class="form-input" placeholder="0 12 * * *" required value="0 12 * * *">
      <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">5 standard cron fields: minute (0-59), hour (0-23), day (1-31), month (1-12), day of week (0-6)</div>
    </div>
    <div class="form-group">
      <label class="form-label">Command to Execute</label>
      <input type="text" id="modal-cron-command" class="form-input" placeholder="/root/.config/backup/backup.sh or curl command" value="curl -s -X POST http://127.0.0.1:9090/api/v1/backups/trigger > /dev/null 2>&1" required>
    </div>
  `, {
    submitText: 'Add Cron Job',
    onSubmit: async () => {
      const schedule = document.getElementById('modal-cron-schedule').value.trim();
      const command = document.getElementById('modal-cron-command').value.trim();

      if (!schedule || !command) {
        Toast.error('Please enter schedule and command');
        return false;
      }

      try {
        await api.addCronJob(schedule, command);
        Toast.success('Cron job scheduled successfully!');
        loadCronJobs();
        return true;
      } catch (err) {
        Toast.error(err.message || 'Failed to add cron job');
        return false;
      }
    }
  });
}

function applyCronPreset(val) {
  if (val !== 'custom') {
    const input = document.getElementById('modal-cron-schedule');
    if (input) input.value = val;
  }
}

async function deleteCronJob(id) {
  if (!confirm('Are you sure you want to remove this cron job?')) return;
  try {
    await api.deleteCronJob(id);
    Toast.success('Cron job removed');
    loadCronJobs();
  } catch (err) {
    Toast.error(err.message || 'Failed to delete cron job');
  }
}
