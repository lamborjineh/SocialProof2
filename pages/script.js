// script.js — Shared utilities for all SocialProof pages
// Loaded via <script src="/pages/script.js" defer> in every HTML file.
// Uses var (not const/let) for globals so page-specific JS can safely re-use
// the same names without SyntaxError: Identifier already declared.

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar + Layout
// ─────────────────────────────────────────────────────────────────────────────
var sidebar    = document.getElementById('sidebar');
var mainEl     = document.getElementById('main') || document.getElementById('page-main');
var burgerBtn  = document.getElementById('burger-btn');
var overlay    = document.getElementById('sidebar-overlay');
var sidebarOpen = window.innerWidth >= 900;

function initSidebar() {
  if (!sidebar || !burgerBtn) return;
  if (window.innerWidth < 900) {
    sidebar.classList.add('collapsed');
    if (mainEl) mainEl.classList.remove('expanded');
    burgerBtn.classList.add('visible');
    sidebarOpen = false;
  } else {
    sidebar.classList.remove('collapsed');
    if (mainEl) mainEl.classList.remove('expanded');
    burgerBtn.classList.remove('visible');
    sidebarOpen = true;
  }
}

function toggleSidebar() {
  if (!sidebar || !burgerBtn) return;
  sidebarOpen = !sidebarOpen;
  if (sidebarOpen) {
    sidebar.classList.remove('collapsed');
    sidebar.classList.add('open');
    if (window.innerWidth >= 900) { if (mainEl) mainEl.classList.remove('expanded'); }
    else { if (overlay) overlay.classList.add('visible'); }
    burgerBtn.classList.remove('visible');
  } else {
    sidebar.classList.add('collapsed');
    sidebar.classList.remove('open');
    if (mainEl) mainEl.classList.add('expanded');
    if (overlay) overlay.classList.remove('visible');
    burgerBtn.classList.add('visible');
  }
}

window.addEventListener('resize', initSidebar);
initSidebar();

// ─────────────────────────────────────────────────────────────────────────────
// Nav Group Toggle (shared — used by Lessons dropdown on every page)
// ─────────────────────────────────────────────────────────────────────────────
function toggleNavGroup(id) {
  var toggle = document.getElementById('nav-' + id + '-toggle');
  var sub    = document.getElementById('nav-sub-' + id);
  if (!toggle || !sub) return;

  // If clicking Lessons from a non-lessons page, navigate to lessons.html
  if (id === 'lessons') {
    var isOnLessons = window.location.pathname.indexOf('lessons.html') !== -1;
    if (!isOnLessons) {
      window.location.href = 'lessons.html';
      return;
    }
  }

  var isOpen = toggle.classList.toggle('open');
  sub.classList.toggle('open', isOpen);
}

// ─────────────────────────────────────────────────────────────────────────────
// Age Mode
// ─────────────────────────────────────────────────────────────────────────────
var AGE_COPY = {
  youth: {
    pageTitle: 'Is This Real?',
    pageSub:   "DON'T GET FOOLED · CHECK IT FAST",
    h2Input:   'Drop the post, message, or story here 👇',
    placeholder: 'Paste or type the thing you want to check…',
    beginBtn:  "Let's Go! →",
    hintClaim: '⚡ A claim is when someone says something is true — like a fact, not an opinion.',
  },
  adult: {
    pageTitle: 'Review Content',
    pageSub:   'CHECK · THINK · DECIDE',
    h2Input:   'What would you like to review?',
    placeholder: 'Paste or type here',
    beginBtn:  'Start →',
    hintClaim: '💡 A claim is a statement presented as fact — something that can be verified.',
  },
  older: {
    pageTitle: 'Check the Facts',
    pageSub:   "IS THIS TRUE? · LET'S FIND OUT",
    h2Input:   'Paste the text you want to check below.',
    placeholder: 'Type or paste the content here, then press Start.',
    beginBtn:  'Start →',
    hintClaim: '💡 A claim is a statement presented as a fact. We will help you check if it is true.',
  },
};

// Migrate legacy mode values
(function() {
  var raw = localStorage.getItem('sp_age_mode');
  if (raw === 'kids' || raw === 'teen') localStorage.setItem('sp_age_mode', 'youth');
})();

var currentMode = localStorage.getItem('sp_age_mode') || 'adult';

function applyAgeCopy(mode) {
  var copy = AGE_COPY[mode] || AGE_COPY.adult;
  var setTxt  = function(id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; };
  var setAttr = function(id, attr, val) { var el = document.getElementById(id); if (el) el[attr] = val; };
  setTxt('page-title', copy.pageTitle);
  setTxt('page-sub',   copy.pageSub);
  setTxt('h2-input',   copy.h2Input);
  setAttr('content-input', 'placeholder', copy.placeholder);
  setTxt('begin-btn',  copy.beginBtn);
  setTxt('hint-claim', copy.hintClaim);
  document.body.classList.toggle('mode-youth', mode === 'youth');
  document.body.classList.toggle('mode-older', mode === 'older');
}

function setAgeMode(mode) {
  currentMode = mode;
  localStorage.setItem('sp_age_mode', mode);
  document.querySelectorAll('.age-pill').forEach(function(el) { el.classList.remove('active'); });
  var pill = document.getElementById('age-' + mode);
  if (pill) pill.classList.add('active');
  applyAgeCopy(mode);
}

// Restore pill state on page load
(function restoreAgePill() {
  var saved = localStorage.getItem('sp_age_mode') || 'adult';
  if (saved === 'kids' || saved === 'teen') { saved = 'youth'; localStorage.setItem('sp_age_mode', 'youth'); }
  document.querySelectorAll('.age-pill').forEach(function(el) { el.classList.remove('active'); });
  var pill = document.getElementById('age-' + saved);
  if (pill) pill.classList.add('active');
  applyAgeCopy(saved);
})();

// ─────────────────────────────────────────────────────────────────────────────
// Shared utilities
// ─────────────────────────────────────────────────────────────────────────────
function markLessonRead(lessonKey) {
  var read = JSON.parse(localStorage.getItem('sp_read_lessons') || '[]');
  if (!read.includes(lessonKey)) { read.push(lessonKey); localStorage.setItem('sp_read_lessons', JSON.stringify(read)); }
}

function showToast(msg) {
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 3500);
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth state → sidebar login link
// ─────────────────────────────────────────────────────────────────────────────
(function() {
  var username  = localStorage.getItem('sp_username');
  var loginLink = document.getElementById('sidebar-login-link');
  if (!username || !loginLink) return;

  loginLink.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Log out';
  loginLink.href = '#';
  loginLink.style.color = 'var(--red)';
  loginLink.onclick = async function(e) {
    e.preventDefault();
    await fetch('/auth/cookie-logout', { method: 'POST', credentials: 'include' }).catch(function() {});
    localStorage.clear();
    window.location.href = 'login.html';
  };
})();
