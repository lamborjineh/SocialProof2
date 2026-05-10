// ── Age mode ─────────────────────────────────────────────────────────────────
(function restoreAgePill() {
  const saved = localStorage.getItem('sp_age_mode') || 'adult';
  document.querySelectorAll('.age-pill').forEach(el => el.classList.remove('active'));
  const pill = document.getElementById('age-' + saved);
  if (pill) pill.classList.add('active');
  document.body.classList.toggle('mode-youth', saved === 'youth');
  document.body.classList.toggle('mode-older', saved === 'older');
})();
function setAgeMode(mode) {
  localStorage.setItem('sp_age_mode', mode);
  document.querySelectorAll('.age-pill').forEach(el => el.classList.remove('active'));
  const pill = document.getElementById('age-' + mode);
  if (pill) pill.classList.add('active');
  document.body.classList.toggle('mode-youth', mode === 'youth');
  document.body.classList.toggle('mode-older', mode === 'older');
}

// ── Nav group toggle ─────────────────────────────────────────────────────────
function toggleNavGroup(id) {
  const toggle = document.getElementById('nav-' + id + '-toggle');
  const sub    = document.getElementById('nav-sub-' + id);
  if (!toggle || !sub) return;
  const isOpen = toggle.classList.toggle('open');
  sub.classList.toggle('open', isOpen);
}

// ── Build role-aware dashboard sub-nav ───────────────────────────────────────
function buildDashboardSubNav(role) {
  const sub = document.getElementById('nav-sub-dashboard');
  if (!sub) return;

  const adminItems = [
    { icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', label: 'Overview', panel: 'overview' },
    { icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', label: 'Users', panel: 'users' },
    { icon: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>', label: 'Analytics', panel: 'analytics' },
    { icon: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>', label: 'Lessons', panel: 'lessons' },
    { icon: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>', label: 'Quiz', panel: 'quiz' },
    { icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', label: 'Prebunking', panel: 'prebunking' },
    { icon: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>', label: 'Eval Questions', panel: 'eval-questions' },
    { icon: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>', label: 'Corpus', panel: 'corpus' },
    { icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>', label: 'API Health', panel: 'api' },
    { icon: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1"/>', label: 'Mindmap', panel: 'mindmap' },
  ];

  const userItems = [
    { icon: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>', label: 'Overview', section: 'section-overview' },
    { icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>', label: 'Skills', section: 'section-skills' },
    { icon: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>', label: 'Learning', section: 'section-learning' },
    { icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', label: 'History', section: 'section-history' },
  ];

  const items = role === 'admin' ? adminItems : userItems;
  sub.innerHTML = items.map(item => {
    if (item.panel) {
      return `<button class="nav-sub-item" id="nav-sub-${item.panel}" onclick="showAdminPanel('${item.panel}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${item.icon}</svg>
        ${item.label}
      </button>`;
    }
    return `<button class="nav-sub-item" onclick="scrollToSection('${item.section}', this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${item.icon}</svg>
      ${item.label}
    </button>`;
  }).join('');
}

function scrollToSection(id, clickedBtn) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Update active state
  document.querySelectorAll('#nav-sub-dashboard .nav-sub-item').forEach(n => n.classList.remove('active'));
  if (clickedBtn) clickedBtn.classList.add('active');
}

// ── Auth state ───────────────────────────────────────────────────────────────
const API = '';
(function initDashboard() {
  const username = localStorage.getItem('sp_username');
  const userId   = localStorage.getItem('sp_user_id');
  const role     = localStorage.getItem('sp_role');
  const loginLink = document.getElementById('sidebar-login-link');

  // Build sub-nav immediately so it shows even on gate screen
  buildDashboardSubNav(role || 'user');
  // Auto-activate Overview nav item on load
  if (role === 'admin') {
    // will be activated by showAdminPanel('overview') below
  } else {
    // Mark Overview as active for user dashboard
    setTimeout(function() {
      const firstSub = document.querySelector('#nav-sub-dashboard .nav-sub-item');
      if (firstSub) firstSub.classList.add('active');
    }, 0);
  }

  if (username) {
    const _tuEl = document.getElementById('topbar-username'); if (_tuEl) _tuEl.textContent = username;
    if (loginLink) {
      loginLink.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>Log out`;
      loginLink.href = '#';
      loginLink.style.color = 'var(--red)';
      loginLink.onclick = async e => {
        e.preventDefault();
        await fetch('/auth/cookie-logout', { method: 'POST', credentials: 'include' }).catch(() => {});
        localStorage.clear();
        window.location.href = 'login.html';
      };
    }
    if (role === 'admin') {
      // Show admin panel inline — no separate admin.html needed
      document.getElementById('gate-section').style.display = 'none';
      document.getElementById('dashboard-content').style.display = 'none';
      document.querySelector('.topbar').style.display = 'none';
      document.getElementById('admin-content').style.display = 'block';
      const tuAdmin = document.getElementById('topbar-username-admin');
      if (tuAdmin) tuAdmin.textContent = username;
      // Highlight Overview nav item and load data
      loadOverview();
      setTimeout(function() {
        const overviewBtn = document.getElementById('nav-sub-overview');
        if (overviewBtn) overviewBtn.classList.add('active');
        const titleEl = document.getElementById('admin-panel-title');
        if (titleEl) titleEl.textContent = 'Overview';
        const subEl = document.getElementById('admin-panel-sub');
        if (subEl) subEl.textContent = 'ADMIN CONSOLE · OVERVIEW';
      }, 0);
    } else {
      document.getElementById('gate-section').style.display = 'none';
      document.getElementById('dashboard-content').style.display = 'block';
      loadMindmapProgress();   // load mindmap progress from API
      loadDashboard(userId);
    }
  }
})();

// ─── MINDMAP PROGRESS (API-driven) ───────────────────────────────────────────
async function loadMindmapProgress() {
  try {
    const res = await fetch('/api/mindmap/progress?map=main', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    const discovered = data.discovered || [];
    const total      = data.total || 30;
    const pct        = Math.round((discovered.length / total) * 100);

    const row = document.getElementById('progress-row');
    if (row) row.style.display = 'grid';

    const countEl = document.getElementById('mm-dash-count');
    const barEl   = document.getElementById('mm-dash-bar');
    const lastEl  = document.getElementById('mm-dash-last');

    if (countEl) countEl.textContent = `${discovered.length} / ${total}`;
    if (barEl)   barEl.style.width   = pct + '%';

    if (lastEl) {
      if (discovered.length === 0) {
        lastEl.innerHTML = `Start exploring → <a href="mindmap.html" style="color:var(--accent)">mindmap</a>`;
      } else if (discovered.length === total) {
        lastEl.innerHTML = '✦ <span>All nodes discovered!</span>';
      } else {
        const lastLabel = data.last_node_label;
        lastEl.innerHTML = lastLabel
          ? `Last visited: <span>${lastLabel}</span>`
          : `${pct}% complete`;
      }
    }
  } catch(e) { /* card stays blank — non-critical */ }
}


// ── Dashboard loader ─────────────────────────────────────────────────────────
async function loadDashboard(userId) {
  if (!userId) return;
  try {
    const res = await fetch(`/dashboard/${userId}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Could not load dashboard data.');
    const d = await res.json();

    // Stats
    document.getElementById('stat-evals').textContent   = d.stats.total_submissions   ?? '0';
    document.getElementById('stat-lessons').textContent = d.stats.lessons_completed   ?? '0';
    document.getElementById('stat-streak').textContent  = d.stats.quiz_streak         ?? '0';
    document.getElementById('stat-quiz').textContent    = d.stats.total_quiz_attempts ?? '0';

    // New-user empty state
    checkNewUser(d.stats);

    // Activity streak heatmap
    if (d.activity_by_day) renderStreak(d.activity_by_day);

    // Prebunking count (mindmap progress card is handled by loadMindmapProgress separately)
    const prebunkingEl = document.getElementById('prebunking-val');
    if (prebunkingEl && d.prebunking_done !== undefined) {
      prebunkingEl.textContent = d.prebunking_done ?? '0';
    }

    // Skill progress
    renderSkillProgress(d.skill_progress || []);

    // Behavior cards + weakness bars
    if ((d.behavior_cards || []).length > 0 || (d.lesson_triggers || []).length > 0) {
      document.getElementById('insights-wrap').style.display = 'block';
      renderBehaviorCards(d.behavior_cards || []);
      renderWeaknessBars(d.lesson_triggers || []);
    }

    // Recommended lessons
    renderRecommended(d.recommended || []);

    // Pretest
    renderPretest(d.pretest);

    // Quiz history
    renderQuizHistory(d.quiz_history || []);

    // Evaluation history — content + date only
    renderHistory(d.history || []);

  } catch (err) {
    console.warn('[Dashboard] load error:', err);
    showToast('Dashboard data unavailable.');
  }
}

// ── Render helpers ───────────────────────────────────────────────────────────

function renderSkillProgress(skills) {
  const grid = document.getElementById('skill-grid');
  if (!skills.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><p>Complete a lesson to unlock skill tracking.</p></div>';
    return;
  }
  const levelPct  = { beginner: 33, intermediate: 66, advanced: 100 };
  const levelCol  = { beginner: '#34d399', intermediate: '#fbbf24', advanced: '#f87171' };
  const badgeCls  = { beginner: 'skill-ring-badge' , intermediate: 'skill-ring-badge', advanced: 'skill-ring-badge' };
  const badgeSty  = { beginner: 'background:rgba(52,211,153,.12);color:#34d399', intermediate: 'background:rgba(251,191,36,.12);color:#fbbf24', advanced: 'background:rgba(248,113,113,.12);color:#f87171' };

  function ringPath(pct, col) {
    const r = 30, cx = 40, cy = 40, circ = 2 * Math.PI * r;
    const dash = (pct / 100) * circ;
    return `<svg class="skill-ring-svg" viewBox="0 0 80 80">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="7"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="7"
        stroke-dasharray="${dash} ${circ}" stroke-dashoffset="${circ * 0.25}"
        stroke-linecap="round" style="transition:stroke-dasharray .6s cubic-bezier(.4,0,.2,1)"/>
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
        font-family="Syne,sans-serif" font-weight="800" font-size="14" fill="${col}">${pct}%</text>
    </svg>`;
  }

  grid.innerHTML = skills.map(s => {
    const pct = levelPct[s.current_level] || 33;
    const col = levelCol[s.current_level] || '#34d399';
    const sty = badgeSty[s.current_level] || badgeSty.beginner;
    return `<div class="skill-ring-card">
      ${ringPath(pct, col)}
      <div class="skill-ring-label">${escHtml(s.display_name)}</div>
      <span class="skill-ring-badge" style="${sty}">${s.current_level}</span>
      <div class="skill-ring-meta">${s.lessons_completed ?? 0} lesson${s.lessons_completed !== 1 ? 's' : ''} · ${s.quiz_accuracy_pct != null ? s.quiz_accuracy_pct + '% acc.' : 'no quiz'}</div>
    </div>`;
  }).join('');
}

function renderBehaviorCards(cards) {
  document.getElementById('behavior-cards').innerHTML = cards.length ? cards.map(c => `
    <div class="insight-card">
      <div class="insight-title">
        <svg class="insight-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        ${escHtml(c.title)}
      </div>
      <div class="insight-body">${escHtml(c.body)}</div>
      <div class="insight-footer">
        <span class="mil-tag">${escHtml(c.mil_skill)}</span>
        <a href="${escHtml(c.action)}" class="insight-link">${escHtml(c.action_label)}</a>
      </div>
    </div>`).join('') : '';
}

function renderWeaknessBars(triggers) {
  if (!triggers.length) { document.getElementById('weakness-bars').innerHTML = ''; return; }
  const max = Math.max(...triggers.map(t => t.trigger_count), 1);
  document.getElementById('weakness-bars').innerHTML = triggers.map(t => `
    <div class="weakness-row">
      <div class="weakness-label">${escHtml(t.display_name)}</div>
      <div class="weakness-bar-wrap"><div class="weakness-bar-fill" style="width:${Math.round(t.trigger_count / max * 100)}%"></div></div>
      <div class="weakness-count">${t.trigger_count}</div>
    </div>`).join('');
}

function renderStreak(activityByDay) {
  const today = new Date();
  const days = 112;
  const dateMap = {};
  (activityByDay || []).forEach(r => { dateMap[r.date] = r.count; });
  const start = new Date(today);
  start.setDate(today.getDate() - (days - 1));
  const cols = [];
  let col = [];
  const cur = new Date(start);
  while (cur <= today) {
    const key = cur.toISOString().slice(0, 10);
    const cnt = dateMap[key] || 0;
    const lv = cnt === 0 ? '' : cnt === 1 ? 'lv1' : cnt <= 3 ? 'lv2' : cnt <= 6 ? 'lv3' : 'lv4';
    col.push(`<div class="heatmap-cell ${lv}" title="${key}: ${cnt}"></div>`);
    if (col.length === 7) { cols.push([...col]); col = []; }
    cur.setDate(cur.getDate() + 1);
  }
  if (col.length) cols.push(col);
  document.getElementById('heatmap-grid').innerHTML = cols.map(c => `<div class="heatmap-col">${c.join('')}</div>`).join('');
  const totalDays = (activityByDay || []).filter(r => r.count > 0).length;
  document.getElementById('streak-label').textContent = totalDays + ' active day' + (totalDays !== 1 ? 's' : '') + ' in 16 weeks';
  document.getElementById('streak-wrap').style.display = 'block';
}

function checkNewUser(stats) {
  const isNew = !stats.total_submissions && !stats.lessons_completed && !stats.total_quiz_attempts;
  const banner = document.getElementById('new-user-banner');
  if (banner) banner.classList.toggle('visible', !!isNew);
}

function renderRecommended(lessons) {
  if (!lessons.length) {
    document.getElementById('recommended-lessons').innerHTML = `<div class="empty-state">No pending recommendations. <a href="lessons.html">Browse all lessons →</a></div>`;
    return;
  }
  document.getElementById('recommended-lessons').innerHTML = lessons.map(l => `
    <a href="lessons.html#${escHtml(l.lesson_key)}" class="lesson-rec">
      <div class="lesson-rec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>
      <div class="lesson-rec-text">
        <div class="lesson-rec-title">${escHtml(l.title)}</div>
        <div class="lesson-rec-meta">${escHtml(l.display_name)} · ${escHtml(l.difficulty)}</div>
      </div>
      <svg class="lesson-rec-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><polyline points="9 18 15 12 9 6"/></svg>
    </a>`).join('');
}

function renderPretest(data) {
  if (!data || (!data.pretest && !data.posttest)) {
    document.getElementById('pretest-section').innerHTML = `<div class="empty-state">Complete the pre-test on the lessons page to see your improvement here. <a href="lessons.html">Go to lessons →</a></div>`;
    return;
  }
  const pre  = data.pretest;
  const post = data.posttest;
  const delta = data.delta;
  const deltaClass = delta == null ? 'delta-neutral' : delta > 0 ? 'delta-positive' : delta < 0 ? 'delta-negative' : 'delta-neutral';
  const deltaStr   = delta == null ? '—' : (delta > 0 ? '+' : '') + delta + '%';
  const deltaIcon = delta == null ? '' : delta >= 0
    ? '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'
    : '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>';
  const deltaCardHtml = delta != null ? `
    <div class="delta-card">
      <div class="delta-icon ${delta < 0 ? 'negative' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${deltaIcon}</svg>
      </div>
      <div>
        <div class="delta-text-label">Score improvement</div>
        <div class="delta-text-val ${delta < 0 ? 'negative' : ''}">${deltaStr}</div>
        <div class="delta-text-sub">${delta > 0 ? 'You improved from pre to post-test — great work.' : delta < 0 ? 'Score dropped — keep practicing.' : 'No change between tests.'}</div>
      </div>
    </div>` : '';
  // If only pretest done, show a nudge banner instead of delta card
  const pretestOnlyBanner = data.pretest_only ? `
    <div style="margin-top:1rem;padding:.85rem 1rem;background:rgba(79,142,247,.07);border:1px solid rgba(79,142,247,.2);border-radius:10px;font-size:.82rem;color:var(--muted);">
      ✅ Pre-test recorded. Come back after completing lessons to take the post-test and see your improvement.
      <a href="lessons.html" style="color:var(--accent);margin-left:.4rem;">Start lessons →</a>
    </div>` : '';
  document.getElementById('pretest-section').innerHTML = `
    <div class="pretest-grid">
      <div class="pretest-card">
        <div class="pretest-label">Pre-test</div>
        <div class="pretest-val">${pre ? pre.score_pct + '%' : '—'}</div>
        <div class="pretest-sub">${pre ? pre.correct + '/' + pre.total + ' correct' : 'not taken'}</div>
      </div>
      <div class="pretest-card">
        <div class="pretest-label">Post-test</div>
        <div class="pretest-val">${post ? post.score_pct + '%' : '—'}</div>
        <div class="pretest-sub">${post ? post.correct + '/' + post.total + ' correct' : 'not taken yet'}</div>
      </div>
      <div class="pretest-card">
        <div class="pretest-label">Improvement</div>
        <div class="pretest-val ${deltaClass}">${deltaStr}</div>
        <div class="pretest-sub">${delta != null ? (delta > 0 ? 'great progress' : delta < 0 ? 'keep practicing' : 'no change') : 'complete both tests'}</div>
      </div>
    </div>${deltaCardHtml}${pretestOnlyBanner}`;
}

function renderQuizHistory(attempts) {
  if (!attempts.length) {
    document.getElementById('quiz-history-list').innerHTML = `<div class="empty-state">No quiz attempts yet. <a href="lessons.html">Start a lesson →</a></div>`;
    return;
  }
  const topicColors = {
    claim_detection:    'background:rgba(79,142,247,.12);color:#93c5fd',
    source_verification:'background:rgba(52,211,153,.12);color:#6ee7b7',
    bias_detection:     'background:rgba(251,191,36,.12);color:#fbbf24',
    evidence_evaluation:'background:rgba(248,113,113,.12);color:#fca5a5',
    general:            'background:rgba(107,115,148,.15);color:#6b7394',
  };
  document.getElementById('quiz-history-list').innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:.75rem 1.1rem">
      ${attempts.map(a => `
        <div class="quiz-row">
          <div class="quiz-dot ${a.is_correct ? 'quiz-dot-correct' : 'quiz-dot-wrong'}" title="${a.is_correct ? 'Correct' : 'Incorrect'}"></div>
          <div class="quiz-q-text">${escHtml(a.question_text)}${a.question_text.length >= 80 ? '…' : ''}</div>
          <span class="quiz-topic-tag" style="${topicColors[a.topic] || ''}">${topicLabel(a.topic)}</span>
          <div class="quiz-meta">${(a.attempted_at || '').slice(0, 10)}</div>
        </div>`).join('')}
    </div>`;
}

function renderHistory(history) {
  if (!history.length) {
    document.getElementById('history-list').innerHTML = `<div class="empty-state">No submissions yet. <a href="index.html">Try submitting some content →</a></div>`;
    return;
  }
  const typeIcons = {
    url:   '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    pdf:   '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    text:  '<line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/>',
  };
  document.getElementById('history-list').innerHTML = history.map(ev => {
    const icon = typeIcons[ev.input_type] || typeIcons.text;
    const date = ev.created_at ? new Date(ev.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    return `<div class="history-item">
      <div class="history-type-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icon}</svg></div>
      <div class="history-text">
        <div class="history-title">${escHtml(ev.content_preview || 'Evaluation #' + ev.eval_id)}</div>
        <div class="history-date">${date} · ${ev.input_type || 'text'}</div>
      </div>
    </div>`;
  }).join('');
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(group, name) {
  document.querySelectorAll(`#learn-tab-${group} .tab-panel, [id^="learn-tab-"]`).forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById(`learn-tab-${name}`);
  if (panel) panel.classList.add('active');
  event.target.classList.add('active');
}

// ── Utils ─────────────────────────────────────────────────────────────────────
const TOPIC_LABELS = {
  claim_detection:'Claim', source_verification:'Source',
  bias_detection:'Bias', evidence_evaluation:'Evidence', general:'General'
};
function topicLabel(t) { return TOPIC_LABELS[t] || t; }
function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

// ══ ADMIN CONSOLE JS ═════════════════════════════════════════════════════════

const PANEL_TITLES = {
  overview: 'Overview', quiz: 'Quiz Questions', lessons: 'Lessons',
  users: 'Users', analytics: 'Analytics', corpus: 'Corpus', api: 'API Health',
  prebunking: 'Prebunking Questions', 'eval-questions': 'Eval Questions',
  mindmap: 'Mindmap Editor',
};

async function showAdminPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-sub-item').forEach(n => n.classList.remove('active'));
  const panel = document.getElementById('panel-' + name);
  if (panel) panel.classList.add('active');
  const navBtn = document.getElementById('nav-sub-' + name);
  if (navBtn) navBtn.classList.add('active');
  const titleEl = document.getElementById('admin-panel-title');
  if (titleEl) titleEl.textContent = PANEL_TITLES[name] || name;
  const subEl = document.getElementById('admin-panel-sub');
  if (subEl) subEl.textContent = 'ADMIN CONSOLE · ' + (PANEL_TITLES[name] || name).toUpperCase();
  if (name === 'overview')       await loadOverview();
  if (name === 'quiz')           await loadQuiz();
  if (name === 'lessons')        await loadLessons();
  if (name === 'users')          await loadUsers();
  if (name === 'analytics')      await loadAnalytics();
  if (name === 'corpus')         await loadCorpusStats();
  if (name === 'api')            await loadApiHealth();
  if (name === 'prebunking')     { _currentPbTab = 'techniques'; switchPbTab('techniques'); }
  if (name === 'eval-questions') { _injectEvalQModal(); await loadEvalQuestions(); }
  if (name === 'mindmap') {
    const wrap = document.getElementById('admin-mindmap-editor-container');
    if (wrap && !wrap._mmInit) {
      wrap._mmInit = true;
      if (typeof MMEditor !== 'undefined') MMEditor.init(wrap);
    }
    if (typeof MMEditor !== 'undefined') {
      MMEditor.renderSuggestions(document.getElementById('suggestions-container'));
    }
  }
}

// ── State ──────────────────────────────────────────────────────────────────
let _quizData    = [];
let _lessonsData = [];
let _usersData   = [];
let _lessonsList = []; // for quiz modal dropdown

// ── Auth ───────────────────────────────────────────────────────────────────
function getHeaders() {
  return { 'Content-Type': 'application/json' };
}

// ── Init ───────────────────────────────────────────────────────────────────
// (Admin panel data is loaded by loadAdminPanel via initDashboard above)

// ── Navigation ─────────────────────────────────────────────────────────────
// toggleAdminGroup kept below
function toggleAdminGroup(btn) {
  const isOpen = btn.classList.toggle('open');
  const sub = btn.nextElementSibling;
  if (sub) sub.classList.toggle('open', isOpen);
}

// ── API helpers ────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, { credentials: 'include', headers: getHeaders(), ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── OVERVIEW ───────────────────────────────────────────────────────────────
async function loadOverview() {
  try {
    const d = await apiFetch('/admin/stats');
    const o = d.overview;
    document.getElementById('overview-stats').innerHTML = `
      ${statCard('Registered Users', o.total_users, 'total accounts created')}
      ${statCard('Total Submissions', o.total_submissions, o.anonymous_submissions + ' were anonymous')}
      ${statCard('Lessons Completed', o.total_lesson_completions, 'across all users')}
      ${statCard('Quiz Attempts', o.total_quiz_attempts, 'questions answered')}
      ${statCard('Lesson Read Rate', o.lesson_read_rate_pct + '%', 'of lessons triggered were read')}
      ${statCard('Admin Accounts', o.total_admins, 'active administrators')}
    `;
    renderBarChart('dau-chart', 'dau-labels', d.dau_7d.map(r => r.active_users), d.dau_7d.map(r => r.day.slice(5)), '#4f8ef7');
    renderBarChart('reg-chart', 'reg-labels', d.registrations_14d.map(r => r.new_users), d.registrations_14d.map(r => r.day.slice(5)), '#34d399');
  } catch(e) { adminToast(e.message, 'error'); }
}

function statCard(label, value, sub) {
  return `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value ?? '—'}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
}

function renderBarChart(chartId, labelsId, values, labels, color) {
  if (!values.length) { document.getElementById(chartId).innerHTML = '<div style="color:var(--muted);font-size:.75rem;font-family:DM Mono,monospace">No data yet</div>'; return; }
  const max = Math.max(...values, 1);
  document.getElementById(chartId).innerHTML = values.map(v =>
    `<div class="bar" style="height:${Math.max(4, Math.round(v / max * 74))}px;background:${color};opacity:.8"></div>`
  ).join('');
  document.getElementById(labelsId).innerHTML = labels.map(l =>
    `<div class="bar-label">${l}</div>`
  ).join('');
}

// ── QUIZ ───────────────────────────────────────────────────────────────────

let _allTopics = []; // dynamic topics loaded from server

async function _refreshTopics() {
  try {
    const data = await apiFetch('/admin/topics');
    _allTopics = data.topics || [];
    // Populate topic filter select
    const filterSel = document.getElementById('quiz-filter-topic');
    if (filterSel) {
      const prev = filterSel.value;
      filterSel.innerHTML = '<option value="">All topics</option>' +
        _allTopics.map(t => `<option value="${escAttr(t)}">${escHtml(_topicLabel(t))}</option>`).join('');
      filterSel.value = prev;
    }
    // Populate quiz modal datalist
    const dl = document.getElementById('qm-topic-list');
    if (dl) dl.innerHTML = _allTopics.map(t => `<option value="${escAttr(t)}">${escHtml(_topicLabel(t))}</option>`).join('');
    // Populate lesson modal datalist
    const ldl = document.getElementById('lm-topic-list');
    if (ldl) ldl.innerHTML = _allTopics.map(t => `<option value="${escAttr(t)}">${escHtml(_topicLabel(t))}</option>`).join('');
  } catch(_) {}
}

function _topicLabel(t) {
  const map = { claim_detection:'Claim Detection', source_verification:'Source Verification',
                bias_detection:'Bias Detection', evidence_evaluation:'Evidence Evaluation', general:'General MIL' };
  return map[t] || t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
}

async function loadQuiz() {
  await _refreshTopics();
  const topic = document.getElementById('quiz-filter-topic').value;
  const diff  = document.getElementById('quiz-filter-diff').value;
  let url = '/admin/quiz/questions';
  const params = [];
  if (topic) params.push('topic=' + topic);
  if (diff)  params.push('difficulty=' + diff);
  if (params.length) url += '?' + params.join('&');
  try {
    _quizData = await apiFetch(url);
    renderQuizTable(_quizData);
    // also refresh lessons list for dropdown
    _lessonsList = await apiFetch('/admin/lessons');
    populateLessonDropdown('qm-lesson', _lessonsList);
  } catch(e) {
    document.getElementById('quiz-table-body').innerHTML = `<tr><td colspan="6" style="color:var(--red);text-align:center;padding:1rem;font-size:.8rem">${e.message}</td></tr>`;
  }
}

function filterQuiz() { loadQuiz(); }

function renderQuizTable(data) {
  if (!data.length) {
    document.getElementById('quiz-table-body').innerHTML = '<tr><td colspan="6"><div class="empty-state"><p>No questions found.</p></div></td></tr>';
    return;
  }
  document.getElementById('quiz-table-body').innerHTML = data.map(q => {
    const acc = q.accuracy_pct;
    const accClass = acc === null ? '' : acc >= 70 ? 'accuracy-high' : acc >= 40 ? 'accuracy-mid' : 'accuracy-low';
    return `<tr>
      <td style="max-width:280px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.82rem">${escHtml(q.question_text)}</div>${q.lesson_title ? `<div class="td-muted" style="font-size:.7rem;margin-top:2px">${escHtml(q.lesson_title)}</div>` : ''}</td>
      <td>${topicBadge(q.topic)}</td>
      <td>${diffBadge(q.difficulty)}</td>
      <td class="td-mono">${q.attempt_count ?? 0}</td>
      <td>${acc !== null ? `<span class="accuracy-pill ${accClass}">${acc}%</span>` : '<span class="td-muted">—</span>'}</td>
      <td>
        <div style="display:flex;gap:.35rem">
          <button class="btn btn-sm btn-icon" title="Stats" onclick="viewQuestionStats(${q.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></button>
          <button class="btn btn-sm btn-icon" title="Edit" onclick='editQuestion(${q.id})'><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="btn btn-sm btn-icon btn-danger" title="Delete" onclick="confirmDeleteQuestion(${q.id}, '${escAttr(q.question_text.slice(0,50))}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// Quiz modal
let _optionCount = 0;
let _correctIndex = 0;
function openQuizModal(data = null) {
  document.getElementById('quiz-edit-id').value = '';
  document.getElementById('quiz-modal-title').textContent = 'New quiz question';
  document.getElementById('qm-text').value = '';
  document.getElementById('qm-explanation').value = '';
  document.getElementById('qm-image').value = '';
  document.getElementById('qm-image-preview').style.display = 'none';
  document.getElementById('qm-topic').value = 'claim_detection';
  document.getElementById('qm-difficulty').value = 'beginner';
  document.getElementById('qm-lesson').value = '';
  document.getElementById('quiz-modal-error').textContent = '';
  _optionCount = 0; _correctIndex = 0;
  document.getElementById('qm-options-list').innerHTML = '';
  addOption(''); addOption('');
  if (data) populateQuizModal(data);
  openModal('quiz-modal');
}
function populateQuizModal(q) {
  document.getElementById('quiz-edit-id').value = q.id;
  document.getElementById('quiz-modal-title').textContent = 'Edit question';
  document.getElementById('qm-text').value = q.question_text;
  document.getElementById('qm-explanation').value = q.explanation || '';
  document.getElementById('qm-topic').value = q.topic;
  document.getElementById('qm-difficulty').value = q.difficulty;
  document.getElementById('qm-lesson').value = q.lesson_id || '';
  // Image
  const imgVal = q.image_url || '';
  document.getElementById('qm-image').value = imgVal;
  const prev = document.getElementById('qm-image-preview');
  const thumb = document.getElementById('qm-image-thumb');
  if (imgVal) { thumb.src = imgVal; prev.style.display = 'block'; } else { prev.style.display = 'none'; }
  _optionCount = 0; _correctIndex = q.correct_index || 0;
  document.getElementById('qm-options-list').innerHTML = '';
  (q.options || []).forEach(o => addOption(o));
  // set correct radio
  document.querySelectorAll('.option-radio').forEach((r, i) => { r.checked = i === _correctIndex; });
}

function addOption(val = '') {
  const idx = _optionCount++;
  const li = document.createElement('div');
  li.className = 'option-row';
  li.dataset.idx = idx;
  li.innerHTML = `
    <span class="option-label-hint">Option ${String.fromCharCode(65+idx)}</span>
    <input class="form-input" style="flex:1" value="${escAttr(val)}" placeholder="Option text…" id="opt-${idx}">
    <input type="radio" class="option-radio" name="correct-option" value="${idx}" ${idx === _correctIndex ? 'checked' : ''} onchange="_correctIndex=${idx}" title="Mark as correct">
  `;
  document.getElementById('qm-options-list').appendChild(li);
}

function previewQuestion() {
  const text    = document.getElementById('qm-text').value.trim();
  const options = getOptions();
  const correct = _correctIndex;
  const exp     = document.getElementById('qm-explanation').value.trim();
  const imgUrl  = document.getElementById('qm-image').value.trim();
  if (!text || options.length < 2) { adminToast('Fill in question and at least 2 options first.', 'error'); return; }
  document.getElementById('preview-content').innerHTML = `
    <div class="preview-box">
      ${imgUrl ? `<img src="${escHtml(imgUrl)}" alt="question image" style="width:100%;max-height:200px;object-fit:cover;border-radius:8px;margin-bottom:.75rem;border:1px solid var(--border);">` : ''}
      <div style="font-size:.88rem;font-weight:500;line-height:1.5;margin-bottom:.75rem">${escHtml(text)}</div>
      <ul class="preview-options">
        ${options.map((o, i) => `<li class="${i === correct ? 'correct' : ''}">${i === correct ? '<svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' : `<span style="display:inline-block;width:14px;height:14px;border:1px solid var(--border);border-radius:3px;flex-shrink:0"></span>`} ${escHtml(o)}</li>`).join('')}
      </ul>
      ${exp ? `<div style="margin-top:.75rem;padding:.6rem .75rem;background:rgba(255,255,255,.03);border-radius:8px;font-size:.78rem;color:var(--muted)">${escHtml(exp)}</div>` : ''}
    </div>`;
  openModal('preview-modal');
}

function getOptions() {
  return Array.from(document.querySelectorAll('.option-row')).map(r => {
    const idx = r.dataset.idx;
    return (document.getElementById('opt-' + idx) || {}).value?.trim() || '';
  }).filter(Boolean);
}

async function saveQuestion() {
  const editId = document.getElementById('quiz-edit-id').value;
  const text    = document.getElementById('qm-text').value.trim();
  const options = getOptions();
  const errEl   = document.getElementById('quiz-modal-error');
  errEl.textContent = '';
  if (!text)            { errEl.textContent = 'Question text is required.'; return; }
  if (options.length < 2){ errEl.textContent = 'At least 2 options required.'; return; }
  if (_correctIndex >= options.length){ errEl.textContent = 'Select a valid correct answer.'; return; }
  const topicVal = document.getElementById('qm-topic').value.trim();
  if (!topicVal) { errEl.textContent = 'Topic is required.'; return; }
  const body = {
    question_text: text, options, correct_index: _correctIndex,
    topic:       topicVal,
    difficulty:  document.getElementById('qm-difficulty').value,
    explanation: document.getElementById('qm-explanation').value.trim() || null,
    lesson_id:   parseInt(document.getElementById('qm-lesson').value) || null,
    image_url:   document.getElementById('qm-image').value.trim() || null, // always optional
  };
  try {
    if (editId) {
      await apiFetch(`/admin/quiz/questions/${editId}`, { method: 'PUT', body: JSON.stringify(body) });
      adminToast('Question updated.');
    } else {
      await apiFetch('/admin/quiz/questions', { method: 'POST', body: JSON.stringify(body) });
      adminToast('Question created.');
    }
    closeModal('quiz-modal');
    await loadQuiz();
  } catch(e) { errEl.textContent = e.message; }
}

function editQuestion(id) {
  const q = _quizData.find(x => x.id === id);
  if (q) openQuizModal(q);
}

function confirmDeleteQuestion(id, preview) {
  document.getElementById('confirm-title').textContent = 'Delete question';
  document.getElementById('confirm-body').innerHTML = `This will permanently delete the question: <strong>"${escHtml(preview)}…"</strong> and all its attempt records.`;
  document.getElementById('confirm-ok-btn').onclick = async () => {
    try {
      await apiFetch(`/admin/quiz/questions/${id}`, { method: 'DELETE' });
      adminToast('Question deleted.');
      closeModal('confirm-modal');
      await loadQuiz();
    } catch(e) { adminToast(e.message, 'error'); }
  };
  openModal('confirm-modal');
}

async function viewQuestionStats(id) {
  document.getElementById('stats-modal-content').innerHTML = '<div class="loading">Loading…</div>';
  openModal('stats-modal');
  try {
    const d = await apiFetch(`/admin/quiz/questions/${id}/stats`);
    const max = Math.max(...d.option_breakdown.map(o => o.count), 1);
    document.getElementById('stats-modal-content').innerHTML = `
      <div class="preview-box" style="margin-bottom:1rem">
        <div style="font-size:.85rem;font-weight:500">${escHtml(d.question_text)}</div>
        <div style="display:flex;gap:.5rem;margin-top:.5rem">${topicBadge(d.topic)} ${diffBadge(d.difficulty)}</div>
      </div>
      <div class="stat-grid" style="margin-bottom:1.25rem">
        ${statCard('Total attempts', d.total_attempts, '')}
        ${statCard('Correct', d.correct_count, '')}
        ${statCard('Accuracy', (d.accuracy_pct || 0) + '%', '')}
        ${statCard('Unique users', d.unique_users, '')}
      </div>
      <div style="font-family:'DM Mono',monospace;font-size:.68rem;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:.75rem">Answer distribution</div>
      ${d.option_breakdown.map(o => `
        <div style="margin-bottom:.65rem">
          <div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:.25rem">
            <span style="${o.is_correct ? 'color:var(--green)' : ''}">${escHtml(o.text)} ${o.is_correct ? '✓' : ''}</span>
            <span style="font-family:'DM Mono',monospace;font-size:.72rem;color:var(--muted)">${o.count} (${o.pct}%)</span>
          </div>
          <div class="progress-bar"><div class="progress-fill ${o.is_correct ? 'fill-green' : 'fill-blue'}" style="width:${Math.round(o.count / max * 100)}%"></div></div>
        </div>`).join('')}`;
  } catch(e) { document.getElementById('stats-modal-content').innerHTML = `<p style="color:var(--red);font-size:.82rem">${e.message}</p>`; }
}

// ── LESSONS ────────────────────────────────────────────────────────────────
async function loadLessons() {
  await _refreshTopics();
  try {
    _lessonsData = await apiFetch('/admin/lessons');
    renderLessonsTable(_lessonsData);
  } catch(e) {
    document.getElementById('lessons-table-body').innerHTML = `<tr><td colspan="8" style="color:var(--red);text-align:center;padding:1rem;font-size:.8rem">${e.message}</td></tr>`;
  }
}

function renderLessonsTable(data) {
  if (!data.length) { document.getElementById('lessons-table-body').innerHTML = '<tr><td colspan="8"><div class="empty-state"><p>No lessons yet.</p></div></td></tr>'; return; }
  document.getElementById('lessons-table-body').innerHTML = data.map(l => {
    const rr = l.read_rate_pct;
    const rrClass = rr == null ? '' : rr >= 60 ? 'fill-green' : rr >= 30 ? 'fill-yellow' : 'fill-red';
    return `<tr>
      <td style="max-width:220px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.82rem">${escHtml(l.title)}</div><div class="td-muted td-mono" style="font-size:.68rem;margin-top:2px">${escHtml(l.lesson_key)}</div></td>
      <td>${topicBadge(l.topic)}</td>
      <td>${diffBadge(l.difficulty)}</td>
      <td class="td-mono">${l.trigger_count ?? 0}</td>
      <td style="min-width:90px">${rr !== null ? `<div style="display:flex;align-items:center;gap:.5rem"><span style="font-family:'DM Mono',monospace;font-size:.72rem;min-width:35px">${rr}%</span><div class="progress-bar" style="flex:1;margin:0"><div class="progress-fill ${rrClass}" style="width:${rr}%"></div></div></div>` : '<span class="td-muted">—</span>'}</td>
      <td class="td-mono">${l.completion_count ?? 0}</td>
      <td class="td-mono">${l.question_count ?? 0}</td>
      <td>
        <div style="display:flex;gap:.35rem">
          <button class="btn btn-sm btn-icon" title="View" onclick="previewLesson(${l.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
          <button class="btn btn-sm btn-icon" title="Edit" onclick='editLesson(${l.id})'><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="btn btn-sm btn-icon btn-danger" title="Delete" onclick="confirmDeleteLesson(${l.id}, '${escAttr(l.title)}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function openLessonModal(data = null) {
  document.getElementById('lm-edit-id').value = '';
  document.getElementById('lesson-modal-title').textContent = 'New lesson';
  ['lm-key','lm-title','lm-content','lm-milskill','lm-sort','lm-image'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('lm-image-preview').style.display = 'none';
  document.getElementById('lm-topic').value = 'claim_detection';
  document.getElementById('lm-difficulty').value = 'beginner';
  document.getElementById('lesson-modal-error').textContent = '';
  // Refresh topic datalist
  _refreshTopics();
  if (data) {
    document.getElementById('lm-edit-id').value = data.id;
    document.getElementById('lesson-modal-title').textContent = 'Edit lesson';
    document.getElementById('lm-key').value = data.lesson_key || '';
    document.getElementById('lm-title').value = data.title || '';
    document.getElementById('lm-content').value = data.content || '';
    document.getElementById('lm-milskill').value = data.mil_skill || '';
    document.getElementById('lm-sort').value = data.sort_order ?? '';
    document.getElementById('lm-topic').value = data.topic || 'general';
    document.getElementById('lm-difficulty').value = data.difficulty || 'beginner';
    document.getElementById('lm-key').disabled = true;
    // Image — optional, never blocks save
    const imgVal = data.image_url || '';
    document.getElementById('lm-image').value = imgVal;
    const prev = document.getElementById('lm-image-preview');
    const thumb = document.getElementById('lm-image-thumb');
    if (imgVal && prev && thumb) { thumb.src = imgVal; prev.style.display = 'block'; } else if (prev) { prev.style.display = 'none'; }
  } else {
    document.getElementById('lm-key').disabled = false;
  }
  openModal('lesson-modal');
}

function editLesson(id) {
  const l = _lessonsData.find(x => x.id === id);
  if (l) openLessonModal(l);
}

function previewLesson(id) {
  const l = _lessonsData.find(x => x.id === id);
  if (!l) return;
  document.querySelector('#preview-modal .modal-title').childNodes[0].textContent = l.title + ' ';
  document.getElementById('preview-content').innerHTML = `
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.75rem;">
      ${topicBadge(l.topic)} ${diffBadge(l.difficulty)}
    </div>
    <div style="white-space:pre-wrap;font-size:.83rem;line-height:1.65;color:var(--text);max-height:60vh;overflow-y:auto;">${escHtml(l.content)}</div>
  `;
  openModal('preview-modal');
}

async function saveLesson() {
  const editId  = document.getElementById('lm-edit-id').value;
  const errEl   = document.getElementById('lesson-modal-error');
  errEl.textContent = '';
  const topicVal = document.getElementById('lm-topic').value.trim();
  if (!topicVal) { errEl.textContent = 'Topic is required.'; return; }
  const body = {
    lesson_key:  document.getElementById('lm-key').value.trim(),
    title:       document.getElementById('lm-title').value.trim(),
    content:     document.getElementById('lm-content').value.trim(),
    topic:       topicVal,
    difficulty:  document.getElementById('lm-difficulty').value,
    mil_skill:   document.getElementById('lm-milskill').value.trim() || null,
    sort_order:  parseInt(document.getElementById('lm-sort').value) || null,
    image_url:   document.getElementById('lm-image').value.trim() || null, // always optional
  };
  if (!body.title || !body.content) { errEl.textContent = 'Title and content are required.'; return; }
  if (!editId && !body.lesson_key)  { errEl.textContent = 'Lesson key is required.'; return; }
  try {
    if (editId) {
      await apiFetch(`/admin/lessons/${editId}`, { method: 'PUT', body: JSON.stringify(body) });
      adminToast('Lesson updated.');
    } else {
      await apiFetch('/admin/lessons', { method: 'POST', body: JSON.stringify(body) });
      adminToast('Lesson created.');
    }
    closeModal('lesson-modal');
    await loadLessons();
    await _refreshTopics();
  } catch(e) { errEl.textContent = e.message; }
}

function confirmDeleteLesson(id, title) {
  document.getElementById('confirm-title').textContent = 'Delete lesson';
  document.getElementById('confirm-body').innerHTML =
    `Permanently delete <strong>"${escHtml(title)}"</strong>?<br><span style="font-size:.8rem;color:var(--muted)">If quiz questions are linked to it, first unlink them in the Quiz panel (set Lesson → "no lesson"), then delete here.</span>`;
  document.getElementById('confirm-ok-btn').onclick = async () => {
    try {
      await apiFetch(`/admin/lessons/${id}`, { method: 'DELETE' });
      adminToast('Lesson deleted.');
      closeModal('confirm-modal');
      await loadLessons();
      await _refreshTopics();
    } catch(e) {
      closeModal('confirm-modal');
      adminToast(e.message, 'error');
    }
  };
  openModal('confirm-modal');
}

// ── USERS ──────────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    _usersData = await apiFetch('/admin/users');
    renderUsersTable(_usersData);
  } catch(e) {
    document.getElementById('users-table-body').innerHTML = `<tr><td colspan="8" style="color:var(--red);text-align:center;padding:1rem;font-size:.8rem">${e.message}</td></tr>`;
  }
}

function filterUsers() {
  const q = document.getElementById('user-search').value.toLowerCase();
  renderUsersTable(_usersData.filter(u => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)));
}

function renderUsersTable(data) {
  const countEl = document.getElementById('users-count-label');
  if (countEl) countEl.textContent = `${data.length} account${data.length !== 1 ? 's' : ''} registered`;
  if (!data.length) { document.getElementById('users-table-body').innerHTML = '<tr><td colspan="8"><div class="empty-state"><p>No users found.</p></div></td></tr>'; return; }
  const me = localStorage.getItem('sp_user_id');
  document.getElementById('users-table-body').innerHTML = data.map(u => `<tr>
    <td><div style="font-size:.82rem">${escHtml(u.username)}</div><div class="td-muted" style="font-size:.72rem">${escHtml(u.email)}</div></td>
    <td><span class="badge badge-${u.role}">${u.role}</span></td>
    <td class="td-muted td-mono" style="font-size:.72rem">${(u.created_at || '').slice(0,10)}</td>
    <td class="td-mono">${u.submission_count ?? 0}</td>
    <td class="td-mono">${u.lessons_completed ?? 0}</td>
    <td class="td-mono">${u.quiz_attempts ?? 0}</td>
    <td class="td-muted td-mono" style="font-size:.72rem">${u.last_active_at ? u.last_active_at.slice(0,10) : '—'}</td>
    <td>
      <div style="display:flex;gap:.35rem;align-items:center">
        <button class="btn btn-sm btn-icon" title="Edit user" onclick="openUserModal(${JSON.stringify(u).replace(/"/g,'&quot;')})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        ${String(u.id) !== String(me) ? `<button class="btn btn-sm btn-icon btn-danger" title="Delete user" onclick="confirmDeleteUser(${u.id}, '${escAttr(u.username)}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg></button>` : ''}
      </div>
    </td>
  </tr>`).join('');
}

async function changeRole(id, role) {
  try {
    await apiFetch(`/admin/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) });
    adminToast(`User role updated to ${role}.`);
    await loadUsers();
  } catch(e) { adminToast(e.message, 'error'); }
}

function confirmDeleteUser(id, username) {
  document.getElementById('confirm-title').textContent = 'Delete user';
  document.getElementById('confirm-body').innerHTML = `This will permanently delete account <strong>"${escHtml(username)}"</strong> and all their data. This cannot be undone.`;
  document.getElementById('confirm-ok-btn').onclick = async () => {
    try {
      await apiFetch(`/admin/users/${id}`, { method: 'DELETE' });
      adminToast('User deleted.');
      closeModal('confirm-modal');
      await loadUsers();
    } catch(e) { adminToast(e.message, 'error'); }
  };
  openModal('confirm-modal');
}

function toggleUserPw() {
  const input  = document.getElementById('um-password');
  const eye    = document.getElementById('um-pw-eye');
  const eyeOff = document.getElementById('um-pw-eye-off');
  const show   = input.type === 'password';
  input.type   = show ? 'text' : 'password';
  eye.style.display    = show ? 'none'  : '';
  eyeOff.style.display = show ? ''      : 'none';
  input.focus();
}

function openUserModal(user) {
  document.getElementById('user-modal-error').textContent = '';
  const isEdit = !!user;
  document.getElementById('user-modal-title').textContent = isEdit ? `Edit user — ${user.username}` : 'New user';
  document.getElementById('um-edit-id').value = isEdit ? user.id : '';
  document.getElementById('um-username').value = isEdit ? (user.username || '') : '';
  document.getElementById('um-email').value    = isEdit ? (user.email || '') : '';
  document.getElementById('um-password').value = '';
  // Always reset to hidden when opening
  document.getElementById('um-password').type = 'password';
  document.getElementById('um-pw-eye').style.display     = '';
  document.getElementById('um-pw-eye-off').style.display = 'none';
  document.getElementById('um-role').value     = isEdit ? (user.role || 'user') : 'user';
  document.getElementById('um-pw-label').textContent = isEdit ? 'New password (leave blank to keep current)' : 'Password';
  document.getElementById('um-pw-hint').textContent  = isEdit ? 'Only fill this if you want to change the password.' : '';
  openModal('user-modal');
}

async function saveUser() {
  const errEl = document.getElementById('user-modal-error');
  errEl.textContent = '';
  const editId   = document.getElementById('um-edit-id').value;
  const username = document.getElementById('um-username').value.trim();
  const email    = document.getElementById('um-email').value.trim();
  const password = document.getElementById('um-password').value;
  const role     = document.getElementById('um-role').value;

  if (!username) { errEl.textContent = 'Username is required.'; return; }
  if (!email)    { errEl.textContent = 'Email is required.'; return; }
  if (!editId && !password) { errEl.textContent = 'Password is required for new accounts.'; return; }
  if (password && password.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }

  try {
    if (editId) {
      const body = { username, email, role };
      if (password) body.password = password;
      await apiFetch(`/admin/users/${editId}`, { method: 'PUT', body: JSON.stringify(body) });
      adminToast('User updated.');
    } else {
      await apiFetch('/admin/users', { method: 'POST', body: JSON.stringify({ username, email, password, role }) });
      adminToast('User created.');
    }
    closeModal('user-modal');
    await loadUsers();
  } catch(e) { errEl.textContent = e.message; }
}

// ── ANALYTICS ─────────────────────────────────────────────────────────────
async function loadAnalytics() {
  try {
    const [skills, heatmap, quiz, pretest] = await Promise.all([
      apiFetch('/admin/analytics/skills'),
      apiFetch('/admin/analytics/lessons-heatmap'),
      apiFetch('/admin/analytics/quiz'),
      apiFetch('/admin/analytics/pretest'),
    ]);

    // Skill distribution
    const topics = [...new Set(skills.skill_distribution.map(r => r.topic))];
    const levelColors = { beginner: '#34d399', intermediate: '#fbbf24', advanced: '#f87171' };
    document.getElementById('skill-dist').innerHTML = topics.map(t => {
      const rows = skills.skill_distribution.filter(r => r.topic === t);
      const total = rows.reduce((s, r) => s + r.user_count, 0) || 1;
      return `<div style="margin-bottom:.9rem"><div style="font-size:.78rem;margin-bottom:.35rem;color:var(--text)">${topicLabel(t)}</div>
        <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;gap:1px">
          ${['beginner','intermediate','advanced'].map(lvl => {
            const row = rows.find(r => r.current_level === lvl);
            const pct = row ? Math.round(row.user_count / total * 100) : 0;
            return pct ? `<div style="width:${pct}%;background:${levelColors[lvl]};opacity:.8" title="${lvl}: ${row?.user_count || 0} users"></div>` : '';
          }).join('')}
        </div>
        <div style="display:flex;gap:.75rem;margin-top:.3rem">
          ${['beginner','intermediate','advanced'].map(lvl => {
            const row = rows.find(r => r.current_level === lvl);
            return `<span style="font-family:'DM Mono',monospace;font-size:.63rem;color:${levelColors[lvl]}">${lvl[0].toUpperCase()}: ${row?.user_count || 0}</span>`;
          }).join('')}
        </div></div>`;
    }).join('') || '<div class="empty-state" style="padding:1rem"><p>No skill data yet</p></div>';

    // Lesson heatmap
    const hData = heatmap.by_lesson.slice(0, 8);
    const hMax = Math.max(...hData.map(r => r.trigger_count), 1);
    document.getElementById('lesson-heatmap').innerHTML = hData.length ? hData.map(r => `
      <div class="topic-row">
        <div class="topic-name" style="font-size:.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(r.title)}">${escHtml(r.title)}</div>
        <div class="topic-bar-wrap"><div class="topic-bar-fill fill-blue" style="width:${Math.round(r.trigger_count / hMax * 100)}%"></div></div>
        <div class="topic-pct">${r.trigger_count}</div>
      </div>`).join('')
    : '<div class="empty-state" style="padding:1rem"><p>No trigger data yet</p></div>';

    // Quiz by topic
    const qMax = Math.max(...(quiz.by_topic.map(r => r.accuracy_pct || 0)), 100);
    document.getElementById('quiz-by-topic').innerHTML = quiz.by_topic.length ? quiz.by_topic.map(r => {
      const pct = r.accuracy_pct || 0;
      const col = pct >= 70 ? '#34d399' : pct >= 40 ? '#fbbf24' : '#f87171';
      return `<div class="topic-row">
        <div class="topic-name" style="font-size:.75rem">${topicLabel(r.topic)}</div>
        <div class="topic-bar-wrap"><div class="topic-bar-fill" style="width:${pct}%;background:${col}"></div></div>
        <div class="topic-pct">${pct}%</div>
      </div>`;
    }).join('') : '<div class="empty-state" style="padding:1rem"><p>No attempts yet</p></div>';

    // Quiz by difficulty
    document.getElementById('quiz-by-diff').innerHTML = quiz.by_difficulty.length ? quiz.by_difficulty.map(r => {
      const pct = r.accuracy_pct || 0;
      const col = pct >= 70 ? '#34d399' : pct >= 40 ? '#fbbf24' : '#f87171';
      return `<div class="topic-row">
        <div class="topic-name" style="font-size:.75rem">${r.difficulty}</div>
        <div class="topic-bar-wrap"><div class="topic-bar-fill" style="width:${pct}%;background:${col}"></div></div>
        <div class="topic-pct">${pct}%</div>
      </div>`;
    }).join('') : '<div class="empty-state" style="padding:1rem"><p>No attempts yet</p></div>';

    // Hardest questions
    document.getElementById('hardest-questions').innerHTML = quiz.hardest_questions.length
      ? `<table style="width:100%;border-collapse:collapse">${quiz.hardest_questions.map(q => `
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:.5rem .25rem;font-size:.78rem;color:var(--text)">${escHtml(q.question_text.slice(0,80))}${q.question_text.length > 80 ? '…' : ''}</td>
            <td style="padding:.5rem .5rem;white-space:nowrap">${topicBadge(q.topic)}</td>
            <td style="padding:.5rem .25rem;white-space:nowrap;font-family:'DM Mono',monospace;font-size:.72rem;color:${(q.accuracy_pct||0)<40?'var(--red)':'var(--yellow)'}">
              ${q.accuracy_pct}% (${q.attempts} attempts)
            </td>
          </tr>`).join('')}</table>`
      : '<div class="empty-state" style="padding:1rem"><p>Need at least 5 attempts per question</p></div>';

    // Pretest
    const byPhase = pretest.by_phase || [];
    const pre  = byPhase.find(r => r.phase === 'pretest');
    const post = byPhase.find(r => r.phase === 'posttest');
    document.getElementById('pretest-data').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
        ${statCard('Pre-test avg', pre  ? pre.avg_score_pct  + '%' : '—', pre  ? pre.total_submissions  + ' submissions' : '')}
        ${statCard('Post-test avg', post ? post.avg_score_pct + '%' : '—', post ? post.total_submissions + ' submissions' : '')}
        ${statCard('Paired users', pretest.paired_users ?? 0, 'completed both')}
        ${statCard('Avg improvement', pretest.avg_improvement_pct != null ? '+' + pretest.avg_improvement_pct + '%' : '—', '')}
      </div>`;

  } catch(e) { adminToast(e.message, 'error'); }
}

// ── CORPUS ─────────────────────────────────────────────────────────────────
async function loadCorpusStats() {
  try {
    const d = await apiFetch('/admin/corpus/stats');
    document.getElementById('corpus-stats').innerHTML = `
      ${statCard('Total sentences', d.total_sentences, '')}
      ${statCard('Unique sources', d.sources, '')}
      ${statCard('Pipelines', d.pipelines || '—', '')}`;
  } catch(e) { document.getElementById('corpus-stats').innerHTML = `<div style="color:var(--red);font-size:.8rem">${e.message}</div>`; }
}

async function ingestCorpus() {
  const domain    = document.getElementById('corpus-domain').value.trim();
  const name      = document.getElementById('corpus-name').value.trim();
  const pipeline  = document.getElementById('corpus-pipeline').value;
  const rawText   = document.getElementById('corpus-sentences').value;
  const sentences = rawText.split('\n').map(s => s.trim()).filter(Boolean);
  const resultEl  = document.getElementById('corpus-result');
  if (!domain || !name) { resultEl.style.color = 'var(--red)'; resultEl.textContent = 'Domain and name are required.'; return; }
  if (!sentences.length){ resultEl.style.color = 'var(--red)'; resultEl.textContent = 'No sentences provided.'; return; }
  try {
    const r = await apiFetch('/admin/corpus/ingest', { method: 'POST', body: JSON.stringify({ sentences, source_domain: domain, source_name: name, pipeline }) });
    resultEl.style.color = 'var(--green)';
    resultEl.textContent = `Inserted ${r.inserted}, skipped ${r.skipped} duplicates.`;
    await loadCorpusStats();
  } catch(e) { resultEl.style.color = 'var(--red)'; resultEl.textContent = e.message; }
}

// ── API HEALTH ─────────────────────────────────────────────────────────────
async function loadApiHealth() {
  document.getElementById('api-health-content').innerHTML = '<div class="loading">Loading…</div>';
  try {
    const d = await apiFetch('/admin/api-usage');
    const fc = d.google_factcheck_api;
    const mb = d.mbfc_coverage;
    const sa = d.system_accuracy;
    document.getElementById('api-health-content').innerHTML = `
      <div class="analytics-grid" style="margin-bottom:1.25rem">
        <div class="analytics-card">
          <div class="analytics-card-title">Google Fact Check cache</div>
          <div class="api-status"><div class="dot-status ${fc.active > 0 ? 'dot-green' : 'dot-yellow'}"></div><span>Active entries: <strong>${fc.active ?? 0}</strong></span></div>
          <div class="api-status"><div class="dot-status dot-yellow"></div><span>Expired: <strong>${fc.expired ?? 0}</strong></span></div>
          <div class="api-status"><div class="dot-status dot-green"></div><span>Total cached: <strong>${fc.total_cached ?? 0}</strong></span></div>
        </div>
        <div class="analytics-card">
          <div class="analytics-card-title">MBFC domain coverage</div>
          <div class="api-status"><div class="dot-status ${mb.total_domains > 0 ? 'dot-green' : 'dot-red'}"></div><span>Domains loaded: <strong>${mb.total_domains ?? 0}</strong></span></div>
          ${mb.last_synced ? `<div class="api-status"><div class="dot-status dot-yellow"></div><span>Last synced: <strong>${mb.last_synced.slice(0,10)}</strong></span></div>` : ''}
          <div style="margin-top:.75rem">
            <button class="btn btn-sm" onclick="triggerMbfcSync()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              Sync MBFC now
            </button>
          </div>
        </div>
      </div>
      <div class="analytics-card">
        <div class="analytics-card-title">System accuracy vs LIAR/FEVER ground truth</div>
        ${sa.error ? `<div style="color:var(--muted);font-size:.82rem;padding:.5rem 0">${escHtml(sa.error)}</div>` :
          sa.total === 0 ? `<div style="color:var(--muted);font-size:.82rem;padding:.5rem 0">No ground truth predictions yet. Run: <code style="font-family:'DM Mono',monospace;font-size:.78rem">python corpus/evaluate_system.py</code></div>` :
          `<div class="stat-grid" style="margin-bottom:.75rem">
            ${statCard('Overall accuracy', (sa.overall_accuracy_pct ?? '—') + '%', sa.total + ' predictions')}
            ${statCard('Correct', sa.correct ?? 0, '')}
            ${statCard('Total', sa.total ?? 0, '')}
          </div>
          ${sa.by_dataset ? sa.by_dataset.map(ds => `<div class="api-status"><div class="dot-status dot-green"></div><span>${escHtml(ds.dataset)}: <strong>${ds.correct}/${ds.total}</strong> correct</span></div>`).join('') : ''}`
        }
      </div>`;
  } catch(e) { document.getElementById('api-health-content').innerHTML = `<div style="color:var(--red);font-size:.82rem">${e.message}</div>`; }
}

async function triggerMbfcSync() {
  adminToast('Syncing MBFC… this may take up to 2 minutes.');
  try {
    const r = await apiFetch('/admin/mbfc/sync', { method: 'POST' });
    adminToast('MBFC sync complete.');
    await loadApiHealth();
  } catch(e) { adminToast(e.message, 'error'); }
}

// ── HELPERS ────────────────────────────────────────────────────────────────
function topicBadge(t) {
  const map = { claim_detection:'badge-claim', source_verification:'badge-source', bias_detection:'badge-bias', evidence_evaluation:'badge-evidence', general:'badge-general' };
  const labels = { claim_detection:'Claim', source_verification:'Source', bias_detection:'Bias', evidence_evaluation:'Evidence', general:'General' };
  return `<span class="badge ${map[t] || 'badge-general'}">${labels[t] || t}</span>`;
}
function diffBadge(d) {
  const map = { beginner:'badge-beginner', intermediate:'badge-intermediate', advanced:'badge-advanced' };
  return `<span class="badge ${map[d] || ''}">${d}</span>`;
}
// topicLabel already defined above
function populateLessonDropdown(id, lessons) {
  const sel = document.getElementById(id);
  const cur = sel.value;
  sel.innerHTML = '<option value="">— no lesson —</option>' + lessons.map(l => `<option value="${l.id}">${escHtml(l.title)}</option>`).join('');
  if (cur) sel.value = cur;
}
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
// escHtml already defined above
function escAttr(s) { return String(s || '').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }

let _adminToastTimer;
function adminToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + (type === 'error' ? 'show' : 'show');
  t.style.borderColor = type === 'error' ? 'rgba(248,113,113,.4)' : '';
  t.style.color = type === 'error' ? 'var(--red)' : '';
  clearTimeout(_adminToastTimer);
  _adminToastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}


// ── PREBUNKING QUESTIONS & TECHNIQUES ────────────────────────────────────────

// Runtime cache of techniques fetched from DB
let PB_TECHNIQUE_NAMES = {};   // technique_id → name
let _pbTechniques      = [];   // full technique objects
let _pbData            = [];
let _pbEditId          = null;
let _currentPbTab      = 'techniques';

// Switch between Techniques / Questions tabs inside the prebunking panel
function switchPbTab(tab) {
  _currentPbTab = tab;
  ['techniques', 'questions'].forEach(t => {
    document.getElementById('pbtab-' + t)?.classList.toggle('active', t === tab);
    document.getElementById('pbtab-btn-' + t)?.classList.toggle('active', t === tab);
    const actEl = document.getElementById('pb-tab-actions-' + t);
    if (actEl) actEl.style.display = t === tab ? 'flex' : 'none';
  });
  if (tab === 'techniques') loadPrebunkingTechniques();
  else                       loadPrebunkingQuestions();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _populateTechniqueDropdowns() {
  // Filter select in Questions tab header
  const filterSel = document.getElementById('pb-filter-technique');
  if (filterSel) {
    const prev = filterSel.value;
    filterSel.innerHTML = '<option value="">All Techniques</option>' +
      _pbTechniques.map(t => `<option value="${escAttr(t.technique_id)}">${escHtml(t.name)}</option>`).join('');
    filterSel.value = prev;
  }
  // Technique select inside the question modal
  const modalSel = document.getElementById('pb-modal-technique');
  if (modalSel) {
    const prev = modalSel.value;
    modalSel.innerHTML = '<option value="">— select —</option>' +
      _pbTechniques.map(t => `<option value="${escAttr(t.technique_id)}">${escHtml(t.name)}</option>`).join('');
    if (prev) modalSel.value = prev;
  }
}

// ── TECHNIQUE CRUD ────────────────────────────────────────────────────────────

async function loadPrebunkingTechniques() {
  const tbody = document.getElementById('pb-techniques-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="padding:2rem;text-align:center;color:var(--muted);font-size:.85rem;">Loading…</td></tr>';
  try {
    _pbTechniques = await apiFetch('/admin/prebunking-techniques');
    // Update the name map
    PB_TECHNIQUE_NAMES = {};
    _pbTechniques.forEach(t => { PB_TECHNIQUE_NAMES[t.technique_id] = t.name; });
    _populateTechniqueDropdowns();

    if (!_pbTechniques.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="padding:2rem;text-align:center;color:var(--muted);font-size:.85rem;">No techniques yet — click "+ New Technique" to add one.</td></tr>';
      return;
    }
    tbody.innerHTML = _pbTechniques.map((t, i) => `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:.7rem 1rem;font-family:'DM Mono',monospace;font-size:.72rem;color:var(--muted);text-align:center;">${i + 1}</td>
        <td style="padding:.7rem 1rem;font-size:.84rem;font-weight:500;">${escHtml(t.name)}</td>
        <td style="padding:.7rem 1rem;font-size:.8rem;color:var(--muted);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escAttr(t.description||'')}">
          ${t.description ? escHtml(t.description.slice(0,80)) + (t.description.length>80?'…':'') : '<em style="opacity:.45">—</em>'}
        </td>
        <td style="padding:.7rem 1rem;text-align:center;font-family:'DM Mono',monospace;font-size:.8rem;">${t.module ?? '—'}</td>
        <td style="padding:.7rem 1rem;text-align:center;">
          <span style="font-size:.75rem;padding:.2rem .6rem;border-radius:20px;${t.is_active ? 'background:rgba(52,211,153,.12);color:var(--green)' : 'background:rgba(255,255,255,.05);color:var(--muted)'}">
            ${t.is_active ? 'Active' : 'Hidden'}
          </span>
        </td>
        <td style="padding:.7rem 1rem;text-align:center;white-space:nowrap;">
          <button onclick="openTechniqueModal(${JSON.stringify(t).replace(/"/g,'&quot;')})" class="btn btn-sm btn-icon" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button onclick="toggleTechniqueActive('${escAttr(t.technique_id)}', ${!t.is_active})" class="btn btn-sm btn-icon" title="${t.is_active ? 'Deactivate' : 'Activate'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;color:${t.is_active ? 'var(--muted)' : 'var(--green)'}"><path d="${t.is_active ? 'M18 6L6 18M6 6l12 12' : 'M20 6L9 17l-5-5'}"/></svg>
          </button>
          <button onclick="confirmDeleteTechnique('${escAttr(t.technique_id)}', '${escAttr(t.name)}')" class="btn btn-sm btn-icon btn-danger" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
          </button>
        </td>
      </tr>`).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:2rem;text-align:center;color:var(--red);font-size:.85rem;">Error: ${escHtml(e.message)}</td></tr>`;
  }
}

// Auto-generate technique_id slug from the name as the teacher types
function autoSlugTechniqueName(val) {
  const slug = val.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  document.getElementById('tm-id').value = slug;
  const preview = document.getElementById('tm-id-preview');
  if (preview) preview.textContent = slug ? 'Internal code: ' + slug : '';
}

function openTechniqueModal(t) {
  const isEdit = t && t.technique_id;
  document.getElementById('technique-modal-title').textContent = isEdit ? 'Edit Technique' : 'New Technique';
  document.getElementById('tm-edit-id').value = isEdit ? t.technique_id : '';
  document.getElementById('tm-id').value      = isEdit ? t.technique_id : '';
  document.getElementById('tm-name').value    = t?.name        || '';
  document.getElementById('tm-desc').value    = t?.description || '';
  document.getElementById('tm-module').value  = t?.module      ?? '';
  document.getElementById('tm-sort').value    = t?.sort_order  ?? '';
  document.getElementById('tm-active').checked = t ? !!t.is_active : true;
  document.getElementById('technique-modal-error').textContent = '';
  const preview = document.getElementById('tm-id-preview');
  if (preview) preview.textContent = '';
  openModal('technique-modal');
}

async function saveTechnique() {
  const editId = document.getElementById('tm-edit-id').value;
  const errEl  = document.getElementById('technique-modal-error');
  errEl.textContent = '';
  const name = document.getElementById('tm-name').value.trim();
  if (!name) { errEl.textContent = 'Please enter a technique name.'; return; }
  const tid = editId
    ? document.getElementById('tm-id').value.trim()
    : name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (!tid) { errEl.textContent = 'Could not generate an ID from the name. Please use letters only.'; return; }
  // Auto-assign sort_order when creating: put it after the last existing technique
  const existingSortVal = document.getElementById('tm-sort').value;
  const autoSort = existingSortVal
    ? parseInt(existingSortVal)
    : (_pbTechniques.length ? Math.max(..._pbTechniques.map(t => t.sort_order || 0)) + 10 : 10);

  const body = {
    name,
    description: document.getElementById('tm-desc').value.trim() || null,
    module:      parseInt(document.getElementById('tm-module').value) || null,
    sort_order:  autoSort,
    is_active:   document.getElementById('tm-active').checked,
  };
  try {
    if (editId) {
      await apiFetch(`/admin/prebunking-techniques/${editId}`, { method: 'PUT', body: JSON.stringify(body) });
      adminToast('Technique updated.');
    } else {
      await apiFetch('/admin/prebunking-techniques', { method: 'POST', body: JSON.stringify({ technique_id: tid, ...body }) });
      adminToast('Technique created.');
    }
    closeModal('technique-modal');
    await loadPrebunkingTechniques();
  } catch(e) { errEl.textContent = e.message; }
}

async function toggleTechniqueActive(tid, active) {
  try {
    await apiFetch(`/admin/prebunking-techniques/${tid}`, { method: 'PUT', body: JSON.stringify({ is_active: active }) });
    adminToast(active ? 'Technique activated.' : 'Technique hidden.');
    await loadPrebunkingTechniques();
  } catch(e) { adminToast(e.message, 'error'); }
}

function confirmDeleteTechnique(tid, name) {
  document.getElementById('confirm-title').textContent = 'Delete technique';
  document.getElementById('confirm-body').innerHTML = `This will permanently delete the technique <strong>"${escHtml(name)}"</strong>. Associated questions will NOT be auto-deleted but will be orphaned. Prefer deactivating instead.`;
  document.getElementById('confirm-ok-btn').onclick = async () => {
    try {
      await apiFetch(`/admin/prebunking-techniques/${encodeURIComponent(tid)}`, { method: 'DELETE' });
      adminToast('Technique deleted.');
      closeModal('confirm-modal');
      await loadPrebunkingTechniques();
    } catch(e) { adminToast(e.message, 'error'); }
  };
  openModal('confirm-modal');
}

// ── QUESTION CRUD ─────────────────────────────────────────────────────────────

async function loadPrebunkingQuestions() {
  const tbody = document.getElementById('pb-questions-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="padding:2rem;text-align:center;color:var(--muted);font-size:.85rem;">Loading…</td></tr>';

  // Ensure techniques are loaded so we have names for display
  if (!_pbTechniques.length) {
    try {
      _pbTechniques = await apiFetch('/admin/prebunking-techniques');
      PB_TECHNIQUE_NAMES = {};
      _pbTechniques.forEach(t => { PB_TECHNIQUE_NAMES[t.technique_id] = t.name; });
      _populateTechniqueDropdowns();
    } catch(_) {}
  }

  const tid = document.getElementById('pb-filter-technique')?.value || '';
  try {
    const url = '/admin/prebunking-questions' + (tid ? `?technique_id=${tid}` : '');
    _pbData = await apiFetch(url);
    if (!_pbData.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:2rem;text-align:center;color:var(--muted);font-size:.85rem;">No questions yet — click "+ New Question" to add one.</td></tr>';
      return;
    }
    tbody.innerHTML = _pbData.map(q => `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:.7rem 1rem;font-family:'DM Mono',monospace;font-size:.72rem;color:var(--accent2);white-space:nowrap;">
          ${escHtml(PB_TECHNIQUE_NAMES[q.technique_id] || q.technique_id)}
        </td>
        <td style="padding:.7rem 1rem;font-size:.83rem;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escAttr(q.question_text)}">
          ${escHtml(q.question_text)}
        </td>
        <td style="padding:.7rem 1rem;font-family:'DM Mono',monospace;font-size:.8rem;color:var(--green);font-weight:700;">
          ${escHtml(q.correct_answer)}
        </td>
        <td style="padding:.7rem 1rem;font-size:.8rem;color:var(--muted);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escAttr(q.explanation||'')}">
          ${q.explanation ? escHtml(q.explanation.slice(0,80)) + (q.explanation.length>80?'…':'') : '<em>—</em>'}
        </td>
        <td style="padding:.7rem 1rem;text-align:center;white-space:nowrap;">
          <button onclick="openPbModal(${q.id})" class="btn btn-sm btn-icon" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button onclick="deletePbQuestion(${q.id})" class="btn btn-sm btn-icon btn-danger" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
          </button>
        </td>
      </tr>`).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:2rem;text-align:center;color:var(--red);font-size:.85rem;">Error: ${escHtml(e.message)}</td></tr>`;
  }
}

function openPbModal(id) {
  _pbEditId = id;
  const q = id ? _pbData.find(x => x.id === id) : null;
  // Make sure technique options are populated
  _populateTechniqueDropdowns();
  document.getElementById('pb-modal-title').textContent = id ? 'Edit Question' : 'New Question';
  document.getElementById('pb-modal-technique').value   = q?.technique_id    || '';
  document.getElementById('pb-modal-question').value    = q?.question_text   || '';
  document.getElementById('pb-modal-option-a').value    = q?.option_a        || '';
  document.getElementById('pb-modal-option-b').value    = q?.option_b        || '';
  document.getElementById('pb-modal-option-c').value    = q?.option_c        || '';
  document.getElementById('pb-modal-option-d').value    = q?.option_d        || '';
  document.getElementById('pb-modal-correct').value     = q?.correct_answer  || 'A';
  document.getElementById('pb-modal-explanation').value = q?.explanation     || '';
  document.getElementById('pb-modal-error').textContent = '';
  // Image — truly optional, never blocks save
  const imgVal = q?.image_url || '';
  document.getElementById('pb-modal-image').value = imgVal;
  const prev = document.getElementById('pb-image-preview');
  const thumb = document.getElementById('pb-image-thumb');
  if (imgVal && prev && thumb) { thumb.src = imgVal; prev.style.display = 'block'; } else if (prev) { prev.style.display = 'none'; }
  openModal('pb-modal');
}

async function savePbQuestion() {
  const technique_id  = document.getElementById('pb-modal-technique').value.trim();
  const question_text = document.getElementById('pb-modal-question').value.trim();
  const option_a      = document.getElementById('pb-modal-option-a').value.trim();
  const option_b      = document.getElementById('pb-modal-option-b').value.trim();
  const option_c      = document.getElementById('pb-modal-option-c').value.trim();
  const option_d      = document.getElementById('pb-modal-option-d').value.trim();
  const correct_answer= document.getElementById('pb-modal-correct').value.trim();
  const explanation   = document.getElementById('pb-modal-explanation').value.trim();
  const image_url     = document.getElementById('pb-modal-image').value.trim() || null; // always optional
  const errEl = document.getElementById('pb-modal-error');
  errEl.textContent = '';
  if (!technique_id)  { errEl.textContent = 'Please select a technique.'; return; }
  if (!question_text) { errEl.textContent = 'Question text is required.'; return; }
  if (!option_a || !option_b || !option_c || !option_d) { errEl.textContent = 'All four options (A–D) are required.'; return; }
  if (!correct_answer){ errEl.textContent = 'Select the correct answer.'; return; }
  try {
    const body = { technique_id, question_text, option_a, option_b, option_c, option_d,
                   correct_answer, explanation: explanation || null, image_url };
    if (_pbEditId) {
      await apiFetch(`/admin/prebunking-questions/${_pbEditId}`, { method:'PUT', body: JSON.stringify(body) });
      adminToast('Question updated.');
    } else {
      await apiFetch('/admin/prebunking-questions', { method:'POST', body: JSON.stringify(body) });
      adminToast('Question created.');
    }
    closeModal('pb-modal');
    await loadPrebunkingQuestions();
  } catch(e) {
    errEl.textContent = e.message;
  }
}

async function deletePbQuestion(id) {
  document.getElementById('confirm-title').textContent = 'Delete question';
  document.getElementById('confirm-body').textContent  = 'Permanently delete this prebunking question?';
  document.getElementById('confirm-ok-btn').onclick = async () => {
    try {
      await apiFetch(`/admin/prebunking-questions/${id}`, { method:'DELETE' });
      adminToast('Question deleted.');
      closeModal('confirm-modal');
      await loadPrebunkingQuestions();
    } catch(e) { adminToast(e.message, 'error'); }
  };
  openModal('confirm-modal');
}

// ── EVAL QUESTIONS ────────────────────────────────────────────────────────────

let _evalQData = [];
let _evalQModalInjected = false;

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function showAdminToast(msg, type = 'success') {
  const t = document.getElementById('eval-q-toast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  t.style.background = type === 'error' ? 'rgba(239,68,68,.15)' : 'rgba(34,197,94,.15)';
  t.style.color = type === 'error' ? '#f87171' : '#4ade80';
  t.style.border = `1px solid ${type === 'error' ? 'rgba(239,68,68,.3)' : 'rgba(34,197,94,.3)'}`;
  setTimeout(() => { t.style.display = 'none'; }, 3500);
}

async function loadEvalQuestions() {
  try {
    _evalQData = await apiFetch('/admin/eval-questions');
    renderEvalQTable();
  } catch(e) {
    const tbody = document.getElementById('eval-q-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:2rem;">${_esc(e.message)}</td></tr>`;
  }
}

function renderEvalQTable() {
  const tbody = document.getElementById('eval-q-tbody');
  if (!tbody) return;
  if (!_evalQData.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:2rem;">No eval questions yet. Click + New Question to add one.</td></tr>';
    return;
  }
  tbody.innerHTML = _evalQData.map(q => `
    <tr draggable="true" data-eq-id="${q.id}">
      <td style="color:var(--muted);font-size:.75rem;">${q.step_order}</td>
      <td style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_esc(q.question_text)}">${_esc(q.question_text)}</td>
      <td><span style="font-family:'DM Mono',monospace;font-size:.72rem;color:var(--muted);">${_esc(q.question_type)}</span></td>
      <td style="text-align:center;color:var(--muted);font-size:.8rem;">${(q.choices||[]).length}</td>
      <td>
        <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;">
          <input type="checkbox" ${q.is_enabled ? 'checked' : ''} onchange="toggleEvalQ(${q.id}, this.checked)" style="cursor:pointer;">
          <span style="font-size:.75rem;color:var(--muted);">${q.is_enabled ? 'Yes' : 'No'}</span>
        </label>
      </td>
      <td>
        <div style="display:flex;gap:.4rem;">
          <button class="btn" style="font-size:.72rem;padding:.3rem .6rem;" onclick="openEvalQuestionModal(${q.id})">Edit</button>
          <button class="btn" style="font-size:.72rem;padding:.3rem .6rem;color:#f87171;border-color:rgba(239,68,68,.3);" onclick="deleteEvalQ(${q.id})">Del</button>
        </div>
      </td>
    </tr>
  `).join('');
  _initEvalQDrag();
}

async function toggleEvalQ(id, enabled) {
  try {
    await apiFetch(`/admin/eval-questions/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_enabled: enabled }),
    });
    localStorage.removeItem('sp_eval_questions');
    const q = _evalQData.find(x => x.id === id);
    if (q) q.is_enabled = enabled;
    renderEvalQTable();
    showAdminToast(enabled ? 'Question enabled.' : 'Question disabled.');
  } catch(e) { showAdminToast(e.message, 'error'); }
}

async function deleteEvalQ(id) {
  if (!confirm('Delete this eval question? This cannot be undone.')) return;
  try {
    await apiFetch(`/admin/eval-questions/${id}`, { method: 'DELETE' });
    localStorage.removeItem('sp_eval_questions');
    showAdminToast('Question deleted.');
    await loadEvalQuestions();
  } catch(e) { showAdminToast(e.message, 'error'); }
}

function _initEvalQDrag() {
  const tbody = document.getElementById('eval-q-tbody');
  if (!tbody) return;
  let dragged = null;
  tbody.querySelectorAll('tr[data-eq-id]').forEach(row => {
    row.addEventListener('dragstart', () => { dragged = row; row.style.opacity = '.4'; });
    row.addEventListener('dragend',   () => { dragged = null; row.style.opacity = ''; });
    row.addEventListener('dragover',  e => { e.preventDefault(); });
    row.addEventListener('drop', async e => {
      e.preventDefault();
      if (!dragged || dragged === row) return;
      tbody.insertBefore(dragged, row);
      const order = [...tbody.querySelectorAll('tr[data-eq-id]')].map(r => parseInt(r.dataset.eqId));
      try {
        const res = await apiFetch('/admin/eval-questions/reorder', { method:'POST', body: JSON.stringify({ order }) });
        localStorage.removeItem('sp_eval_questions');
        await loadEvalQuestions();
      } catch(e) { showAdminToast(e.message, 'error'); }
    });
  });
}

function openEvalQuestionModal(id) {
  _injectEvalQModal();
  const q = id ? _evalQData.find(x => x.id === id) : null;
  document.getElementById('eq-modal-title').textContent = q ? 'Edit Question' : 'New Question';
  document.getElementById('eq-id').value          = q ? q.id : '';
  document.getElementById('eq-step-order').value  = q ? q.step_order : (_evalQData.length);
  document.getElementById('eq-question-text').value = q ? q.question_text : '';
  document.getElementById('eq-question-type').value = q ? q.question_type : 'text';
  _toggleEqTypeFields();

  const choicesWrap = document.getElementById('eq-choices-wrap');
  choicesWrap.innerHTML = '';
  const choices = q?.choices || [];
  choices.forEach((ch, i) => _addEvalChoice(ch.value, ch.label, ch.sort_order));

  document.getElementById('eq-modal-overlay').classList.add('open');
}

function _toggleEqTypeFields() {
  const type = document.getElementById('eq-question-type').value;
  const wrap = document.getElementById('eq-choices-section');
  if (wrap) wrap.style.display = type === 'multiple_choice' ? '' : 'none';
}

function _addEvalChoice(value = '', label = '', order = 0) {
  const wrap = document.getElementById('eq-choices-wrap');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:.5rem;align-items:center;margin-bottom:.4rem;';
  const vIn = document.createElement('input');
  vIn.type = 'text'; vIn.placeholder = 'Value (e.g. A)'; vIn.value = value;
  vIn.style.cssText = 'width:80px;background:var(--surface-2,var(--surface));border:1px solid var(--border);border-radius:6px;color:var(--text);padding:.35rem .6rem;font-size:.8rem;';
  vIn.className = 'eq-choice-value';
  const lIn = document.createElement('input');
  lIn.type = 'text'; lIn.placeholder = 'Label text'; lIn.value = label;
  lIn.style.cssText = 'flex:1;background:var(--surface-2,var(--surface));border:1px solid var(--border);border-radius:6px;color:var(--text);padding:.35rem .6rem;font-size:.8rem;';
  lIn.className = 'eq-choice-label';
  const del = document.createElement('button');
  del.type = 'button'; del.textContent = '×';
  del.style.cssText = 'background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--muted);cursor:pointer;padding:.2rem .5rem;font-size:.9rem;';
  del.onclick = () => wrap.removeChild(row);
  row.append(vIn, lIn, del);
  wrap.appendChild(row);
}

async function saveEvalQuestion() {
  const id   = document.getElementById('eq-id').value;
  const body = {
    step_order:    parseInt(document.getElementById('eq-step-order').value) || 0,
    question_text: document.getElementById('eq-question-text').value.trim(),
    question_type: document.getElementById('eq-question-type').value,
    is_enabled:    true,
    choices: [...document.querySelectorAll('#eq-choices-wrap > div')].map((row, i) => ({
      value: row.querySelector('.eq-choice-value').value.trim(),
      label: row.querySelector('.eq-choice-label').value.trim(),
      order: i,
    })).filter(c => c.value && c.label),
  };
  if (!body.question_text) { showAdminToast('Question text is required.', 'error'); return; }
  try {
    if (id) {
      await apiFetch(`/admin/eval-questions/${id}`, { method:'PUT', body: JSON.stringify(body) });
    } else {
      await apiFetch('/admin/eval-questions', { method:'POST', body: JSON.stringify(body) });
    }
    localStorage.removeItem('sp_eval_questions');
    document.getElementById('eq-modal-overlay').classList.remove('open');
    showAdminToast(id ? 'Question updated.' : 'Question created.');
    await loadEvalQuestions();
  } catch(e) { showAdminToast(e.message, 'error'); }
}

function _injectEvalQModal() {
  if (_evalQModalInjected) return;
  _evalQModalInjected = true;
  const overlay = document.createElement('div');
  overlay.id = 'eq-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:560px;width:95%;">
      <div class="modal-header">
        <div class="modal-title" id="eq-modal-title">Eval Question</div>
        <button class="modal-close" onclick="document.getElementById('eq-modal-overlay').classList.remove('open')">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:.85rem;">
        <input type="hidden" id="eq-id">
        <div>
          <label style="font-size:.75rem;color:var(--muted);display:block;margin-bottom:.3rem;">Step Order</label>
          <input id="eq-step-order" type="number" min="0" style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:.5rem .75rem;font-size:.85rem;">
        </div>
        <div>
          <label style="font-size:.75rem;color:var(--muted);display:block;margin-bottom:.3rem;">Question Text</label>
          <textarea id="eq-question-text" rows="3" style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:.5rem .75rem;font-size:.85rem;resize:vertical;"></textarea>
        </div>
        <div>
          <label style="font-size:.75rem;color:var(--muted);display:block;margin-bottom:.3rem;">Type</label>
          <select id="eq-question-type" onchange="_toggleEqTypeFields()" style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:.5rem .75rem;font-size:.85rem;">
            <option value="text">text</option>
            <option value="multiple_choice">multiple_choice</option>
          </select>
        </div>
        <div id="eq-choices-section">
          <label style="font-size:.75rem;color:var(--muted);display:block;margin-bottom:.4rem;">Choices</label>
          <div id="eq-choices-wrap"></div>
          <button type="button" onclick="_addEvalChoice()" style="font-size:.75rem;background:transparent;border:1px dashed var(--border);border-radius:7px;color:var(--muted);padding:.35rem .75rem;cursor:pointer;margin-top:.3rem;">+ Add Choice</button>
        </div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:.6rem;padding-top:.75rem;">
        <button class="btn" onclick="document.getElementById('eq-modal-overlay').classList.remove('open')">Cancel</button>
        <button class="btn-primary" onclick="saveEvalQuestion()">Save</button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
  document.body.appendChild(overlay);
}


document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
});

// Live image preview for admin modals
function _bindImagePreview(inputId, previewId, thumbId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('input', () => {
    const val = input.value.trim();
    const prev = document.getElementById(previewId);
    const thumb = document.getElementById(thumbId);
    if (val) { thumb.src = val; prev.style.display = 'block'; } else { prev.style.display = 'none'; }
  });
}
document.addEventListener('DOMContentLoaded', () => {
  _bindImagePreview('qm-image', 'qm-image-preview', 'qm-image-thumb');
  _bindImagePreview('lm-image', 'lm-image-preview', 'lm-image-thumb');
  _bindImagePreview('pb-modal-image', 'pb-image-preview', 'pb-image-thumb');
});
