/**
 * Live console for background jobs (installs, certbot, imports, deployments).
 * Polls /jobs/:id with an output offset until the job finishes. Jobs made of
 * steps (website setup, deployments) also show a live checklist.
 */
const STEP_ICONS = {
  pending: '<span class="step-idle"></span>',
  running: '<span class="spinner spinner-sm"></span>',
  done: () =>
    Icons.get("checkCircle", { size: 15, color: "var(--color-green)" }),
  warning: () =>
    Icons.get("alertTriangle", { size: 15, color: "var(--color-amber)" }),
  failed: () => Icons.get("xCircle", { size: 15, color: "var(--color-red)" }),
  skipped: '<span class="step-skip">–</span>',
};

class JobConsole {
  static stepsHtml(steps) {
    // Skipped steps (not needed for this website) are left out
    return (steps || [])
      .filter((s) => s.status !== "skipped")
      .map((s) => {
        const icon =
          typeof STEP_ICONS[s.status] === "function"
            ? STEP_ICONS[s.status]()
            : STEP_ICONS[s.status] || "";
        const time =
          s.startedAt && s.finishedAt
            ? `<span class="step-time">${UI.duration(Math.max(0, Math.round((new Date(s.finishedAt) - new Date(s.startedAt)) / 1000)))}</span>`
            : "";
        return `<li class="step step-${s.status}"><span class="step-icon">${icon}</span><span class="step-title">${escapeHtml(s.title)}${s.error && s.status !== "done" ? `<span class="step-error">${escapeHtml(s.error)}</span>` : ""}</span>${time}</li>`;
      })
      .join("");
  }

  /**
   * Render a job console into `container` (inline on a page).
   * opts: { onDone(job), compact, showCancel }
   * Returns { stop() } — call it when leaving the page.
   */
  static attach(container, jobId, { onDone, showCancel = true } = {}) {
    const I = window.Icons;
    container.innerHTML = `
      <div class="job-console">
        <div class="job-console-head">
          <span class="badge badge-info job-status"><span class="spinner spinner-sm"></span> Running</span>
          <span class="job-elapsed muted"></span>
          <div style="flex:1;"></div>
          ${showCancel ? `<button class="btn btn-sm btn-danger job-cancel">${I.get("x", { size: 12 })}<span>Cancel</span></button>` : ""}
        </div>
        <ul class="job-steps" style="display:none;"></ul>
        <pre class="job-output"></pre>
      </div>`;
    const out = container.querySelector(".job-output");
    const badge = container.querySelector(".job-status");
    const stepsEl = container.querySelector(".job-steps");
    const elapsed = container.querySelector(".job-elapsed");
    const cancelBtn = container.querySelector(".job-cancel");
    let offset = 0;
    let stopped = false;
    let notified = false;

    cancelBtn?.addEventListener("click", async () => {
      cancelBtn.disabled = true;
      try {
        await api.cancelJob(jobId);
      } catch (err) {
        toast.error("Cancel failed", err.message);
      }
    });

    const finish = (job) => {
      stopped = true;
      if (cancelBtn) cancelBtn.style.display = "none";
      const warned = (job.steps || []).some((s) => s.status === "warning");
      const ok = job.status === "completed";
      badge.className = `badge job-status ${ok ? (warned ? "badge-warning" : "badge-success") : "badge-danger"}`;
      badge.innerHTML = `${I.get(ok ? (warned ? "alertTriangle" : "checkCircle") : "alertCircle", { size: 12 })} ${ok ? (warned ? "Completed with warnings" : "Completed") : job.status === "cancelled" ? "Cancelled" : "Failed"}`;
      if (!notified && onDone) {
        notified = true;
        onDone(job);
      }
    };

    const poll = async () => {
      if (stopped) return;
      if (!document.body.contains(container)) {
        // Console removed (page left / modal closed): keep watching quietly so onDone still fires
        if (!notified) JobConsole.watch(jobId, offset, onDone);
        return;
      }
      try {
        const job = await api.getJob(jobId, offset);
        if (job.steps?.length) {
          stepsEl.style.display = "";
          stepsEl.innerHTML = JobConsole.stepsHtml(job.steps);
        }
        if (job.startedAt) {
          const end = job.finishedAt ? new Date(job.finishedAt) : new Date();
          elapsed.textContent = UI.duration(
            Math.max(0, Math.round((end - new Date(job.startedAt)) / 1000)),
          );
        }
        if (job.output) {
          const atBottom =
            out.scrollTop + out.clientHeight >= out.scrollHeight - 30;
          out.textContent += UI.cleanOutput(job.output);
          if (atBottom) out.scrollTop = out.scrollHeight;
        }
        offset = job.nextOffset;
        if (job.status !== "running") return finish(job);
      } catch (err) {
        out.textContent += `\n[${err.message}]\n`;
        return finish({ status: "failed", exitCode: "?" });
      }
      setTimeout(poll, 900);
    };
    poll();
    return {
      stop: () => {
        stopped = true;
      },
    };
  }

  /**
   * @param {string} jobId
   * @param {string} title
   * @param {object} opts { onDone(job) } — called once when the job finishes
   */
  static open(jobId, title, { onDone } = {}) {
    const { overlay, close } = Modal.show(
      escapeHtml(title),
      `<div id="job-console-host"></div>
       <div class="form-hint" style="margin-top:8px;">You can close this window — the job keeps running on the server.</div>`,
      { width: 880 },
    );
    JobConsole.attach(overlay.querySelector("#job-console-host"), jobId, {
      onDone,
    });
    return { close };
  }

  /**
   * Background watcher used after the console is closed.
   */
  static async watch(jobId, offset, onDone, title) {
    try {
      const job = await api.getJob(jobId, offset);
      if (job.status === "running") {
        setTimeout(
          () =>
            JobConsole.watch(jobId, job.nextOffset, onDone, title || job.title),
          2000,
        );
        return;
      }
      if (job.status === "completed")
        toast.success("Finished", title || job.title);
      else toast.error("Job failed", title || job.title);
      if (onDone) onDone(job);
    } catch {}
  }

  /**
   * Convenience: await an API call that returns { jobId } and open its console.
   */
  static async run(promise, title, opts) {
    try {
      const res = await promise;
      if (res && res.jobId) return JobConsole.open(res.jobId, title, opts);
      toast.success("Done", title);
      opts?.onDone?.({ status: "completed" });
    } catch (err) {
      toast.error("Failed", err.message);
    }
  }
}

window.JobConsole = JobConsole;
