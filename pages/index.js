// ─────────────────────────────────────────────────────────────────────────────
// View toggle (Step-by-Step vs Mind Map)
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
const API_BASE = '';

async function initSessionToken() {
  let t = sessionStorage.getItem('sp_session');
  if (!t) {
    try {
      const res = await fetch(`${API_BASE}/auth/session`);
      const data = await res.json();
      t = data.session_token;
    } catch {
      t = Array.from(crypto.getRandomValues(new Uint8Array(32)))
            .map(b => b.toString(16).padStart(2,'0')).join('');
    }
    sessionStorage.setItem('sp_session', t);
  }
  return t;
}
function getSessionToken() {
  return sessionStorage.getItem('sp_session') || '';
}

const _SP_USER_ID  = localStorage.getItem('sp_user_id')  ? parseInt(localStorage.getItem('sp_user_id')) : null;
const _SP_USERNAME = localStorage.getItem('sp_username') || null;
const USER_ID      = _SP_USER_ID;

function _authHeaders() {
  return { 'Content-Type': 'application/json' };
}

// initSessionToken() is now called (and awaited) inside _boot()

const state = {
  currentStep:    0,
  totalSteps:     8,
  skippedSteps:   [],
  answeredSteps:  [],
  userScore:      50,
  confidence:     'medium',
  userClaim:      '',
  sourceRating:   null,
  biasRating:     null,
  evidenceRating: null,
  purposeRating:  null,
  audienceRating: null,
  logicRating:    null,
  corroboration:  null,
  content:        '',
  inputType:      'text',
  imageData:      null,
  imageFile:      null,
  fileData:       null,
  fileName:       null,
  evaluationId:      null,
  userEvaluationId:  null,
  systemResult:      null,
  comparisonResult:  null,
};

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Eval Questions — Dynamic Loading & Persistence
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_EVAL_QUESTIONS = [
  {
    id: 'q_claim', step: 0, type: 'textarea',
    question: '📌 What is the <strong>main claim</strong> being made in this content?',
    inputName: 'user-claim',
    placeholder: 'In your own words, what factual claim does this post make?',
    hint: '💡 A claim is a statement presented as fact — something that can be verified. Opinions and feelings are not claims.',
    showClaimRecs: true
  },
  {
    id: 'q_source', step: 1, type: 'radio', inputName: 'source',
    question: '🔍 How would you rate the <strong>credibility of the source</strong>?',
    choices: [
      { value: 'yes',            label: '✅ The source seems credible (known outlet, verified account)' },
      { value: 'no',             label: '❌ The source seems unreliable or unknown' },
      { value: 'unsure',         label: '🤔 I\'m not sure' },
      { value: 'none_mentioned', label: '🚫 No source is mentioned' }
    ],
    hint: '💡 Check the domain (.gov, .edu tend to be more reliable). Look for an "About" page or search the source name + "bias" or "reliability".'
  },
  {
    id: 'q_bias', step: 2, type: 'radio', inputName: 'bias',
    question: '⚠️ Does the content use <strong>emotionally charged or biased language</strong>?',
    choices: [
      { value: '1',      label: 'Yes — I notice exaggerations, ALL CAPS, emotional words, or clickbait patterns' },
      { value: '0',      label: 'No — The language seems neutral and factual' },
      { value: '2',      label: 'Somewhat — There are minor emotional cues but mostly balanced' },
      { value: 'unsure', label: '🤔 I\'m not sure' }
    ],
    hint: '💡 Watch for: "SHOCKING", "You won\'t believe", excessive "!!!", absolute words like "always/never/everyone", or appeals to fear/anger.'
  },
  {
    id: 'q_evidence', step: 3, type: 'radio', inputName: 'evidence',
    question: '📊 Does the content provide <strong>verifiable evidence</strong> for its claims?',
    choices: [
      { value: '1',      label: 'Yes — It cites studies, official reports, or named sources' },
      { value: '0',      label: 'No — It makes claims with no supporting references' },
      { value: '2',      label: 'Partially — Some claims are supported but others are not' },
      { value: 'unsure', label: '🤔 I\'m not sure' }
    ],
    hint: '💡 Vague references like "experts say" or "studies show" without links are not verifiable evidence. Good evidence is specific and traceable.'
  },
  {
    id: 'q_purpose', step: 4, type: 'radio', inputName: 'purpose',
    question: '🎯 What is the <strong>purpose or intent</strong> of this content?',
    choices: [
      { value: 'inform',    label: '📰 To inform — presents facts or events objectively' },
      { value: 'persuade',  label: '🗣 To persuade — pushes a specific viewpoint or agenda' },
      { value: 'entertain', label: '🎭 To entertain — humor, satire, or engagement-driven' },
      { value: 'mislead',   label: '⚠️ To mislead — appears to inform but distorts the truth' },
      { value: 'unsure',    label: '🤔 I\'m not sure' }
    ],
    hint: '💡 Knowing the <em>why</em> behind content helps you evaluate it more critically. Persuasive content isn\'t necessarily wrong, but it should be read differently than reporting.'
  },
  {
    id: 'q_audience', step: 5, type: 'radio', inputName: 'audience',
    question: '👥 Who is the <strong>target audience</strong> of this content?',
    choices: [
      { value: 'general',      label: '🌐 General public — broad, non-specific audience' },
      { value: 'partisan',     label: '🏴 A specific group — based on identity, beliefs, or interests' },
      { value: 'professional', label: '🎓 Experts or professionals in a specific field' },
      { value: 'unsure',       label: '🤔 Hard to tell' },
      { value: 'none',         label: '🚫 None of the above' }
    ],
    hint: '💡 Misinformation is often crafted for specific audiences — appealing to their beliefs, fears, or identity. Ask yourself: why would <em>this</em> audience be targeted?'
  },
  {
    id: 'q_logic', step: 6, type: 'radio', inputName: 'logic',
    question: '🧠 Does the content use <strong>sound logic and reasoning</strong>?',
    choices: [
      { value: 'sound',   label: '✅ Yes — the argument follows logically from the evidence presented' },
      { value: 'flawed',  label: '❌ No — conclusions are exaggerated or don\'t follow from the facts' },
      { value: 'fallacy', label: '⚠️ It uses a logical fallacy — e.g. false equivalence, slippery slope, straw man' },
      { value: 'unsure',  label: '🤔 I\'m not sure' }
    ],
    hint: '💡 Common fallacies: <strong>False equivalence</strong> (treating unequal things as equal), <strong>ad hominem</strong> (attacking the person not the argument), <strong>slippery slope</strong> (assuming one event leads to extreme outcomes without evidence).'
  },
  {
    id: 'q_corroboration', step: 7, type: 'radio', inputName: 'corroboration',
    question: '🔄 <strong>Corroboration</strong> — Do other independent sources say the same thing?',
    infoBox: '<div style="font-size:.82rem;font-weight:600;color:var(--accent);margin-bottom:.5rem;">👉 This is where a lot of misinformation hides.</div><div style="font-size:.82rem;color:var(--muted);line-height:1.6;">Ask yourself: Is this story only on one site? Are opposing views being ignored? What\'s <em>missing</em> from this account? Legitimate news is usually reported by multiple independent outlets.</div>',
    choices: [
      { value: 'confirmed',    label: '✅ Confirmed — multiple independent sources report the same thing' },
      { value: 'partial',      label: '🔶 Partially — some sources confirm parts of it, but details differ' },
      { value: 'only_one',     label: '❌ Only one source — I can\'t find it reported elsewhere' },
      { value: 'contradicted', label: '🚫 Contradicted — other sources say the opposite' },
      { value: 'unsure',       label: '🤔 I haven\'t checked other sources' }
    ],
    hint: '💡 <strong>Completeness check:</strong> Are opposing views ignored? Is context stripped away? A true account should hold up when you read it alongside other reporting.',
    isFinal: true
  }
];

let _evalQuestions = null;

async function loadEvalQuestions() {
  const cached = localStorage.getItem('sp_eval_questions');
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        _evalQuestions = parsed;
        renderEvalSteps();
        return;
      }
    } catch(e) {}
  }
  try {
    const res = await fetch('/admin/eval-questions/public');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        _evalQuestions = data;
        localStorage.setItem('sp_eval_questions', JSON.stringify(data));
        renderEvalSteps();
        return;
      }
    }
  } catch(e) {}
  _evalQuestions = DEFAULT_EVAL_QUESTIONS;
  renderEvalSteps();
}

// ── Safe DOM helpers ──────────────────────────────────────────────────────────
function _el(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

// Allows only <strong>, <em>, <br> — strips everything else
function _safeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  let safe = div.innerHTML.replace(/&lt;(\/?(strong|em|br))&gt;/gi, '<$1>');
  div.innerHTML = safe;
  return div;
}

function renderEvalSteps() {
  const qs = _evalQuestions || DEFAULT_EVAL_QUESTIONS;
  const container = document.getElementById('eval-steps-container');
  if (!container) return;

  state.totalSteps = qs.length;

  // Rebuild tracker
  const tracker = document.getElementById('eval-steps-tracker');
  if (tracker) {
    tracker.innerHTML = '';
    qs.forEach((q, i) => {
      const rawName = q.stepName || (q.inputName || '').replace(/_/g, ' ') || `Step ${i+1}`;
      const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
      const div = _el('div', { className: `step${i === 0 ? ' active' : ''}`, id: `s${i}` },
        _el('span', { className: 'step-num' }, String(i + 1).padStart(2, '0')),
        _el('span', { className: 'step-name' }, name)
      );
      div.addEventListener('click', () => jumpToStep(i));
      tracker.appendChild(div);
    });
  }

  container.innerHTML = '';
  qs.forEach((q, i) => {
    const isFirst = i === 0;
    const isLast  = i === qs.length - 1;
    const card = _el('div', { className: `card eval-step${isFirst ? ' active' : ''}`, id: `eval-${i}` });

    const qDiv = _el('div', { className: 'question' });
    qDiv.innerHTML = q.question || '';
    card.appendChild(qDiv);

    if (q.type === 'textarea') {
      const ta = _el('textarea', { id: 'user-claim', style: 'min-height:80px;' });
      ta.placeholder = q.placeholder || '';
      card.appendChild(ta);

      const hint = _el('div', { className: 'hint', id: 'hint-claim' });
      hint.innerHTML = q.hint || '';
      card.appendChild(hint);

      if (q.showClaimRecs) {
        const recBanner = _el('div', {
          id: 'claim-recommendations',
          style: 'display:none;margin-top:.85rem;padding:.85rem 1rem;background:rgba(79,142,247,.08);border:1px solid rgba(79,142,247,.2);border-radius:10px;font-size:.84rem;'
        });
        recBanner.innerHTML = `
          <div style="font-weight:600;color:var(--accent);margin-bottom:.45rem;">📚 We recommend reviewing these before you continue:</div>
          <div id="claim-rec-list" style="display:flex;flex-direction:column;gap:.4rem;color:var(--text);line-height:1.5;"></div>
          <div id="claim-rec-loading" style="color:var(--muted);font-size:.8rem;display:flex;align-items:center;gap:.4rem;"><span class="loader-dot"></span> Finding related content…</div>`;
        card.appendChild(recBanner);
      }

    } else if (q.type === 'radio') {
      if (q.infoBox) {
        const ib = _el('div', { style: 'background:rgba(79,142,247,.07);border:1px solid rgba(79,142,247,.2);border-radius:10px;padding:1rem 1.1rem;margin-bottom:1rem;' });
        ib.innerHTML = q.infoBox;
        card.appendChild(ib);
      }
      const safeName = (q.inputName || '').replace(/[^\w-]/g, '');
      const optWrap = _el('div', { className: 'options', id: `${safeName}-options` });
      (q.choices || []).forEach(c => {
        const lbl = document.createElement('label');
        lbl.className = 'option-label';
        const radio = _el('input', {
          type: 'radio',
          name: safeName,
          value: String(c.value).replace(/"/g, '').slice(0, 80)
        });
        lbl.appendChild(radio);
        lbl.appendChild(document.createTextNode(' '));
        const labelSpan = document.createElement('span');
        labelSpan.innerHTML = c.label || '';
        lbl.appendChild(labelSpan);
        optWrap.appendChild(lbl);
      });
      card.appendChild(optWrap);
      if (q.hint) {
        const hintDiv = _el('div', { className: 'hint' });
        hintDiv.innerHTML = q.hint;
        card.appendChild(hintDiv);
      }
    }

    // Nav buttons — all static text, no API data
    const nav = _el('div', { className: 'step-nav' });
    if (isFirst) {
      const cancel = _el('button', { className: 'btn btn-ghost' }, '✕ Cancel');
      cancel.addEventListener('click', cancelEvaluation);
      const next = _el('button', { className: 'btn btn-primary' }, 'Next →');
      next.addEventListener('click', () => nextStep(i));
      nav.appendChild(cancel);
      nav.appendChild(next);
    } else if (isLast) {
      const left   = _el('div', { style: 'display:flex;gap:.5rem;' });
      const cancel = _el('button', { className: 'btn btn-ghost' }, '✕ Cancel');
      cancel.addEventListener('click', cancelEvaluation);
      const back   = _el('button', { className: 'btn btn-ghost' }, '← Back');
      back.addEventListener('click', () => prevStep(i));
      left.appendChild(cancel); left.appendChild(back);
      const submit = _el('button', { className: 'btn btn-primary' }, 'Submit & See Analysis →');
      submit.addEventListener('click', finalizeAndSubmit);
      nav.appendChild(left); nav.appendChild(submit);
    } else {
      const left   = _el('div', { style: 'display:flex;gap:.5rem;' });
      const cancel = _el('button', { className: 'btn btn-ghost' }, '✕ Cancel');
      cancel.addEventListener('click', cancelEvaluation);
      const back   = _el('button', { className: 'btn btn-ghost' }, '← Back');
      back.addEventListener('click', () => prevStep(i));
      left.appendChild(cancel); left.appendChild(back);
      const next   = _el('button', { className: 'btn btn-primary' }, 'Next →');
      next.addEventListener('click', () => nextStep(i));
      nav.appendChild(left); nav.appendChild(next);
    }
    card.appendChild(nav);
    container.appendChild(card);
  });

  // Re-wire claim textarea listener
  const claimTA = document.getElementById('user-claim');
  if (claimTA) {
    claimTA.addEventListener('input', () => {
      clearTimeout(_claimRecTimeout);
      const val = claimTA.value.trim();
      if (val.length < 15) {
        const rec = document.getElementById('claim-recommendations');
        if (rec) rec.style.display = 'none';
        return;
      }
      _claimRecTimeout = setTimeout(() => _fetchClaimRecommendations(val), 900);
    });
  }
}

// ── Cross-page state persistence (in-eval progress) ───────────────────────────
const _PERSIST_KEY = 'sp_index_state';

function _serializeState() {
  const answers = {};
  (_evalQuestions || DEFAULT_EVAL_QUESTIONS).forEach(q => {
    if (q.type === 'radio') {
      const checked = document.querySelector(`input[name="${q.inputName}"]:checked`);
      if (checked) answers[q.inputName] = checked.value;
    } else if (q.type === 'textarea') {
      const el = document.getElementById('user-claim');
      if (el) answers['user-claim'] = el.value;
    }
  });
  const inputEl = document.getElementById('content-input');
  return {
    phase: _currentPhase(),
    content: inputEl ? inputEl.value : state.content,
    inputType: state.inputType,
    currentStep: state.currentStep,
    answeredSteps: state.answeredSteps,
    skippedSteps: state.skippedSteps,
    answers,
    imageData: state.imageData,
    imageFile: state.imageFile,
    fileData: state.fileData,
    fileName: state.fileName,
    evaluationId: state.evaluationId,
  };
}

function _currentPhase() {
  for (const p of ['phase-input','phase-eval','phase-loading','phase-results']) {
    const el = document.getElementById(p);
    if (el && el.style.display !== 'none' && el.style.display !== '') return p;
  }
  return 'phase-input';
}

function saveStateToPersist() {
  try { localStorage.setItem(_PERSIST_KEY, JSON.stringify(_serializeState())); } catch(e) {}
}

function restoreStateFromPersist() {
  try {
    const raw = localStorage.getItem(_PERSIST_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved) return false;

    const inputEl = document.getElementById('content-input');
    if (inputEl && saved.content) inputEl.value = saved.content;
    if (saved.inputType && saved.inputType !== 'text') {
      const tabBtn = document.querySelector(`.tab-btn[onclick*="${saved.inputType}"]`);
      if (tabBtn) setTab(tabBtn, saved.inputType);
    }
    if (saved.imageData) { state.imageData = saved.imageData; state.imageFile = saved.imageFile; }
    if (saved.fileData)  { state.fileData  = saved.fileData;  state.fileName  = saved.fileName; }

    state.currentStep   = saved.currentStep   || 0;
    state.answeredSteps = saved.answeredSteps  || [];
    state.skippedSteps  = saved.skippedSteps   || [];
    state.evaluationId  = saved.evaluationId   || null;
    state.content       = saved.content        || '';

    setTimeout(() => {
      if (saved.answers) {
        Object.entries(saved.answers).forEach(([name, val]) => {
          if (name === 'user-claim') {
            const el = document.getElementById('user-claim');
            if (el) el.value = val;
          } else {
            const radio = document.querySelector(`input[name="${name}"][value="${val}"]`);
            if (radio) radio.checked = true;
          }
        });
      }
      const phase = saved.phase || 'phase-input';
      // Don't restore loading phase — drop back to input
      if (phase !== 'phase-loading' && phase !== 'phase-results') {
        show(phase);
        if (phase === 'phase-eval') { restoreStepUI(state.currentStep); updateProgress(); }
      }
    }, 50);
    return true;
  } catch(e) { return false; }
}

window.addEventListener('beforeunload', saveStateToPersist);
window.addEventListener('pagehide', saveStateToPersist);

// ─────────────────────────────────────────────────────────────────────────────
// Tab switcher
// ─────────────────────────────────────────────────────────────────────────────
function setTab(btn, type) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.inputType = type;

  const ta        = document.getElementById('content-input');
  const imgArea   = document.getElementById('image-upload-area');
  const fileArea  = document.getElementById('file-upload-area');
  const charWrap  = document.getElementById('char-count');

  ta.style.display       = 'none';
  imgArea.style.display  = 'none';
  fileArea.style.display = 'none';

  if (type === 'image') {
    imgArea.style.display = 'block';
    charWrap.textContent  = state.imageData ? '✔ Image ready' : 'No image selected';
  } else if (type === 'file') {
    fileArea.style.display = 'block';
    charWrap.textContent   = state.fileData ? '✔ File ready' : 'No file selected';
  } else {
    ta.style.display = '';
    const placeholders = {
      text: AGE_COPY[currentMode]?.placeholder || AGE_COPY.adult.placeholder,
      url:  'Paste a URL to a news article or social media post…',
    };
    ta.placeholder = placeholders[type];
    charWrap.textContent = ta.value.length + ' characters';
  }
}

function handleImageUpload(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { showToast('Image is too large — please use an image under 10 MB.'); input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = function (e) {
    const dataUrl   = e.target.result;
    const base64    = dataUrl.split(',')[1];
    state.imageData = base64;
    state.imageFile = file.name;
    document.getElementById('image-preview').src      = dataUrl;
    document.getElementById('image-filename').textContent = file.name;
    document.getElementById('image-preview-wrap').style.display = 'block';
    document.getElementById('char-count').textContent = '✔ Image ready';
    document.getElementById('image-drop-label').style.display   = 'none';
  };
  reader.readAsDataURL(file);
}

function clearImageUpload() {
  state.imageData = null; state.imageFile = null;
  document.getElementById('image-file-input').value           = '';
  document.getElementById('image-preview').src                = '';
  document.getElementById('image-preview-wrap').style.display = 'none';
  document.getElementById('image-drop-label').style.display  = 'flex';
  document.getElementById('char-count').textContent           = 'No image selected';
}

function handleFileUpload(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { showToast('File is too large — max 10 MB.'); input.value = ''; return; }
  const allowed = ['.pdf','.docx','.pptx','.html','.htm','.txt','.json'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!allowed.includes(ext)) { showToast('Unsupported file type. Allowed: PDF, DOCX, PPTX, HTML, TXT, JSON.'); input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = e => {
    // Strip the data:...;base64, prefix — API expects raw base64
    state.fileData = e.target.result.split(',')[1];
    state.fileName = file.name;
    const kb = (file.size / 1024).toFixed(0);
    document.getElementById('file-filename').textContent       = file.name;
    document.getElementById('file-filesize').textContent       = kb + ' KB';
    document.getElementById('file-preview-wrap').style.display = 'block';
    document.getElementById('file-drop-label').style.display   = 'none';
    document.getElementById('char-count').textContent          = '✔ File ready';
  };
  reader.readAsDataURL(file);
}

function clearFileUpload() {
  state.fileData = null; state.fileName = null;
  document.getElementById('file-file-input').value            = '';
  document.getElementById('file-preview-wrap').style.display  = 'none';
  document.getElementById('file-drop-label').style.display    = 'flex';
  document.getElementById('char-count').textContent           = 'No file selected';
}

document.getElementById('content-input').addEventListener('input', function () {
  document.getElementById('char-count').textContent = this.value.length + ' characters';
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase transitions
// ─────────────────────────────────────────────────────────────────────────────
function show(id) {
  ['phase-input','phase-eval','phase-loading','phase-no-claims','phase-results'].forEach(p => {
    document.getElementById(p).style.display = (p === id) ? 'block' : 'none';
  });
}

function startEvaluation() {
  if (state.inputType === 'image') {
    if (!state.imageData) { showToast('Please upload an image first.'); return; }
    state.content = '[image]';
  } else if (state.inputType === 'file') {
    if (!state.fileData) { showToast('Please upload a file first.'); return; }
    state.content = '[file]';
  } else {
    const content = document.getElementById('content-input').value.trim();
    if (content.length < 10) { showToast('Please enter at least 10 characters of content.'); return; }
    if (state.inputType === 'url') {
      const looks_like_url = /^https?:\/\/.{5}/.test(content) || /^[\w-]+\.\w{2,}/.test(content);
      if (!looks_like_url) { showToast('That doesn\'t look like a URL — please paste the full link (e.g. https://example.com/article).'); return; }
    }
    state.content = content;
    // Silently start gathering background evidence as user goes through steps
    _gatherBackgroundEvidence(content, state.inputType);
  }

  // Clear all previous step answers so nothing bleeds in from a prior session
  state.currentStep   = 0;
  state.skippedSteps  = [];
  state.answeredSteps = [];
  state.userClaim     = '';
  state.sourceRating  = null;
  state.biasRating    = null;
  state.evidenceRating = null;
  state.purposeRating  = null;
  state.audienceRating = null;
  state.logicRating    = null;
  state.corroboration  = null;
  // Clear all radio inputs and textarea in the eval form
  document.querySelectorAll('#eval-steps-container input[type="radio"]').forEach(r => r.checked = false);
  const claimTA = document.getElementById('user-claim');
  if (claimTA) claimTA.value = '';
  // Clear saved progress so restore on next load doesn't re-populate
  sessionStorage.removeItem('sp_eval_progress');

  show('phase-eval');
  goToStep(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step navigation
// ─────────────────────────────────────────────────────────────────────────────
function hasAnswer(step) {
  const qs = _evalQuestions || DEFAULT_EVAL_QUESTIONS;
  const q = qs[step];
  if (!q) return false;
  if (q.type === 'textarea') {
    const el = document.getElementById('user-claim');
    return el ? el.value.trim().length > 0 : false;
  }
  return !!document.querySelector(`input[name="${q.inputName}"]:checked`);
}
function nextStep(from) {
  if (!hasAnswer(from)) {
    // No answer — treat as skip
    skipStep(from);
    return;
  }
  saveStepAnswer(from);
  goToStep(from + 1);
}
function prevStep(from) {
  saveStepAnswer(from);
  const dest = from - 1;
  // Clear skipped status for steps >= dest that aren't answered
  // (they were only orange from a forward jump, not from explicit skip)
  state.skippedSteps = state.skippedSteps.filter(s => s < dest || state.answeredSteps.includes(s));
  goToStep(dest);
}
function skipStep(step) {
  if (!state.skippedSteps.includes(step)) state.skippedSteps.push(step);
  // remove from answered if previously answered
  state.answeredSteps = state.answeredSteps.filter(s => s !== step);
  goToStep(step + 1);
}
function saveStepAnswer(from) {
  const qs = _evalQuestions || DEFAULT_EVAL_QUESTIONS;
  const q = qs[from];
  if (!q) return;
  if (q.type === 'textarea') {
    state.userClaim = (document.getElementById('user-claim') || {}).value || '';
  } else if (q.type === 'radio') {
    const r = document.querySelector(`input[name="${q.inputName}"]:checked`);
    const val = r ? r.value : null;
    const fieldMap = { source:'sourceRating', bias:'biasRating', evidence:'evidenceRating',
      purpose:'purposeRating', audience:'audienceRating', logic:'logicRating', corroboration:'corroboration' };
    if (fieldMap[q.inputName]) state[fieldMap[q.inputName]] = val;
    else state['_extra_' + q.inputName] = val;
  }
  const answered = hasAnswer(from);
  if (answered) {
    if (!state.answeredSteps.includes(from)) state.answeredSteps.push(from);
    state.skippedSteps = state.skippedSteps.filter(s => s !== from);
  }
}
function restoreStepUI(step) {
  const qs = _evalQuestions || DEFAULT_EVAL_QUESTIONS;
  const q = qs[step];
  if (!q) return;
  if (q.type === 'textarea') {
    const el = document.getElementById('user-claim');
    if (el && state.userClaim) el.value = state.userClaim;
  } else if (q.type === 'radio') {
    const fieldMap = { source:'sourceRating', bias:'biasRating', evidence:'evidenceRating',
      purpose:'purposeRating', audience:'audienceRating', logic:'logicRating', corroboration:'corroboration' };
    const val = state[fieldMap[q.inputName]] ?? state['_extra_' + q.inputName];
    if (val) { const r = document.querySelector(`input[name="${q.inputName}"][value="${val}"]`); if (r) r.checked = true; }
  }
}
function jumpToStep(step) {
  // Save current step answer before jumping
  saveStepAnswer(state.currentStep);
  const current = state.currentStep;

  if (step > current) {
    // Jumping forward — mark all steps between current and destination as skipped
    // (unless they were already answered)
    for (let i = current; i < step; i++) {
      if (!state.answeredSteps.includes(i)) {
        if (!state.skippedSteps.includes(i)) state.skippedSteps.push(i);
      }
    }
  } else if (step < current) {
    // Jumping backward — steps from destination onward that are neither answered
    // nor explicitly skipped should be cleared (they were only orange because we
    // jumped past them, not because the user chose to skip)
    // Keep answered steps green. Keep explicitly skipped steps orange only if
    // they were skipped before the jump destination.
    // Simple rule: remove skipped status for steps >= destination that aren't answered
    state.skippedSteps = state.skippedSteps.filter(s => s < step || state.answeredSteps.includes(s));
  }

  goToStep(step);
}
function goToStep(step) {
  document.querySelectorAll('.eval-step').forEach((el, i) => {
    el.classList.toggle('active', i === step);
  });
  document.querySelectorAll('.step').forEach((el, i) => {
    el.classList.remove('active', 'done', 'skipped');
    if (i === step) {
      el.classList.add('active');
    } else if (state.answeredSteps.includes(i)) {
      el.classList.add('done');
    } else if (state.skippedSteps.includes(i)) {
      el.classList.add('skipped');
    }
  });
  state.currentStep = step;
  restoreStepUI(step);
  updateProgress();
}
function cancelEvaluation() {
  sessionStorage.removeItem('sp_eval_progress');
  localStorage.removeItem('sp_last_result');
  localStorage.removeItem(_PERSIST_KEY);
  // Reset annotation section
  const annSec = document.getElementById('section-annotation');
  if (annSec) annSec.style.display = 'none';
  ['claim','opinion','context'].forEach(t => {
    _annState[t] = true;
    const tog = document.getElementById('tog-' + t);
    if (tog) tog.classList.remove('dimmed');
    const at = document.getElementById('annotated-text');
    if (at) at.classList.remove('hide-' + t + 's');
  });
  const claimSummary = document.getElementById('ann-claim-summary');
  if (claimSummary) claimSummary.style.display = 'none';
  // Reset post-analysis phases
  ['phase-r1-summary','phase-r2-evidence','phase-r3-explore','phase-r4-reflect',
   'phase-r5-position','phase-r6-reasoning','phase-r7-final'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  _evidenceSummaryReady = null; _explorationReady = null; _backgroundEvidenceCache = null;
  reflectionState.position = null; reflectionState.reasoning = ''; reflectionState.saved = false;
  // Reset evidence sections
  state._submissionEvidenceRendered = false;
  const subList = document.getElementById('evidence-submission-list');
  if (subList) subList.innerHTML = '';
  const claimWrap = document.getElementById('evidence-claim-wrap');
  if (claimWrap) { claimWrap.style.display = 'none'; }
  const claimList = document.getElementById('evidence-claim-list');
  if (claimList) claimList.innerHTML = '';
  // Reset result sections
  const sectionUI = document.getElementById('section-user-input');
  if (sectionUI) sectionUI.style.display = 'block';
  document.getElementById('phase-r7-final').style.display = 'none';
  document.getElementById('ur-content').style.display = 'none';
  document.getElementById('ur-loading').style.display = 'flex';
  document.getElementById('ur-steps-recap').innerHTML = '';
  document.getElementById('ur-lesson-suggestions').innerHTML = '';
  document.getElementById('cr-explore-content').style.display = 'none';
  document.getElementById('cr-explore-loading').style.display = 'flex';
  document.getElementById('claim-recommendations').style.display = 'none';
  document.getElementById('claim-rec-list').innerHTML = '';
  document.getElementById('r6-reasoning-input').value = '';
  document.querySelectorAll('input[name="user_position"]').forEach(r => r.checked = false);
  // Reset eval state
  state.currentStep = 0;
  state.skippedSteps = [];
  state.answeredSteps = [];
  state.userClaim = '';
  state.sourceRating = null; state.biasRating = null; state.evidenceRating = null;
  state.purposeRating = null; state.audienceRating = null; state.logicRating = null;
  state.corroboration = null;
  // Clear UI
  document.querySelectorAll('.eval-step').forEach((el, i) => el.classList.toggle('active', i === 0));
  document.querySelectorAll('.step').forEach((el, i) => { el.classList.remove('active','done','skipped'); if(i===0) el.classList.add('active'); });
  document.querySelectorAll('input[type=radio]').forEach(r => r.checked = false);
  const uc = document.getElementById('user-claim'); if (uc) uc.value = '';
  document.getElementById('eval-progress').style.width = '0%';
  show('phase-input');
}
function updateProgress() {
  const pct = (state.currentStep / state.totalSteps) * 100;
  document.getElementById('eval-progress').style.width = pct + '%';
}
function selectConf(btn, val) {
  document.querySelectorAll('.conf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.confidence = val;
}
function updateSliderColor(val) {
  const el = document.getElementById('user-score-display');
  el.style.background = val >= 60
    ? 'linear-gradient(135deg,#34d399,#059669)'
    : val >= 40
    ? 'linear-gradient(135deg,#fbbf24,#f59e0b)'
    : 'linear-gradient(135deg,#f87171,#ef4444)';
  el.style['-webkit-background-clip'] = 'text';
  el.style['-webkit-text-fill-color'] = 'transparent';
}

// Save corroboration then submit (replaces old rating step)
function finalizeAndSubmit() {
  saveStepAnswer(7);
  submitEvaluation();
}

// ─────────────────────────────────────────────────────────────────────────────
// submitEvaluation
// ─────────────────────────────────────────────────────────────────────────────
async function submitEvaluation() {
  // Rating step removed — use defaults (score=50, confidence=medium)
  state.userScore = 50;
  if (!state.confidence) state.confidence = 'medium';

  show('phase-loading');
  animateLoader();

  let analysisResult;
  try {
    const res = await fetch(`${API_BASE}/analyze`, {
      method:  'POST',
      credentials: 'include',
      headers: _authHeaders(),
      body:    JSON.stringify({
        text:          state.inputType === 'text' ? state.content : null,
        url:           state.inputType === 'url'  ? state.content : null,
        image_data:    state.inputType === 'image' ? state.imageData : null,
        file_data:     state.inputType === 'file'  ? state.fileData : null,
        file_name:     state.inputType === 'file'  ? state.fileName : null,
        input_type:    state.inputType,
        session_token: getSessionToken(),
        user_id:       USER_ID,
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `API error ${res.status}`);
    }
    analysisResult = await res.json();
    state.evaluationId = analysisResult.submission_id ?? analysisResult.evaluation_id;
    state.systemResult  = analysisResult;
  } catch (err) {
    show('phase-eval');
    showToast(`Analysis failed: ${err.message}`);
    return;
  }

  if (analysisResult.no_claims_detected) { _showNoClaimsPhase(); return; }

  let comparisonResult = null;
  try {
    const skippedNames = state.skippedSteps.map(s => ['claims','source','bias','evidence','purpose','audience','logic','corroboration'][s]).filter(Boolean);
    const res2 = await fetch(`${API_BASE}/user-evaluation`, {
      method:  'POST',
      credentials: 'include',
      headers: _authHeaders(),
      body:    JSON.stringify({
        evaluation_id:     state.evaluationId,
        user_id:           USER_ID,
        session_token:     getSessionToken(),
        identified_claims: state.userClaim ? [state.userClaim] : [],
        source_credible:   state.sourceRating,
        bias_detected:     state.biasRating === '1',
        evidence_assessed: state.evidenceRating === '1' || state.evidenceRating === '2',
        user_score:        state.userScore,
        user_label:        state.userScore >= 60 ? 'Likely Credible' : state.userScore >= 40 ? 'Uncertain' : 'Likely Misleading',
        confidence_level:  state.confidence,
        skipped_steps:     skippedNames,
        // v3 new step fields — stored in analysis_json for behavior_tracker
        purpose_rating:    state.purposeRating    || null,
        audience_rating:   state.audienceRating   || null,
        logic_rating:      state.logicRating      || null,
        corroboration:     state.corroboration    || null,
      })
    });
    if (res2.ok) {
      const data2 = await res2.json();
      comparisonResult = data2.comparison;
      state.userEvaluationId = data2.user_evaluation_id;
      state.comparisonResult = comparisonResult;
    }
  } catch (err) {
    console.warn('User evaluation save failed:', err);
  }

  renderResults(analysisResult, comparisonResult);
}

// ─────────────────────────────────────────────────────────────────────────────
// No-Claims flow
// ─────────────────────────────────────────────────────────────────────────────
function _showNoClaimsPhase() {
  // Start gathering background evidence silently regardless of claim detection
  _gatherBackgroundEvidence(state.content, state.inputType);

  // If the user already typed a claim at Step 1, auto-run the pipeline with it
  if (state.userClaim && state.userClaim.trim().length >= 5) {
    show('phase-loading');
    document.getElementById('loading-text').textContent = 'Using your identified claim…';
    _runUserClaimPipeline(state.userClaim.trim());
    return;
  }

  // If the input was plain text or a URL (not image/file), use the content itself as the claim
  if ((state.inputType === 'text' || state.inputType === 'url') && state.content && state.content.trim().length >= 5) {
    show('phase-loading');
    document.getElementById('loading-text').textContent = 'Re-analyzing your content…';
    _runUserClaimPipeline(state.content.trim().slice(0, 500));
    return;
  }

  // Fallback: show the manual claim input screen (for image/file inputs with no Step 1 claim)
  // Show UNESCO-aligned "no clear claim" message but still retrieve related sources
  document.getElementById('no-claims-input-card').style.display  = 'block';
  document.getElementById('no-claims-validating').style.display  = 'none';
  document.getElementById('no-claims-warning').style.display     = 'none';
  document.getElementById('no-claims-claim-input').value         = '';
  // Inject the soft notice above the card
  const existingNotice = document.getElementById('no-claims-soft-notice');
  if (!existingNotice) {
    const noticeEl = document.createElement('div');
    noticeEl.id = 'no-claims-soft-notice';
    noticeEl.style.cssText = 'padding:.85rem 1.1rem;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.25);border-radius:10px;font-size:.88rem;color:var(--yellow);margin-bottom:1rem;line-height:1.6;';
    noticeEl.innerHTML = '<strong>No clear claim was identified.</strong> The system will still retrieve related sources based on the provided text.';
    const inputCard = document.getElementById('no-claims-input-card');
    inputCard.parentNode.insertBefore(noticeEl, inputCard);
  }
  show('phase-no-claims');
}

async function submitNoClaimsInput() {
  const claimText = document.getElementById('no-claims-claim-input').value.trim();
  if (claimText.length < 5) { showToast('Please type what you think the claim is (at least 5 characters).'); return; }
  document.getElementById('no-claims-input-card').style.display = 'none';
  document.getElementById('no-claims-warning').style.display    = 'none';
  document.getElementById('no-claims-validating').style.display = 'block';

  let validationResult;
  try {
    const res = await fetch(`${API_BASE}/analyze/validate-claim`, {
      method:  'POST',
      credentials: 'include',
      headers: _authHeaders(),
      body:    JSON.stringify({ claim_text: claimText, submission_id: state.evaluationId }),
    });
    if (res.status === 503) { await _runUserClaimPipeline(claimText); return; }
    if (!res.ok) throw new Error(`Validation error ${res.status}`);
    validationResult = await res.json();
  } catch (err) {
    await _runUserClaimPipeline(claimText); return;
  }
  document.getElementById('no-claims-validating').style.display = 'none';
  if (validationResult.is_claim) {
    await _runUserClaimPipeline(claimText);
  } else {
    state._pendingUserClaim = claimText;
    document.getElementById('no-claims-warning-reason').textContent =
      validationResult.reason || 'The input doesn\'t appear to be a specific, verifiable factual statement.';
    document.getElementById('no-claims-warning').style.display = 'block';
  }
}

function retryClaimInput() {
  document.getElementById('no-claims-warning').style.display    = 'none';
  document.getElementById('no-claims-input-card').style.display = 'block';
}

async function forceSubmitUserClaim() {
  const claimText = state._pendingUserClaim;
  if (!claimText) return;
  document.getElementById('no-claims-warning').style.display    = 'none';
  document.getElementById('no-claims-validating').style.display = 'block';
  await _runUserClaimPipeline(claimText);
}

async function _runUserClaimPipeline(claimText) {
  try {
    const res = await fetch(`${API_BASE}/analyze/user-claim`, {
      method:  'POST',
      credentials: 'include',
      headers: _authHeaders(),
      body:    JSON.stringify({ submission_id: state.evaluationId, claim_text: claimText, session_token: getSessionToken(), user_id: USER_ID }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || `Pipeline error ${res.status}`); }
    const result = await res.json();
    const normalised = { ...state.systemResult, ...result, no_claims_detected: false };

    // Render claim evidence in its own section WITHOUT overwriting submission evidence
    if (result.evidence && result.evidence.length > 0) {
      const wrapEl = document.getElementById('evidence-claim-wrap');
      if (wrapEl) wrapEl.style.display = 'block';
      _renderEvidenceInto('evidence-claim-list', result.evidence);
    }

    // Prevent renderResults from re-rendering submission evidence
    state._submissionEvidenceRendered = true;
    renderResults(normalised, state.comparisonResult);
  } catch (err) {
    show('phase-no-claims');
    document.getElementById('no-claims-validating').style.display = 'none';
    document.getElementById('no-claims-input-card').style.display = 'block';
    showToast(`Pipeline error: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Loader animation
// ─────────────────────────────────────────────────────────────────────────────
function animateLoader() {
  const messages = [
    'Detecting claims…','Analyzing source credibility…',
    'Scanning for bias patterns…','Retrieving evidence…',
    'Running NLI contradiction check…','Scoring credibility…','Generating explanation…',
  ];
  let i = 0;
  const el = document.getElementById('loading-text');
  const iv = setInterval(() => {
    el.style.opacity = 0;
    setTimeout(() => { el.textContent = messages[i++ % messages.length]; el.style.opacity = 1; }, 200);
  }, 600);
  setTimeout(() => clearInterval(iv), 30000);
  state._loaderInterval = iv;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render results
// ─────────────────────────────────────────────────────────────────────────────
function renderResults(r, comparison) {
  if (state._loaderInterval) clearInterval(state._loaderInterval);
  show('phase-results');

  const isInconclusive = r.is_inconclusive === true;
  const lb = document.getElementById('sys-label');
  lb.textContent = r.label;
  lb.className = 'label-badge ' + (isInconclusive ? 'badge-yellow' :
    r.label === 'Credible' ? 'badge-green' : r.label === 'Misleading' ? 'badge-red' : 'badge-yellow');

  document.getElementById('sys-explanation').textContent = r.explanation;

  const covPct = ((r.evidence_coverage ?? 0) * 100).toFixed(0);
  document.getElementById('eq-coverage').textContent = covPct + '%';
  document.getElementById('eq-coverage').style.color =
    covPct >= 60 ? 'var(--green)' : covPct >= 30 ? 'var(--yellow)' : 'var(--red)';
  document.getElementById('eq-mode').textContent =
    r.live_search_used ? '🌐 Live Search (FAISS had no results)' : '📚 FAISS Corpus';

  const partialEl = document.getElementById('eq-partial');
  partialEl.textContent = r.is_partial ? 'Yes — verdict based on partial evidence' : 'No';
  partialEl.style.color = r.is_partial ? 'var(--yellow)' : 'var(--green)';

  const warnEl = document.getElementById('eq-warning');
  if (warnEl) warnEl.style.display = 'none';

  document.getElementById('explanation-source').textContent =
    r.explanation_source === 'ollama' ? '✦ Explanation generated by local AI (Ollama)' : '✦ Rule-based explanation';

  const stepsCompleted = state.totalSteps - state.skippedSteps.length;
  document.getElementById('comp-user').textContent = `${stepsCompleted} / ${state.totalSteps}`;
  const skippedAreaNames = state.skippedSteps.map(s => ['Claim','Source','Bias','Evidence','Purpose','Audience','Logic','Corroboration'][s]).filter(Boolean);
  const compUserConf = document.getElementById('comp-user-conf');
  if (stepsCompleted === 0) {
    compUserConf.textContent = `You completed 0 of 8 analysis steps.`;
  } else if (skippedAreaNames.length > 0) {
    compUserConf.innerHTML = `You completed ${stepsCompleted} of ${state.totalSteps} analysis steps.<br><span style="color:var(--muted);font-size:.8rem;">Skipped: ${skippedAreaNames.join(', ')}</span>`;
  } else {
    compUserConf.textContent = 'All steps completed';
  }

  const fb = document.getElementById('feedback-area');
  fb.innerHTML = '';
  if (comparison && comparison.feedback_items) {
    comparison.feedback_items.forEach(item => {
      const cls = item.type === 'good' ? 'feedback-good' : item.type === 'warn' ? 'feedback-warn' : 'feedback-bad';
      fb.innerHTML += `<div class="${cls}">${item.type === 'good' ? '✓' : '✗'} ${item.text}</div>`;
    });
  }

  // ── Interactive annotation view (feature ②) ──────────────────────────────
  const at = document.getElementById('annotated-text');
  const annSection = document.getElementById('section-annotation');
  const _annTip = document.getElementById('ann-tip');
  const _annTipType = document.getElementById('ann-tip-type');
  const _annTipDesc = document.getElementById('ann-tip-desc');
  const _ANN_INFO = {
    claim:   { label:'CLAIM',   color:'var(--blue)',   desc:'A specific, testable assertion that can be verified against evidence.' },
    opinion: { label:'OPINION', color:'var(--orange)', desc:'A subjective view or judgment — can be biased, emotional, or one-sided.' },
    context: { label:'CONTEXT', color:'var(--muted)',  desc:'Background or framing language — neither a direct claim nor a stated opinion.' },
  };
  function _showTip(e, type, status) {
    const info = _ANN_INFO[type] || _ANN_INFO.context;
    _annTipType.style.color = info.color;
    _annTipType.textContent = info.label + (status && status !== 'unverified' ? ' — ' + status.toUpperCase() : '');
    let desc = info.desc;
    if (status === 'support')    desc += ' Evidence found that supports this claim.';
    if (status === 'contradict') desc += ' Evidence found that contradicts this claim.';
    _annTipDesc.textContent = desc;
    _annTip.style.display = 'block';
    _annTip.style.left = Math.min(e.clientX + 14, window.innerWidth - 300) + 'px';
    _annTip.style.top  = (e.clientY + 18) + 'px';
  }
  document.addEventListener('mousemove', e => {
    if (_annTip.style.display !== 'none') {
      _annTip.style.left = Math.min(e.clientX + 14, window.innerWidth - 300) + 'px';
      _annTip.style.top  = (e.clientY + 18) + 'px';
    }
  });

  let _claimCount = 0, _opinionCount = 0, _ctxCount = 0;
  const _claimsForSummary = [];

  if (r.annotated && r.annotated.length > 0) {
    at.innerHTML = r.annotated.map((seg, i) => {
      let cls = 'ann-context';
      if (seg.type === 'claim') {
        cls = 'ann-claim' + (seg.status === 'contradict' ? ' ann-contra' : seg.status === 'support' ? ' ann-support' : '');
        _claimCount++;
        _claimsForSummary.push({ text: seg.text, status: seg.status });
      } else if (seg.type === 'opinion') {
        cls = 'ann-opinion'; _opinionCount++;
      } else {
        _ctxCount++;
      }
      return `<span class="${cls}" data-type="${seg.type}" data-status="${seg.status||''}" data-idx="${i}">${seg.text} </span>`;
    }).join('');

    // Wire tooltips
    at.querySelectorAll('[data-type]').forEach(el => {
      el.addEventListener('mouseenter', e => _showTip(e, el.dataset.type, el.dataset.status));
      el.addEventListener('mouseleave', () => { _annTip.style.display = 'none'; });
    });

    // Claim summary panel
    const claimList = document.getElementById('ann-claim-list');
    const claimSummary = document.getElementById('ann-claim-summary');
    if (_claimsForSummary.length > 0) {
      claimList.innerHTML = _claimsForSummary.map((c, i) => {
        const icon = c.status === 'support' ? '✅' : c.status === 'contradict' ? '❌' : '⬜';
        const col  = c.status === 'support' ? 'var(--green)' : c.status === 'contradict' ? 'var(--red)' : 'var(--muted)';
        return `<div style="display:flex;gap:.6rem;align-items:flex-start;"><span>${icon}</span><span style="color:${col};flex:1">${c.text}</span></div>`;
      }).join('');
      claimSummary.style.display = 'block';
    }

    // Count label
    const countEl = document.getElementById('ann-counts');
    if (countEl) countEl.textContent = `${_claimCount} claim${_claimCount!==1?'s':''} · ${_opinionCount} opinion${_opinionCount!==1?'s':''} · ${_ctxCount} context`;

    annSection.style.display = '';
  } else {
    at.innerHTML = `<span class="ann-context">${state.content || ''}</span>`;
    annSection.style.display = '';
  }

  // Only populate submission evidence on the first renderResults call (not when user-claim overwrites)
  if (!state._submissionEvidenceRendered) {
    state._submissionEvidenceRendered = true;
    _renderEvidenceInto('evidence-submission-list', r.evidence || []);
  }

  const la = document.getElementById('lessons-area');
  la.innerHTML = '';
  const triggeredLessons = comparison?.triggered_lessons || [];
  if (triggeredLessons.length > 0) {
    const topicIcons = { claim_detection:'🎯', source_verification:'🔍', bias_detection:'⚡', evidence_evaluation:'🧪', general:'📚' };
    triggeredLessons.forEach(lesson => {
      la.innerHTML += `<div class="lesson-card" onclick="markLessonRead('${lesson.key}')">
        <div class="lesson-icon">${topicIcons[lesson.topic] || '📖'}</div>
        <div class="lesson-title">${lesson.title}</div>
        <div class="lesson-text">${lesson.trigger_reason || ''}</div>
        <a href="lessons.html#${lesson.key}" class="lesson-link">Read full lesson →</a>
      </div>`;
    });
  } else {
    la.innerHTML = '<div class="no-lessons">Great job — no specific lesson gaps detected. Keep practicing with the <a href="lessons.html#quiz" style="color:var(--accent)">Quiz</a>.</div>';
  }

  const reeval = document.getElementById('reeval-score');
  if (reeval) reeval.value = state.userScore;
  const reevalDisp = document.getElementById('reeval-score-display');
  if (reevalDisp) reevalDisp.textContent = state.userScore;

  // review link removed

  // Kick off the post-analysis reflection flow
  startPostAnalysisFlow(r);

  // Persist the full result so it survives page navigation
  try {
    localStorage.setItem('sp_last_result', JSON.stringify({
      result: r,
      comparison,
      state: {
        content:       state.content,
        inputType:     state.inputType,
        userClaim:     state.userClaim,
        skippedSteps:  state.skippedSteps,
        answeredSteps: state.answeredSteps,
        totalSteps:    state.totalSteps,
        userScore:     state.userScore,
        evaluationId:  state.evaluationId,
        sourceRating:  state.sourceRating,
        biasRating:    state.biasRating,
        evidenceRating:state.evidenceRating,
        purposeRating: state.purposeRating,
        audienceRating:state.audienceRating,
        logicRating:   state.logicRating,
        corroboration: state.corroboration,
      },
      savedAt: Date.now(),
    }));
  } catch(e) { /* storage full or unavailable */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Post-analysis phases — all on one scrollable page
// ─────────────────────────────────────────────────────────────────────────────

// State for reflection
const reflectionState = { position: null, reasoning: '', saved: false };

// ── Background claim recommendation for Step 1 ───────────────────────────────
let _claimRecTimeout = null;

// ── Persist & restore last result across page navigation ─────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Restore last result if user navigated away and came back within 2 hours
  try {
    const saved = localStorage.getItem('sp_last_result');
    if (!saved) return;
    const { result, comparison, state: s, savedAt } = JSON.parse(saved);
    if (!savedAt || Date.now() - savedAt > 2 * 60 * 60 * 1000) return;

    // Rehydrate state
    Object.assign(state, s);

    // Show restore banner
    // Jump straight to results
    show('phase-results');
    renderResults(result, comparison);
  } catch(e) { /* corrupt or missing */ }
});

async function _fetchClaimRecommendations(claimText) {
  const banner = document.getElementById('claim-recommendations');
  const list   = document.getElementById('claim-rec-list');
  const loading = document.getElementById('claim-rec-loading');
  banner.style.display = 'block';
  list.style.display   = 'none';
  loading.style.display = 'flex';

  // No AI endpoint configured — hide the banner silently
  banner.style.display = 'none';
}

// ── Background content gather (silent, no UI) ─────────────────────────────────
let _backgroundEvidenceCache = null;
async function _gatherBackgroundEvidence(content, inputType) {
  // If no claim detected, gather related content silently and cache it
  _backgroundEvidenceCache = [];
}

// ── Kick off post-analysis flow ───────────────────────────────────────────────
function startPostAnalysisFlow(analysisResult) {
  // Pre-fetch exploration in background
  _fetchExploration(analysisResult);
  // Render the three sections immediately
  _renderUserResult(analysisResult);
  _renderContentRetrieval(analysisResult);
  _initUserInput(analysisResult);
  // Setup reasoning char count
  const ta = document.getElementById('r6-reasoning-input');
  if (ta) ta.addEventListener('input', () => {
    document.getElementById('r6-char-count').textContent = ta.value.length + ' characters';
  });
}

// ── SECTION 1: User Result ────────────────────────────────────────────────────
async function _renderUserResult(analysisResult) {
  document.getElementById('ur-loading').style.display = 'flex';
  document.getElementById('ur-content').style.display = 'none';

  const stepNames  = ['Claim','Source','Bias','Evidence','Purpose','Audience','Logic','Corroboration'];
  const unsureVals = ['unsure','none_mentioned'];
  const stepAnswerLabels = {
    yes:'Credible', no:'Unreliable/Unknown', unsure:'Not sure', none_mentioned:'No source mentioned',
    1:'Yes — emotional/biased language', 0:'No — neutral language', 2:'Somewhat',
    inform:'Inform', persuade:'Persuade', entertain:'Entertain', sell:'Sell', unknown:'Unknown',
    general:'General public', partisan:'A specific group', professional:'Experts/Professionals',
    hard_to_tell:'Hard to tell', none:'None of the above',
    valid:'Logically sound', fallacy:'Contains fallacies', unclear:'Unclear/hard to tell',
    confirmed:'Confirmed by other sources', contradicted:'Contradicted by others',
    partial:'Partially confirmed', only_one:'Only one source found', not_found:'Not found elsewhere', unchecked:'Not checked',
  };

  const lessonMap = {
    'Claim':         { key:'claim_detection',      title:'Claim Detection',       desc:'How to spot verifiable factual claims vs opinions.' },
    'Source':        { key:'source_verification',  title:'Source Verification',   desc:'How to assess credibility of sources.' },
    'Bias':          { key:'bias_detection',        title:'Bias Detection',        desc:'How to spot emotional language and bias.' },
    'Evidence':      { key:'evidence_evaluation',  title:'Evidence Evaluation',   desc:'How to assess the quality of evidence.' },
    'Purpose':       { key:'media_purpose',        title:'Media Purpose',         desc:'Understanding why content is created.' },
    'Audience':      { key:'audience_awareness',   title:'Audience Awareness',    desc:'How targeting shapes content.' },
    'Logic':         { key:'logical_reasoning',    title:'Logical Reasoning',     desc:'Spotting logical fallacies and sound arguments.' },
    'Corroboration': { key:'corroboration',        title:'Cross-Checking Sources',desc:'Why multiple independent sources matter.' },
  };

  const stateAnswers = [
    state.userClaim || null,
    state.sourceRating, state.biasRating, state.evidenceRating,
    state.purposeRating, state.audienceRating, state.logicRating, state.corroboration
  ];

  // Build step recap rows
  const recapEl = document.getElementById('ur-steps-recap');
  const skippedNames = [];
  const unsureNames  = [];

  // Build compact grid — collect rows first so we can wrap in one grid container
  const gridRows = stepNames.map((name, i) => {
    const raw        = stateAnswers[i];
    const hasValue   = raw !== null && raw !== undefined && raw !== '';
    const isSkipped  = state.skippedSteps.includes(i) || (!state.answeredSteps.includes(i) && !hasValue);
    const isAnswered = state.answeredSteps.includes(i) && hasValue;
    const isUnsure   = !isSkipped && (unsureVals.includes(String(raw)) || raw === 'unsure');
    const icon      = isSkipped ? '⬜' : isUnsure ? '🤔' : isAnswered ? '✅' : '⬜';
    const valText   = isSkipped ? '<span style="color:var(--muted);font-style:italic;">Skipped</span>' :
      hasValue ? (stepAnswerLabels[raw] || raw) : '<span style="color:var(--muted);font-style:italic;">Skipped</span>';
    const borderColor = isSkipped ? 'rgba(107,115,148,.25)' : isUnsure ? 'rgba(251,191,36,.3)' : 'rgba(52,211,153,.3)';
    const bg = isSkipped ? 'transparent' : isUnsure ? 'rgba(251,191,36,.04)' : 'rgba(52,211,153,.04)';

    if (isSkipped) skippedNames.push(name);
    if (isUnsure)  unsureNames.push(name);

    return `<div style="display:flex;align-items:center;gap:.5rem;padding:.45rem .7rem;border-radius:7px;border:1px solid ${borderColor};background:${bg};min-width:0;">
      <span style="font-size:.85rem;flex-shrink:0;">${icon}</span>
      <div style="min-width:0;overflow:hidden;">
        <div style="font-family:'DM Mono',monospace;font-size:.6rem;color:var(--muted);letter-spacing:.07em;white-space:nowrap;">${name.toUpperCase()}</div>
        <div style="font-size:.78rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${valText}</div>
      </div>
    </div>`;
  });

  recapEl.style.display = 'grid';
  recapEl.style.gridTemplateColumns = 'repeat(2, 1fr)';
  recapEl.style.gap = '.4rem';
  recapEl.innerHTML = gridRows.join('');

  // Skipped/unsure blocks removed — the grid above already shows this clearly

  // Lesson suggestions for skipped + unsure steps — compact "Skipped X → Learn how to..." format
  const needsLesson = [...new Set([...skippedNames, ...unsureNames])];
  const lessonEl = document.getElementById('ur-lesson-suggestions');
  if (needsLesson.length > 0) {
    const seen = new Set();
    lessonEl.innerHTML = needsLesson.map(name => {
      const lesson = lessonMap[name];
      if (!lesson || seen.has(lesson.key)) return '';
      seen.add(lesson.key);
      const actionText = {
        'Claim':         'how to identify verifiable claims',
        'Source':        'how to evaluate sources',
        'Bias':          'how to detect bias',
        'Evidence':      'how to assess evidence',
        'Purpose':       'how to identify content purpose',
        'Audience':      'how to recognize audience targeting',
        'Logic':         'how to spot logical fallacies',
        'Corroboration': 'how to cross-check sources',
      }[name] || 'more about this step';
      const prefix = skippedNames.includes(name) ? 'Skipped' : 'Uncertain about';
      return `<a href="lessons.html" target="_blank" rel="noopener" class="lesson-link" style="display:block;padding:.6rem .9rem;background:var(--surface);border:1px solid var(--border);border-radius:8px;text-decoration:none;color:var(--accent);font-size:.84rem;">→ ${prefix} ${name} — Learn ${actionText}</a>`;
    }).filter(Boolean).join('');
  }

  // Assessment summary — static fallback (no external AI endpoint configured)
  {
    const stepsCompleted = state.totalSteps - state.skippedSteps.length;
    let summary = '';
    if (skippedNames.length === 0 && unsureNames.length === 0) {
      summary = `Great work — you completed all ${stepsCompleted} evaluation steps. Keep applying these habits every time you encounter content online.`;
    } else {
      const skippedPart = skippedNames.length > 0 ? `You skipped: ${skippedNames.join(', ')}.` : '';
      const unsurePart  = unsureNames.length > 0  ? `You were uncertain about: ${unsureNames.join(', ')}.` : '';
      summary = `You completed ${stepsCompleted} of ${state.totalSteps} steps — good effort! ${[skippedPart, unsurePart].filter(Boolean).join(' ')} Review the lesson links above to build confidence in those areas.`;
    }
    document.getElementById('ur-ai-summary').textContent = summary;
  }

  document.getElementById('ur-loading').style.display = 'none';
  document.getElementById('ur-content').style.display = 'block';
}

function _stepHint(name) {
  const hints = {
    'Claim':         'whether the content makes a specific verifiable factual statement',
    'Source':        'the credibility and reliability of who published this',
    'Bias':          'whether the language is neutral or emotionally charged',
    'Evidence':      'whether the content provides citations or data to back its claims',
    'Purpose':       'why this content was created (to inform, persuade, sell, etc.)',
    'Audience':      'who this content is targeting and how that affects its framing',
    'Logic':         'whether the reasoning follows logically or contains fallacies',
    'Corroboration': 'whether other independent sources report the same information',
  };
  return hints[name] || 'this aspect of the content';
}

// ── Evidence rendering helper ─────────────────────────────────────────────────
function _renderEvidenceInto(listId, evidenceArr) {
  const el = document.getElementById(listId);
  if (!el) return;
  if (!evidenceArr || evidenceArr.length === 0) {
    el.innerHTML = '<div style="color:var(--muted);font-size:.85rem;padding:.5rem 0;">No evidence found.</div>';
    return;
  }
  // Deduplicate
  const seen = new Set();
  const deduped = evidenceArr.filter(e => {
    const key = (e.source_label || '') + '::' + (e.evidence_text || '').slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let caveat = '';
  if (deduped.length === 1) {
    caveat = '<div style="margin-bottom:.75rem;padding:.7rem 1rem;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.25);border-radius:8px;font-size:.82rem;color:var(--yellow);">⚠ Only one related source found — consider checking additional sources before deciding.</div>';
  } else if (deduped.length <= 3) {
    caveat = '<div style="margin-bottom:.75rem;padding:.7rem 1rem;background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.2);border-radius:8px;font-size:.82rem;color:var(--yellow);">⚠ Limited sources found — results may not show the full picture.</div>';
  } else {
    caveat = '<div style="margin-bottom:.75rem;padding:.7rem 1rem;background:rgba(52,211,153,.06);border:1px solid rgba(52,211,153,.2);border-radius:8px;font-size:.82rem;color:var(--green);">✓ Multiple sources found — compare perspectives for a balanced view.</div>';
  }
  el.innerHTML = caveat + deduped.map(e => {
    const title     = e.article_title || e.source_label || 'View Article';
    const domain    = e.source_url ? (() => { try { return new URL(e.source_url).hostname.replace(/^www\./, ''); } catch { return ''; } })() : (e.source_label || '');
    const date      = e.date_published || '';
    const meta      = `<div style="display:flex;align-items:center;gap:.5rem;margin-top:.45rem;flex-wrap:wrap;">
      ${domain ? `<span style="font-size:.72rem;color:var(--muted);background:var(--border);padding:.15rem .55rem;border-radius:4px;font-family:'DM Mono',monospace;">${domain}</span>` : ''}
      ${date   ? `<span style="font-size:.72rem;color:var(--muted);">${date}</span>` : ''}
    </div>`;
    const titleEl = e.source_url
      ? `<a href="${e.source_url}" target="_blank" rel="noopener noreferrer" class="ev-title-link">${title}</a>`
      : `<span class="ev-title-plain">${title}</span>`;
    return `<div class="evidence-item">
      ${titleEl}${meta}
    </div>`;
  }).join('');
}


function _renderContentRetrieval(analysisResult) {
  // Evidence list is already rendered by renderResults()
  // Kick off exploration links
  _fetchExploration(analysisResult);
}

let _evidenceSummaryReady = null;
// Compat aliases (old code may call these)
function showPhaseR2() {}

let _explorationReady = null;
async function _fetchExploration(analysisResult) {
  _explorationReady = [];
  _renderExplorationInline(_explorationReady);
}

function _renderExplorationInline(links) {
  document.getElementById('cr-explore-loading').style.display = 'none';
  document.getElementById('cr-explore-content').style.display = 'block';
  const el = document.getElementById('r3-links');
  if (!links || links.length === 0) {
    // Hide the entire explore section when empty — don't show "no sources" message
    const exploreWrap = document.getElementById('cr-explore-content').closest('[style*="border-radius:14px"]') ||
      document.getElementById('cr-explore-content').parentElement;
    if (exploreWrap) exploreWrap.style.display = 'none';
    return;
  }
  el.innerHTML = links.map(l => `
    <a href="${l.url}" target="_blank" class="r3-source-card" style="text-decoration:none;">
      <div class="r3-source-title">${l.title}</div>
      <div class="r3-source-url">${l.url.length > 60 ? l.url.slice(0,60)+'…' : l.url}</div>
      <div class="r3-source-snippet">${l.description}</div>
    </a>`).join('');
}

// Compat aliases
function showPhaseR3() {}
function showPhaseR4() {}
function showPhaseR5() {}

// ── SECTION 3: User Input ─────────────────────────────────────────────────────
function _initUserInput(analysisResult) {
  // UNESCO MIL-aligned reflection prompts (Step 7 Reflection)
  const prompts = [
    {
      label: '1. Evaluation awareness',
      question: 'Which information source or step most influenced your thinking, and why?',
    },
    {
      label: '2. Critical thinking / bias awareness',
      question: 'Did any part of the content feel convincing before you checked the sources? What influenced that reaction?',
    },
    {
      label: '3. Reasoning transparency',
      question: 'If you explain your conclusion, which steps (Claim, Source, Evidence, etc.) did you rely on most?',
    },
  ];
  document.getElementById('r4-prompts').innerHTML = prompts.map(p =>
    `<div class="r4-prompt"><strong style="display:block;font-size:.72rem;font-family:'DM Mono',monospace;color:var(--muted);letter-spacing:.06em;margin-bottom:.35rem;">${p.label.toUpperCase()}</strong>💭 ${p.question}</div>`
  ).join('');
}

function showPhaseR6() {
  // Compat — not needed since stance and reasoning are on same screen
}

// ── R7: Reflection Summary + Save ─────────────────────────────────────────────
async function showPhaseR7(skipped) {
  const selected = document.querySelector('input[name="user_position"]:checked');
  if (!selected && !skipped) { showToast('Please select a position first.'); return; }
  reflectionState.position = selected ? selected.value : 'uncertain';
  reflectionState.reasoning = skipped ? '' : (document.getElementById('r6-reasoning-input').value.trim());

  const posMap = {
    supported:   { badge: '✅', label: 'Supported',   color: 'var(--green)' },
    unsupported: { badge: '❌', label: 'Unsupported', color: 'var(--red)' },
    uncertain:   { badge: '🤔', label: 'Still Unsure', color: 'var(--yellow)' },
  };
  const pos = posMap[reflectionState.position] || posMap['uncertain'];

  // Hide user input section, show final summary
  document.getElementById('section-user-input').style.display = 'none';
  const r7 = document.getElementById('phase-r7-final');
  r7.style.display = 'block';
  r7.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('r7-position-badge').textContent = pos.badge;
  document.getElementById('r7-position-label').textContent = pos.label;
  document.getElementById('r7-position-label').style.color  = pos.color;
  document.getElementById('r7-reasoning-display').textContent =
    reflectionState.reasoning || '(No reasoning provided)';

  const saveEl = document.getElementById('r7-save-status');
  saveEl.textContent = '⏳ Saving your reflection…';
  try {
    const res = await fetch(`${API_BASE}/user-reflection`, {
      method: 'POST', credentials: 'include', headers: _authHeaders(),
      body: JSON.stringify({
        evaluation_id:     state.evaluationId,
        user_id:           USER_ID,
        session_token:     getSessionToken(),
        position:          reflectionState.position,
        reasoning:         reflectionState.reasoning,
        skipped_reasoning: skipped,
      })
    });
    saveEl.textContent = res.ok ? '✅ Reflection saved.' : '✅ Reflection recorded locally.';
    reflectionState.saved = true;
  } catch(e) {
    saveEl.textContent = '✅ Reflection noted (will sync when connected).';
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function submitReeval() {
  const revised = parseInt(document.getElementById('reeval-score').value);
  if (!state.userEvaluationId) { showToast('✅ Revised rating noted. (Log in to save it.)'); return; }
  try {
    const res = await fetch(`${API_BASE}/re-evaluation`, {
      method:  'POST', credentials: 'include', headers: _authHeaders(),
      body:    JSON.stringify({ user_evaluation_id: state.userEvaluationId, revised_score: revised,
        revised_label: revised >= 60 ? 'Likely Credible' : revised >= 40 ? 'Uncertain' : 'Likely Misleading',
        revised_confidence: state.confidence, revision_notes: null })
    });
    if (res.ok) {
      const data = await res.json();
      const shift = data.score_shift;
      const dir   = shift > 0 ? `↑ +${shift}` : shift < 0 ? `↓ ${shift}` : '→ unchanged';
      showToast(`✅ Revised rating (${revised}/100) saved. Shift: ${dir} pts`);
    } else { showToast(`✅ Revised rating (${revised}/100) recorded.`); }
  } catch (e) { showToast(`✅ Revised rating (${revised}/100) noted.`); }
}

// ─────────────────────────────────────────────────────────────────────────────
// New Evaluation
// ─────────────────────────────────────────────────────────────────────────────
function saveEvalProgress() {
  const snap = {
    phase: document.getElementById('phase-eval').style.display !== 'none' ? 'eval' : null,
    content: state.content, inputType: state.inputType,
    currentStep: state.currentStep, skippedSteps: state.skippedSteps, answeredSteps: state.answeredSteps,
    userClaim: state.userClaim, sourceRating: state.sourceRating, biasRating: state.biasRating,
    evidenceRating: state.evidenceRating, purposeRating: state.purposeRating,
    audienceRating: state.audienceRating, logicRating: state.logicRating, corroboration: state.corroboration,
  };
  sessionStorage.setItem('sp_eval_progress', JSON.stringify(snap));
}

function restoreEvalProgress() {
  const raw = sessionStorage.getItem('sp_eval_progress');
  if (!raw) return;
  try {
    const snap = JSON.parse(raw);
    if (snap.phase !== 'eval' || !snap.content) return;
    // Restore state
    Object.assign(state, {
      content: snap.content, inputType: snap.inputType,
      currentStep: snap.currentStep || 0,
      skippedSteps: snap.skippedSteps || [], answeredSteps: snap.answeredSteps || [],
      userClaim: snap.userClaim || '', sourceRating: snap.sourceRating, biasRating: snap.biasRating,
      evidenceRating: snap.evidenceRating, purposeRating: snap.purposeRating,
      audienceRating: snap.audienceRating, logicRating: snap.logicRating, corroboration: snap.corroboration,
    });
    // Restore content input
    if (snap.inputType === 'text' || snap.inputType === 'url') {
      document.getElementById('content-input').value = snap.content;
      document.getElementById('char-count').textContent = snap.content.length + ' characters';
    }
    show('phase-eval');
    goToStep(snap.currentStep || 0);
  } catch(e) { /* ignore */ }
}

// Save session progress on unload
window.addEventListener('beforeunload', saveEvalProgress);

// ── Bootstrap: load dynamic questions, then restore all state ─────────────────
async function _boot() {
  await initSessionToken();    // 0. ensure session token is ready
  await loadEvalQuestions();   // 1. render dynamic step cards first
  restoreEvalProgress();       // 2. restore same-session progress (sessionStorage)
  restoreStateFromPersist();   // 3. restore cross-page in-eval progress (localStorage)
  // sp_last_result (your result persistence) is handled by the DOMContentLoaded
  // listener below — it runs after _boot so the result phases exist in the DOM
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _boot);
} else {
  _boot();
}

// ── Annotation toggle (feature ②) ────────────────────────────────────────────
const _annState = { claim: true, opinion: true, context: true };
function annToggle(type) {
  _annState[type] = !_annState[type];
  const tog = document.getElementById('tog-' + type);
  const at  = document.getElementById('annotated-text');
  if (!at) return;
  if (_annState[type]) {
    at.classList.remove('hide-' + type + 's');
    if (tog) { tog.classList.remove('dimmed'); }
  } else {
    at.classList.add('hide-' + type + 's');
    if (tog) { tog.classList.add('dimmed'); }
  }
}

function newEval() {
  const inputEl = document.getElementById('content-input');
  if (inputEl) inputEl.value = '';
  const charCount = document.getElementById('char-count');
  if (charCount) charCount.textContent = '0 characters';
  const claimEl = document.getElementById('user-claim');
  if (claimEl) claimEl.value = '';
  localStorage.removeItem(_PERSIST_KEY);
  document.querySelectorAll('input[type=radio]').forEach(r => r.checked = false);
  // Reset post-analysis phases
  ['phase-r1-summary','phase-r2-evidence','phase-r3-explore','phase-r4-reflect',
   'phase-r5-position','phase-r6-reasoning','phase-r7-final'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  _evidenceSummaryReady = null;
  _explorationReady = null;
  reflectionState.position = null;
  reflectionState.reasoning = '';
  reflectionState.saved = false;
  document.querySelectorAll('input[name="user_position"]').forEach(r => r.checked = false);
  const rta = document.getElementById('r6-reasoning-input');
  if (rta) { rta.value = ''; }
  const rcc = document.getElementById('r6-char-count');
  if (rcc) rcc.textContent = '0 characters';
  state.sourceRating = null; state.biasRating = null; state.evidenceRating = null;
  state.evaluationId = null; state.userEvaluationId = null;
  state.systemResult = null; state.comparisonResult = null;
  state._pendingUserClaim = null; state.imageData = null; state.imageFile = null;
  clearImageUpload();
  document.querySelectorAll('.conf-btn').forEach(b => b.classList.remove('active'));
  goToStep(0);
  show('phase-input');
}
