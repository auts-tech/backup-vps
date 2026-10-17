/**
 * Modal dialog system with vector icons
 */
class Modal {
  static show(title, bodyHtml, options = {}) {
    const {
      onSubmit,
      submitText = "Save",
      submitClass = "btn-primary",
      width,
    } = options;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const closeIcon = window.Icons ? window.Icons.get("x", { size: 16 }) : "✕";

    overlay.innerHTML = `
      <div class="modal" ${width ? `style="max-width:${width}px"` : ""}>
        <div class="modal-header">
          <h3 class="modal-title">${title}</h3>
          <button class="modal-close" id="modal-close-btn" title="Close">${closeIcon}</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        ${
          onSubmit
            ? `
          <div class="modal-footer">
            <button class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
            <button class="btn ${submitClass}" id="modal-submit-btn">${submitText}</button>
          </div>
        `
            : ""
        }
      </div>
    `;

    document.body.appendChild(overlay);

    // Close handlers
    const close = () => overlay.remove();
    overlay.querySelector("#modal-close-btn").addEventListener("click", close);
    overlay
      .querySelector("#modal-cancel-btn")
      ?.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    // Submit handler
    if (onSubmit) {
      overlay
        .querySelector("#modal-submit-btn")
        .addEventListener("click", async () => {
          try {
            await onSubmit(overlay);
            close();
          } catch (err) {
            window.toast.error("Error", err.message);
          }
        });
    }

    return { overlay, close };
  }

  static closeAll() {
    document.querySelectorAll(".modal-overlay").forEach((el) => el.remove());
  }

  static confirm(title, message, onConfirm) {
    return Modal.show(
      title,
      `<p style="color:var(--text-secondary);font-size:14px;">${message}</p>`,
      {
        onSubmit: onConfirm,
        submitText: "Confirm",
        submitClass: "btn-danger",
      },
    );
  }
}

window.Modal = Modal;
