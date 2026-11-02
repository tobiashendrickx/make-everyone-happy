'use strict';

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'make-everyone-happy-data';

const uid = p => p + '_' + Math.random().toString(36).slice(2, 8);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function defaultDrawing() {
  // two dots for eyes; the mouth is always drawn live on top
  return [
    { points: [[40, 35]], width: 5 },
    { points: [[60, 35]], width: 5 },
  ];
}

function seedState() {
  return {
    axes: [
      { id: 'cost',          name: 'Cost',          description: 'how expensive the option is (100 = very expensive)', min: 0, max: 100 },
      { id: 'user_friendly', name: 'User friendly', description: 'how easy it is to use (100 = very friendly)',        min: 0, max: 100 },
      { id: 'many_options',  name: 'Many options',  description: 'how much choice / configurability it offers',         min: 0, max: 100 },
    ],
    personas: [
      {
        id: 'alice', name: 'Alice',
        drawing: [{ points: [[40, 35]], width: 5 }, { points: [[60, 35]], width: 5 }],
        weights: { cost: -2, user_friendly: 3, many_options: 0 },
      },
      {
        id: 'bob', name: 'Bob',
        drawing: [
          { points: [[42, 32]], width: 4 }, { points: [[58, 32]], width: 4 },
          { points: [[30, 12], [70, 16]], width: 2 },
        ],
        weights: { cost: 1, user_friendly: 1, many_options: 3 },
      },
    ],
    influences: [
      { from: 'many_options', to: 'user_friendly', weight: -30 },
    ],
    projects: [
      {
        id: 'editor_choice', name: 'Choose a text editor',
        axes: {
          cost:          { on: true, value: 80 },
          user_friendly: { on: true, value: 40 },
          many_options:  { on: true, value: 70 },
        },
      },
    ],
  };
}

function normalize(s) {
  s.axes = Array.isArray(s.axes) ? s.axes : [];
  s.personas = Array.isArray(s.personas) ? s.personas : [];
  s.projects = Array.isArray(s.projects) ? s.projects : [];
  s.influences = Array.isArray(s.influences) ? s.influences : [];
  s.personas.forEach(p => {
    p.id = p.id || uid('p');
    p.name = p.name || 'persona';
    p.drawing = Array.isArray(p.drawing) ? p.drawing : [];
    p.weights = p.weights && typeof p.weights === 'object' ? p.weights : {};
  });
  s.axes.forEach(a => { a.id = a.id || uid('ax'); });
  s.projects.forEach(pr => {
    pr.id = pr.id || uid('pr');
    pr.axes = pr.axes && typeof pr.axes === 'object' ? pr.axes : {};
  });
  s.influences = s.influences.filter(i => i && i.from && i.to);
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalize(JSON.parse(raw));
  } catch (e) { return null; }
}

let state = loadState() || seedState();
if (!loadState()) save(); // persist seed on first run
const editing = { persona: null, axis: null, project: null };
let activeTab = 'personas';

function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

/* ------------------------------------------------------------------ */
/* calculations                                                        */
/* ------------------------------------------------------------------ */

const axisById = id => state.axes.find(a => a.id === id);
const axisMin = a => Number(a.min ?? 0);
const axisMax = a => Number(a.max ?? 100);
const isToggleAxis = a => axisMin(a) === 0 && axisMax(a) === 1;

// value after influences from other active axes, clamped to the axis range
function effectiveValue(project, axisId) {
  const a = axisById(axisId);
  if (!a) return 0;
  const lo = axisMin(a), hi = axisMax(a);
  const half = (hi - lo) / 2 || 1, mid = (lo + hi) / 2;
  let v = clamp(Number(project.axes[axisId]?.value ?? mid), lo, hi);
  for (const inf of state.influences) {
    if (inf.to !== axisId) continue;
    const src = project.axes[inf.from];
    if (!src || !src.on) continue;
    const sa = axisById(inf.from);
    if (!sa) continue;
    const sLo = axisMin(sa), sHi = axisMax(sa);
    const sHalf = (sHi - sLo) / 2 || 1, sMid = (sLo + sHi) / 2;
    const srcNorm = (clamp(Number(src.value ?? sMid), sLo, sHi) - sMid) / sHalf;
    v += (Number(inf.weight) / 100) * srcNorm * half;
  }
  return clamp(v, lo, hi);
}

// axis score in -1..+1 (0 = middle of the range)
function normalizedValue(project, axisId) {
  const a = axisById(axisId);
  const lo = axisMin(a), hi = axisMax(a);
  const half = (hi - lo) / 2 || 1, mid = (lo + hi) / 2;
  return (effectiveValue(project, axisId) - mid) / half;
}

// weighted average of the axis scores the persona cares about -> -1..+1
function personaHappiness(persona, project) {
  let sum = 0, absSum = 0;
  for (const a of state.axes) {
    const conf = project.axes[a.id];
    if (!conf || !conf.on) continue;
    const w = Number(persona.weights?.[a.id] ?? 0);
    if (!w) continue;
    sum += w * normalizedValue(project, a.id);
    absSum += Math.abs(w);
  }
  return absSum ? clamp(sum / absSum, -1, 1) : 0;
}

/* ------------------------------------------------------------------ */
/* rendering helpers                                                   */
/* ------------------------------------------------------------------ */

function faceCanvas(persona, happiness, size) {
  return `<canvas data-face="${esc(persona.id)}" data-h="${happiness}" width="${size}" height="${size}"></canvas>`;
}

function paintFaces(root) {
  root.querySelectorAll('canvas[data-face]').forEach(cv => {
    const p = state.personas.find(x => x.id === cv.dataset.face);
    if (p) FaceDraw.renderFace(cv, p.drawing, Number(cv.dataset.h || 0));
  });
}

function render() {
  document.querySelectorAll('nav .tabbtn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === activeTab));
  for (const t of ['personas', 'axes', 'projects', 'data']) {
    document.getElementById('tab-' + t).style.display = (t === activeTab) ? '' : 'none';
  }
  const el = document.getElementById('tab-' + activeTab);
  if (activeTab === 'personas') renderPersonas(el);
  else if (activeTab === 'axes') renderAxes(el);
  else if (activeTab === 'projects') renderProjects(el);
  else renderData(el);
}

/* ------------------------------------------------------------------ */
/* personas tab                                                        */
/* ------------------------------------------------------------------ */

function renderPersonas(el) {
  if (editing.persona) { renderPersonaEditor(el); return; }
  el.innerHTML = `
    <p><button data-action="new-persona">+ new persona</button></p>
    <div class="row">
      ${state.personas.map(p => `
        <div class="card" style="text-align:center">
          ${faceCanvas(p, 0, 90)}<br>
          <b>${esc(p.name)}</b><br>
          <button data-action="edit-persona" data-id="${esc(p.id)}">edit</button>
          <button data-action="del-persona" data-id="${esc(p.id)}">delete</button>
        </div>`).join('') || '<i>no personas yet</i>'}
    </div>
    <p class="muted">the mouth is always neutral here; it only smiles/frowns inside a project (or in the editor preview).</p>`;
  paintFaces(el);
}

function renderPersonaEditor(el) {
  const p = state.personas.find(x => x.id === editing.persona);
  if (!p) { editing.persona = null; renderPersonas(el); return; }
  el.innerHTML = `
    <h2>Edit persona</h2>
    <p>Name: <input id="p-name" value="${esc(p.name)}" size="30"></p>
    <div class="row">
      <div>
        <canvas id="p-canvas" width="300" height="300"></canvas><br>
        pen width:
        <select id="p-pen">
          ${[2, 3, 5, 8].map(w => `<option value="${w}"${w === 3 ? ' selected' : ''}>${w}</option>`).join('')}
        </select>
        <button id="p-undo">undo stroke</button>
        <button id="p-default">default face</button>
        <button id="p-clear">clear drawing</button>
      </div>
      <div>
        <h3>How much does this persona care about each axis?</h3>
        <table>
          <tr><th>axis</th><th>weight (-3 .. +3)</th></tr>
          ${state.axes.map(a => `
            <tr>
              <td><b>${esc(a.name)}</b><br><span class="muted">${esc(a.description || '')}</span></td>
              <td><select data-weight="${esc(a.id)}">
                ${[-3, -2, -1, 0, 1, 2, 3].map(w =>
                  `<option value="${w}"${Number(p.weights[a.id] ?? 0) === w ? ' selected' : ''}>${w > 0 ? '+' + w : (w === 0 ? '0 (ignore)' : w)}</option>`).join('')}
              </select></td>
            </tr>`).join('') || '<tr><td colspan="2"><i>no axes defined yet</i></td></tr>'}
          </table>
        <p class="muted">negative weight = gets sad when the axis value is high.<br>positive weight = gets happy when the axis value is high.</p>
        <h3>Mouth preview</h3>
        <input type="range" id="p-preview" min="-100" max="100" value="0">
        <br><br>
        <button id="p-done">done</button>
      </div>
    </div>`;

  const canvas = el.querySelector('#p-canvas');
  let preview = 0;
  const ed = FaceDraw.attachEditor(canvas, {
    getStrokes: () => p.drawing,
    getHappiness: () => preview,
    getPenWidth: () => el.querySelector('#p-pen').value,
    onCommit: st => { p.drawing.push(st); save(); },
  });

  el.querySelector('#p-name').addEventListener('change', e => { p.name = e.target.value; save(); });
  el.querySelectorAll('select[data-weight]').forEach(sel =>
    sel.addEventListener('change', () => {
      p.weights[sel.dataset.weight] = Number(sel.value);
      save();
    }));
  el.querySelector('#p-preview').addEventListener('input', e => {
    preview = Number(e.target.value) / 100;
    ed.redraw();
  });
  el.querySelector('#p-undo').addEventListener('click', () => { p.drawing.pop(); save(); ed.redraw(); });
  el.querySelector('#p-clear').addEventListener('click', () => { p.drawing = []; save(); ed.redraw(); });
  el.querySelector('#p-default').addEventListener('click', () => { p.drawing = defaultDrawing(); save(); ed.redraw(); });
  el.querySelector('#p-done').addEventListener('click', () => { editing.persona = null; render(); });
}

/* ------------------------------------------------------------------ */
/* axes tab                                                            */
/* ------------------------------------------------------------------ */

function infSelect(i, field, selected) {
  return `<select data-inf="${field}" data-inf-idx="${i}">` +
    state.axes.map(a => `<option value="${esc(a.id)}"${a.id === selected ? ' selected' : ''}>${esc(a.name)}</option>`).join('') +
    `</select>`;
}

function renderAxes(el) {
  if (editing.axis) { renderAxisEditor(el); return; }
  el.innerHTML = `
    <h2>Axes</h2>
    <p><button data-action="new-axis">+ new axis</button></p>
    <table>
      <tr><th>axis</th><th>range</th><th>description</th><th></th></tr>
      ${state.axes.map(a => `
        <tr>
          <td><b>${esc(a.name)}</b> <span class="muted">(${esc(a.id)})</span></td>
          <td>${axisMin(a)} .. ${axisMax(a)}${isToggleAxis(a) ? ' (on/off)' : ''}</td>
          <td>${esc(a.description || '')}</td>
          <td>
            <button data-action="edit-axis" data-id="${esc(a.id)}">edit</button>
            <button data-action="del-axis" data-id="${esc(a.id)}">delete</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="4"><i>no axes yet</i></td></tr>'}
    </table>

    <h2>Influences between axes</h2>
    <p class="muted">if the source axis sits at its maximum, the target axis shifts by "weight %" of its own range.<br>
    negative weight = pushes the target the other way. only active axes in a project exert influence.</p>
    <table>
      <tr><th>source</th><th>target</th><th>weight %</th><th></th></tr>
      ${state.influences.map((inf, i) => `
        <tr>
          <td>${infSelect(i, 'from', inf.from)}</td>
          <td>${infSelect(i, 'to', inf.to)}</td>
          <td><input type="number" data-inf-w="${i}" value="${Number(inf.weight) || 0}" min="-100" max="100" style="width:5em"></td>
          <td><button data-action="del-inf" data-id="${i}">remove</button></td>
        </tr>`).join('') || '<tr><td colspan="4"><i>no influences yet</i></td></tr>'}
      <tr><td colspan="4"><button data-action="add-inf" ${state.axes.length ? '' : 'disabled'}>+ add influence</button></td></tr>
    </table>`;

  el.querySelectorAll('select[data-inf]').forEach(sel =>
    sel.addEventListener('change', () => {
      state.influences[Number(sel.dataset.infIdx)][sel.dataset.inf] = sel.value;
      save();
    }));
  el.querySelectorAll('input[data-inf-w]').forEach(inp =>
    inp.addEventListener('change', () => {
      const inf = state.influences[Number(inp.dataset.infW)];
      inf.weight = Number(inp.value) || 0;
      save();
    }));
}

function renderAxisEditor(el) {
  const a = axisById(editing.axis);
  if (!a) { editing.axis = null; renderAxes(el); return; }
  el.innerHTML = `
    <h2>Edit axis</h2>
    <p>Name: <input id="a-name" value="${esc(a.name)}" size="30"></p>
    <p>Description: <input id="a-desc" value="${esc(a.description || '')}" size="60"></p>
    <p>Range: min <input id="a-min" type="number" value="${axisMin(a)}" style="width:6em">
       max <input id="a-max" type="number" value="${axisMax(a)}" style="width:6em"></p>
    <p class="muted">range 0..1 turns this into an on/off axis in projects (drawn as a checkbox instead of a slider).</p>
    <button id="a-done">done</button>`;

  el.querySelector('#a-name').addEventListener('change', e => { a.name = e.target.value; save(); });
  el.querySelector('#a-desc').addEventListener('change', e => { a.description = e.target.value; save(); });
  el.querySelector('#a-min').addEventListener('change', e => { a.min = Number(e.target.value) || 0; save(); });
  el.querySelector('#a-max').addEventListener('change', e => { a.max = Number(e.target.value) || 0; save(); });
  el.querySelector('#a-done').addEventListener('click', () => { editing.axis = null; render(); });
}

/* ------------------------------------------------------------------ */
/* projects tab                                                        */
/* ------------------------------------------------------------------ */

function renderProjects(el) {
  if (editing.project) { renderProjectEditor(el); return; }
  el.innerHTML = `
    <h2>Projects</h2>
    <p><button data-action="new-project">+ new project</button></p>
    <div class="row">
      ${state.projects.map(pr => `
        <div class="card">
          <b>${esc(pr.name)}</b><br>
          <span class="muted">${Object.entries(pr.axes)
            .filter(([, c]) => c && c.on)
            .map(([id]) => esc(axisById(id)?.name || id)).join(', ') || 'no axes on'}</span><br>
          <button data-action="edit-project" data-id="${esc(pr.id)}">open</button>
          <button data-action="del-project" data-id="${esc(pr.id)}">delete</button>
        </div>`).join('') || '<i>no projects yet</i>'}
    </div>`;
}

function renderProjectEditor(el) {
  const pr = state.projects.find(x => x.id === editing.project);
  if (!pr) { editing.project = null; renderProjects(el); return; }

  // make sure every axis has a config entry
  state.axes.forEach(a => {
    if (!pr.axes[a.id]) {
      pr.axes[a.id] = {
        on: false,
        value: isToggleAxis(a) ? 0 : Math.round((axisMin(a) + axisMax(a)) / 2),
      };
    }
  });
  save();

  el.innerHTML = `
    <h2>${esc(pr.name)}</h2>
    <p>Name: <input id="pr-name" value="${esc(pr.name)}" size="30"></p>
    <h3>Axes</h3>
    <table>
      <tr><th>on</th><th>axis</th><th>value</th></tr>
      ${state.axes.map(a => {
        const conf = pr.axes[a.id];
        const toggle = isToggleAxis(a);
        const valCell = toggle
          ? `<input type="checkbox" data-pval="${esc(a.id)}"${conf.value > 0 ? ' checked' : ''}>`
          : `<input type="range" data-pval="${esc(a.id)}" min="${axisMin(a)}" max="${axisMax(a)}" value="${conf.value}">
             <span data-pval-label="${esc(a.id)}">${conf.value}</span>`;
        return `
        <tr>
          <td><input type="checkbox" data-pon="${esc(a.id)}"${conf.on ? ' checked' : ''}></td>
          <td><b>${esc(a.name)}</b><br><span class="muted">${esc(a.description || '')}</span></td>
          <td>${valCell}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="3"><i>no axes defined yet</i></td></tr>'}
    </table>
    <h3>How the personas feel about this</h3>
    <div class="row" id="pr-faces"></div>
    <h3>Numbers <span class="muted">(axis values after influences)</span></h3>
    <div id="pr-numbers"></div>
    <p><button id="pr-done">done</button></p>`;

  const updateFaces = () => {
    const faces = el.querySelector('#pr-faces');
    faces.innerHTML = state.personas.map(p => {
      const h = personaHappiness(p, pr);
      return `<div class="card" style="text-align:center">
        ${faceCanvas(p, h, 110)}<br>
        ${esc(p.name)}: ${Math.round(h * 100)}%
      </div>`;
    }).join('') || '<i>no personas yet</i>';
    paintFaces(faces);

    const active = state.axes.filter(a => pr.axes[a.id] && pr.axes[a.id].on);
    el.querySelector('#pr-numbers').innerHTML = `
      <table>
        <tr><th>persona</th>${active.map(a => `<th>${esc(a.name)}</th>`).join('')}<th>happiness</th></tr>
        ${state.personas.map(p => {
          const h = personaHappiness(p, pr);
          return `<tr>
            <td>${esc(p.name)}</td>
            ${active.map(a => `<td>${Math.round(effectiveValue(pr, a.id))}</td>`).join('')}
            <td>${Math.round(h * 100)}%</td>
          </tr>`;
        }).join('') || '<tr><td><i>no personas yet</i></td></tr>'}
      </table>`;
  };

  el.querySelectorAll('[data-pon]').forEach(inp =>
    inp.addEventListener('change', () => {
      pr.axes[inp.dataset.pon].on = inp.checked;
      save(); updateFaces();
    }));

  el.querySelectorAll('[data-pval]').forEach(inp => {
    const id = inp.dataset.pval;
    const handler = () => {
      if (isToggleAxis(axisById(id))) pr.axes[id].value = inp.checked ? 1 : 0;
      else {
        pr.axes[id].value = Number(inp.value);
        const lbl = el.querySelector(`[data-pval-label="${id}"]`);
        if (lbl) lbl.textContent = inp.value;
      }
      save(); updateFaces();
    };
    if (inp.type === 'range') inp.addEventListener('input', handler);
    else inp.addEventListener('change', handler);
  });

  el.querySelector('#pr-name').addEventListener('change', e => {
    pr.name = e.target.value; save();
    el.querySelector('h2').textContent = pr.name;
  });
  el.querySelector('#pr-done').addEventListener('click', () => { editing.project = null; render(); });

  updateFaces();
}

/* ------------------------------------------------------------------ */
/* data tab                                                            */
/* ------------------------------------------------------------------ */

function toYaml() { return jsyaml.dump(state, { indent: 2, lineWidth: 100 }); }

function exportYaml() {
  const blob = new Blob([toYaml()], { type: 'text/yaml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'data.yaml';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importYamlText(text) {
  const data = jsyaml.load(text);
  if (!data || !Array.isArray(data.axes) || !Array.isArray(data.personas) || !Array.isArray(data.projects)) {
    throw new Error('file must contain "axes", "personas" and "projects" arrays');
  }
  state = normalize(data);
  editing.persona = editing.axis = editing.project = null;
  save(); render();
}

function renderData(el) {
  el.innerHTML = `
    <h2>Data</h2>
    <p>
      <button data-action="export-yaml">export data.yaml</button>
      <label>import: <input type="file" id="import-file" accept=".yaml,.yml,.txt"></label>
      <button data-action="reset-data">reset to seed data</button>
    </p>
    <p class="muted">everything is auto-saved in this browser (localStorage).<br>
    export / import moves it around as a single data.yaml file (import replaces the current data).</p>
    <h3>current data.yaml</h3>
    <textarea readonly id="yaml-preview" rows="22" style="width:100%">${esc(toYaml())}</textarea>`;

  el.querySelector('#import-file').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    f.text()
      .then(importYamlText)
      .then(() => alert('imported.'))
      .catch(err => alert('import failed: ' + err.message));
  });
}

/* ------------------------------------------------------------------ */
/* global wiring                                                       */
/* ------------------------------------------------------------------ */

document.querySelectorAll('nav .tabbtn').forEach(b =>
  b.addEventListener('click', () => { activeTab = b.dataset.tab; render(); }));

document.addEventListener('click', e => {
  const t = e.target.closest('button[data-action]');
  if (!t) return;
  const action = t.dataset.action, id = t.dataset.id;

  if (action === 'new-persona') {
    const p = { id: uid('p'), name: 'New persona ' + (state.personas.length + 1), drawing: defaultDrawing(), weights: {} };
    state.personas.push(p); editing.persona = p.id; save(); render();
  }
  else if (action === 'edit-persona') { editing.persona = id; render(); }
  else if (action === 'del-persona') {
    const p = state.personas.find(x => x.id === id);
    if (p && confirm(`Delete persona "${p.name}"?`)) {
      state.personas = state.personas.filter(x => x.id !== id); save(); render();
    }
  }
  else if (action === 'new-axis') {
    const a = { id: uid('ax'), name: 'New axis ' + (state.axes.length + 1), description: '', min: 0, max: 100 };
    state.axes.push(a); editing.axis = a.id; save(); render();
  }
  else if (action === 'edit-axis') { editing.axis = id; render(); }
  else if (action === 'del-axis') {
    const a = axisById(id);
    if (a && confirm(`Delete axis "${a.name}"? (removed from personas, influences and projects too)`)) {
      state.axes = state.axes.filter(x => x.id !== id);
      state.influences = state.influences.filter(i => i.from !== id && i.to !== id);
      state.personas.forEach(p => { delete p.weights[id]; });
      state.projects.forEach(pr => { delete pr.axes[id]; });
      save(); render();
    }
  }
  else if (action === 'add-inf') {
    if (state.axes.length) {
      state.influences.push({ from: state.axes[0].id, to: state.axes[0].id, weight: -10 });
      save(); render();
    }
  }
  else if (action === 'del-inf') {
    state.influences.splice(Number(id), 1); save(); render();
  }
  else if (action === 'new-project') {
    const pr = { id: uid('pr'), name: 'New project ' + (state.projects.length + 1), axes: {} };
    state.projects.push(pr); editing.project = pr.id; save(); render();
  }
  else if (action === 'edit-project') { editing.project = id; render(); }
  else if (action === 'del-project') {
    const pr = state.projects.find(x => x.id === id);
    if (pr && confirm(`Delete project "${pr.name}"?`)) {
      state.projects = state.projects.filter(x => x.id !== id); save(); render();
    }
  }
  else if (action === 'export-yaml') { exportYaml(); }
  else if (action === 'reset-data') {
    if (confirm('Throw away everything and restore the example data?')) {
      state = seedState();
      editing.persona = editing.axis = editing.project = null;
      save(); render();
    }
  }
});

render();
