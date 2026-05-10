/* ══════════════════════════════════════════════════════════════
   admin_mindmap_editor.js
   Drop this into dashboard.js or load as a separate module.

   Uses Cytoscape.js (loaded via CDN in dashboard.html).
   4 explicit modes: SELECT · ADD · CONNECT · DELETE
   All writes: single DB call per action, fire-and-forget.
   Positions debounced on drag — one call per node, on mouseup.
══════════════════════════════════════════════════════════════ */

const MMEditor = (() => {

  const MAP_ID   = 'main';
  const API_BASE = '';
  const CY_STYLE = [
    {
      selector: 'node',
      style: {
        'label':              'data(label)',
        'color':              '#d4d8e8',
        'font-size':          10,
        'font-family':        'DM Sans, sans-serif',
        'text-valign':        'bottom',
        'text-margin-y':      5,
        'width':              42,
        'height':             42,
        'background-color':   'data(color)',
        'background-opacity': 0.15,
        'border-width':       2,
        'border-color':       'data(color)',
        'border-opacity':     0.7,
      }
    },
    {
      selector: 'node[type="root"]',
      style: { width: 70, height: 70, 'border-width': 3, 'font-size': 12 }
    },
    {
      selector: 'node[type="cat"]',
      style: { width: 54, height: 54, 'border-width': 2.5 }
    },
    {
      selector: 'node:selected',
      style: { 'border-width': 3, 'border-color': '#4f8ef7', 'border-opacity': 1 }
    },
    {
      selector: 'edge',
      style: {
        'width':              1.5,
        'line-color':         '#2a3050',
        'line-style':         'dashed',
        'target-arrow-color': '#2a3050',
        'target-arrow-shape': 'triangle',
        'curve-style':        'bezier',
      }
    },
    {
      selector: 'edge:selected',
      style: { 'line-color': '#ff3b3b', 'target-arrow-color': '#ff3b3b', 'width': 2.5 }
    },
    {
      selector: '.eh-handle',
      style: { 'background-color': '#4f8ef7', width: 10, height: 10, shape: 'ellipse' }
    }
  ];

  let cy = null;
  let mode = 'select';      // 'select' | 'add' | 'connect' | 'delete'
  let connectSource = null; // node id pending connection
  let pendingPositions = {}; // nodeId -> {x,y}, debounced flush
  let posTimer = null;
  let allNodes = [];        // master node list

  /* ── API helpers ─────────────────────────────────────────── */
  async function api(method, path, body) {
    const opts = {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${API_BASE}${path}`, opts);
    if (!res.ok) throw new Error(await res.text());
    return res.json().catch(() => ({}));
  }

  /* ── Init ────────────────────────────────────────────────── */
  async function init(containerEl) {
    containerEl.innerHTML = `
      <div id="admin-mm-wrap">
        <div class="mm-toolbar">
          <button class="mm-mode-btn active" data-mode="select" title="Click/drag nodes">
            ↖ SELECT
          </button>
          <button class="mm-mode-btn" data-mode="add" title="Click canvas to add node">
            + ADD NODE
          </button>
          <button class="mm-mode-btn" data-mode="connect" title="Click source then target">
            ⤻ CONNECT
          </button>
          <button class="mm-mode-btn danger" data-mode="delete" title="Click to delete">
            ✕ DELETE
          </button>
          <div class="mm-toolbar-sep"></div>
          <button class="mm-mode-btn" id="mm-fit-btn" title="Fit graph">⊙ FIT</button>
          <div class="mm-toolbar-hint" id="mm-hint">Click a node to inspect or drag to move</div>
        </div>
        <div id="mm-cy"></div>
      </div>`;

    // Toolbar mode switching
    containerEl.querySelectorAll('.mm-mode-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });
    containerEl.querySelector('#mm-fit-btn').addEventListener('click', () => cy.fit(40));

    // Load Cytoscape if not already loaded
    await loadCytoscapeIfNeeded();

    const data = await api('GET', `/api/admin/mindmap/nodes?map=${MAP_ID}`);
    allNodes = data.nodes || [];

    const elements = buildCyElements(allNodes, data.edges || []);
    cy = cytoscape({
      container: document.getElementById('mm-cy'),
      elements,
      style: CY_STYLE,
      layout: { name: 'preset' }, // positions already set from DB
      wheelSensitivity: 0.3,
      minZoom: 0.15,
      maxZoom: 3,
    });

    cy.fit(40);
    bindEvents();
  }

  function buildCyElements(nodes, edges) {
    const els = [];
    nodes.forEach(n => {
      els.push({
        group: 'nodes',
        data: { id: n.id, label: `${n.icon} ${n.label}`, color: n.color || '#4488ff', type: n.type || 'leaf' },
        position: { x: (n.x || 400) / 4, y: (n.y || 400) / 4 }, // scale down from 3600px canvas
      });
    });
    edges.forEach(e => {
      els.push({ group: 'edges', data: { id: `e-${e.id}`, source: e.from_id, target: e.to_id, dbId: e.id } });
    });
    return els;
  }

  function loadCytoscapeIfNeeded() {
    if (window.cytoscape) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.28.1/cytoscape.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  /* ── Mode system ─────────────────────────────────────────── */
  function setMode(m) {
    mode = m;
    connectSource = null;
    document.querySelectorAll('.mm-mode-btn[data-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === m);
    });
    cy.userPanningEnabled(m === 'select');
    cy.autoungrabify(m !== 'select');
    if (cy) cy.elements().unselect();

    const hints = {
      select:  'Click a node to inspect · drag to reposition',
      add:     'Click empty canvas to add a new node',
      connect: 'Click a source node, then a target node to draw edge',
      delete:  'Click a node or edge to delete it',
    };
    setHint(hints[m] || '');
  }

  function setHint(msg) {
    const el = document.getElementById('mm-hint');
    if (el) el.textContent = msg;
  }

  /* ── Events ──────────────────────────────────────────────── */
  function bindEvents() {

    // Canvas click — ADD mode
    cy.on('tap', e => {
      if (e.target !== cy) return; // clicked on element, not canvas
      if (mode === 'add') openAddNodeModal(e.position);
    });

    // Node click
    cy.on('tap', 'node', e => {
      const node = e.target;
      if (mode === 'delete') { deleteNode(node); return; }
      if (mode === 'connect') {
        if (!connectSource) {
          connectSource = node.id();
          node.select();
          setHint(`Source: "${node.data('label')}" — now click a target node`);
        } else if (connectSource !== node.id()) {
          createEdge(connectSource, node.id());
          connectSource = null;
          cy.elements().unselect();
          setMode('connect'); // reset hint
        }
        return;
      }
      if (mode === 'select') openNodeInspector(node);
    });

    // Edge click — DELETE mode
    cy.on('tap', 'edge', e => {
      if (mode === 'delete') deleteEdge(e.target);
    });

    // Drag end — debounced position save
    cy.on('dragfree', 'node', e => {
      const node = e.target;
      const pos  = node.position();
      pendingPositions[node.id()] = { x: Math.round(pos.x * 4), y: Math.round(pos.y * 4) };
      clearTimeout(posTimer);
      posTimer = setTimeout(flushPositions, 1200);
    });
  }

  /* ── Position flush ──────────────────────────────────────── */
  function flushPositions() {
    const updates = Object.entries(pendingPositions).map(([id, pos]) => ({ id, x: pos.x, y: pos.y }));
    pendingPositions = {};
    if (!updates.length) return;
    api('PUT', `/api/admin/mindmap/nodes/positions`, { map_id: MAP_ID, updates }).catch(console.error);
  }

  /* ── Add node modal ──────────────────────────────────────── */
  function openAddNodeModal(position) {
    const existing = document.getElementById('mm-add-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'mm-add-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px">
        <div class="modal-title">
          Add node
          <button class="modal-close" id="mm-add-close">✕</button>
        </div>
        <div class="form-group">
          <label class="form-label">Label <span style="color:var(--red)">*</span></label>
          <input class="form-input" id="mm-label" placeholder="e.g. Manufactured Consent" maxlength="80">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
          <div class="form-group">
            <label class="form-label">Icon</label>
            <input class="form-input" id="mm-icon" placeholder="📌" maxlength="4" value="📌">
          </div>
          <div class="form-group">
            <label class="form-label">Type</label>
            <select class="form-input" id="mm-type" style="cursor:pointer">
              <option value="leaf">leaf</option>
              <option value="cat">category</option>
              <option value="root">root</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Size</label>
            <select class="form-input" id="mm-size" style="cursor:pointer">
              <option value="0">Auto</option>
              <option value="32">Small (32px)</option>
              <option value="46">Medium (46px)</option>
              <option value="60">Large (60px)</option>
              <option value="80">XL (80px)</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Color</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap" id="mm-color-swatches">
            ${['#4488ff','#ff3b3b','#ff7a30','#f5b731','#2fd469','#38d4d4','#9b6eff','#e857c0'].map(c =>
              `<button class="color-swatch" data-color="${c}"
                style="width:28px;height:28px;border-radius:50%;background:${c};border:2px solid transparent;cursor:pointer;transition:border-color .15s"
                title="${c}"></button>`
            ).join('')}
          </div>
          <input type="hidden" id="mm-color" value="#4488ff">
        </div>
        <div class="form-group">
          <label class="form-label">Media type</label>
          <select class="form-input" id="mm-mtype" style="cursor:pointer">
            <option value="">None</option>
            <option value="image">Image (URL)</option>
            <option value="youtube">YouTube (video ID)</option>
          </select>
        </div>
        <div class="form-group" id="mm-murl-wrap" style="display:none">
          <label class="form-label" id="mm-murl-label">URL</label>
          <input class="form-input" id="mm-murl" placeholder="">
        </div>
        <div id="mm-add-error" class="form-error"></div>
        <div class="form-actions">
          <button class="btn" id="mm-add-cancel">Cancel</button>
          <button class="btn btn-primary" id="mm-add-submit">Add node</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add('open'), 10);

    // Color swatch selection
    let selectedColor = '#4488ff';
    const firstSwatch = overlay.querySelector('.color-swatch');
    if (firstSwatch) firstSwatch.style.borderColor = '#fff';
    overlay.querySelectorAll('.color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        overlay.querySelectorAll('.color-swatch').forEach(s => s.style.borderColor = 'transparent');
        sw.style.borderColor = '#fff';
        selectedColor = sw.dataset.color;
        overlay.querySelector('#mm-color').value = selectedColor;
      });
    });

    // Show/hide media URL field
    const mtypeEl   = overlay.querySelector('#mm-mtype');
    const murlWrap  = overlay.querySelector('#mm-murl-wrap');
    const murlLabel = overlay.querySelector('#mm-murl-label');
    const murlInput = overlay.querySelector('#mm-murl');
    mtypeEl.addEventListener('change', () => {
      const v = mtypeEl.value;
      murlWrap.style.display = v ? 'block' : 'none';
      if (v === 'youtube') { murlLabel.textContent = 'YouTube video ID (11 chars)'; murlInput.placeholder = 'e.g. dQw4w9WgXcQ'; }
      if (v === 'image')   { murlLabel.textContent = 'Image URL'; murlInput.placeholder = 'https://example.com/image.jpg'; }
    });

    const closeModal = () => overlay.remove();
    overlay.querySelector('#mm-add-close').onclick  = closeModal;
    overlay.querySelector('#mm-add-cancel').onclick = closeModal;

    overlay.querySelector('#mm-add-submit').onclick = async () => {
      const label  = overlay.querySelector('#mm-label').value.trim();
      const icon   = overlay.querySelector('#mm-icon').value.trim() || '📌';
      const type   = overlay.querySelector('#mm-type').value;
      const color  = overlay.querySelector('#mm-color').value || '#4488ff';
      const size   = parseInt(overlay.querySelector('#mm-size').value) || 0;
      const mtype  = mtypeEl.value || null;
      const murl   = murlInput.value.trim() || null;
      const errEl  = overlay.querySelector('#mm-add-error');

      if (!label) { errEl.textContent = 'Label is required.'; errEl.style.display = 'block'; return; }
      if (mtype && !murl) { errEl.textContent = 'Paste a URL / video ID for the selected media type.'; errEl.style.display = 'block'; return; }

      const btn = overlay.querySelector('#mm-add-submit');
      btn.disabled = true; btn.textContent = 'Adding…';

      try {
        const newNode = await api('POST', `/api/admin/mindmap/nodes`, {
          map_id: MAP_ID, label, icon, type, color, sort_order: size,
          x: Math.round(position.x * 4),
          y: Math.round(position.y * 4),
          media_type: mtype,
          media_url:  murl,
        });
        const nodeSize = size || (type === 'root' ? 70 : type === 'cat' ? 54 : 38);
        cy.add({ group: 'nodes', data: { id: newNode.id, label: `${icon} ${label}`, color, type, size: nodeSize }, position });
        allNodes.push(newNode);
        closeModal();
        setMode('select');
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Add node';
        errEl.textContent = 'Failed to add node. ' + (err.message || '');
        errEl.style.display = 'block';
      }
    };
  }

  /* ── Node inspector (click in SELECT mode) ───────────────── */
  function openNodeInspector(cyNode) {
    const existing = document.getElementById('mm-inspect-modal');
    if (existing) existing.remove();

    const nodeData = allNodes.find(n => n.id === cyNode.id()) || {};
    const curSize  = nodeData.sort_order || 0;
    const overlay  = document.createElement('div');
    overlay.id     = 'mm-inspect-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px">
        <div class="modal-title">
          Edit node
          <button class="modal-close" id="mm-ins-close">✕</button>
        </div>
        <div class="form-group">
          <label class="form-label">Label</label>
          <input class="form-input" id="mm-ins-label" value="${esc(nodeData.label || cyNode.data('label'))}">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
          <div class="form-group">
            <label class="form-label">Icon</label>
            <input class="form-input" id="mm-ins-icon" value="${esc(nodeData.icon || '📌')}" maxlength="4">
          </div>
          <div class="form-group">
            <label class="form-label">Size</label>
            <select class="form-input" id="mm-ins-size" style="cursor:pointer">
              <option value="0"  ${curSize===0 ?'selected':''}>Auto</option>
              <option value="32" ${curSize===32?'selected':''}>Small (32px)</option>
              <option value="46" ${curSize===46?'selected':''}>Medium (46px)</option>
              <option value="60" ${curSize===60?'selected':''}>Large (60px)</option>
              <option value="80" ${curSize===80?'selected':''}>XL (80px)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Visible from start</label>
            <select class="form-input" id="mm-ins-visible" style="cursor:pointer">
              <option value="0" ${!nodeData.start_visible ? 'selected':''}>No (ghost)</option>
              <option value="1" ${nodeData.start_visible ? 'selected':''}>Yes</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Media type</label>
          <select class="form-input" id="mm-ins-mtype" style="cursor:pointer">
            <option value=""       ${!nodeData.media_type                  ?'selected':''}>None</option>
            <option value="image"  ${nodeData.media_type==='image'         ?'selected':''}>Image (URL)</option>
            <option value="youtube"${nodeData.media_type==='youtube'       ?'selected':''}>YouTube (video ID)</option>
          </select>
        </div>
        <div class="form-group" id="mm-ins-murl-wrap" style="display:${nodeData.media_type ? 'block' : 'none'}">
          <label class="form-label" id="mm-ins-murl-label">${nodeData.media_type === 'youtube' ? 'YouTube video ID (11 chars)' : 'Image URL'}</label>
          <input class="form-input" id="mm-ins-murl" value="${esc(nodeData.media_url || '')}"
            placeholder="${nodeData.media_type === 'youtube' ? 'e.g. dQw4w9WgXcQ' : 'https://example.com/image.jpg'}">
        </div>
        <div id="mm-ins-error" class="form-error"></div>
        <div class="form-actions">
          <button class="btn btn-danger" id="mm-ins-delete" style="margin-right:auto">Delete node</button>
          <button class="btn" id="mm-ins-cancel">Cancel</button>
          <button class="btn btn-primary" id="mm-ins-save">Save</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add('open'), 10);

    // Show/hide media URL field dynamically
    const mtypeEl   = overlay.querySelector('#mm-ins-mtype');
    const murlWrap  = overlay.querySelector('#mm-ins-murl-wrap');
    const murlLabel = overlay.querySelector('#mm-ins-murl-label');
    const murlInput = overlay.querySelector('#mm-ins-murl');
    mtypeEl.addEventListener('change', () => {
      const v = mtypeEl.value;
      murlWrap.style.display = v ? 'block' : 'none';
      if (v === 'youtube') { murlLabel.textContent = 'YouTube video ID (11 chars)'; murlInput.placeholder = 'e.g. dQw4w9WgXcQ'; }
      if (v === 'image')   { murlLabel.textContent = 'Image URL'; murlInput.placeholder = 'https://example.com/image.jpg'; }
    });

    const closeModal = () => overlay.remove();
    overlay.querySelector('#mm-ins-close').onclick  = closeModal;
    overlay.querySelector('#mm-ins-cancel').onclick = closeModal;

    overlay.querySelector('#mm-ins-delete').onclick = () => {
      if (!confirm(`Delete "${nodeData.label || cyNode.data('label')}"? This also removes all its edges.`)) return;
      closeModal();
      deleteNodeById(cyNode.id(), cyNode);
    };

    overlay.querySelector('#mm-ins-save').onclick = async () => {
      const label   = overlay.querySelector('#mm-ins-label').value.trim();
      const icon    = overlay.querySelector('#mm-ins-icon').value.trim() || '📌';
      const visible = overlay.querySelector('#mm-ins-visible').value;
      const size    = parseInt(overlay.querySelector('#mm-ins-size').value) || 0;
      const mtype   = mtypeEl?.value || '';
      const murl    = murlInput?.value.trim() || '';
      const errEl   = overlay.querySelector('#mm-ins-error');
      if (!label) { errEl.textContent = 'Label required.'; errEl.style.display = 'block'; return; }
      if (mtype && !murl) { errEl.textContent = 'Paste a URL / video ID for the selected media type.'; errEl.style.display = 'block'; return; }

      const btn = overlay.querySelector('#mm-ins-save');
      btn.disabled = true; btn.textContent = 'Saving…';

      try {
        await api('PUT', `/api/admin/mindmap/nodes/${cyNode.id()}`, {
          map_id: MAP_ID, label, icon,
          start_visible: parseInt(visible),
          sort_order: size,
          media_type: mtype || null,
          media_url:  murl || null,
        });
        const nodeSize = size || (nodeData.type === 'root' ? 70 : nodeData.type === 'cat' ? 54 : 38);
        cyNode.data('label', `${icon} ${label}`);
        if (size) { cyNode.style('width', nodeSize); cyNode.style('height', nodeSize); }
        // Update local cache
        const cached = allNodes.find(n => n.id === cyNode.id());
        if (cached) { cached.label = label; cached.icon = icon; cached.sort_order = size; cached.media_type = mtype || null; cached.media_url = murl || null; }
        closeModal();
      } catch {
        btn.disabled = false; btn.textContent = 'Save';
        errEl.textContent = 'Save failed.'; errEl.style.display = 'block';
      }
    };
  }

  /* ── Create edge ─────────────────────────────────────────── */
  async function createEdge(fromId, toId) {
    // Prevent duplicates client-side
    if (cy.edges(`[source="${fromId}"][target="${toId}"]`).length) {
      setHint('Edge already exists between these nodes.');
      return;
    }
    try {
      const result = await api('POST', `/api/admin/mindmap/edges`, { map_id: MAP_ID, from_id: fromId, to_id: toId });
      cy.add({ group: 'edges', data: { id: `e-${result.id}`, source: fromId, target: toId, dbId: result.id } });
    } catch (err) {
      console.error('Edge create failed', err);
    }
  }

  /* ── Delete node ─────────────────────────────────────────── */
  async function deleteNode(cyNode) {
    const id = cyNode.id();
    if (!confirm(`Delete node "${cyNode.data('label')}"? This removes all connected edges.`)) return;
    deleteNodeById(id, cyNode);
  }

  async function deleteNodeById(id, cyNode) {
    try {
      await api('DELETE', `/api/admin/mindmap/nodes/${id}?map_id=${MAP_ID}`);
      cyNode.remove(); // removes connected edges too in Cytoscape
      allNodes = allNodes.filter(n => n.id !== id);
    } catch (err) { console.error('Delete failed', err); }
  }

  /* ── Delete edge ─────────────────────────────────────────── */
  async function deleteEdge(cyEdge) {
    const dbId = cyEdge.data('dbId');
    if (!dbId) { cyEdge.remove(); return; }
    try {
      await api('DELETE', `/api/admin/mindmap/edges/${dbId}?map_id=${MAP_ID}`);
      cyEdge.remove();
    } catch (err) { console.error('Edge delete failed', err); }
  }

  /* ── Suggestions panel ───────────────────────────────────── */
  async function renderSuggestions(containerEl) {
    containerEl.innerHTML = '<p style="color:var(--muted);font-size:.82rem">Loading…</p>';
    try {
      const data = await api('GET', `/api/admin/mindmap/suggestions?status=pending&map=${MAP_ID}`);
      const list = data.suggestions || [];
      if (!list.length) {
        containerEl.innerHTML = '<p style="color:var(--muted);font-size:.82rem">No pending suggestions.</p>';
        return;
      }
      containerEl.innerHTML = `<div class="suggestions-list">${list.map(s => `
        <div class="suggestion-row" data-id="${s.id}">
          <div class="suggestion-row-body">
            <div class="suggestion-label">${esc(s.label)}</div>
            ${s.reason ? `<div class="suggestion-reason">${esc(s.reason)}</div>` : ''}
            <div class="suggestion-meta">
              From node: ${s.connect_from_id || 'unspecified'} ·
              ${s.user_id ? 'user #' + s.user_id : 'guest'} ·
              ${new Date(s.submitted_at).toLocaleDateString()}
            </div>
          </div>
          <div class="suggestion-actions">
            <button class="btn btn-small" data-action="approve" data-sid="${s.id}">✓ Approve</button>
            <button class="btn btn-small btn-danger" data-action="reject" data-sid="${s.id}">✕</button>
          </div>
        </div>`).join('')}
      </div>`;

      containerEl.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const status = btn.dataset.action === 'approve' ? 'approved' : 'rejected';
          const sid    = btn.dataset.sid;
          btn.disabled = true;
          try {
            await api('PUT', `/api/admin/mindmap/suggestions/${sid}`, { status });
            btn.closest('.suggestion-row').remove();
            if (!containerEl.querySelector('.suggestion-row')) {
              containerEl.innerHTML = '<p style="color:var(--muted);font-size:.82rem">No pending suggestions.</p>';
            }
          } catch { btn.disabled = false; }
        });
      });
    } catch {
      containerEl.innerHTML = '<p style="color:var(--red);font-size:.82rem">Failed to load suggestions.</p>';
    }
  }

  /* ── Utilities ───────────────────────────────────────────── */
  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, renderSuggestions };

})();

/* ══════════════════════════════════════════════════════════════
   Dashboard integration — call when admin tab is active
   Example usage in dashboard.js:

   if (tab === 'mindmap') {
     const wrap = document.getElementById('admin-mindmap-editor-container');
     if (!wrap._init) { wrap._init = true; MMEditor.init(wrap); }
     MMEditor.renderSuggestions(document.getElementById('suggestions-container'));
   }
══════════════════════════════════════════════════════════════ */
