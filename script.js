(() => {
  const ROLES = ['keeper','nightingale'];
  const modalId = 'profile-editor-modal';
  let editingRole = null;

  function trapFocus(modal) {
    const focusable = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const nodes = Array.from(modal.querySelectorAll(focusable));
    const first = nodes[0];
    const last = nodes[nodes.length - 1];

    function keyHandler(e) {
      if (e.key === 'Escape') { closeProfileEditor(); return; }
      if (e.key === 'Tab') {
        if (nodes.length === 0) { e.preventDefault(); return; }
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    modal._keyHandler = keyHandler;
    modal.addEventListener('keydown', keyHandler);
    setTimeout(() => (first || modal).focus(), 0);
  }

  function releaseFocus(modal) {
    if (!modal) return;
    if (modal._keyHandler) modal.removeEventListener('keydown', modal._keyHandler);
    modal._keyHandler = null;
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden','false');
    trapFocus(modal);
    modal._backdropHandler = (e) => { if (e.target === modal) closeProfileEditor(); };
    modal.addEventListener('mousedown', modal._backdropHandler);
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden','true');
    releaseFocus(modal);
    if (modal._backdropHandler) modal.removeEventListener('mousedown', modal._backdropHandler);
    modal._backdropHandler = null;
  }

  function getProfileKey(role){ return `profile-${role}`; }

  function applyProfile(role, data) {
    const card = document.getElementById(`profile-${role}`);
    if (!card) return;
    card.style.setProperty('--accent', data.accent || '#7f00ff');
    card.style.setProperty('--status-color', presenceColor(data.presence || 'online', data.accent));
    card.style.setProperty('--avatar-bg', data.avatarBg || data.accent || '#444');

    const nameEl = document.getElementById(`${role}-name`);
    const titleEl = document.getElementById(`${role}-title`);
    const statusEl = document.getElementById(`status-${role}`);
    const avatarEl = document.getElementById(`avatar-${role}`);
    const statusDot = document.getElementById(`status-dot-${role}`);

    if (nameEl) nameEl.textContent = data.name || role;
    if (titleEl) titleEl.textContent = data.title || (role === 'keeper' ? 'The Keeper' : 'The Nightingale');
    if (statusEl) statusEl.textContent = data.status || '';
    if (statusDot) statusDot.style.background = presenceColor(data.presence || 'online', data.accent);

    if (avatarEl) {
      avatarEl.textContent = initials(data.name || role);
      avatarEl.style.background = data.avatarBg || data.accent || '#444';
      avatarEl.style.color = readableTextColor(avatarEl.style.background);
    }
  }

  function initials(name){
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0,2).toUpperCase();
    return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
  }

  function presenceColor(presence, accent){
    switch(presence){
      case 'online': return '#2ecc71';
      case 'idle': return '#f1c40f';
      case 'dnd': return '#e74c3c';
      case 'offline': return '#95a5a6';
      default: return accent || '#7f00ff';
    }
  }

  function readableTextColor(bg){
    const c = (bg || '#444').replace('#','');
    const r = parseInt(c.substring(0,2),16), g = parseInt(c.substring(2,4),16), b = parseInt(c.substring(4,6),16);
    const lum = 0.2126*r + 0.7152*g + 0.0722*b;
    return lum > 140 ? '#111' : '#fff';
  }

  function saveProfileToStorage(role, data){
    try { localStorage.setItem(getProfileKey(role), JSON.stringify(data)); }
    catch(e){ console.warn('Could not save profile', e); }
  }

  function loadProfileFromStorage(role){
    try {
      const raw = localStorage.getItem(getProfileKey(role));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch(e){ return null; }
  }

  function openProfileEditor(role){
    editingRole = role;
    const modal = document.getElementById(modalId);
    const stored = loadProfileFromStorage(role) || (window.EXAMPLES && window.EXAMPLES.profiles && window.EXAMPLES.profiles[role]) || {};
    document.getElementById('editor-name').value = stored.name || (role === 'keeper' ? 'Alex' : 'Riley');
    document.getElementById('editor-title').value = stored.title || (role === 'keeper' ? 'The Keeper' : 'The Nightingale');
    document.getElementById('editor-accent').value = stored.accent || '#7f00ff';
    document.getElementById('editor-avatar-color').value = stored.avatarBg || (stored.accent || '#444');
    document.getElementById('editor-presence').value = stored.presence || 'online';
    document.getElementById('editor-status').value = stored.status || '';
    updateEditorPreviews();
    openModal(modalId);
  }
  window.openProfileEditor = openProfileEditor;

  function closeProfileEditor(){
    editingRole = null;
    closeModal(modalId);
  }
  window.closeProfileEditor = closeProfileEditor;

  function updateEditorPreviews(){
    const accent = document.getElementById('editor-accent').value;
    const avatarBg = document.getElementById('editor-avatar-color').value;
    const name = document.getElementById('editor-name').value || '';
    const preview = document.getElementById('editor-avatar-preview');
    const accentPreview = document.getElementById('editor-accent-preview');
    const avatarPreviewColor = document.getElementById('editor-avatar-preview-color');
    preview.textContent = initials(name || 'U');
    preview.style.background = avatarBg;
    preview.style.color = readableTextColor(avatarBg);
    accentPreview.style.background = accent;
    avatarPreviewColor.style.background = avatarBg;
  }

  function saveProfileEditor(){
    if (!editingRole) return;
    const role = editingRole;
    const data = {
      name: document.getElementById('editor-name').value.trim(),
      title: document.getElementById('editor-title').value.trim(),
      accent: document.getElementById('editor-accent').value,
      avatarBg: document.getElementById('editor-avatar-color').value,
      presence: document.getElementById('editor-presence').value,
      status: document.getElementById('editor-status').value.trim()
    };
    applyProfile(role, data);
    saveProfileToStorage(role, data);
    if (window.firebase && window.firebase.firestore && window.CURRENT_LEDGER_ID && window.CURRENT_USER_ID) {
      try {
        const db = window.firebase.firestore();
        const docRef = db.collection('ledgers').doc(window.CURRENT_LEDGER_ID).collection('profiles').doc(role);
        docRef.set(data, { merge: true }).catch(e => console.warn('Firebase save failed', e));
      } catch(e){ console.warn('Firebase not initialized', e); }
    }
    closeProfileEditor();
  }
  window.saveProfileEditor = saveProfileEditor;

  function loadAllProfiles(){
    ROLES.forEach(role => {
      const stored = loadProfileFromStorage(role);
      const fallback = (window.EXAMPLES && window.EXAMPLES.profiles && window.EXAMPLES.profiles[role]) || {};
      const data = Object.assign({}, fallback, stored || {});
      applyProfile(role, data);
    });
  }

  function randomizeProfile(role){
    const colors = ['#b05c6c','#7f00ff','#059669','#ff7a59','#2b9cff','#8e44ad','#16a085'];
    const accent = colors[Math.floor(Math.random()*colors.length)];
    const avatarBg = colors[Math.floor(Math.random()*colors.length)];
    const names = ['Avery','Jordan','Taylor','Casey','Morgan','Riley','Alex','Sam'];
    const titles = ['Keeper','Nightingale','Muse','Anchor','Guide','Partner'];
    const data = {
      name: names[Math.floor(Math.random()*names.length)],
      title: titles[Math.floor(Math.random()*titles.length)],
      accent, avatarBg,
      presence: ['online','idle','dnd','offline'][Math.floor(Math.random()*4)],
      status: ['Focused','On a break','Working','Cooking','Reading'][Math.floor(Math.random()*5)]
    };
    applyProfile(role, data);
    saveProfileToStorage(role, data);
  }
  window.randomizeProfile = randomizeProfile;

  document.addEventListener('DOMContentLoaded', () => {
    loadAllProfiles();
    ['editor-name','editor-accent','editor-avatar-color'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', updateEditorPreviews);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById(modalId);
        if (modal && !modal.classList.contains('hidden')) closeProfileEditor();
      }
    });
  });

  window.applyProfile = applyProfile;
  window.loadAllProfiles = loadAllProfiles;

})();
