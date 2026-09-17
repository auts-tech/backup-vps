/**
 * Cron & Automation Management Page
 * Clean white theme with vector icons and deep black text
 */
function renderCron(container) {
  const I = window.Icons;

  container.innerHTML = `
    <div>
      <div class="page-header">
        <div class="page-header-title">
          <h2>Cron Automation</h2>
          <p>Schedule automatic backups and recurring maintenance on your VPS</p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" onclick="loadCronJobs()">
            ${I.get('refresh', { size: 13 })}
            <span>Refresh</span>
          </button>
          <button class="btn btn-primary" onclick="showAddCronModal()">
            ${I.get('plus', { size: 13, color: '#ffffff' })}
            <span>Add Cron Job</span>
          </button>
        </div>
      </div>

      <!-- Quick Preset Schedule Banner -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <h3 class="card-title">
            ${I.get('zap', { size: 16 })}
            <span>Quick Automation Presets</span>
          </h3>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;padding:16px;">
          <button class="btn btn-secondary" onclick="quickAddCron('0 12 * * *', 'Daily Backup (12:00 PM UK)')" style="justify-content:flex-start;padding:12px 14px;height:auto;">
            <div style="width:32px;height:32px;border-radius:6px;background:#f4f4f5;display:flex;align-items:center;justify-content:center;margin-right:10px;flex-shrink:0;">
              ${I.get('clock', { size: 16 })}
            </div>
            <div style="text-align:left;">
              <div style="font-weight:600;color:var(--text-primary);font-size:13px;">Daily at 12 PM</div>
              <div style="font-size:11px;color:var(--text-tertiary);">Trigger full backup at noon</div>
            </div>
          </button>

          <button class="btn btn-secondary" onclick="quickAddCron('0 0 * * *', 'Midnight Backup')" style="justify-content:flex-start;padding:12px 14px;height:auto;">
            <div style="width:32px;height:32px;border-radius:6px;background:#f4f4f5;display:flex;align-items:center;justify-content:center;margin-right:10px;flex-shrink:0;">
              ${I.get('moon', { size: 16 })}
            </div>
            <div style="text-align:left;">
              <div style="font-weight:600;color:var(--text-primary);font-size:13px;">Nightly at 00:00</div>
              <div style="font-size:11px;color:var(--text-tertiary);">Daily midnight backup</div>
            </div>
          </button>

          <button class="btn btn-secondary" onclick="quickAddCron('0 2 * * 0', 'Weekly VPS Snapshot')" style="justify-content:flex-start;padding:12px 14px;height:auto;">
            <div style="width:32px;height:32px;border-radius:6px;background:#f4f4f5;display:flex;align-items:center;justify-content:center;margin-right:10px;flex-shrink:0;">
              ${I.get('calendar', { size: 16 })}
            </div>
            <div style="text-align:left;">
              <div style="font-weight:600;color:var(--text-primary);font-size:13px;">Weekly Snapshot</div>
              <div style="font-size:11px;color:var(--text-tertiary);">Sundays at 02:00 AM</div>
            </div>
          </button>

          <button class="btn btn-secondary" onclick="quickAddCron('0 3 * * *', 'Daily Retention Cleanup')" style="justify-content:flex-start;padding:12px 14px;height:auto;">
            <div style="width:32px;height:32px;border-radius:6px;background:#f4f4f5;display:flex;align-items:center;justify-content:center;margin-right:10px;flex-shrink:0;">
              ${I.get('trash', { size: 16 })}
            </div>
            <div style="text-align:left;">
              <div style="font-weight:600;color:var(--text-primary);font-size:13px;">Prune Expired</div>
              <div style="font-size:11px;color:var(--text-tertiary);">Purge backups older than 30d</div>
            </div>
          </button>
        </div>
      </div>

      <!-- Active Cron Table -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">
            ${I.get('clock', { size: 16 })}
            <span>Active System Crontab Schedules</span>
          </h3>
          <span class="badge badge-neutral" id="cron-count-badge">0 Jobs</span>
        </div>
        <div class="table-container" style="border:none;border-radius:0;">
          <table class="table">
            <thead>
              <tr>
                <th style="width:50px;">#</th>
                <th>Schedule</th>
                <th>Human Interval</th>
                <th>Execution Command</th>
                <th style="text-align:right">Action</th>
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
    </div>
  `;

  loadCronJobs();
}

async function loadCronJobs() {
  const tbody = document.getElementById('cron-table-body');
  const countBadge = document.getElementById('cron-count-badge');
  const I = window.Icons;
  if (!tbody) return;

  try {
    const res = await api.getCronJobs();
    const jobs = res.jobs || [];

    if (countBadge) countBadge.textContent = `${jobs.length} Job${jobs.length === 1 ? '' : 's'}`;

    if (jobs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5">
            <div class="empty-state" style="padding:36px 20px;">
              <div class="empty-state-icon">${I.get('clock', { size: 20 })}</div>
              <div class="empty-state-title">No Cron Schedules Configured</div>
              <div class="empty-state-desc">Use the Quick Automation Presets above or add a custom schedule.</div>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = jobs.map((job, idx) => {
      const desc = describeCron(job.schedule);
      return `
        <tr>
          <td><span style="color:var(--text-tertiary);font-size:12px;">${idx + 1}</span></td>
          <td>
            <code style="font-weight:600;">${escapeHtml(job.schedule)}</code>
          </td>
          <td>
            <span style="font-weight:500;color:var(--text-primary);font-size:13px;">${escapeHtml(desc)}</span>
          </td>
          <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(job.command)}">
            <span style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);">${escapeHtml(job.command)}</span>
          </td>
          <td style="text-align:right">
            <button class="btn btn-sm btn-danger" onclick="deleteCronJob(${job.id || idx})" title="Delete Job">
              ${I.get('trash', { size: 12 })}
              <span>Delete</span>
            </button>
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
    toast.success('Preset Added', label);
    loadCronJobs();
  } catch (err) {
    toast.error('Failed', err.message || 'Failed to add cron preset');
  }
}

function showAddCronModal() {
  Modal.show('Add Scheduled Cron Job', `
    <div class="form-group">
      <label class="form-label">Schedule Preset</label>
      <select id="modal-cron-preset" class="form-select" onchange="applyCronPreset(this.value)">
        <option value="custom">-- Select a Preset or Enter Custom --</option>
        <option value="0 12 * * *">Daily at 12:00 PM</option>
        <option value="0 0 * * *">Daily at Midnight (00:00)</option>
        <option value="0 * * * *">Every Hour</option>
        <option value="*/30 * * * *">Every 30 Minutes</option>
        <option value="0 2 * * 0">Weekly on Sunday at 2:00 AM</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Cron Expression *</label>
      <input type="text" id="modal-cron-schedule" class="form-input" placeholder="0 12 * * *" required value="0 12 * * *">
      <div class="form-hint">Format: <code>minute hour day-of-month month day-of-week</code></div>
    </div>
    <div class="form-group">
      <label class="form-label">Command to Execute *</label>
      <input type="text" id="modal-cron-command" class="form-input" value="curl -s -X POST http://127.0.0.1:9090/api/v1/backups/trigger > /dev/null 2>&1" required>
    </div>
  `, {
    submitText: 'Save Schedule',
    onSubmit: async () => {
      const schedule = document.getElementById('modal-cron-schedule').value.trim();
      const command = document.getElementById('modal-cron-command').value.trim();

      if (!schedule || !command) {
        toast.error('Required', 'Please specify both schedule and command');
        throw new Error('Please specify both schedule and command');
      }

      await api.addCronJob(schedule, command);
      toast.success('Cron Saved', 'Cron schedule registered with system');
      loadCronJobs();
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
  Modal.confirm('Delete Cron Job', 'Are you sure you want to remove this scheduled cron job from the system?', async () => {
    try {
      await api.deleteCronJob(id);
      toast.success('Deleted', 'Cron schedule removed');
      loadCronJobs();
    } catch (err) {
      toast.error('Failed', err.message || 'Failed to delete cron job');
    }
  });
}

window.renderCron = renderCron;
