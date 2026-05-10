const API_BASE  = '';
let LESSONS     = [];   // loaded from /lessons API
let currentFilter = 'all';
let completedKeys = new Set(JSON.parse(localStorage.getItem('sp_read_lessons') || '[]'));

// ── Frontend metadata map (icon + preview + takeaway by lesson_key) ───────────
// New lessons added to the DB without entries here get auto-generated previews.
const LESSON_META = {
  identify_claims:    { icon:'🎯', takeaway:'Ask yourself: "Can this be independently verified?" If yes — it\'s a claim that deserves fact-checking.' },
  multiple_claims:    { icon:'📋', takeaway:'Break compound sentences into individual claims and investigate each one separately.' },
  source_verification:{ icon:'🔍', takeaway:'Before trusting any content, take 60 seconds to check: Who published this? When? Can I find their editorial standards?' },
  primary_vs_secondary:{ icon:'🏛️', takeaway:'"Studies show…" tells you nothing. Always ask: Which study? Where is the link? What did it actually say?' },
  recognize_bias:     { icon:'🔥', takeaway:'The more emotional a post makes you feel, the more carefully you should read it.' },
  clickbait_headlines:{ icon:'🪤', takeaway:'Always read past the headline. A sensational headline that matches a measured article is rare.' },
  investigate_evidence:  { icon:'📊', takeaway:'"Studies show" is not evidence. The citation, sample size, methodology, and publication venue are what make evidence credible.' },
  correlation_causation:{ icon:'🔗', takeaway:'When a post says "X is linked to Y," that\'s correlation — not proof that X causes Y.' },
  general_mil:        { icon:'📖', takeaway:'MIL doesn\'t make you a cynic — it makes you a more informed, empowered consumer of information.' },
  confirmation_bias:  { icon:'🧠', takeaway:'The content you agree with most strongly deserves the most scrutiny — not the least.' },
};

// Default icon by topic
const TOPIC_ICONS = {
  claim_detection:'🎯', source_verification:'🔍', bias_detection:'⚡',
  evidence_evaluation:'📊', general:'📖',
};

const TOPIC_META = {
  claim_detection:    { label:'Claim Detection',    cls:'tag-claim' },
  source_verification:{ label:'Source Verification', cls:'tag-source' },
  bias_detection:     { label:'Bias Detection',      cls:'tag-bias' },
  evidence_evaluation:{ label:'Evidence Evaluation', cls:'tag-evidence' },
  general:            { label:'General MIL',         cls:'tag-general' },
};

// Strip HTML tags for preview generation
function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

// Estimate reading time in minutes
function readTime(content) {
  const words = stripHtml(content).split(/\s+/).length;
  const mins  = Math.max(1, Math.round(words / 200));
  return `${mins} min read`;
}

// ── Fetch lessons from API ─────────────────────────────────────────────────────
async function loadLessons() {
  try {
    const res  = await fetch(`${API_BASE}/lessons`, { credentials: 'include' });
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error('empty');
    LESSONS = data.map(l => ({
      ...l,
      key:     l.lesson_key || l.key || String(l.id),
      icon:    (LESSON_META[l.lesson_key] || {}).icon || TOPIC_ICONS[l.topic] || '📄',
      preview: stripHtml(l.content || '').slice(0, 140) + '…',
      takeaway:(LESSON_META[l.lesson_key] || {}).takeaway || '',
    }));
  } catch(e) {
    // Graceful fallback — show friendly error
    document.getElementById('lessons-grid').innerHTML =
      '<p style="color:var(--muted);font-size:.88rem;">Could not load lessons — make sure the API is running.</p>';
    return;
  }
  updateProgress();
  renderGrid(getFiltered());
}

// ── Render grid ────────────────────────────────────────────────────────────────
function renderGrid(list) {
  const grid  = document.getElementById('lessons-grid');
  const empty = document.getElementById('empty-state');
  if (!list.length) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  grid.innerHTML = list.map(l => {
    const tm     = TOPIC_META[l.topic] || { label: l.topic, cls: 'tag-general' };
    const done   = completedKeys.has(l.key);
    const rt     = readTime(l.content || l.preview || '');
    return `
      <div class="lesson-card ${done?'completed':''}" onclick="openLesson('${l.key}')">
        <div class="lesson-topic-tag ${tm.cls}">${tm.label}</div>
        <span class="lesson-icon">${l.icon}</span>
        <div class="lesson-title">${l.title}</div>
        <div class="lesson-preview">${l.preview}</div>
        <div class="lesson-footer">
          <span class="lesson-diff diff-${l.difficulty}">
            <span class="diff-dot"></span>${l.difficulty.charAt(0).toUpperCase()+l.difficulty.slice(1)}
          </span>
          <span class="read-time">⏱ ${rt}</span>
        </div>
      </div>`;
  }).join('');
}

function getFiltered() {
  const q = (document.getElementById('search').value || '').toLowerCase();
  return LESSONS.filter(l => {
    const matchTopic  = currentFilter === 'all' || l.topic === currentFilter;
    const haystack    = (l.title + ' ' + (l.content || '') + ' ' + l.preview).toLowerCase();
    const matchSearch = !q || haystack.includes(q);
    return matchTopic && matchSearch;
  });
}

// Debounce handle for backend FTS — avoids a round-trip on every keystroke.
let _searchDebounce = null;

async function _backendSearch(q) {
  try {
    const params = new URLSearchParams({ q });
    if (currentFilter !== 'all') params.set('topic', currentFilter);
    const res  = await fetch(`${API_BASE}/lessons?${params}`, { credentials: 'include' });
    const data = await res.json();
    if (!Array.isArray(data)) return;
    // Merge backend results — add any lessons not already in LESSONS
    const existing = new Set(LESSONS.map(l => l.id));
    data.forEach(l => {
      if (!existing.has(l.id)) {
        LESSONS.push({
          ...l,
          key:     l.lesson_key || l.key || String(l.id),
          icon:    (LESSON_META[l.lesson_key] || {}).icon || TOPIC_ICONS[l.topic] || '📄',
          preview: stripHtml(l.content || '').slice(0, 140) + '…',
          takeaway:(LESSON_META[l.lesson_key] || {}).takeaway || '',
        });
      }
    });
    renderGrid(getFiltered());
  } catch(e) {
    // Backend search failed — client-side filter is already shown
  }
}

function filterLessons() {
  renderGrid(getFiltered());  // immediate client-side pass
  const q = (document.getElementById('search').value || '').trim();
  if (!q) return;
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => _backendSearch(q), 350);
}

function setFilter(btn, filter) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = filter;
  filterLessons();
}

// ── Open lesson modal ──────────────────────────────────────────────────────────
async function openLesson(key) {
  const l = LESSONS.find(x => x.key === key);
  if (!l) return;
  const tm  = TOPIC_META[l.topic] || { label: l.topic, cls: 'tag-general' };
  const done = completedKeys.has(key);
  const diffColor = { beginner:'var(--green)', intermediate:'var(--yellow)', advanced:'var(--red)' }[l.difficulty] || 'var(--muted)';
  const rt = readTime(l.content || '');

  document.getElementById('modal-body').innerHTML = `
    <div class="lesson-topic-tag ${tm.cls}" style="margin-bottom:1.2rem;">${tm.label}</div>
    <div style="font-size:2rem;margin-bottom:.6rem;">${l.icon}</div>
    <div class="modal-title">${l.title}</div>
    <div style="display:flex;gap:.9rem;align-items:center;margin-bottom:1.2rem;flex-wrap:wrap;">
      <span class="lesson-diff diff-${l.difficulty}" style="font-family:'DM Mono',monospace;font-size:.68rem;letter-spacing:.06em;color:var(--muted);display:flex;align-items:center;gap:.4rem;">
        <span class="diff-dot" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${diffColor}"></span>
        ${l.difficulty.toUpperCase()}
      </span>
      <span style="font-family:'DM Mono',monospace;font-size:.65rem;color:var(--muted);">⏱ ${rt}</span>
      ${l.mil_skill ? `<span style="font-family:'DM Mono',monospace;font-size:.65rem;color:var(--accent2);">MIL: ${l.mil_skill}</span>` : ''}
    </div>
    <div class="modal-content">${l.content || l.preview || ''}</div>
    ${l.takeaway ? `<div class="takeaway"><div class="takeaway-label">KEY TAKEAWAY</div><div class="takeaway-text">${l.takeaway}</div></div>` : ''}

    <!-- Micro-quiz section -->
    <div class="micro-quiz">
      <div class="micro-quiz-label">⚡ Quick Check — answer to complete this lesson</div>
      <div id="micro-quiz-area"><div class="micro-loading">Loading question…</div></div>
    </div>

    <!-- Mark complete button (shown if no quiz available or after attempting) -->
    <div id="mark-area" style="display:none;">
      <button class="mark-complete-btn ${done?'done':''}" id="mark-btn" onclick="markComplete('${key}')"
        ${done?'disabled':''}>
        ${done ? '✓ Completed' : '✓ Mark as Complete'}
      </button>
    </div>
  `;

  document.getElementById('modal-overlay').classList.add('open');
  loadMicroQuiz(l.topic, key, done);
}

// ── Load micro-quiz for lesson modal ──────────────────────────────────────────
async function loadMicroQuiz(topic, lessonKey, alreadyDone) {
  const area = document.getElementById('micro-quiz-area');
  if (!area) return;
  try {
    const res  = await fetch(`${API_BASE}/quiz?topic=${topic}&limit=1`, { credentials: 'include' });
    const data = await res.json();
    if (!data || !data.length) throw new Error('no q');
    const q       = data[0];
    const options = Array.isArray(q.options) ? q.options : JSON.parse(q.options || '[]');
    const letters = ['A','B','C','D'];

    area.innerHTML = `
      ${q.image_url ? `<img src="${q.image_url}" alt="question image" style="width:100%;max-height:200px;object-fit:cover;border-radius:10px;margin-bottom:.85rem;border:1px solid var(--border);">` : ''}
      <div class="micro-quiz-q">${q.question_text}</div>
      <div class="micro-options" id="micro-options">
        ${options.map((opt,i) => `
          <button class="micro-opt" data-idx="${i}"
            onclick="answerMicro(${i},${q.correct_index},'${(q.explanation||'').replace(/'/g,"\\'")}','${lessonKey}')">
            <span class="micro-opt-letter">${letters[i]||i}</span>
            <span>${opt}</span>
          </button>`).join('')}
      </div>
      <div class="micro-feedback" id="micro-feedback"></div>
    `;
  } catch(e) {
    // No quiz available — just show the manual mark button
    area.innerHTML = '<p style="font-size:.8rem;color:var(--muted);">No check available for this lesson.</p>';
    document.getElementById('mark-area').style.display = 'block';
  }
}

// Skill metadata for micro-quiz chips (mirrors backend _TOPIC_SKILL map)
const _MICRO_SKILL = {
  claim_detection:    { label:'Claim Detection',          desc:'Spotting specific, checkable assertions in everyday language' },
  source_verification:{ label:'Source Verification',      desc:'Tracing where information comes from and whether that origin is trustworthy' },
  bias_detection:     { label:'Bias Detection',           desc:'Recognising emotional framing, loaded language, and selective emphasis' },
  evidence_evaluation:{ label:'Evidence Evaluation',      desc:'Judging whether sources actually prove what a claim asserts' },
  general:            { label:'Media & Information Literacy', desc:'Applying critical thinking across the full fact-checking workflow' },
};

function answerMicro(selected, correct, explanation, lessonKey) {
  const opts = document.querySelectorAll('.micro-opt');
  const fb   = document.getElementById('micro-feedback');
  opts.forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === correct) btn.classList.add('correct');
    else if (idx === selected && selected !== correct) btn.classList.add('wrong');
    else if (idx === correct && selected !== correct) btn.classList.add('reveal');
  });

  const isCorrect = selected === correct;
  fb.className = `micro-feedback show ${isCorrect ? 'correct' : 'wrong'}`;
  fb.innerHTML = `<strong>${isCorrect ? '\u2713 Correct!' : '\u2717 Not quite.'}</strong>${explanation ? `<br><span style="color:var(--text);font-size:.82rem;">${explanation}</span>` : ''}`;

  // Skill chip — read topic from the nearest lesson card's data-topic attribute
  const lessonCard = fb.closest('[data-topic]') || document.querySelector(`[data-key="${lessonKey}"]`);
  const topic = lessonCard ? (lessonCard.dataset.topic || 'general') : 'general';
  const skill = _MICRO_SKILL[topic] || _MICRO_SKILL.general;
  fb.innerHTML += `<div style="margin-top:.5rem"><span class="skill-chip"><span class="skill-chip-icon">&#x1F9E0;</span> Skill practiced: <strong>${skill.label}</strong></span><div class="skill-chip-desc">${skill.desc}</div></div>`;

  // Show mark-complete after answering
  const markArea = document.getElementById('mark-area');
  if (markArea) markArea.style.display = 'block';

  // Auto-mark complete if correct
  if (isCorrect && !completedKeys.has(lessonKey)) {
    setTimeout(() => markComplete(lessonKey, true), 600);
  }
}

// ── Mark lesson complete ───────────────────────────────────────────────────────
function markComplete(key, auto = false) {
  if (completedKeys.has(key)) return;
  completedKeys.add(key);
  localStorage.setItem('sp_read_lessons', JSON.stringify([...completedKeys]));

  // Update button state
  const btn = document.getElementById('mark-btn');
  if (btn) { btn.textContent = '✓ Completed'; btn.classList.add('done'); btn.disabled = true; }

  updateProgress();
  renderGrid(getFiltered());

  // XP popup
  if (!auto) showXpPopup('+10 XP');
  else showXpPopup('✓ +10 XP');

  // Sync to server (best-effort)
  const lessonId = (LESSONS.find(l => l.key === key) || {}).id;
  if (lessonId) {
    fetch(`${API_BASE}/lessons/${lessonId}/read`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {});
  }
}

function showXpPopup(text) {
  const el = document.createElement('div');
  el.className = 'xp-popup';
  el.textContent = text;
  el.style.cssText = `left:50%;top:40%;margin-left:-40px;`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

function updateProgress() {
  const total = LESSONS.length;
  const done  = completedKeys.size;
  document.getElementById('read-count').textContent = `${done} / ${total}`;
  document.getElementById('progress-fill').style.width = total ? `${(done/total)*100}%` : '0%';
}

function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }
function closeModalOutside(e) { if (e.target.id === 'modal-overlay') closeModal(); }

// ── Init ───────────────────────────────────────────────────────────────────────
loadLessons();


// ── Auth state → sidebar ────────────────────────────────────
(function() {
  const username  = localStorage.getItem('sp_username');
  const role      = localStorage.getItem('sp_role');
  const loginLink = document.getElementById('sidebar-login-link');

  if (username && loginLink) {
    loginLink.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg> Log out`;
    loginLink.href = '#';
    loginLink.style.color = 'var(--red)';
    loginLink.onclick = async e => {
      e.preventDefault();
      await fetch('/auth/cookie-logout',{method:'POST',credentials:'include'}).catch(()=>{});
      localStorage.clear(); window.location.href = 'login.html';
    };
  }

})();

// ── Embedded Practice Quiz ─────────────────────────────────────────────────────
const QUIZ_API = '';
const QUIZ_TOPIC_NAMES = {
  claim_detection:'Claim Detection', source_verification:'Source Verification',
  bias_detection:'Bias Detection', evidence_evaluation:'Evidence Evaluation', general:'General'
};
const QUIZ_TOPIC_COLORS = {
  claim_detection:'var(--blue)', source_verification:'var(--accent2)',
  bias_detection:'var(--orange)', evidence_evaluation:'var(--green)', general:'var(--accent)'
};
const qState = { questions:[], currentIndex:0, score:0, topicStats:{}, selectedTopic:'all', answered:{} };

(async function() {
  try {
    const res  = await fetch(`${QUIZ_API}/quiz/settings`, { credentials:'include' });
    const data = await res.json();
    const n = data.questions_per_session || 10;
    document.getElementById('quiz-q-count').textContent = `${n} questions per session`;
  } catch(e) { document.getElementById('quiz-q-count').textContent = '10 questions per session'; }
  // daily badge
  const lastPlayed = localStorage.getItem('sp_quiz_last_date');
  const today = new Date().toISOString().slice(0,10);
  const wrap = document.getElementById('daily-badge-wrap');
  if (wrap && lastPlayed !== today) {
    wrap.innerHTML = `<div style="display:inline-flex;align-items:center;gap:.4rem;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.2);color:var(--yellow);font-family:'DM Mono',monospace;font-size:.68rem;padding:.3rem .8rem;border-radius:20px;margin-bottom:1rem;">⭐ New today — you haven't practised yet</div>`;
  }
})();

function quizSelectTopic(el, topic) {
  document.querySelectorAll('#quiz-topic-grid .topic-card').forEach(c => {
    c.style.borderColor = 'var(--border)'; c.style.background = 'var(--surface)';
  });
  el.style.borderColor = 'var(--accent)'; el.style.background = 'rgba(79,142,247,.08)';
  qState.selectedTopic = topic;
}

async function quizStart() {
  qState.score = 0; qState.currentIndex = 0; qState.topicStats = {}; qState.answered = {};
  const topic = qState.selectedTopic;
  const url = topic === 'all' ? `${QUIZ_API}/quiz?limit=10` : `${QUIZ_API}/quiz?topic=${topic}&limit=10`;
  try {
    const res = await fetch(url, { credentials:'include' });
    qState.questions = await res.json() || [];
  } catch(e) { qState.questions = []; }
  if (!qState.questions.length) {
    alert('Could not load questions — make sure the API is running.');
    return;
  }
  document.getElementById('quiz-screen-start').style.display = 'none';
  document.getElementById('quiz-screen-quiz').style.display = '';
  document.getElementById('quiz-screen-results').style.display = 'none';
  localStorage.setItem('sp_quiz_last_date', new Date().toISOString().slice(0,10));
  quizRender();
}

function quizRender() {
  const q = qState.questions[qState.currentIndex];
  if (!q) { quizShowResults(); return; }
  const total = qState.questions.length;
  const options = Array.isArray(q.options) ? q.options : JSON.parse(q.options || '[]');
  const letters = ['A','B','C','D'];
  const topic = q.topic || 'general';
  document.getElementById('quiz-progress-label').textContent = `Question ${qState.currentIndex+1} of ${total}`;
  document.getElementById('quiz-score-label').innerHTML = `Score: <b>${qState.score}</b>`;
  document.getElementById('quiz-progress-fill').style.width = `${(qState.currentIndex/total)*100}%`;
  document.getElementById('quiz-feedback-box').style.display = 'none';
  document.getElementById('quiz-skip-btn').style.display = '';
  document.getElementById('quiz-next-btn').style.display = 'none';
  document.getElementById('quiz-question-container').innerHTML = `
    <div style="display:inline-flex;align-items:center;gap:.4rem;font-family:'DM Mono',monospace;font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;padding:.3rem .7rem;border-radius:20px;margin-bottom:1rem;background:rgba(79,142,247,.15);color:var(--accent);">${QUIZ_TOPIC_NAMES[topic]||topic}</div>
    ${q.image_url ? `<img src="${q.image_url}" alt="question image" style="width:100%;max-height:220px;object-fit:cover;border-radius:12px;margin-bottom:1rem;border:1px solid var(--border);">` : ''}
    <div style="font-size:1.05rem;font-weight:500;line-height:1.6;margin-bottom:1.5rem;">${q.question_text}</div>
    <div style="display:flex;flex-direction:column;gap:.65rem;">
      ${options.map((opt,i) => `
        <button style="width:100%;text-align:left;padding:.85rem 1.1rem;border-radius:12px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-family:'DM Sans',sans-serif;font-size:.92rem;line-height:1.5;cursor:pointer;transition:all .2s;display:flex;align-items:center;gap:.75rem;" 
          data-idx="${i}" onclick="quizAnswer(${i},${q.correct_index},'${(q.explanation||'').replace(/'/g,"\'")}',${q.id},'${topic}')">
          <span style="width:22px;height:22px;border-radius:50%;border:1.5px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:'DM Mono',monospace;font-size:.7rem;color:var(--muted);">${letters[i]||i}</span>
          <span>${opt}</span>
        </button>`).join('')}
    </div>`;
}

async function quizAnswer(sel, correct, explanation, qid, topic) {
  if (qState.answered[qState.currentIndex]) return;
  qState.answered[qState.currentIndex] = true;
  const isCorrect = sel === correct;
  document.querySelectorAll('#quiz-question-container button[data-idx]').forEach((btn, i) => {
    btn.disabled = true;
    if (i === correct) { btn.style.borderColor='var(--green)'; btn.style.background='rgba(52,211,153,.1)'; btn.style.color='var(--green)'; }
    else if (i === sel && !isCorrect) { btn.style.borderColor='var(--red)'; btn.style.background='rgba(248,113,113,.1)'; btn.style.color='var(--red)'; }
  });
  if (isCorrect) qState.score += 10;
  if (!qState.topicStats[topic]) qState.topicStats[topic] = {correct:0,total:0};
  qState.topicStats[topic].total++;
  if (isCorrect) qState.topicStats[topic].correct++;
  const fb = document.getElementById('quiz-feedback-box');
  fb.style.display = 'block';
  fb.style.background = isCorrect ? 'rgba(52,211,153,.1)' : 'rgba(248,113,113,.1)';
  fb.style.border = isCorrect ? '1px solid rgba(52,211,153,.25)' : '1px solid rgba(248,113,113,.25)';
  fb.innerHTML = `<strong style="color:${isCorrect?'var(--green)':'var(--red)'}">${isCorrect?'✓ Correct!':'✗ Incorrect'}</strong>${explanation?`<br><span style="font-size:.88rem;">${explanation}</span>`:''}${!isCorrect?`<br><a href="lessons.html" style="display:inline-flex;align-items:center;gap:.4rem;margin-top:.5rem;font-family:'DM Mono',monospace;font-size:.72rem;color:var(--accent);text-decoration:none;border:1px solid rgba(79,142,247,.3);border-radius:8px;padding:.3rem .8rem;">📖 Review ${QUIZ_TOPIC_NAMES[topic]||topic} lessons →</a>`:''}`;
  document.getElementById('quiz-score-label').innerHTML = `Score: <b>${qState.score}</b>`;
  document.getElementById('quiz-skip-btn').style.display = 'none';
  document.getElementById('quiz-next-btn').style.display = '';
  // Record attempt + surface skill chip (feature ⑨)
  try {
    const res = await fetch(`${QUIZ_API}/quiz/attempt`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:parseInt(localStorage.getItem('sp_user_id')),question_id:qid,selected_index:sel})});
    if (res.ok) {
      const data = await res.json();
      if (data.skill_label) {
        const chipEl = document.createElement('div');
        chipEl.innerHTML = `<span class="skill-chip"><span class="skill-chip-icon">&#x1F9E0;</span> Skill practiced: <strong>${data.skill_label}</strong></span>${data.skill_description ? `<div class="skill-chip-desc">${data.skill_description}</div>` : ''}`;
        fb.appendChild(chipEl);
      }
    }
  } catch(e){}
}

function quizSkip() {
  if (!qState.answered[qState.currentIndex]) {
    const q = qState.questions[qState.currentIndex];
    if (q && q.topic) { if (!qState.topicStats[q.topic]) qState.topicStats[q.topic]={correct:0,total:0}; qState.topicStats[q.topic].total++; }
  }
  qState.currentIndex++;
  if (qState.currentIndex >= qState.questions.length) quizShowResults();
  else quizRender();
}

function quizNext() {
  qState.currentIndex++;
  if (qState.currentIndex >= qState.questions.length) quizShowResults();
  else { quizRender(); }
}

function quizShowResults() {
  document.getElementById('quiz-screen-quiz').style.display = 'none';
  document.getElementById('quiz-screen-results').style.display = '';
  const total = qState.questions.length;
  const correctCount = Math.round(qState.score / 10);
  const pct = total > 0 ? Math.round((correctCount/total)*100) : 0;
  document.getElementById('quiz-result-num').textContent = `${correctCount}/${total}`;
  const ring = document.getElementById('quiz-result-ring');
  ring.style.background = pct >= 80 ? `conic-gradient(var(--green) ${pct}%, var(--surface) 0%)` : pct >= 50 ? `conic-gradient(var(--yellow) ${pct}%, var(--surface) 0%)` : `conic-gradient(var(--red) ${pct}%, var(--surface) 0%)`;
  const headlines = [[80,'Excellent work! 🎉','Your media literacy skills are strong.'],[60,'Good effort! 📈','Review weak topics to improve.'],[40,'Keep practising! 💪','Focus on topics where you struggled.'],[0,"Let's learn together 📖",'Check the lessons — they build skills step by step.']];
  const [,headline,subline] = headlines.find(([t]) => pct >= t);
  document.getElementById('quiz-result-headline').textContent = headline;
  document.getElementById('quiz-result-subline').textContent = subline;
}

function quizRetry() {
  document.getElementById('quiz-screen-results').style.display = 'none';
  document.getElementById('quiz-screen-start').style.display = '';
}

// ── Prebunking quiz state — declared here so switchLessonsTab can reference them ──
let _pbqQuestions = [];
let _pbqActive    = [];
let _pbqIdx       = 0;
let _pbqScore     = 0;
let _pbqMissed    = [];
let _pbqAnswered  = false;

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchLessonsTab(tab) {
  const isLessons    = tab === 'lessons';
  const lessonsEl    = document.getElementById('tab-lessons');
  const prebunkingEl = document.getElementById('tab-prebunking');
  const navLessons   = document.getElementById('nav-sub-lessons-lessons');
  const navPrebunking = document.getElementById('nav-sub-lessons-prebunking');

  if (lessonsEl)     lessonsEl.style.display    = isLessons ? '' : 'none';
  if (prebunkingEl)  prebunkingEl.style.display  = isLessons ? 'none' : '';
  if (navLessons)    navLessons.classList.toggle('active', isLessons);
  if (navPrebunking) navPrebunking.classList.toggle('active', !isLessons);

  // Scroll to top of page so Prebunking Lab header is visible, not the quiz
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Update hash for bookmarking/back-button
  history.replaceState(null, '', isLessons ? '#' : '#prebunking');

  // Kick off prebunking quiz data load when switching to that tab
  if (tab === 'prebunking' && _pbqQuestions.length === 0) initPbQuiz();
}
// ── Tab switching done above ───────────────────────────────────────────────────

// Hash-based routing on load: #quiz scrolls to quiz within lessons tab,
// #prebunking opens the prebunking tab
(function _handleInitialHash() {
  const hash = window.location.hash;
  if (hash === '#prebunking') {
    switchLessonsTab('prebunking');
  } else if (hash === '#quiz') {
    switchLessonsTab('lessons');
    setTimeout(() => { document.getElementById('quiz')?.scrollIntoView({behavior: 'smooth'}); }, 300);
  }
})();

// ══ PREBUNKING LAB JS ════════════════════════════════════════════════════════



// ── Technique database ────────────────────────────────────────────────────────
const TECHNIQUES = [
  {
    id: 'emotional_override',
    quiz_topic: 'bias_detection',
    name: 'Emotional Override',
    icon: '😱',
    color: '#f87171',
    short: 'Fear & outrage bypass critical thinking',
    explanation: 'This technique deliberately triggers strong emotions — fear, outrage, disgust, or panic — to make you react before you think. When you\'re emotionally aroused, your brain\'s analytical systems take a back seat. Misinformation spreads faster when it makes you angry or afraid.',
    why: 'Strong emotions activate the amygdala and reduce prefrontal cortex activity, which handles critical evaluation. Content engineered to outrage is shared 6× more than neutral content.',
    vaccine_example: '\"DOCTORS ARE KILLING YOUR CHILDREN WITH VACCINES!! Share this before they DELETE it!! Parents are PANICKING as government covers up the TRUTH. Don\'t let them silence us!!\"',
    vaccine_signals: ['ALL CAPS for alarm', '\"Delete it\" conspiracy implication', 'Parents panicking — fear escalation', 'Urgency to share before reading'],
    // Hardcoded fallback exercise (used if DB is empty)
    exercise_example: '\"The cancer cure they\'ve been hiding from you for DECADES. Big Pharma spends $4 BILLION every year suppressing this simple remedy. Doctors are FURIOUS. Share with everyone you love before this gets banned!\"',
    exercise_label: 'What manipulation technique is this post using?',
    correct_id: 'emotional_override',
    explanation_result: 'This uses emotional override combined with urgency. \"Before it gets banned\" triggers fear of missing out. \"Everyone you love\" makes sharing feel like an act of care. The ALL CAPS amplifies urgency to bypass critical thinking.',
  },
  {
    id: 'false_authority',
    quiz_topic: 'source_verification',
    name: 'False Authority',
    icon: '🎓',
    color: '#fb923c',
    short: 'Fake or irrelevant credentials lend false credibility',
    explanation: 'This technique uses the appearance of expertise to make a claim seem credible. The \"expert\" may not exist, may be misrepresented, may have credentials in an unrelated field, or may be a real person whose actual view is the opposite of what\'s being claimed.',
    why: 'We\'re conditioned from childhood to trust authority figures. Credentials create a mental shortcut: \"an expert said it, so it must be true.\" Bad actors exploit this by fabricating or misrepresenting expertise.',
    vaccine_example: '\"Harvard neurologist Dr. Michael Reeves confirms: smartphones cause permanent brain damage in under 30 minutes of use. He was fired from the university for publishing this research.\" [Link goes to a personal blog with no institutional affiliation]',
    vaccine_signals: ['Prestigious institution name-drop', 'Vague but impressive title', '\"Fired for telling the truth\" — martyrdom framing', 'No actual study citation'],
    exercise_example: '\"Former NASA physicist Dr. Elena Kovacs has confirmed the moon landing was staged. She was part of the original mission team and has now released classified documents proving the hoax. The government has been trying to silence her for 50 years.\"',
    exercise_label: 'What manipulation technique is primarily being used?',
    correct_id: 'false_authority',
    explanation_result: '\"Former NASA physicist\" sounds credible until you ask: is this person real? Can you verify the documents? \"Trying to silence her for 50 years\" is the conspiracy layer added to explain why you can\'t verify. Legitimate scientists publish in peer-reviewed journals.',
  },
  {
    id: 'cherry_pick',
    quiz_topic: 'evidence_evaluation',
    name: 'Cherry-Picked Statistics',
    icon: '📊',
    color: '#fbbf24',
    short: 'Real numbers, misleading context',
    explanation: 'This technique uses real statistics — so it can\'t be called \"fake\" — but selects only the data that supports the desired conclusion while hiding contradictory data. The numbers are technically accurate, the conclusion is deliberately misleading.',
    why: 'We tend to trust numbers more than words because they feel objective. Cherry-picking exploits this trust by providing partial truth. The lie isn\'t in the number — it\'s in what\'s left out.',
    vaccine_example: '\"Crime in District 5 DOUBLED under Mayor Santos! In 2022 there were 2 reported robberies. In 2023 there were 4. This is a 100% increase — and she says she\'s tough on crime?\"',
    vaccine_signals: ['100% increase sounds huge — but 2→4 is tiny', 'No comparison to other districts', 'No context: is this better or worse than national average?', 'One year of data, cherry-picked timeframe'],
    exercise_example: '\"New study: coffee drinkers have 40% lower risk of liver disease! Scientists at Stanford analyzed data from 1,200 participants and confirmed coffee\'s protective effect. Time to upgrade your morning routine.\"',
    exercise_label: 'Which technique is most likely being used here?',
    correct_id: 'cherry_pick',
    explanation_result: 'The stat may be real — but what\'s missing matters. Was this one study among dozens? Did the others show different results? One study showing correlation is very different from established medical consensus.',
  },
  {
    id: 'false_dichotomy',
    quiz_topic: 'claim_detection',
    name: 'False Dichotomy',
    icon: '⚖️',
    color: '#a78bfa',
    short: 'Only two choices presented when many exist',
    explanation: 'This technique frames a complex situation as having only two possible options — usually one \"right\" and one obviously bad — when reality has many more. It forces you to pick a side and treats any nuance as betrayal.',
    why: 'Binary thinking is easier for our brains to process. By eliminating middle ground, this technique makes moderation or nuance seem like weakness or complicity. It\'s especially effective at polarizing communities.',
    vaccine_example: '\"You either support unrestricted free speech online, or you support government censorship and a digital dictatorship. There is no middle ground — which side are you on?\"',
    vaccine_signals: ['\"No middle ground\" stated explicitly', 'Two extremes only — ignores content moderation, platform policy, legal frameworks', 'Emotional loaded language (\"dictatorship\")', '\"Which side are you on?\" — demands immediate allegiance'],
    exercise_example: '\"Either we open all borders completely and allow unlimited immigration, OR we build walls and deport everyone who entered illegally. Compromise is just a way of doing nothing. Pick a side.\"',
    exercise_label: 'Identify the primary manipulation technique:',
    correct_id: 'false_dichotomy',
    explanation_result: 'Immigration policy has dozens of possible approaches. \"Compromise is doing nothing\" explicitly attacks the space where real policy lives. This technique shuts down policy discussion by making nuance feel like cowardice.',
  },
  {
    id: 'conspiracy_framing',
    quiz_topic: 'source_verification',
    name: 'Conspiracy Framing',
    icon: '🕵️',
    color: '#60a5fa',
    short: '\"They\" are hiding the truth from you',
    explanation: 'This technique positions information as suppressed truth that powerful forces don\'t want you to know. It\'s designed to make the claim unfalsifiable: if you can\'t find evidence, it\'s because \"they\" hid it; if an expert disagrees, they\'re part of the cover-up.',
    why: 'Conspiracy framing is psychologically powerful because it makes the believer feel special (you know the truth), creates an in-group, and explains away all counter-evidence. The more you try to disprove it, the more \"proof\" it becomes.',
    vaccine_example: '\"What the mainstream media doesn\'t want you to know: 5G towers are linked to a 300% increase in neurological disorders. The WHO, telecom companies, and governments are all in on it. Notice how this never gets covered? That\'s not an accident.\"',
    vaccine_signals: ['\"Doesn\'t want you to know\" — suppression framing', 'Multiple institutions all colluding', '\"That\'s not an accident\" — absence of coverage as proof', 'No source cited — secrecy explains why'],
    exercise_example: '\"Doctors know that this common kitchen ingredient reverses diabetes completely. They\'re not telling patients because it would destroy the $327 billion diabetes drug industry. They need you sick. Your doctor profits from your illness. Do your own research.\"',
    exercise_label: 'Which manipulation technique is driving this post?',
    correct_id: 'conspiracy_framing',
    explanation_result: '\"They need you sick\" is the core conspiracy claim. \"Do your own research\" means \"distrust experts and rely on unvetted online sources.\" The unfalsifiability is built in: if your doctor says it\'s false, that proves they\'re part of the conspiracy.',
  },
  {
    id: 'impersonation',
    quiz_topic: 'source_verification',
    name: 'Source Impersonation',
    icon: '🎭',
    color: '#34d399',
    short: 'Fake sources that look real',
    explanation: 'This technique creates or uses sources that mimic legitimate media organizations, government agencies, or scientific bodies. It could be a Facebook page with a logo similar to a real news outlet, a URL like \"cnn-news24.net\", or a screenshot taken out of context.',
    why: 'We trust known brand names. Impersonation exploits brand recognition — you see \"CNN\" or \"Department of Health\" and your guard drops before you check whether it\'s actually real. Screenshots are especially effective because the original source is hard to verify.',
    vaccine_example: '[A screenshot shows what appears to be a Reuters headline: \"Philippines DOH Confirms Vaccine Causes 50,000 Deaths — Immediate Recall Ordered\" — but the font is slightly different and the URL bar shows reuters-ph-news.blogspot.com]',
    vaccine_signals: ['Well-known brand name (Reuters) for trust', 'URL is NOT reuters.com', 'Sensational claim Reuters would never publish this way', 'Screenshot format makes URL hard to see'],
    exercise_example: '\"According to the ABS-CBN News Facebook page: \'President Signs Emergency Order Banning All Imports Effective This Week\'\' [The post comes from a page called \"ABS-CBN News — Philippines Updates\" with 892 followers, not verified]',
    exercise_label: 'What technique is this content using?',
    correct_id: 'impersonation',
    explanation_result: 'The real ABS-CBN News page has millions of followers and a blue verification checkmark. \"892 followers\" and \"no verification\" are the tells. Always check the exact page name, follower count, and verification status before trusting breaking news.',
  },
];

const PB_OPTIONS_ALL = [
  {id:'emotional_override', label:'Emotional Override'},
  {id:'false_authority', label:'False Authority'},
  {id:'cherry_pick', label:'Cherry-Picked Statistics'},
  {id:'false_dichotomy', label:'False Dichotomy'},
  {id:'conspiracy_framing', label:'Conspiracy Framing'},
  {id:'impersonation', label:'Source Impersonation'},
];

// ── State ─────────────────────────────────────────────────────────────────────
const PB_STORAGE_KEY = 'sp_prebunking_progress';
let pbProgress = JSON.parse(sessionStorage.getItem(PB_STORAGE_KEY) || '{}');
let pbActiveTech = null;
let pbSelectedOption = null;
// DB question counts per technique (loaded once on init)
let pbQuestionCounts = {};

function pbGetProgress(id) { return pbProgress[id] || {phase:'vaccine', correct:null, tried:false}; }
function pbSaveProgress(id, data) {
  pbProgress[id] = data;
  sessionStorage.setItem(PB_STORAGE_KEY, JSON.stringify(pbProgress));
  const tok = sessionStorage.getItem('sp_session') || '';
  const uid = localStorage.getItem('sp_user_id') ? parseInt(localStorage.getItem('sp_user_id')) : null;
  if (tok && data.phase === 'done') {
    fetch(`${API_BASE}/prebunking/attempt`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ session_token: tok, user_id: uid, technique_id: id, correct: data.correct })
    }).catch(()=>{});
  }
}

// ── Render helpers ────────────────────────────────────────────────────────────
function pbRenderProgress() {
  const track = document.getElementById('pb-progress-track');
  if (!track) return;
  const doneCount = TECHNIQUES.filter(t => pbGetProgress(t.id).tried).length;
  track.innerHTML = TECHNIQUES.map(t => {
    const p = pbGetProgress(t.id);
    const cls = p.tried ? (p.correct ? 'done' : 'done') : (pbActiveTech === t.id ? 'active' : '');
    return `<div class="prog-dot ${cls}" title="${t.name}"></div>`;
  }).join('');
  document.getElementById('pb-prog-text').innerHTML =
    `Technique <strong>${doneCount}</strong> of <strong>${TECHNIQUES.length}</strong> attempted`;
  pbUpdateScore();
}

function pbUpdateScore() {
  const tried = TECHNIQUES.filter(t => pbGetProgress(t.id).tried);
  const correct = tried.filter(t => pbGetProgress(t.id).correct).length;
  const pct = tried.length ? Math.round((correct / tried.length) * 100) : 0;
  const offset = 188 - (188 * pct / 100);
  const ring = document.getElementById('pb-ring-fill');
  if (ring) ring.style.strokeDashoffset = offset;
  const valEl = document.getElementById('pb-overall-val');
  const subEl = document.getElementById('pb-overall-sub');
  if (valEl) valEl.textContent = tried.length ? `${pct}%` : '—';
  if (subEl) subEl.textContent = tried.length
    ? `${correct} of ${tried.length} exercises correct`
    : 'Complete exercises to build resistance';
}

function pbStatusBadge(p) {
  if (!p.tried) return '<span style="font-size:.65rem;font-family:\'DM Mono\',monospace;color:var(--muted);">start →</span>';
  if (p.correct) return '<span style="font-size:.65rem;font-family:\'DM Mono\',monospace;color:var(--green);">✓ Correct</span>';
  return '<span style="font-size:.65rem;font-family:\'DM Mono\',monospace;color:var(--red);">✗ Tried</span>';
}

function pbRenderTechList() {
  const area = document.getElementById('pb-module-area');
  if (!area) return;
  const tech = TECHNIQUES.find(t => t.id === pbActiveTech);
  if (!tech) {
    area.innerHTML = `
      <div class="module-card">
        <div class="phase-badge phase-vaccine">Choose a technique</div>
        <div class="module-title">Select a manipulation technique to study</div>
        <div class="module-desc">Each module has two phases: first you learn the technique with a clearly labeled example (the vaccine), then you identify it in an unlabeled real example (the exercise).</div>
        <div class="techniques-grid">
          ${TECHNIQUES.map(t => {
            const p = pbGetProgress(t.id);
            return `<button class="technique-chip ${p.tried?'completed':''}" onclick="pbStartTech('${t.id}')">
              <div class="tech-icon" style="background:${t.color}22">${t.icon}</div>
              <div><div class="tech-name">${t.name}</div><div class="tech-sub">${t.short}</div></div>
              <div class="tech-status">${pbStatusBadge(p)}</div>
            </button>`;
          }).join('')}
        </div>
      </div>`;
    return;
  }
  const p = pbGetProgress(tech.id);
  if (p.phase === 'vaccine' || p.phase === undefined) pbRenderVaccine(tech);
  else if (p.phase === 'exercise') pbRenderExercise(tech);
  else pbRenderResult(tech, p.correct);
}

function pbStartTech(id) {
  pbActiveTech = id;
  pbSelectedOption = null;
  // Reset to vaccine phase if they want to re-study (but keep tried/correct for score)
  const p = pbGetProgress(id);
  if (p.phase === 'done') {
    // Allow re-attempt: reset to exercise phase with a new DB question
    pbProgress[id] = { phase:'exercise', correct: null, tried: true };
    sessionStorage.setItem(PB_STORAGE_KEY, JSON.stringify(pbProgress));
  }
  pbRenderProgress();
  pbRenderTechList();
}

function pbRenderVaccine(tech) {
  const area = document.getElementById('pb-module-area');
  area.innerHTML = `
    <div class="module-card">
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem;">
        <button onclick="pbGoBack()" style="background:transparent;border:1px solid var(--border);border-radius:7px;padding:.3rem .65rem;color:var(--muted);cursor:pointer;font-size:.78rem;">← Back</button>
        <span class="phase-badge phase-vaccine">Phase 1 — Vaccine</span>
      </div>
      <div class="module-title">${tech.icon} ${tech.name}</div>
      <div class="module-desc">${tech.explanation}</div>
      <div class="why-box"><div class="why-label">Why it works</div><div class="why-text">${tech.why}</div></div>
      <div style="margin-top:1.5rem;">
        <div class="vaccine-label">⚠ Labeled example of this technique:</div>
        <div class="example-box">
          <div class="example-text">${tech.vaccine_example}</div>
          <div class="example-annotation">${tech.vaccine_signals.map(s=>`<span class="annotation-tag">${s}</span>`).join('')}</div>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="pbAdvanceToExercise('${tech.id}')">I understand this technique →</button>
      </div>
    </div>`;
}

function pbAdvanceToExercise(id) {
  const p = pbGetProgress(id);
  pbProgress[id] = { phase:'exercise', correct: null, tried: p.tried || false };
  sessionStorage.setItem(PB_STORAGE_KEY, JSON.stringify(pbProgress));
  pbSelectedOption = null;
  pbRenderTechList();
}

// ── Exercise: fetch a real quiz question for this technique's topic ────────────
async function pbRenderExercise(tech) {
  const area = document.getElementById('pb-module-area');
  area.innerHTML = `
    <div class="module-card">
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem;">
        <button onclick="pbGoBack()" style="background:transparent;border:1px solid var(--border);border-radius:7px;padding:.3rem .65rem;color:var(--muted);cursor:pointer;font-size:.78rem;">← Back</button>
        <span class="phase-badge phase-exercise">Phase 2 — Quiz</span>
      </div>
      <div class="module-title">Test your knowledge</div>
      <div style="padding:1.5rem 0;text-align:center;font-family:'DM Mono',monospace;font-size:.75rem;color:var(--muted);">Loading question…</div>
    </div>`;

  const topic = tech.quiz_topic || 'source_verification';
  let q = null;
  try {
    const res = await fetch(`${API_BASE}/quiz?topic=${topic}&limit=5`, { credentials: 'include' });
    if (res.ok) {
      const questions = await res.json();
      if (questions && questions.length) {
        // Pick a random one from the batch for variety
        q = questions[Math.floor(Math.random() * questions.length)];
      }
    }
  } catch(e) {}

  if (!q) {
    // Use the technique's built-in hardcoded exercise as fallback
    if (tech.exercise_example) {
      const fallbackOptions = TECHNIQUES.map(t => t.name);
      // Build A/B/C/D options: correct answer = this tech, others = 3 random techs
      const others = TECHNIQUES.filter(t => t.id !== tech.id).sort(() => Math.random() - .5).slice(0, 3);
      const allOpts = [{ id: tech.id, name: tech.name, correct: true }, ...others.map(t => ({ id: t.id, name: t.name, correct: false }))].sort(() => Math.random() - .5);
      const correctIdx = allOpts.findIndex(o => o.correct);
      pbRenderExerciseUI(tech, tech.exercise_label || 'What manipulation technique is this post using?', allOpts.map(o => o.name), correctIdx, `This is an example of <strong>${tech.name}</strong>. ${tech.short}`, null, tech.exercise_example);
      return;
    }
    area.innerHTML = `
      <div class="module-card">
        <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem;">
          <button onclick="pbGoBack()" style="background:transparent;border:1px solid var(--border);border-radius:7px;padding:.3rem .65rem;color:var(--muted);cursor:pointer;font-size:.78rem;">← Back</button>
          <span class="phase-badge phase-exercise">Phase 2 — Quiz</span>
        </div>
        <div class="module-title">No questions available yet</div>
        <div class="module-desc" style="color:var(--muted);">No quiz questions have been added for this topic. Ask your admin to add some in the dashboard.</div>
        <div class="btn-row">
          <button class="btn btn-primary" onclick="pbSaveProgress('${tech.id}', {phase:'done',correct:false,tried:true}); pbRenderProgress(); pbGoBack();">Mark as attempted</button>
        </div>
      </div>`;
    return;
  }

  const options = Array.isArray(q.options) ? q.options : JSON.parse(q.options || '[]');
  pbRenderExerciseUI(tech, q.question_text, options, q.correct_index, q.explanation || '', q.image_url || null, null);
}

function pbRenderExerciseUI(tech, questionText, options, correctIdx, explanation, imageUrl, scenarioText) {
  const area = document.getElementById('pb-module-area');
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  area.innerHTML = `
    <div class="module-card">
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem;">
        <button onclick="pbGoBack()" style="background:transparent;border:1px solid var(--border);border-radius:7px;padding:.3rem .65rem;color:var(--muted);cursor:pointer;font-size:.78rem;">← Back</button>
        <span class="phase-badge phase-exercise">Phase 2 — Quiz</span>
      </div>
      <div class="module-title">Test your knowledge</div>
      ${imageUrl ? `<img src="${imageUrl}" alt="scenario image" style="width:100%;max-height:220px;object-fit:cover;border-radius:12px;margin-bottom:1rem;border:1px solid var(--border);">` : ''}
      ${scenarioText ? `<div class="example-box" style="margin-bottom:1rem;"><div class="example-text">${scenarioText}</div></div>` : ''}
      <div class="module-desc" style="margin-bottom:1rem;">${questionText}</div>
      <div class="options-grid" id="pb-options-grid">
        ${options.map((opt, i) => `
          <button class="option-btn" id="pb-opt-${i}" onclick="pbSelectOptionIdx(${i})">
            <div class="option-letter">${letters[i]}</div>
            <div class="option-name">${opt}</div>
          </button>`).join('')}
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" id="pb-submit-btn"
          onclick="pbSubmitAnswerIdx('${tech.id}', ${correctIdx}, ${JSON.stringify(explanation)})"
          disabled style="opacity:.4;cursor:not-allowed;">Submit Answer</button>
      </div>
    </div>`;
  window._pbSelectedIdx = null;
}

function pbSelectOptionIdx(idx) {
  window._pbSelectedIdx = idx;
  document.querySelectorAll('.option-btn').forEach((b, i) => {
    b.classList.toggle('selected', i === idx);
  });
  const btn = document.getElementById('pb-submit-btn');
  if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
}

function pbSubmitAnswerIdx(techId, correctIdx, explanation) {
  const selected = window._pbSelectedIdx;
  if (selected === null || selected === undefined) return;
  const tech = TECHNIQUES.find(t => t.id === techId);
  const correct = selected === correctIdx;
  pbSaveProgress(techId, { phase: 'done', correct, tried: true });
  pbRenderProgress();
  pbRenderResultWithRetry(tech, correct, explanation);
}

// ── Result phase with "Try another scenario" ──────────────────────────────────
function pbRenderResultWithRetry(tech, correct, explanation) {
  const area = document.getElementById('pb-module-area');
  const nextId = pbGetNextTech(tech.id);
  const hasMore = (pbQuestionCounts[tech.id] || 0) > 1;
  area.innerHTML = `
    <div class="module-card">
      <span class="phase-badge ${correct ? 'phase-result-correct' : 'phase-result-wrong'}">${correct ? '✓ Correct' : '✗ Incorrect'}</span>
      <div class="result-score">
        <div class="result-icon">${correct ? '🎯' : '🤔'}</div>
        <div class="result-msg">${correct ? 'You spotted it!' : 'Not quite'}</div>
        <div class="result-sub">${correct ? 'Your resistance is building.' : 'Understanding the technique is the first step to resisting it.'}</div>
      </div>
      <div class="explanation-block">
        <div class="why-label" style="color:var(--accent2);margin-bottom:.5rem;">What was actually happening</div>
        <div class="explanation-text">${explanation || tech.explanation_result || ''}</div>
      </div>
      <div class="btn-row">
        ${nextId ? `<button class="btn btn-primary" onclick="pbStartTech('${nextId}')">Next technique →</button>` : '<button class="btn btn-success" style="background:rgba(52,211,153,.15);color:var(--green);border:1px solid rgba(52,211,153,.3);padding:.65rem 1.2rem;border-radius:10px;font-family:\'Syne\',sans-serif;font-weight:600;font-size:.85rem;">🎉 All techniques done!</button>'}
        <button class="btn" style="background:transparent;border:1px solid var(--border);color:var(--muted);padding:.65rem 1.2rem;border-radius:10px;cursor:pointer;font-family:'Syne',sans-serif;font-weight:600;font-size:.85rem;" onclick="pbGoBack()">← Choose another</button>
        <button class="btn" style="background:rgba(79,142,247,.1);border:1px solid rgba(79,142,247,.25);color:var(--accent);padding:.65rem 1.2rem;border-radius:10px;cursor:pointer;font-family:'Syne',sans-serif;font-weight:600;font-size:.85rem;" onclick="pbTryAnother('${tech.id}')">🔄 Try another scenario</button>
      </div>
    </div>`;
}

// Reset to exercise phase so a new random question is fetched
function pbTryAnother(techId) {
  const p = pbGetProgress(techId);
  pbProgress[techId] = { phase: 'exercise', correct: null, tried: p.tried || true };
  sessionStorage.setItem(PB_STORAGE_KEY, JSON.stringify(pbProgress));
  pbSelectedOption = null;
  window._pbSelectedIdx = null;
  pbRenderTechList();
}

// Legacy result renderer (used for re-study flow from pbStartTech)
function pbRenderResult(tech, correct) {
  pbRenderResultWithRetry(tech, correct, tech.explanation_result);
}

function pbGetNextTech(currentId) {
  const idx = TECHNIQUES.findIndex(t => t.id === currentId);
  const remaining = TECHNIQUES.slice(idx+1).filter(t => !pbGetProgress(t.id).tried);
  return remaining[0]?.id || TECHNIQUES.find(t => !pbGetProgress(t.id).tried && t.id !== currentId)?.id || null;
}

function pbGoBack() {
  pbActiveTech = null;
  pbRenderProgress();
  pbRenderTechList();
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function initPrebunking() {
  try {
    let tok = sessionStorage.getItem('sp_session');
    if (!tok) {
      try { const r = await fetch('/auth/session'); const d = await r.json(); tok = d.session_token; }
      catch { tok = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,'0')).join(''); }
      sessionStorage.setItem('sp_session', tok);
    }
    const uid = localStorage.getItem('sp_user_id') ? `&user_id=${localStorage.getItem('sp_user_id')}` : '';
    // Load server progress
    const r = await fetch(`${API_BASE}/prebunking/modules?session_token=${tok}${uid}`);
    if (r.ok) {
      const data = await r.json();
      (data.completions || []).forEach(c => {
        pbProgress[c.technique_id] = {phase:'done', correct: c.correct, tried: true};
      });
      sessionStorage.setItem(PB_STORAGE_KEY, JSON.stringify(pbProgress));
    }
    // Load question counts for "Try another" availability
    const cr = await fetch(`${API_BASE}/prebunking/questions/count`);
    if (cr.ok) {
      const cd = await cr.json();
      pbQuestionCounts = cd.by_technique || {};
    }
  } catch { /* offline — use local progress */ }
  pbRenderProgress();
  pbRenderTechList();
}
// ══ END PREBUNKING JS ══════════════════════════════════════════════════════════

initPrebunking();

// ══ PREBUNKING QUIZ JS ════════════════════════════════════════════════════════
// Separate quiz that tests technique recognition — distinct from the MIL quiz.

const PBQ_COUNT = 10; // questions per round

// Fallback questions used when API returns nothing
const FALLBACK_PBQ_QUESTIONS = [
  { id:'fb1', question_text:'A viral post says: "SCIENTISTS FINALLY ADMIT: Vaccines cause autism!! Government trying to DELETE this study — share before it\'s gone!!" What manipulation technique is this?', option_a:'Emotional Override — uses fear and outrage to bypass critical thinking', option_b:'False Equivalence — treats two unequal claims as equal', option_c:'Cherry Picking — selects only data that supports the claim', option_d:'Impersonation — pretends to be a credible authority', correct_answer:'A', explanation:'The ALL CAPS, urgency to share, and "they\'re hiding it from you" framing are classic Emotional Override signals designed to make you react before you think.' },
  { id:'fb2', question_text:'An article claims: "Studies show coffee cures cancer — therefore drinking 10 cups a day is completely safe." What technique is being used?', option_a:'Emotional Override', option_b:'False Equivalence — stretching a limited finding to an unsupported conclusion', option_c:'Scarcity / Fear of Missing Out', option_d:'Slippery Slope — exaggerating a chain of consequences', correct_answer:'B', explanation:'Correlation in one study does not mean unlimited consumption is safe. This stretches a limited finding far beyond what the evidence supports.' },
  { id:'fb3', question_text:'A meme shows a politician alongside a quote they never said, presented as if it were real. This is an example of:', option_a:'Cherry Picking', option_b:'Astroturfing — creating fake grassroots support', option_c:'Impersonation / Fabricated Quotes — putting false words in a real person\'s mouth', option_d:'Emotional Override', correct_answer:'C', explanation:'Fabricated quotes attributed to real figures are a common disinformation tactic because they borrow credibility from a known person.' },
  { id:'fb4', question_text:'"Everyone is switching to this new diet — don\'t be the last person to find out!" This message primarily uses:', option_a:'Bandwagon / Social Proof — pressuring you to follow the crowd', option_b:'Cherry Picking', option_c:'False Equivalence', option_d:'Scapegoating', correct_answer:'A', explanation:'Claiming "everyone" does something exploits our instinct to conform socially, overriding individual evaluation of evidence.' },
  { id:'fb5', question_text:'A news site only publishes the statistics that support its preferred conclusion and ignores contradictory data. This technique is called:', option_a:'Emotional Override', option_b:'Impersonation', option_c:'Cherry Picking — selectively using data to mislead', option_d:'False Equivalence', correct_answer:'C', explanation:'Cherry picking makes a distorted picture seem credible by using real (but selectively chosen) data, omitting anything that challenges the conclusion.' },
  { id:'fb6', question_text:'"If we allow same-sex marriage, next people will want to marry animals." This argument is an example of:', option_a:'Slippery Slope — assuming one event inevitably leads to extreme outcomes', option_b:'Emotional Override', option_c:'Cherry Picking', option_d:'Bandwagon', correct_answer:'A', explanation:'Slippery slope fallacies predict a chain of extreme consequences from a single policy change, without evidence that those steps would actually follow.' },
  { id:'fb7', question_text:'A website that looks almost identical to a real news outlet publishes a false story. What technique is this?', option_a:'Cherry Picking', option_b:'Impersonation — mimicking legitimate sources to borrow credibility', option_c:'Emotional Override', option_d:'Scarcity appeal', correct_answer:'B', explanation:'Fake sites that clone the look of real outlets exploit the trust readers already have in the original, making the false content seem verified.' },
  { id:'fb8', question_text:'"This limited-time offer expires in 10 minutes — act now or miss out forever!" This persuasion technique relies on:', option_a:'Scarcity / Urgency — manufacturing time pressure to prevent careful thinking', option_b:'False Equivalence', option_c:'Slippery Slope', option_d:'Cherry Picking', correct_answer:'A', explanation:'Artificial urgency short-circuits deliberation. When you feel you\'ll miss out, you\'re less likely to pause and fact-check.' },
  { id:'fb9', question_text:'A politician blames all of a country\'s economic problems on a single minority group. This is an example of:', option_a:'Emotional Override', option_b:'Scapegoating — redirecting blame onto a convenient out-group', option_c:'Cherry Picking', option_d:'Bandwagon', correct_answer:'B', explanation:'Scapegoating simplifies complex problems by assigning blame to a single group, often stirring up prejudice and diverting attention from real causes.' },
  { id:'fb10', question_text:'A post says: "Mainstream media and Big Tech are conspiring to hide the truth about [topic]." Without specific evidence, this framing is an example of:', option_a:'Bandwagon', option_b:'False Equivalence', option_c:'Conspiracy Framing — using vague accusations of hidden agendas to dismiss evidence', option_d:'Cherry Picking', correct_answer:'C', explanation:'Conspiracy framing inoculates the claim against fact-checking: any debunking can be reframed as part of the cover-up, making the claim unfalsifiable.' },
];

async function initPbQuiz() {
  try {
    const r = await fetch(`${API_BASE}/prebunking/questions`);
    if (!r.ok) throw new Error();
    const data = await r.json();
    _pbqQuestions = Array.isArray(data) ? data : (data.questions || []);
  } catch {
    _pbqQuestions = [];
  }
  // If API returned nothing, use our hardcoded fallback questions
  if (_pbqQuestions.length === 0) {
    _pbqQuestions = FALLBACK_PBQ_QUESTIONS;
  }
  const startBtn = document.getElementById('pbq-start-btn');
  const noQEl    = document.getElementById('pbq-no-questions');
  // Only disable if still truly empty (shouldn't happen now)
  if (_pbqQuestions.length === 0) {
    if (startBtn)  startBtn.disabled = true;
    if (noQEl)     noQEl.style.display = 'block';
  } else {
    if (startBtn)  startBtn.disabled = false;
    if (noQEl)     noQEl.style.display = 'none';
  }
}

function _pbqShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startPbQuiz() {
  if (_pbqQuestions.length === 0) { initPbQuiz().then(startPbQuiz); return; }
  _pbqActive   = _pbqShuffle(_pbqQuestions).slice(0, PBQ_COUNT);
  _pbqIdx      = 0;
  _pbqScore    = 0;
  _pbqMissed   = [];
  _pbqAnswered = false;

  document.getElementById('pbq-start').style.display   = 'none';
  document.getElementById('pbq-results').style.display = 'none';
  document.getElementById('pbq-running').style.display = '';
  _pbqRender();
}

function _pbqRender() {
  const q       = _pbqActive[_pbqIdx];
  const total   = _pbqActive.length;
  _pbqAnswered  = false;

  document.getElementById('pbq-counter').textContent    = `Question ${_pbqIdx + 1} / ${total}`;
  document.getElementById('pbq-score-live').textContent = `Score: ${_pbqScore}`;
  document.getElementById('pbq-prog-bar').style.width   = `${(_pbqIdx / total) * 100}%`;
  document.getElementById('pbq-question').textContent   = q.question_text;
  document.getElementById('pbq-feedback').style.display = 'none';
  document.getElementById('pbq-next-btn').style.display = 'none';

  // Media
  const mediaEl = document.getElementById('pbq-media');
  mediaEl.style.display = 'none';
  mediaEl.innerHTML = '';
  const mt = q.media_type || (q.image_url ? 'image' : q.video_url ? 'video' : 'text');
  if (mt === 'image' && q.image_url) {
    mediaEl.style.display = '';
    mediaEl.innerHTML = `<img src="${q.image_url}" alt="scenario" style="max-width:100%;max-height:220px;border-radius:10px;border:1px solid var(--border);object-fit:cover;">`;
  } else if (mt === 'video' && q.video_url) {
    mediaEl.style.display = '';
    // YouTube embed or direct video
    const isYT = /youtu\.?be/.test(q.video_url);
    if (isYT) {
      const vid = q.video_url.match(/(?:v=|youtu\.be\/)([^&?]+)/)?.[1] || '';
      mediaEl.innerHTML = `<iframe width="100%" height="200" src="https://www.youtube.com/embed/${vid}" frameborder="0" allowfullscreen style="border-radius:10px;"></iframe>`;
    } else {
      mediaEl.innerHTML = `<video src="${q.video_url}" controls style="max-width:100%;max-height:220px;border-radius:10px;border:1px solid var(--border);"></video>`;
    }
  } else if (mt === 'file' && q.image_url) {
    mediaEl.style.display = '';
    mediaEl.innerHTML = `<a href="${q.image_url}" target="_blank" style="color:var(--accent);font-size:.85rem;">📎 View attached file</a>`;
  }

  // Options — A/B/C/D
  const opts = [
    { letter: 'A', text: q.option_a },
    { letter: 'B', text: q.option_b },
    { letter: 'C', text: q.option_c },
    { letter: 'D', text: q.option_d },
  ];
  const optsEl = document.getElementById('pbq-options');
  optsEl.innerHTML = '';
  opts.forEach(({ letter, text }) => {
    const btn = document.createElement('button');
    btn.className = 'pbq-opt';
    btn.textContent = `${letter}. ${text}`;
    btn.dataset.letter = letter;
    btn.onclick = () => _pbqAnswer(letter);
    optsEl.appendChild(btn);
  });
}

function _pbqAnswer(chosen) {
  if (_pbqAnswered) return;
  _pbqAnswered = true;
  const q       = _pbqActive[_pbqIdx];
  const correct = (q.correct_answer || '').toUpperCase();
  const isRight = chosen === correct;

  if (isRight) _pbqScore++;
  else         _pbqMissed.push({ q, chosen });

  // Colour the buttons
  document.querySelectorAll('.pbq-opt').forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.letter === correct)  btn.classList.add('correct');
    if (btn.dataset.letter === chosen && !isRight) btn.classList.add('wrong');
  });

  // Feedback
  const fbEl = document.getElementById('pbq-feedback');
  fbEl.style.display = '';
  fbEl.className = `quiz-feedback ${isRight ? 'correct' : 'wrong'}`;
  fbEl.innerHTML = isRight
    ? `✅ <strong>Correct!</strong>${q.explanation ? ' ' + q.explanation : ''}`
    : `❌ <strong>Incorrect.</strong> The answer is <strong>${correct}</strong>.${q.explanation ? ' ' + q.explanation : ''}`;

  document.getElementById('pbq-next-btn').style.display = '';
  // Auto-submit attempt
  _pbqSubmitAttempt(q, chosen, isRight);
}

async function _pbqSubmitAttempt(q, chosen, correct) {
  try {
    const tok = sessionStorage.getItem('sp_session') || '';
    const uid = localStorage.getItem('sp_user_id') ? `&user_id=${localStorage.getItem('sp_user_id')}` : '';
    await fetch(`${API_BASE}/prebunking/attempt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question_id:  q.id,
        technique_id: q.technique_id,
        chosen_answer: chosen,
        correct,
        session_token: tok,
      }),
    });
  } catch { /* non-blocking */ }
}

function pbqNext() {
  _pbqIdx++;
  if (_pbqIdx >= _pbqActive.length) {
    _pbqShowResults();
  } else {
    _pbqRender();
  }
}

function _pbqShowResults() {
  document.getElementById('pbq-running').style.display  = 'none';
  document.getElementById('pbq-results').style.display  = '';

  const total   = _pbqActive.length;
  const pct     = Math.round((_pbqScore / total) * 100);
  const emoji   = pct >= 80 ? '🛡️' : pct >= 50 ? '🧪' : '🎯';
  const msg     = pct >= 80 ? 'Excellent — you\'re well-inoculated against these techniques!'
                : pct >= 50 ? 'Good effort! Review the techniques you missed and try again.'
                :             'Keep practicing — spotting these techniques takes time!';

  document.getElementById('pbq-result-emoji').textContent  = emoji;
  document.getElementById('pbq-result-title').textContent  = 'Quiz Complete!';
  document.getElementById('pbq-result-score').textContent  = `${_pbqScore} / ${total}`;
  document.getElementById('pbq-result-msg').textContent    = msg;

  // Missed list
  const missedEl = document.getElementById('pbq-missed-list');
  missedEl.innerHTML = '';
  if (_pbqMissed.length > 0) {
    const heading = document.createElement('p');
    heading.style.cssText = 'font-weight:600;font-size:.85rem;margin-bottom:.6rem;';
    heading.textContent = 'Review — questions you missed:';
    missedEl.appendChild(heading);
    _pbqMissed.forEach(({ q, chosen }) => {
      const div = document.createElement('div');
      div.className = 'pbq-missed-item';
      const opts = { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d };
      div.innerHTML =
        `<div style="margin-bottom:.35rem;font-size:.85rem;">${q.question_text}</div>` +
        `<div style="color:#ef4444;font-size:.8rem;">You chose: <strong>${chosen}. ${opts[chosen] || ''}</strong></div>` +
        `<div style="color:#22c55e;font-size:.8rem;">Correct: <strong>${q.correct_answer}. ${opts[q.correct_answer] || ''}</strong></div>` +
        (q.explanation ? `<div style="color:var(--muted);font-size:.78rem;margin-top:.3rem;">${q.explanation}</div>` : '');
      missedEl.appendChild(div);
    });
  }
}

initPbQuiz(); // pre-load questions on page open
// ══ END PREBUNKING QUIZ JS ════════════════════════════════════════════════════
