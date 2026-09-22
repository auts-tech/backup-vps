/**
 * Live console for background jobs (installs, certbot, imports, "run now").
 * Polls /jobs/:id with an output offset until the job finishes.
 */
class JobConsole {
  /**
   * @param {string} jobId
   * @param {string} title
   * @param {object} opts { onDone(job) } — called once when the job finishes
   */
  static open(jobId, title, { onDone } = {}) {
    const I = window.Icons;
    const { overlay, close } = Modal.show(escapeHtml(title), `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span class="badge badge-info" id="job-status-badge"><span class="spinner spinner-sm"></span> Running</span>
        <button class="btn btn-sm btn-danger" id="job-cancel-btn">${I.get('x', { size: 12 })}<span>Cancel</span></button>
      </div>
      <pre class="job-output" id="job-output"></pre>
      <div class="form-hint" style="margin-top:8px;">You can close this window — the job keeps running on the server.</div>
    `, { width: 860 });

    const out = overlay.querySelector('#job-output');
    const badge = overlay.querySelector('#job-status-badge');
    const cancelBtn = overlay.querySelector('#job-cancel-btn');
    let offset = 0;
    let stopped = false;
    let notified = false;

    cancelBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      try { await api.cancelJob(jobId); } catch (err) { toast.error('Cancel failed', err.message); }
    });

    const finish = (job) => {
      stopped = true;
      cancelBtn.style.display = 'none';
      const ok = job.status === 'completed';
      badge.className = `badge ${ok ? 'badge-success' : 'badge-danger'}`;
      badge.innerHTML = `${I.get(ok ? 'checkCircle' : 'alertCircle', { size: 12 })} ${ok ? 'Completed' : job.status === 'cancelled' ? 'Cancelled' : `Failed (exit ${job.exitCode})`}`;
      if (!notified && onDone) {
        notified = true;
        onDone(job);
      }
    };

    const poll = async () => {
      if (stopped || !document.body.contains(overlay)) {
        // Window closed: keep watching quietly so onDone still fires
        if (!stopped && !notified) JobConsole.watch(jobId, offset, onDone, title);
        return;
      }
      try {
        const job = await api.getJob(jobId, offset);
        if (job.output) {
          const atBottom = out.scrollTop + out.clientHeight >= out.scrollHeight - 30;
          out.textContent += job.output;
          if (atBottom) out.scrollTop = out.scrollHeight;
        }
        offset = job.nextOffset;
        if (job.status !== 'running') return finish(job);
      } catch (err) {
        out.textContent += `\n[${err.message}]\n`;
        return finish({ status: 'failed', exitCode: '?' });
      }
      setTimeout(poll, 800);
    };
    poll();
    return { close };
  }

  /**
   * Background watcher used after the console window is closed.
   */
  static async watch(jobId, offset, onDone, title) {
    try {
      const job = await api.getJob(jobId, offset);
      if (job.status === 'running') {
        setTimeout(() => JobConsole.watch(jobId, job.nextOffset, onDone, title), 2000);
        return;
      }
      if (job.status === 'completed') toast.success('Finished', title);
      else toast.error('Job failed', title);
      if (onDone) onDone(job);
    } catch { }
  }

  /**
   * Convenience: await an API call that returns { jobId } and open its console.
   */
  static async run(promise, title, opts) {
    try {
      const res = await promise;
      if (res && res.jobId) return JobConsole.open(res.jobId, title, opts);
      toast.success('Done', title);
      opts?.onDone?.({ status: 'completed' });
    } catch (err) {
      toast.error('Failed', err.message);
    }
  }
}

window.JobConsole = JobConsole;
