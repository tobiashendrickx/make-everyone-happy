'use strict';

/* Face rendering + freehand drawing capture on a 0..100 grid. */
const FaceDraw = (() => {
  const GRID = 100;

  // strokes: [{points: [[x,y],...], width: n}]  -- single point = filled dot
  // happiness: -1 (frown) .. +1 (smile); the mouth is never a stored stroke
  function renderFace(canvas, strokes, happiness, liveStroke) {
    const ctx = canvas.getContext('2d');
    const s = canvas.width / GRID;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    (strokes || []).forEach(st => drawStroke(ctx, st, s));
    if (liveStroke) drawStroke(ctx, liveStroke, s);
    drawMouth(ctx, happiness || 0, s);
  }

  function drawStroke(ctx, st, s) {
    const pts = st.points || [];
    if (!pts.length) return;
    const w = st.width || 3;
    ctx.lineWidth = w * s;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0][0] * s, pts[0][1] * s, w * s / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * s, pts[0][1] * s);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * s, pts[i][1] * s);
    ctx.stroke();
  }

  function drawMouth(ctx, happiness, s) {
    const y = 60, x1 = 37, x2 = 63;
    ctx.lineWidth = 3 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1 * s, y * s);
    ctx.quadraticCurveTo(50 * s, (y + happiness * 13) * s, x2 * s, y * s);
    ctx.stroke();
  }

  function attachEditor(canvas, opts) {
    // opts: { getStrokes, getHappiness, getPenWidth, onCommit(stroke) }
    let stroke = null;
    const toGrid = e => {
      const r = canvas.getBoundingClientRect();
      return [
        Math.round((e.clientX - r.left) / r.width * GRID * 10) / 10,
        Math.round((e.clientY - r.top) / r.height * GRID * 10) / 10,
      ];
    };
    const redraw = () => renderFace(canvas, opts.getStrokes(), opts.getHappiness(), stroke);

    canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      stroke = { points: [toGrid(e)], width: Number(opts.getPenWidth()) || 3 };
      redraw();
    });
    canvas.addEventListener('pointermove', e => {
      if (!stroke) return;
      const p = toGrid(e);
      const last = stroke.points[stroke.points.length - 1];
      const dx = p[0] - last[0], dy = p[1] - last[1];
      if (dx * dx + dy * dy < 1.2) return; // skip tiny jitter
      stroke.points.push(p);
      redraw();
    });
    const finish = () => {
      if (!stroke) return;
      opts.onCommit(stroke);
      stroke = null;
      redraw();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);

    redraw();
    return { redraw };
  }

  return { GRID, renderFace, attachEditor };
})();
