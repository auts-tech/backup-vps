/**
 * Toast notification system with vector icons
 */
class Toast {
  constructor() {
    this.container = null;
    this.init();
  }

  init() {
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    document.body.appendChild(this.container);
  }

  show(type, title, message, duration = 4000) {
    const iconNames = {
      success: 'checkCircle',
      error: 'alertCircle',
      warning: 'alertTriangle',
      info: 'info'
    };

    const iconName = iconNames[type] || 'info';
    const iconHtml = window.Icons ? window.Icons.get(iconName, { size: 18 }) : '';

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${iconHtml}</span>
      <div class="toast-body">
        <div class="toast-title">${escapeHtml(title)}</div>
        ${message ? `<div class="toast-message">${escapeHtml(message)}</div>` : ''}
      </div>
      <button class="toast-close" onclick="this.closest('.toast').remove()" title="Close">
        ${window.Icons ? window.Icons.get('x', { size: 14 }) : '✕'}
      </button>
    `;

    this.container.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 250);
      }, duration);
    }
  }

  success(title, message) { this.show('success', title, message); }
  error(title, message) { this.show('error', title, message); }
  warning(title, message) { this.show('warning', title, message); }
  info(title, message) { this.show('info', title, message); }
}

window.toast = new Toast();
