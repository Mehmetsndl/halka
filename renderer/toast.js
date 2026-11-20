'use strict';
const api = window.halka;
const el = document.getElementById('toast');
let hideTimer = null;

api.onToast((payload) => {
  document.documentElement.dataset.theme = payload.theme || 'light';
  document.documentElement.dataset.accent = (payload.settings && payload.settings.accent) || 'blue';
  document.getElementById('title').textContent = payload.title || '';
  document.getElementById('body').textContent = payload.body || '';
  document.getElementById('when').textContent = payload.language === 'tr' ? 'şimdi' : 'now';
  const actions = document.getElementById('actions');
  actions.innerHTML = '';
  for (const action of payload.actions || []) {
    const button = document.createElement('button');
    button.textContent = action.label;
    button.addEventListener('click', () => api.toastAction(action));
    actions.append(button);
  }
  el.className = `toast ${payload.tone || 'info'}`;
  el.hidden = false;
  void el.offsetWidth;
  el.classList.add('in');
  duration = payload.duration || 3200;
  schedule(duration);
});

let duration = 3200;
function schedule(ms) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => api.toastAction({ kind: 'dismiss' }), ms);
}

api.onToastHide(() => {
  el.classList.remove('in');
  el.classList.add('out');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { el.hidden = true; api.toastHidden(); }, 180);
});

// Hovering keeps the notification; leaving dismisses it shortly after.
el.addEventListener('mouseenter', () => clearTimeout(hideTimer));
el.addEventListener('mouseleave', () => schedule(1600));
el.addEventListener('click', (event) => { if (event.target === el || !event.target.closest('button')) api.toastAction({ kind: 'dismiss' }); });
