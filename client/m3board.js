/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · gem duel board
   The 7x7 board on a canvas: gems drawn in code and pre-rendered for
   the current size, input (tap-tap, drag or swipe), and the playback of
   the server's events (swaps, specials, combos, boosters, cascades) on
   the shared schedule from shared/match3.js. Collected gems fly to the
   score and booster meters on a second, full-window canvas. It never
   decides anything: the room feeds it events and the board they end on.

   Everything on the board canvas is drawn in cell units (a cell is 1x1,
   the board 7x7) so a resize never disturbs an animation in flight.
   ════════════════════════════════════════════════════════════════════ */
import { W, H, N, TIMING, BOOSTERS, PERKS, canSwap, adjacent, rowOf, colOf } from '../shared/match3.js';

const DPR_MAX = 2, SPR = 1.5, GEM_R = 0.41; // a sprite spans 1.5 cells, a gem's radius is 0.41 of one
const LIGHT = [-0.55, -0.83];               // the lamp: up and to the left
const now = () => performance.now();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rand = (a, b) => a + Math.random() * (b - a);
const E = {
  io: k => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  out: k => 1 - (1 - k) ** 3,
  in: k => k * k,
  back: k => 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2,
  elastic: k => (k <= 0 ? 0 : k >= 1 ? 1 : 2 ** (-10 * k) * Math.sin((k * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
};
const hex = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
const mix = (a, b, t) => { const x = hex(a), y = hex(b); return `rgb(${x.map((v, k) => Math.round(v + (y[k] - v) * t)).join(',')})`; };
const rgba = (h, a) => `rgba(${hex(h).join(',')},${a})`;
const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.ceil(w)), height: Math.max(1, Math.ceil(h)) });
const nbrs = i => [i % W ? i - 1 : -1, i % W < W - 1 ? i + 1 : -1, i - W, i + W].filter(j => j >= 0 && j < N);

/* ───────────── the six gems ─────────────
   Look 0 is always "yours" (the viewer's colour), 1 "theirs", 2-5 neutral.
   Each has its own silhouette so the board reads without colour too.   */
const GEMS = [
  { shape: 'flame', base: '#2f7cf6', hi: '#c4e6ff', lo: '#0a2266', glow: '#5cb4ff' },   // sapphire lamp flame
  { shape: 'diamond', base: '#e8304c', hi: '#ffc4c8', lo: '#5e0616', glow: '#ff5a6e' }, // ruby
  { shape: 'octagon', base: '#18b866', hi: '#bbffd8', lo: '#05482a', glow: '#48f59a' }, // emerald
  { shape: 'hexagon', base: '#f28a1a', hi: '#ffe2ae', lo: '#6e2e02', glow: '#ffab3d' }, // amber
  { shape: 'star', base: '#9a4cf5', hi: '#ecd6ff', lo: '#2e0c6e', glow: '#c48bff' },    // violet
  { shape: 'round', base: '#efc232', hi: '#fff7c8', lo: '#7a5404', glow: '#ffe066' },   // gold
];
const ring = (n, r) => Array.from({ length: n }, (_, k) => { const a = -Math.PI / 2 + (k * 2 * Math.PI) / n; return [Math.cos(a) * r, Math.sin(a) * r]; });
const SHAPES = {
  flame: n => Array.from({ length: n }, (_, k) => { // a drop whose tip leans a little, like a lamp flame
    const t = (k / n) * 2 * Math.PI, y = -0.03 - Math.cos(t) * 0.96;
    return [Math.sin(t) * Math.sin(t / 2) * 1.04 + 0.16 * Math.max(0, -y) ** 2, y];
  }),
  diamond: () => [[-0.5, -0.7], [0.5, -0.7], [0.95, -0.18], [0, 0.95], [-0.95, -0.18]],
  octagon: () => [[-0.42, -0.9], [0.42, -0.9], [0.8, -0.52], [0.8, 0.52], [0.42, 0.9], [-0.42, 0.9], [-0.8, 0.52], [-0.8, -0.52]],
  hexagon: () => ring(6, 0.97),
  star: () => Array.from({ length: 8 }, (_, k) => { const a = -Math.PI / 2 + (k * Math.PI) / 4, r = k % 2 ? 0.47 : 1.02; return [Math.cos(a) * r, Math.sin(a) * r]; }),
  round: n => ring(n, 0.9),
};
const smooth = s => s === 'flame' || s === 'round';
const outlineOf = s => (smooth(s) ? SHAPES[s](48) : SHAPES[s]());
const facetsOf = s => (s === 'flame' ? SHAPES.flame(10) : s === 'round' ? SHAPES.round(12) : SHAPES[s]());
function poly(g, pts, R = 1) {
  g.beginPath();
  pts.forEach(([x, y], k) => (k ? g.lineTo(x * R, y * R) : g.moveTo(x * R, y * R)));
  g.closePath();
}
function rrect(g, x, y, w, h, r) {
  r = clamp(r, 0, Math.min(w, h) / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function sparkle4(g, x, y, r, a = 1) {
  g.save(); g.globalAlpha *= a; g.fillStyle = '#ffffff'; g.beginPath();
  for (let k = 0; k < 8; k++) { const ang = (k * Math.PI) / 4, rr = k % 2 ? r * 0.22 : r; g.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr); }
  g.closePath(); g.fill(); g.restore();
}

/** A faceted gem: drop shadow, shaded facets, a glowing table, rim light and a specular glint. */
function gemBody(g, gem, R) {
  const out = outlineOf(gem.shape), fac = facetsOf(gem.shape).map(([x, y]) => [x * R, y * R]);
  const k = gem.shape === 'star' ? 0.34 : 0.54;
  const inner = fac.map(([x, y]) => [x * k - R * 0.04, y * k - R * 0.06]);
  g.save();
  g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = R * 0.3; g.shadowOffsetY = R * 0.16;
  poly(g, out, R); g.fillStyle = gem.lo; g.fill();
  g.restore();
  g.save(); poly(g, out, R); g.clip();
  const base = g.createLinearGradient(-R, -R, R, R);
  base.addColorStop(0, gem.hi); base.addColorStop(0.45, gem.base); base.addColorStop(1, gem.lo);
  g.fillStyle = base; g.fillRect(-R * 1.3, -R * 1.3, R * 2.6, R * 2.6);
  fac.forEach((p, i) => {
    const q = fac[(i + 1) % fac.length], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, len = Math.hypot(mx, my) || 1;
    const lit = (mx / len) * LIGHT[0] + (my / len) * LIGHT[1];
    g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.lineTo(...inner[(i + 1) % fac.length]); g.lineTo(...inner[i]); g.closePath();
    g.fillStyle = mix(gem.lo, gem.hi, clamp(0.4 + lit * 0.48 + (i % 2 ? 0.07 : -0.05), 0.04, 0.96));
    g.fill();
  });
  poly(g, inner);
  const tg = g.createLinearGradient(-R * 0.5, -R * 0.6, R * 0.4, R * 0.5);
  tg.addColorStop(0, mix(gem.base, '#ffffff', 0.5)); tg.addColorStop(0.55, gem.base); tg.addColorStop(1, mix(gem.base, gem.lo, 0.45));
  g.fillStyle = tg; g.fill();
  const ig = g.createRadialGradient(R * 0.12, R * 0.3, 0, R * 0.12, R * 0.3, R * 0.75);
  ig.addColorStop(0, rgba(gem.glow, 0.6)); ig.addColorStop(1, rgba(gem.glow, 0));
  g.fillStyle = ig; g.fillRect(-R, -R, R * 2, R * 2);
  g.strokeStyle = 'rgba(255,255,255,.26)'; g.lineWidth = Math.max(0.6, R * 0.028);
  g.beginPath(); fac.forEach((p, i) => { g.moveTo(p[0], p[1]); g.lineTo(...inner[i]); }); g.stroke();
  poly(g, inner); g.stroke();
  // rim light along the lower right, and the glint where the lamp catches it
  const rl = g.createLinearGradient(-R, -R, R, R);
  rl.addColorStop(0.55, rgba(gem.hi, 0)); rl.addColorStop(1, rgba(gem.hi, 0.75));
  poly(g, out, R); g.strokeStyle = rl; g.lineWidth = R * 0.16; g.stroke();
  g.translate(-R * 0.3, -R * 0.42); g.rotate(-0.6); g.scale(1, 0.48);
  const sg = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.34);
  sg.addColorStop(0, 'rgba(255,255,255,.95)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sg; g.beginPath(); g.arc(0, 0, R * 0.34, 0, 7); g.fill();
  g.restore();
  poly(g, out, R); g.strokeStyle = mix(gem.lo, '#000000', 0.35); g.lineWidth = R * 0.055; g.stroke();
  sparkle4(g, -R * 0.26, -R * 0.4, R * 0.2, 0.9);
}

/** Arrow: double chevrons pointing both ways along its line, with a streak through the gem. */
function arrows(g, gem, R, dir) {
  g.save();
  if (dir === 'v') g.rotate(Math.PI / 2);
  const st = g.createLinearGradient(-R * 1.1, 0, R * 1.1, 0);
  st.addColorStop(0, 'rgba(255,255,255,0)'); st.addColorStop(0.5, 'rgba(255,255,255,.7)'); st.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = st; g.fillRect(-R * 1.1, -R * 0.06, R * 2.2, R * 0.12);
  g.shadowColor = gem.glow; g.shadowBlur = R * 0.4;
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const pass of [[mix(gem.lo, '#000000', 0.3), R * 0.24], ['#ffffff', R * 0.13]]) {
    g.strokeStyle = pass[0]; g.lineWidth = pass[1];
    for (const side of [-1, 1]) for (const k of [0, 1]) {
      const x = side * (R * 0.36 + k * R * 0.27);
      g.beginPath(); g.moveTo(x - side * R * 0.18, -R * 0.27); g.lineTo(x, 0); g.lineTo(x - side * R * 0.18, R * 0.27); g.stroke();
    }
    g.shadowBlur = 0;
  }
  g.restore();
}

/** The gem's silhouette, small, as an emblem on the orbs so they keep their family. */
function emblem(g, gem, R, s) {
  poly(g, outlineOf(gem.shape), R * s);
  g.fillStyle = 'rgba(255,255,255,.28)'; g.fill();
  g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = R * 0.05; g.stroke();
}
function orb(g, gem, r, glow) {
  g.save();
  g.shadowColor = glow ? gem.glow : 'rgba(0,0,0,.55)'; g.shadowBlur = r * (glow ? 0.6 : 0.35); g.shadowOffsetY = glow ? 0 : r * 0.18;
  g.beginPath(); g.arc(0, 0, r, 0, 7);
  const og = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r);
  og.addColorStop(0, mix(gem.base, '#ffffff', glow ? 0.7 : 0.55)); og.addColorStop(0.4, gem.base); og.addColorStop(1, mix(gem.lo, '#000000', 0.4));
  g.fillStyle = og; g.fill();
  g.restore();
  g.beginPath(); g.arc(0, 0, r, 0, 7); g.strokeStyle = mix(gem.lo, '#000000', 0.4); g.lineWidth = r * 0.07; g.stroke();
}
function gloss(g, r) {
  g.save(); g.translate(-r * 0.32, -r * 0.42); g.rotate(-0.5); g.scale(1, 0.55);
  const sg = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.42);
  sg.addColorStop(0, 'rgba(255,255,255,.9)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sg; g.beginPath(); g.arc(0, 0, r * 0.42, 0, 7); g.fill(); g.restore();
}
/** Bomb: a glossy orb in the gem's colour with a brass cap and a fuse (its spark is drawn live). */
function bombOrb(g, gem, R) {
  const r = R * 0.84;
  g.translate(0, R * 0.08);
  g.save(); g.rotate(0.6);
  const cap = g.createLinearGradient(-r * 0.22, 0, r * 0.22, 0);
  cap.addColorStop(0, '#8a6a33'); cap.addColorStop(0.5, '#f3dca0'); cap.addColorStop(1, '#8a6a33');
  g.fillStyle = cap; rrect(g, -r * 0.22, -r * 1.14, r * 0.44, r * 0.32, r * 0.06); g.fill();
  g.restore();
  orb(g, gem, r, false);
  emblem(g, gem, R, 0.36);
  gloss(g, r);
  g.beginPath(); g.moveTo(r * 0.55, -r * 0.9); g.quadraticCurveTo(r * 0.82, -r * 1.25, r * 0.98, -r * 1.12);
  g.strokeStyle = '#3a2a16'; g.lineWidth = r * 0.11; g.lineCap = 'round'; g.stroke();
  g.strokeStyle = '#a07a40'; g.lineWidth = r * 0.05; g.stroke();
}
/** Lightning: a charged orb with a white bolt glyph (its arcs are drawn live). */
function boltOrb(g, gem, R) {
  const r = R * 0.86;
  orb(g, gem, r, true);
  const ig = g.createRadialGradient(0, 0, 0, 0, 0, r);
  ig.addColorStop(0, rgba(gem.glow, 0.9)); ig.addColorStop(0.6, rgba(gem.glow, 0.25)); ig.addColorStop(1, rgba(gem.glow, 0));
  g.fillStyle = ig; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  g.beginPath(); g.arc(0, 0, r * 0.82, 0, 7); g.strokeStyle = rgba(gem.hi, 0.55); g.lineWidth = r * 0.05; g.stroke();
  gloss(g, r);
  g.save(); g.shadowColor = gem.glow; g.shadowBlur = r * 0.5;
  poly(g, [[0.16, -0.66], [-0.32, 0.08], [-0.03, 0.08], [-0.16, 0.66], [0.34, -0.1], [0.05, -0.1]], r);
  g.fillStyle = '#ffffff'; g.fill();
  g.restore();
}
/** A gem (or special) sprite, `px` device pixels per cell. */
function gemSprite(gem, s, px) {
  const S = Math.ceil(px * SPR), c = canvas(S, S), g = c.getContext('2d'), R = px * GEM_R;
  g.translate(S / 2, S / 2);
  if (s === 'bomb') bombOrb(g, gem, R);
  else if (s === 'bolt') boltOrb(g, gem, R);
  else { gemBody(g, gem, R); if (s === 'h' || s === 'v') arrows(g, gem, R, s); }
  return c;
}
/** A gem as an image URL, for pictures outside the board (the how-to-play guide). Look 0 is "yours", 1 "theirs". */
const icons = new Map();
export function gemImage(look, s = '', px = 72) {
  const key = `${look}${s}${px}`;
  if (!icons.has(key)) icons.set(key, gemSprite(GEMS[look], s, px).toDataURL());
  return icons.get(key);
}
/** Soft round glows for light effects: one per gem, white ('w') and lamplight ('l'). */
function glowSprite(col, core = 0.6) {
  const S = 64, c = canvas(S, S), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.12, rgba(col, 1)); gr.addColorStop(0.4, rgba(col, core * 0.55)); gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return c;
}

/* ───────────── effects ─────────────
   Each effect in flight is { k, t0, dur, ... } in cell units; FX[k] draws
   it at progress 0..1 with `this` the board, additively unless it says
   otherwise. Colours are a gem look (0-5), 'w' white or 'l' lamplight. */
const CASCADE = ['Cascade!', 'Double cascade!', 'Triple cascade!', 'Unstoppable!'];
const tint = col => (typeof col === 'number' ? GEMS[col].glow : col === 'l' ? '#ffc878' : '#dde9ff');
function starSprite() {
  const c = canvas(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 22);
  gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  sparkle4(g, 32, 32, 31);
  return c;
}
/** A little brass lantern, lit. */
function lanternAt(g, x, y, s) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.strokeStyle = '#8a6a33'; g.lineWidth = 0.035;
  g.beginPath(); g.arc(0, -0.34, 0.08, Math.PI, 0); g.stroke();
  g.fillStyle = '#c49a52'; g.beginPath(); g.moveTo(-0.13, -0.26); g.lineTo(0.13, -0.26); g.lineTo(0.2, -0.18); g.lineTo(-0.2, -0.18); g.closePath(); g.fill();
  const body = g.createRadialGradient(0, 0.02, 0, 0, 0.02, 0.24);
  body.addColorStop(0, '#fffbe6'); body.addColorStop(0.5, '#ffd27a'); body.addColorStop(1, '#e08a2a');
  g.fillStyle = body; rrect(g, -0.16, -0.18, 0.32, 0.38, 0.06); g.fill();
  g.strokeStyle = '#7a5a28'; g.beginPath(); g.moveTo(0, -0.18); g.lineTo(0, 0.2); g.stroke();
  rrect(g, -0.16, -0.18, 0.32, 0.38, 0.06); g.stroke();
  g.fillStyle = '#a07a40'; g.fillRect(-0.18, 0.2, 0.36, 0.06);
  g.restore();
}
/** The Trick Hat: a top hat with a violet band. */
function hatAt(g, x, y, s, tilt) {
  g.save(); g.translate(x, y); g.rotate(tilt); g.scale(s, s);
  g.fillStyle = '#16121f';
  g.beginPath(); g.ellipse(0, 0.32, 0.62, 0.14, 0, 0, 6.283); g.fill();
  const cr = g.createLinearGradient(-0.4, 0, 0.4, 0);
  cr.addColorStop(0, '#0d0a14'); cr.addColorStop(0.35, '#3a3150'); cr.addColorStop(1, '#0d0a14');
  g.fillStyle = cr; g.beginPath(); g.moveTo(-0.38, 0.3); g.lineTo(-0.34, -0.42); g.quadraticCurveTo(0, -0.5, 0.34, -0.42); g.lineTo(0.38, 0.3); g.closePath(); g.fill();
  g.fillStyle = '#9a4cf5'; g.fillRect(-0.375, 0.06, 0.75, 0.13);
  g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(-0.24, -0.4, 0.06, 0.68);
  g.restore();
}
const FX = {
  pop(g, f, k) { this.glow(g, f.col, f.x, f.y, 0.45 + 0.5 * k, (1 - k) * 0.9); this.glow(g, 'w', f.x, f.y, 0.32 * (1 - k), 1 - k); },
  ring(g, f, k) {
    g.globalAlpha = (1 - k) * 0.9;
    g.beginPath(); g.arc(f.x, f.y, f.R * E.out(k), 0, 6.283);
    g.strokeStyle = tint(f.col); g.lineWidth = 0.12 * (1 - k) + 0.02; g.stroke();
  },
  blast(g, f, k) {
    const e = E.out(k);
    this.glow(g, 'w', f.x, f.y, f.R * (0.4 + 0.6 * e), (1 - k) ** 2 * 1.2);
    this.glow(g, f.col, f.x, f.y, f.R * (0.6 + 0.8 * e), (1 - k) * 0.8);
    for (const [d, w] of [[0, 0.22], [0.14, 0.1]]) {
      const kk = (k - d) / (1 - d);
      if (kk <= 0) continue;
      g.globalAlpha = (1 - kk) * 0.9;
      g.beginPath(); g.arc(f.x, f.y, f.R * E.out(kk), 0, 6.283);
      g.strokeStyle = tint(f.col); g.lineWidth = w * (1 - kk) + 0.02; g.stroke();
    }
  },
  beam(g, f, k, t) { this.drawBeam(g, f, k, t, false); },
  laser(g, f, k, t) { this.drawBeam(g, f, k, t, true); },
  zap(g, f, k, t) {
    const el = t - f.t0, fade = k > 0.7 ? (1 - k) / 0.3 : 1;
    if (!f.paths || t - f.pt > 55) { f.pt = t; f.paths = f.pts.map(([x, y]) => forked(f.x, f.y, x, y, f.big ? 0.28 : 0.22)); }
    const live = f.paths.filter((_, j) => el >= f.reach[j]).flat();
    this.glow(g, f.col, f.x, f.y, 0.7 + 0.15 * Math.random(), 0.8 * fade);
    if (live.length) {
      this.strokePaths(g, live, tint(f.col), f.big ? 0.2 : 0.14, 0.3 * fade);
      this.strokePaths(g, live, tint(f.col), 0.06, 0.85 * fade);
      this.strokePaths(g, live, '#ffffff', 0.022, fade);
    }
    f.pts.forEach(([x, y], j) => { const kk = (el - f.reach[j]) / 160; if (kk >= 0 && kk < 1) this.glow(g, 'w', x, y, 0.45, 1 - kk); });
  },
  hops(g, f, k, t) {
    const el = t - f.t0, fade = k > 0.75 ? (1 - k) / 0.25 : 1, pts = [[f.x, f.y], ...f.pts];
    if (!f.paths || t - f.pt > 60) { f.pt = t; f.paths = f.pts.map((p, j) => jag(pts[j][0], pts[j][1], p[0], p[1], 0.35)); }
    const live = f.paths.filter((_, j) => el >= f.reach[j] - 40 && el < f.reach[j] + 240);
    this.glow(g, f.col, f.x, f.y, 0.6 + 0.1 * Math.random(), 0.7 * fade);
    if (live.length) {
      this.strokePaths(g, live, tint(f.col), 0.16, 0.35 * fade);
      this.strokePaths(g, live, '#ffffff', 0.03, fade);
    }
    f.pts.forEach(([x, y], j) => { const kk = (el - f.reach[j]) / 200; if (kk >= 0 && kk < 1) this.glow(g, f.col, x, y, 0.5, 1 - kk); });
  },
  rays(g, f, k, t) {
    const el = t - f.t0, fade = k > 0.6 ? (1 - k) / 0.4 : 1;
    g.lineCap = 'round';
    f.pts.forEach(([x, y], j) => {
      const grow = clamp((el + 40) / (f.reach[j] + 40), 0, 1), ex = f.x + (x - f.x) * grow, ey = f.y + (y - f.y) * grow, hue = (j * 47 + el * 0.4) % 360;
      for (const [w, a, l] of [[0.16, 0.35, 62], [0.045, 0.95, 82]]) {
        g.globalAlpha = a * fade; g.strokeStyle = `hsl(${hue},100%,${l}%)`; g.lineWidth = w;
        g.beginPath(); g.moveTo(f.x, f.y); g.lineTo(ex, ey); g.stroke();
      }
      if (grow >= 1) this.glow(g, 'w', x, y, 0.42, fade * 0.8);
    });
    g.globalAlpha = fade; g.save(); g.translate(f.x, f.y); g.rotate(el / 200);
    g.drawImage(this.star, -0.6, -0.6, 1.2, 1.2); g.restore();
    this.glow(g, 'w', f.x, f.y, 0.9, fade);
  },
  plus(g, f, k) {
    const len = 1.35 * E.out(Math.min(1, k * 2.5));
    g.globalAlpha = 1 - k;
    for (let q = 0; q < 4; q++) {
      g.save(); g.translate(f.x, f.y); g.rotate((q * Math.PI) / 2);
      const gr = g.createLinearGradient(0, 0, len, 0);
      gr.addColorStop(0, 'rgba(255,244,210,1)'); gr.addColorStop(0.55, 'rgba(255,150,50,.85)'); gr.addColorStop(1, 'rgba(255,90,20,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, -0.24); g.quadraticCurveTo(len * 0.6, -0.15, len, 0); g.quadraticCurveTo(len * 0.6, 0.15, 0, 0.24); g.fill();
      g.restore();
    }
    if (k < 0.6 && Math.random() < 0.7) this.part({ kind: 'spark', x: f.x + rand(-1, 1), y: f.y + rand(-1, 1), vx: rand(-0.5, 0.5), vy: rand(-2, -0.6), gr: 1, drag: 2, life: rand(0.3, 0.6), size: rand(0.06, 0.12), col: 'l' });
  },
  lantern(g, f, k, t) {
    const x = 0.5 + (6 * (t - f.t0)) / f.reach, a = 1 - k;
    const gr = g.createLinearGradient(Math.min(x, 7) - 7, 0, Math.min(x, 7), 0);
    gr.addColorStop(0, 'rgba(255,190,100,0)'); gr.addColorStop(1, 'rgba(255,214,140,.55)');
    g.globalAlpha = a; g.fillStyle = gr; g.fillRect(0, f.y - 0.48, Math.min(x, 7), 0.96);
    if (x < 7.5) this.glow(g, 'l', x, f.y, 1.2, a);
  },
  intro(g, f, k, t) {
    const x = colOf(f.i) + 0.5, y = rowOf(f.i) + 0.5, el = t - f.t0;
    switch (f.key) {
      case 'ember': {
        const sy = -1.4 + (y + 1.4) * E.in(k);
        this.glow(g, 'l', x, sy, 0.5, 1); this.glow(g, 'w', x, sy, 0.2, 1);
        if (Math.random() < 0.85) this.part({ kind: 'spark', x: x + rand(-0.06, 0.06), y: sy, vx: rand(-0.4, 0.4), vy: rand(-1.4, -0.4), gr: 1, drag: 2, life: rand(0.25, 0.5), size: rand(0.06, 0.13), col: 'l' });
        break;
      }
      case 'sweep': {
        const lx = -0.4 + 7.8 * E.io(k), bob = Math.sin(el / 90) * 0.04;
        const gr = g.createLinearGradient(lx - 3, 0, lx, 0);
        gr.addColorStop(0, 'rgba(255,190,100,0)'); gr.addColorStop(1, 'rgba(255,214,140,.35)');
        g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(Math.max(0, lx - 3), y - 0.48, Math.min(3, lx), 0.96);
        this.glow(g, 'l', lx, y + bob, 1.3, 0.9);
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = Math.min(1, k * 6);
        lanternAt(g, lx, y + bob, 1.5);
        break;
      }
      case 'beams': {
        const a = E.out(k), r = 0.95 - 0.4 * a;
        g.globalAlpha = 0.55 * a; g.fillStyle = '#ffd28a';
        g.fillRect(0, y - 0.02, W, 0.04); g.fillRect(x - 0.02, 0, 0.04, H);
        g.globalAlpha = a; g.strokeStyle = '#ffe7a8'; g.lineWidth = 0.05;
        g.save(); g.translate(x, y); g.rotate(el / 300);
        for (let q = 0; q < 4; q++) { g.rotate(Math.PI / 2); g.beginPath(); g.moveTo(r, r - 0.22); g.lineTo(r, r); g.lineTo(r - 0.22, r); g.stroke(); }
        g.restore();
        break;
      }
      case 'prism': {
        for (let q = 0; q < 6; q++) {
          g.globalAlpha = 0.8 * Math.sin(Math.PI * k); g.strokeStyle = `hsl(${q * 60 + el * 0.5},100%,65%)`; g.lineWidth = 0.08;
          g.beginPath(); g.arc(x, y, 0.4 + 0.5 * k, (q * Math.PI) / 3 + el / 150, (q * Math.PI) / 3 + el / 150 + 0.8); g.stroke();
        }
        g.globalAlpha = 1; g.save(); g.translate(x, y); g.rotate(el / 120); g.drawImage(this.star, -0.5, -0.5, 1, 1); g.restore();
        this.glow(g, 'w', x, y, 0.5 + 0.3 * k, 0.8);
        break;
      }
      case 'volt': {
        const col = this.lookAt(f.i);
        this.glow(g, col, x, y, 0.4 + 0.5 * k, 0.9);
        if (!f.paths || t - f.pt > 70) {
          f.pt = t;
          f.paths = [0, 1, 2].map(() => { const a = rand(0, 6.283), b = a + rand(-1, 1), r = 0.3 + 0.4 * k; return jag(x + Math.cos(a) * 0.2, y + Math.sin(a) * 0.2, x + Math.cos(b) * r, y + Math.sin(b) * r, 0.4, 3); });
        }
        this.strokePaths(g, f.paths, tint(col), 0.08, 0.5);
        this.strokePaths(g, f.paths, '#ffffff', 0.025, 1);
        break;
      }
      case 'hat': {
        const s = E.elastic(Math.min(1, k * 1.7)), tilt = k > 0.5 ? -0.55 * E.out((k - 0.5) / 0.5) : 0, hy = 2.9 - 0.25 * E.out(k);
        this.glow(g, 'l', 3.5, hy, 1.4 * s, 0.6);
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
        hatAt(g, 3.5, hy, 1.2 * s, tilt);
        if (k > 0.5 && f.conv.length && Math.random() < 0.9) {
          const j = f.conv[(Math.random() * f.conv.length) | 0], tx = colOf(j) + 0.5, ty = rowOf(j) + 0.5, d = 0.35;
          this.part({ kind: 'star', x: 3.3, y: hy - 0.3, vx: (tx - 3.3) / d, vy: (ty - hy + 0.3) / d, gr: 0, drag: 0, life: d, size: rand(0.1, 0.16), col: 'l' });
        }
        break;
      }
    }
  },
  hammer(g, f, k, t) {
    const el = t - f.t0, x = colOf(f.i) + 0.5, y = rowOf(f.i) + 0.5, L = 1.6, dir = colOf(f.i) >= 4 ? -1 : 1, th1 = -1.25, th0 = 0.2;
    const sw = clamp(el / f.hit, 0, 1), back = el > f.hit ? Math.sin(clamp((el - f.hit) / 170, 0, 1) * Math.PI) * 0.16 : 0;
    const th = (th0 + (th1 - th0) * E.in(sw) + back) * dir, a = el > f.hit ? clamp(1 - (el - f.hit) / (f.dur - f.hit), 0, 1) : clamp(el / 80, 0, 1);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = a;
    g.save(); g.translate(x - dir * L * Math.sin(th1), y + L * Math.cos(th1)); g.rotate(th);
    const hg = g.createLinearGradient(-0.06, 0, 0.06, 0);
    hg.addColorStop(0, '#4a2e14'); hg.addColorStop(0.5, '#b07a42'); hg.addColorStop(1, '#4a2e14');
    g.fillStyle = hg; rrect(g, -0.065, -L, 0.13, L + 0.14, 0.06); g.fill();
    g.translate(0, -L);
    const mg = g.createLinearGradient(0, -0.21, 0, 0.21);
    mg.addColorStop(0, '#eef2f7'); mg.addColorStop(0.45, '#8b95a5'); mg.addColorStop(1, '#3c4350');
    g.fillStyle = mg; rrect(g, -0.44, -0.21, 0.88, 0.42, 0.07); g.fill();
    g.fillStyle = '#c49a52'; g.fillRect(-0.16, -0.22, 0.07, 0.44); g.fillRect(0.09, -0.22, 0.07, 0.44);
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 0.025; rrect(g, -0.44, -0.21, 0.88, 0.42, 0.07); g.stroke();
    g.restore();
    const kk = (el - f.hit) / 320;
    if (kk >= 0 && kk < 1) {
      g.globalCompositeOperation = 'lighter';
      this.glow(g, 'w', x, y, 0.8 + kk * 0.7, 1 - kk);
      if (!f.cracks) f.cracks = Array.from({ length: 6 }, (_, q) => { const an = (q / 6) * 6.283 + rand(-0.3, 0.3); return jag(x, y, x + Math.cos(an) * 0.6, y + Math.sin(an) * 0.6, 0.3, 2); });
      this.strokePaths(g, f.cracks, '#ffffff', 0.03, 1 - kk);
    }
  },
  vortex(g, f, k, t) {
    for (let q = 0; q < 3; q++) {
      g.globalAlpha = Math.sin(Math.PI * k) * 0.45; g.strokeStyle = q === 1 ? '#9fc8ff' : '#ffd28a'; g.lineWidth = 0.12;
      const a = (t - f.t0) / 160 + q * 2.1;
      g.beginPath(); g.arc(f.x, f.y, 1 + q * 1.1, a, a + 1.3); g.stroke();
    }
    this.glow(g, 'l', f.x, f.y, 2.5, Math.sin(Math.PI * k) * 0.4);
  },
};

/* ───────────── the tray ─────────────
   Pre-rendered at the canvas size: the back (shadow, brass rim, midnight
   glass, cell checker, lamp glow, vignette) and the front (inner shadow
   and a sheen over the gems).                                         */
function renderBack({ dpr, w, h, ox, oy, size, pad, cs }) {
  const c = canvas(w * dpr, h * dpr), g = c.getContext('2d'), r = size * 0.05, tx = ox + pad, ty = oy + pad, ts = size - 2 * pad;
  g.scale(dpr, dpr);
  g.save();
  g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = size * 0.045 * dpr; g.shadowOffsetY = size * 0.018 * dpr;
  rrect(g, ox, oy, size, size, r);
  const br = g.createLinearGradient(ox, oy, ox + size, oy + size);
  br.addColorStop(0, '#f6e2a8'); br.addColorStop(0.28, '#c49a52'); br.addColorStop(0.5, '#8a6a33'); br.addColorStop(0.74, '#d9b46c'); br.addColorStop(1, '#6e5022');
  g.fillStyle = br; g.fill();
  g.restore();
  rrect(g, ox + 1, oy + 1, size - 2, size - 2, r - 1); g.strokeStyle = 'rgba(255,244,214,.6)'; g.lineWidth = 1.2; g.stroke();
  rrect(g, ox + pad * 0.42, oy + pad * 0.42, size - pad * 0.84, size - pad * 0.84, r * 0.8);
  g.strokeStyle = 'rgba(70,46,12,.5)'; g.lineWidth = Math.max(1, pad * 0.1); g.stroke();
  rrect(g, tx, ty, ts, ts, r * 0.6);
  const tg = g.createLinearGradient(0, ty, 0, ty + ts);
  tg.addColorStop(0, '#17213c'); tg.addColorStop(0.55, '#0b1122'); tg.addColorStop(1, '#05070f');
  g.fillStyle = tg; g.fill();
  g.save(); g.clip();
  const lamp = g.createRadialGradient(tx + ts / 2, ty + ts * 0.1, 0, tx + ts / 2, ty + ts * 0.1, ts * 0.85);
  lamp.addColorStop(0, 'rgba(255,192,112,.24)'); lamp.addColorStop(1, 'rgba(255,192,112,0)');
  g.fillStyle = lamp; g.fillRect(tx, ty, ts, ts);
  const cool = g.createRadialGradient(tx + ts / 2, ty + ts * 1.05, 0, tx + ts / 2, ty + ts * 1.05, ts * 0.7);
  cool.addColorStop(0, 'rgba(70,120,230,.16)'); cool.addColorStop(1, 'rgba(70,120,230,0)');
  g.fillStyle = cool; g.fillRect(tx, ty, ts, ts);
  for (let i = 0; i < N; i++) {
    const x = tx + colOf(i) * cs + cs * 0.045, y = ty + rowOf(i) * cs + cs * 0.045, s = cs * 0.91;
    rrect(g, x, y, s, s, cs * 0.14);
    g.fillStyle = (rowOf(i) + colOf(i)) % 2 ? 'rgba(160,190,255,.065)' : 'rgba(255,232,196,.045)'; g.fill();
    g.beginPath(); g.moveTo(x + cs * 0.14, y + 0.5); g.lineTo(x + s - cs * 0.14, y + 0.5);
    g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1; g.stroke();
  }
  const vig = g.createRadialGradient(tx + ts / 2, ty + ts / 2, ts * 0.3, tx + ts / 2, ty + ts / 2, ts * 0.78);
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.42)');
  g.fillStyle = vig; g.fillRect(tx, ty, ts, ts);
  g.restore();
  return c;
}
function renderFront({ dpr, w, h, ox, oy, size, pad, cs }) {
  const c = canvas(w * dpr, h * dpr), g = c.getContext('2d'), r = size * 0.03, tx = ox + pad, ty = oy + pad, ts = size - 2 * pad;
  g.scale(dpr, dpr);
  g.save();
  rrect(g, tx, ty, ts, ts, r); g.clip();
  g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = cs * 0.3 * dpr; g.shadowOffsetY = cs * 0.06 * dpr;
  rrect(g, tx, ty, ts, ts, r); g.rect(tx - ts, ty - ts, ts * 3, ts * 3);
  g.fillStyle = '#000'; g.fill('evenodd');
  g.shadowColor = 'transparent';
  const sheen = g.createLinearGradient(tx, ty, tx + ts * 0.7, ty + ts * 0.7);
  sheen.addColorStop(0, 'rgba(255,255,255,.08)'); sheen.addColorStop(0.42, 'rgba(255,255,255,.025)'); sheen.addColorStop(0.43, 'rgba(255,255,255,0)');
  g.fillStyle = sheen; g.fillRect(tx, ty, ts, ts);
  g.restore();
  rrect(g, tx - 0.5, ty - 0.5, ts + 1, ts + 1, r); g.strokeStyle = 'rgba(255,236,190,.38)'; g.lineWidth = 1; g.stroke();
  return c;
}

/** Midpoint displacement: a jagged lightning path from (x0, y0) to (x1, y1). */
function jag(x0, y0, x1, y1, rough = 0.22, levels = 4) {
  let pts = [[x0, y0], [x1, y1]], off = Math.hypot(x1 - x0, y1 - y0) * rough;
  for (let l = 0; l < levels; l++) {
    const nx = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = by - ay, dy = ax - bx, d = Math.hypot(dx, dy) || 1, o = (Math.random() - 0.5) * off;
      nx.push(pts[i], [(ax + bx) / 2 + (dx / d) * o, (ay + by) / 2 + (dy / d) * o]);
    }
    nx.push(pts[pts.length - 1]); pts = nx; off /= 2;
  }
  return pts;
}
/** A jagged path plus a fork or two, for a branching bolt. */
function forked(x0, y0, x1, y1, rough = 0.22) {
  const main = jag(x0, y0, x1, y1, rough), out = [main], len = Math.hypot(x1 - x0, y1 - y0);
  for (let k = 0; k < (len > 1.5 ? 2 : 1); k++) {
    const p = main[2 + ((Math.random() * (main.length - 4)) | 0)], a = Math.atan2(y1 - y0, x1 - x0) + rand(-1.1, 1.1), l = rand(0.25, 0.55) * Math.min(2, len);
    out.push(jag(p[0], p[1], p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l, 0.3, 3));
  }
  return out;
}

/* ───────────── the board ───────────── */
const EVENTS = [['pointerdown', 'down'], ['pointermove', 'move'], ['pointerup', 'up'], ['pointercancel', 'up'], ['pointerleave', 'leave']];

export class M3Board {
  constructor(host, { sfx = null, onSwap = () => {}, onTap = () => {}, onBusy = () => {} } = {}) {
    Object.assign(this, { host, sfx, onSwap, onTap, onBusy });
    this.seat = 0; this.mode = 'off'; this.opts = {};
    this.cells = Array(N).fill(null); // the board as it stands: { id, c, s, tmp }
    this.vis = new Map();             // id -> how that gem is drawn right now
    this.fx = []; this.parts = []; this.texts = []; this.flights = []; this.oparts = []; this.twinkles = []; this.flashes = [];
    this.sel = -1; this.hover = -1; this.press = null; this.pending = null; this.hintPair = null; this.lockUntil = 0;
    this.targets = { score: [], charge: [] };
    this.speed = 1; this.skip = false; this.animating = false; this.busyNow = false;
    this.waiters = new Set(); this.timers = new Set(); this.queue = Promise.resolve();
    this.shake = null; this.sprites = new Map(); this.ovDirty = false; this.nextTwinkle = 0;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.glows = Object.fromEntries([...GEMS.map((g, k) => [k, glowSprite(g.glow)]), ['w', glowSprite('#cfe4ff', 0.4)], ['l', glowSprite('#ffc878')]]);
    this.star = starSprite();

    this.cv = canvas(1, 1);
    Object.assign(this.cv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', touchAction: 'none', userSelect: 'none', webkitUserSelect: 'none', webkitTapHighlightColor: 'transparent' });
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.append(this.cv);
    this.g = this.cv.getContext('2d');
    this.ov = canvas(1, 1);
    Object.assign(this.ov.style, { position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '9000' });
    document.body.append(this.ov);
    this.og = this.ov.getContext('2d');

    this.on = {
      down: e => this.down(e), move: e => this.move(e), up: e => this.up(e),
      leave: e => { if (e.pointerType === 'mouse') this.hover = -1; },
      vis: () => { if (document.hidden) this.flush(); },
      resize: () => this.sizeOverlay(),
    };
    for (const [k, f] of EVENTS) this.cv.addEventListener(k, this.on[f]);
    document.addEventListener('visibilitychange', this.on.vis);
    window.addEventListener('resize', this.on.resize);
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(host);
    this.layout(); this.sizeOverlay();
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }
  get reduced() { return this.motion.matches; }

  /* ───── public ───── */
  setView(seat) { this.seat = seat === 1 ? 1 : 0; }
  setBoard(cells) {
    this.pending = null; this.sel = -1; this.vis.clear();
    this.cells = Array.from({ length: N }, (_, i) => (cells[i] ? { ...cells[i] } : null));
    this.cells.forEach((p, i) => p && this.vis.set(p.id, this.mkVis(p, i)));
    this.setBusy();
  }
  setInput(mode, opts = {}) {
    this.mode = mode === 'swap' || mode === 'target' ? mode : 'off';
    this.opts = opts || {};
    if (this.mode !== 'swap') this.sel = -1;
    this.press = null;
    this.cv.style.cursor = this.mode === 'off' ? 'default' : this.mode === 'target' ? 'crosshair' : 'pointer';
  }
  setTargets({ score = [], charge = [] } = {}) { this.targets = { score, charge }; }
  hint(pair) { this.hintPair = Array.isArray(pair) && pair.length === 2 ? pair.slice() : null; this.hintT = now(); }
  /** Plays one server event from the board shown now; the board ends exactly on `final`. */
  play(ev, final, opts) {
    const run = this.queue.then(() => this.run(ev, final, opts || {}));
    this.queue = run.catch(() => {});
    return run;
  }
  /** The server turned down the swap we already showed: slide it back. */
  /** The server refused the swap we started: slide it back. Returns false if there was none. */
  cancelPending() {
    const p = this.pending;
    if (!p) return false;
    this.pending = null;
    this.slide(p.a, p.b, 260, 'back');
    this.lockUntil = now() + 260;
    this.sfx?.bad();
    this.setBusy();
    return true;
  }
  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.flush();
    for (const [k, f] of EVENTS) this.cv.removeEventListener(k, this.on[f]);
    document.removeEventListener('visibilitychange', this.on.vis);
    window.removeEventListener('resize', this.on.resize);
    this.cv.remove(); this.ov.remove();
    this.vis.clear(); this.sprites.clear(); this.flights = []; this.oparts = [];
  }

  /* ───── sizing ───── */
  layout() {
    const r = this.host.getBoundingClientRect(), w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
    if ((w === this.w && h === this.h && dpr === this.dpr) || Math.min(w, h) < 40) return;
    const size = Math.min(w, h) - 2 * Math.max(3, Math.min(w, h) * 0.014), pad = size * 0.034;
    Object.assign(this, { w, h, dpr, size, pad, ox: (w - size) / 2, oy: (h - size) / 2, cs: (size - 2 * pad) / W });
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this.sprites.clear();
    this.back = renderBack(this); this.front = renderFront(this);
  }
  sizeOverlay() {
    const d = Math.min(DPR_MAX, window.devicePixelRatio || 1);
    this.ov.width = Math.round(innerWidth * d); this.ov.height = Math.round(innerHeight * d); this.odpr = d;
  }
  sprite(look, s) {
    const key = look + (s || '');
    let sp = this.sprites.get(key);
    if (!sp) this.sprites.set(key, (sp = gemSprite(GEMS[look], s, this.cs * this.dpr)));
    return sp;
  }
  look(c) { return c === this.seat ? 0 : c === 1 - this.seat ? 1 : clamp(c | 0, 0, 5); }
  /** Board (cell units) to the page's viewport. */
  toView(x, y) {
    const r = this.cv.getBoundingClientRect();
    return [r.left + this.ox + this.pad + x * this.cs, r.top + this.oy + this.pad + y * this.cs];
  }

  /* ───── input ───── */
  pt(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  /** The cell under a point; a little slack around the board keeps the edge cells easy to hit. */
  cellOf({ x, y }, slack = 0.35) {
    const cx = (x - this.ox - this.pad) / this.cs, cy = (y - this.oy - this.pad) / this.cs;
    if (cx < -slack || cy < -slack || cx >= W + slack || cy >= H + slack) return -1;
    return clamp(Math.floor(cy), 0, H - 1) * W + clamp(Math.floor(cx), 0, W - 1);
  }
  locked() { return this.animating || !!this.pending || now() < this.lockUntil; }
  down(e) {
    if (e.button > 0 || this.mode === 'off' || this.locked()) return;
    const p = this.pt(e), i = this.cellOf(p);
    if (i < 0) { this.sel = -1; return; }
    try { this.cv.setPointerCapture(e.pointerId); } catch { /* a synthetic or already-gone pointer */ }
    if (this.mode === 'target') { this.press = { id: e.pointerId, i, target: true }; return; }
    this.hintPair = null;
    if (this.sel >= 0 && this.sel !== i && adjacent(this.sel, i)) { const a = this.sel; this.sel = -1; this.trySwap(a, i); return; }
    this.press = { id: e.pointerId, i, x: p.x, y: p.y, dx: 0, dy: 0, was: this.sel === i };
    if (this.sel !== i) { this.sel = i; this.sfx?.select(); }
  }
  move(e) {
    const p = this.pt(e), pr = this.press;
    if (e.pointerType === 'mouse' && !pr) this.hover = this.mode === 'off' ? -1 : this.cellOf(p, 0);
    if (!pr || pr.id !== e.pointerId) return;
    if (pr.target) { const i = this.cellOf(p); if (i >= 0) pr.i = i; return; }
    pr.dx = (p.x - pr.x) / this.cs; pr.dy = (p.y - pr.y) / this.cs;
    if (Math.max(Math.abs(pr.dx), Math.abs(pr.dy)) < 0.3) return;
    const r = rowOf(pr.i), c = colOf(pr.i);
    const j = Math.abs(pr.dx) > Math.abs(pr.dy)
      ? (pr.dx > 0 ? (c < W - 1 ? pr.i + 1 : -1) : (c > 0 ? pr.i - 1 : -1))
      : (pr.dy > 0 ? (r < H - 1 ? pr.i + W : -1) : (r > 0 ? pr.i - W : -1));
    this.press = null; this.sel = -1;
    if (j >= 0) this.trySwap(pr.i, j);
  }
  up(e) {
    const pr = this.press;
    if (!pr || pr.id !== e.pointerId) return;
    this.press = null;
    if (pr.target) { if (e.type === 'pointerup' && this.mode === 'target' && !this.locked()) this.onTap(pr.i); return; }
    if (pr.was && e.type === 'pointerup') this.sel = -1; // a second tap on the same gem lets it go
  }
  trySwap(a, b) {
    this.sel = -1; this.hintPair = null;
    if (!this.cells[a] || !this.cells[b]) return;
    if (!canSwap(this.cells, a, b)) {
      this.nudge(a, b); this.nudge(b, a);
      this.lockUntil = now() + 300;
      this.sfx?.bad();
      return;
    }
    this.pending = { a, b, t0: now() };
    this.slide(a, b, TIMING.swap);
    this.sfx?.swap();
    this.setBusy();
    this.onSwap(a, b);
  }
  setBusy() {
    const b = this.animating || !!this.pending;
    if (b !== this.busyNow) { this.busyNow = b; this.onBusy(b); }
  }

  /* ───── gems in motion ─────
     A drawn gem rests at (col, row); `mv` brings it there from elsewhere.
     Times are absolute (performance.now), already divided by the speed. */
  mkVis(p, i) {
    return { id: p.id, c: p.c, s: p.s || '', tmp: p.tmp, col: colOf(i), row: rowOf(i), mv: null, pop: null, fade: null, born: 0, landT: 0, ghost: null, rc: null, flashT: 0, ph: Math.random() * 6.283 };
  }
  posOf(v, t) {
    const m = v.mv;
    if (!m) return [v.col, v.row];
    const k = clamp((t - m.t0) / m.dur, 0, 1);
    if (k >= 1) { v.mv = null; if (m.kind === 'fall') v.landT = m.t0 + m.dur; return [v.col, v.row]; }
    if (m.kind === 'nudge') { const o = Math.sin(Math.PI * k) * 0.36; return [m.fc + (m.tc - m.fc) * o, m.fr + (m.tr - m.fr) * o]; }
    if (m.kind === 'swirl') {
      const e = E.io(k), a = m.a0 + m.da * e, r = (m.r0 + (m.r1 - m.r0) * e) * (1 - 0.5 * Math.sin(Math.PI * e));
      return [3 + Math.cos(a) * r, 3 + Math.sin(a) * r];
    }
    const e = (m.kind === 'fall' || m.kind === 'merge' ? E.in : E[m.kind] || E.io)(k);
    return [m.fc + (v.col - m.fc) * e, m.fr + (v.row - m.fr) * e];
  }
  /** Slides the gems at a and b into each other's place (and swaps them on the board). */
  slide(a, b, ms, kind = 'io') {
    const t = now(), A = this.cells[a], B = this.cells[b];
    [this.cells[a], this.cells[b]] = [B, A];
    for (const [p, to] of [[A, b], [B, a]]) {
      const v = p && this.vis.get(p.id);
      if (!v) continue;
      const [fc, fr] = this.posOf(v, t);
      Object.assign(v, { col: colOf(to), row: rowOf(to), mv: { kind, fc, fr, t0: t, dur: ms } });
    }
  }
  /** Half a slide toward the neighbour and back: not a legal move. */
  nudge(a, b) {
    const v = this.cells[a] && this.vis.get(this.cells[a].id);
    if (v) v.mv = { kind: 'nudge', fc: colOf(a), fr: rowOf(a), tc: colOf(b), tr: rowOf(b), t0: now(), dur: 280 };
  }

  /* ───── the schedule ─────
     `beat(ms)` waits a stretch of the shared schedule (divided by the
     speed); `at(ms, fn)` runs a cosmetic step later. A hidden tab skips
     both, and the event ends by snapping to the final board.          */
  beat(ms) { return this.wait(ms / this.speed); }
  wait(ms) {
    if (this.skip || ms <= 0) return Promise.resolve();
    return new Promise(res => {
      const w = { res, id: setTimeout(() => { this.waiters.delete(w); res(); }, ms) };
      this.waiters.add(w);
    });
  }
  at(ms, fn) {
    if (this.skip) return;
    if (ms <= 0) { fn(); return; }
    const id = setTimeout(() => { this.timers.delete(id); if (!this.skip && !this.dead) fn(); }, ms / this.speed);
    this.timers.add(id);
  }
  flush() {
    if (this.animating) this.skip = true;
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    for (const w of this.waiters) { clearTimeout(w.id); w.res(); }
    this.waiters.clear();
    this.fx = []; this.parts = []; this.texts = []; this.flashes = []; this.shake = null;
  }

  /* ───── playback ───── */
  async run(ev, final, { speed = 1 }) {
    this.speed = clamp(+speed || 1, 0.25, 8);
    this.skip = document.hidden;
    this.animating = true; this.sel = -1; this.press = null; this.hintPair = null;
    this.setBusy();
    try {
      if (ev && !this.skip) await this.animate(ev);
    } catch (err) {
      console.error('m3board', err);
    } finally {
      if (this.skip) this.flush();
      this.pending = null;
      if (Array.isArray(final)) this.reconcile(final);
      this.animating = false; this.skip = false;
      this.setBusy();
    }
  }
  async animate(ev) {
    const T = TIMING, p = this.pending;
    const mine = p && ev.type === 'swap' && ((p.a === ev.a && p.b === ev.b) || (p.a === ev.b && p.b === ev.a));
    if (p && !mine) this.slide(p.a, p.b, 1); // something else came first: put our swap back
    this.pending = null;
    if (ev.type === 'swap') {
      if (mine) await this.wait(p.t0 + T.swap - now());
      else { this.slide(ev.a, ev.b, T.swap / this.speed); this.sfx?.swap(); await this.beat(T.swap); }
    } else if (ev.type === 'boost' || (ev.type === 'perk' && ev.kind === 'hammer')) await this.intro(ev);
    else if (ev.type === 'perk' && ev.shuffle) await this.swirl(ev.shuffle, PERKS.shuffle.name);
    const waves = ev.waves || [];
    for (let n = 0; n < waves.length; n++) await this.wave(waves[n], n, ev);
    if (ev.extra) { this.banner('Extra move!', 'extra'); this.sfx?.extra(); }
    if (ev.ready) this.readySoon(ev.seat);
    if (ev.fade && ev.fade.length) await this.fadeTemps(ev.fade);
    if (ev.reshuffle) await this.swirl(ev.reshuffle, 'No moves left: reshuffle');
  }
  /** The booster (or hammer) shows itself before its wave. */
  async intro(ev) {
    const T = TIMING, key = ev.type === 'boost' ? ev.key : 'hammer', t = now(), d = T.intro / this.speed, w0 = (ev.waves || [])[0];
    const i = Number.isInteger(ev.target) ? ev.target : w0 && w0.fx[0] ? w0.fx[0].i : 24;
    this.banner((BOOSTERS[key] || PERKS[key] || {}).name || '', 'boost');
    if (key === 'hammer') {
      this.fx.push({ k: 'hammer', i, t0: t, dur: d * 1.6, hit: d * 0.82 });
      this.at(T.intro * 0.82, () => {
        this.sfx?.hammer(); this.kick(0.1, 240);
        this.burst(colOf(i) + 0.5, rowOf(i) + 0.5, 'l', 1.3, 16); this.flash('l', 0.35);
      });
    } else {
      this.sfx?.boost(key);
      this.fx.push({ k: 'intro', key, i, t0: t, dur: d, conv: w0 ? w0.conv.map(c => c[0]) : [] });
    }
    await this.beat(T.intro);
  }
  async wave(w, n, ev) {
    const T = TIMING;
    if (w.conv.length) { this.convert(w, ev); await this.beat(T.conv); }
    if (w.removed.length) { this.clears(w, n, ev); await this.beat(T.clear + Math.max(0, ...w.removed.map(x => x.d)) * T.depth); }
    if (w.fall.length || w.spawn.length) { this.drop(w); await this.beat(T.fall); }
    await this.beat(T.gap);
  }
  lookAt(i) { const p = this.cells[i]; return p ? this.look(p.c) : 'w'; }
  /** Pieces turning special in place: a bolt's arcs (bolt + arrow/bomb) or the Trick Hat's sparkle. */
  convert(w, ev) {
    const T = TIMING, src = w.fx.find(f => f.k === 'boltarrow' || f.k === 'boltbomb'), hat = ev.type === 'boost' && ev.key === 'hat';
    if (src) {
      this.fx.push({ k: 'zap', x: colOf(src.i) + 0.5, y: rowOf(src.i) + 0.5, pts: w.conv.map(([i]) => [colOf(i) + 0.5, rowOf(i) + 0.5]), reach: w.conv.map((_, k) => k * 40 / this.speed), col: this.lookAt(src.i), t0: now(), dur: (T.conv * 0.85) / this.speed });
      this.sfx?.bolt();
    }
    w.conv.forEach(([i, s], k) => {
      const p = this.cells[i];
      if (!p) return;
      p.s = s;
      if (hat) p.tmp = ev.seat;
      const v = this.vis.get(p.id);
      if (!v) return;
      this.at(T.conv * (src ? 0.3 + k * 0.04 : 0.15 + k * 0.2), () => {
        Object.assign(v, { s, tmp: p.tmp, born: now(), flashT: now() });
        this.burst(v.col + 0.5, v.row + 0.5, hat ? 'l' : this.look(v.c), 0.9, hat ? 14 : 8, true);
        if (!src || k === 0) this.sfx?.special(hat ? 'hat' : s);
      });
    });
  }
  /** When an effect fired at f.i reaches cell j: ms of the schedule, within one depth step. */
  reach(f, j) {
    const D = TIMING.depth, dc = Math.abs(colOf(j) - colOf(f.i)), dr = Math.abs(rowOf(j) - rowOf(f.i));
    switch (f.k) {
      case 'h': case 'v': case 'cross': case 'rows3': case 'cols3': case 'beams': return D * 0.9 * Math.min(1, Math.max(dc, dr) / 6);
      case 'sweep': return D * 0.9 * (colOf(j) / 6);
      case 'bomb': case 'bomb2': case 'ember': return D * 0.3 * Math.max(dc, dr);
      case 'prism': return D * 0.85 * Math.min(1, Math.hypot(dc, dr) / 8);
      case 'bolt': case 'bolt2': case 'volt': { const o = this.order(f), k = o.indexOf(j); return k < 0 ? 0 : D * 0.9 * (k / Math.max(1, o.length - 1)); }
      default: return 0;
    }
  }
  /** The order an effect visits its cells in (a volt arc hops from near to far). */
  order(f) {
    if (!f.ord) f.ord = f.k === 'volt' ? f.cells.slice().sort((a, b) => Math.hypot(colOf(a) - colOf(f.i), rowOf(a) - rowOf(f.i)) - Math.hypot(colOf(b) - colOf(f.i), rowOf(b) - rowOf(f.i))) : f.cells;
    return f.ord;
  }
  /** Matched pieces that slide into the special they make (or a combo's moving piece into its partner). */
  mergers(w, n, ev) {
    const out = new Map(), rem = new Map(w.removed.map(x => [x.i, x]));
    for (const m of w.made) {
      const seen = new Set([m.i]), stack = [m.i];
      while (stack.length) {
        for (const j of nbrs(stack.pop())) {
          const x = rem.get(j);
          if (x && !seen.has(j) && x.d === 0 && x.c === m.c && !x.s) { seen.add(j); stack.push(j); }
        }
      }
      for (const i of seen) { const x = rem.get(i); if (x && !x.s) out.set(x.id, m.i); }
    }
    if (n === 0 && ev.type === 'swap' && ev.combo && rem.has(ev.a)) out.set(rem.get(ev.a).id, ev.b);
    return out;
  }
  /** Which collected pieces fly off the board, and where: own colour to the booster meter, the rest to the score. */
  flightPlan(w, ev) {
    const out = new Map(), seat = ev.seat;
    if (seat !== 0 && seat !== 1) return out;
    const shown = el => el && el.isConnected && el.getClientRects().length > 0;
    const ch = this.targets.charge && this.targets.charge[seat], sc = this.targets.score && this.targets.score[seat];
    const mine = w.removed.filter(x => x.c === seat).slice(0, this.reduced ? 3 : 9), rest = w.removed.filter(x => x.c !== seat);
    if (shown(ch)) mine.forEach((x, k) => out.set(x.id, { el: ch, charge: true, frac: (k + 1) / mine.length }));
    const cap = this.reduced ? 4 : 14, step = Math.max(1, Math.ceil(rest.length / cap));
    if (shown(sc)) rest.forEach((x, k) => { if (k % step === 0) out.set(x.id, { el: sc }); });
    return out;
  }
  /** Connected groups of cleared cells, biggest first, for the +N popups. */
  clusters(removed) {
    const left = new Map(removed.map(x => [x.i, x])), out = [];
    for (const x of removed) {
      if (!left.has(x.i)) continue;
      const group = [x], stack = [x.i];
      left.delete(x.i);
      while (stack.length) for (const j of nbrs(stack.pop())) if (left.has(j)) { group.push(left.get(j)); left.delete(j); stack.push(j); }
      out.push(group);
    }
    return out.sort((a, b) => b.length - a.length);
  }
  clears(w, n, ev) {
    const T = TIMING, t = now(), sp = this.speed;
    const dOf = new Map(w.removed.map(x => [x.i, x.d])), when = new Map(w.removed.map(x => [x.i, x.d * T.depth]));
    for (const f of w.fx) for (const j of f.cells || []) if (dOf.get(j) === f.d + 1) when.set(j, Math.min(when.get(j), f.d * T.depth + this.reach(f, j)));
    const merge = this.mergers(w, n, ev), plan = this.flightPlan(w, ev);
    for (const x of w.removed) {
      const v = this.vis.get(x.id);
      if (!v) continue;
      const ms = when.get(x.i), fl = plan.get(x.id);
      v.top = true;
      if (merge.has(x.id)) {
        const to = merge.get(x.id), fc = v.col, fr = v.row;
        Object.assign(v, { col: colOf(to), row: rowOf(to), mv: { kind: 'merge', fc, fr, t0: t + ms / sp, dur: (T.clear * 0.55) / sp }, fade: { t0: t + ms / sp, dur: (T.clear * 0.6) / sp } });
        this.at(ms + T.clear * 0.6, () => { this.vis.delete(x.id); if (fl) this.fly(v, fl); });
      } else {
        v.pop = { t0: t + ms / sp, dur: (T.clear * 0.45) / sp };
        this.at(ms + T.clear * 0.45, () => { this.shatter(v); this.vis.delete(x.id); if (fl) this.fly(v, fl); });
      }
    }
    for (const d of new Set(w.removed.map(x => x.d))) this.at(d * T.depth, () => this.sfx?.match(n + d));
    for (const f of w.fx) this.at(f.d * T.depth, () => this.fire(f, w));
    for (const m of w.made) {
      this.at(T.clear * 0.6, () => {
        const v = this.mkVis(m, m.i), x = colOf(m.i) + 0.5, y = rowOf(m.i) + 0.5;
        Object.assign(v, { born: now(), flashT: now() });
        this.vis.set(m.id, v);
        this.ring(x, y, this.look(m.c), 1.5, 420); this.burst(x, y, this.look(m.c), 1, 12, true);
        this.sfx?.special(m.s);
      });
    }
    // +N for each match of three or more; whatever an effect took in ones and twos, together where it went off
    const mid = list => [list.reduce((a, q) => a + colOf(q.i), 0) / list.length + 0.5, list.reduce((a, q) => a + rowOf(q.i), 0) / list.length + 0.5];
    const popup = (list, [x, y]) => {
      const ms = list.reduce((a, q) => a + when.get(q.i), 0) / list.length + T.clear * 0.4;
      this.texts.push({ kind: 'pts', s: '+' + list.length, x, y, n, t0: t + ms / sp, dur: 950 / Math.min(sp, 2) });
    };
    const groups = this.clusters(w.removed), big = groups.filter(g => g.length >= 3).slice(0, 4), rest = groups.filter(g => !big.includes(g)).flat(), f0 = w.fx[0];
    big.forEach(g => popup(g, mid(g)));
    if (rest.length) popup(rest, f0 && f0.k !== 'sweep' ? [colOf(f0.i) + 0.5, rowOf(f0.i) + 0.5] : mid(rest));
    const word = n === 0 && ev.combo ? 'Combo!' : w.removed.length >= 20 ? 'Dazzling!' : n >= 1 ? CASCADE[Math.min(n, CASCADE.length) - 1] : w.removed.length >= 12 ? 'Brilliant!' : '';
    if (word) this.at(T.clear * 0.5 + Math.max(0, ...w.removed.map(x => x.d)) * T.depth, () => this.banner(word, n >= 1 ? 'cascade' : 'combo'));
    for (const x of w.removed) this.cells[x.i] = null;
    for (const m of w.made) this.cells[m.i] = { id: m.id, c: m.c, s: m.s };
  }
  /** An effect goes off: arrows, bombs, bolts, their combos, the boosters. */
  fire(f, w) {
    const x = colOf(f.i) + 0.5, y = rowOf(f.i) + 0.5, src = w.removed.find(r => r.i === f.i), col = src ? this.look(src.c) : 'l', t = now();
    const D = TIMING.depth / this.speed, life = (TIMING.depth + TIMING.clear * 0.7) / this.speed;
    const beam = (dir, o, wd, kind = 'beam') => this.fx.push({ k: kind, dir, x: dir === 'h' ? x : x + o, y: dir === 'h' ? y + o : y, wd, col, t0: t, dur: life, reach: D * 0.9 });
    const zap = big => this.fx.push({ k: 'zap', x, y, col, big, t0: t, dur: life * 1.15, pts: this.order(f).map(j => [colOf(j) + 0.5, rowOf(j) + 0.5]), reach: this.order(f).map(j => this.reach(f, j) / this.speed) });
    switch (f.k) {
      case 'h': case 'v': beam(f.k, 0, 0.5); this.sfx?.arrow(); break;
      case 'cross': beam('h', 0, 0.8); beam('v', 0, 0.8); this.burst(x, y, 'w', 1.4, 18); this.flash(col, 0.25); this.sfx?.combo(); this.sfx?.arrow(); break;
      case 'rows3': case 'cols3': for (const o of [-1, 0, 1]) beam(f.k === 'rows3' ? 'h' : 'v', o, 0.85); this.kick(0.08, 300); this.flash(col, 0.3); this.sfx?.combo(); this.sfx?.arrow(); break;
      case 'bomb': this.blast(x, y, col, 1.6); this.sfx?.bomb(false); break;
      case 'bomb2': this.blast(x, y, col, 2.8, true); this.flash('w', 0.45); this.sfx?.combo(); this.sfx?.bomb(true); break;
      case 'bolt': zap(false); this.sfx?.bolt(); break;
      case 'bolt2': zap(true); this.flash(col, 0.35); this.sfx?.combo(); this.sfx?.bolt(); break;
      case 'boltarrow': case 'boltbomb': this.blast(x, y, col, 1.2); this.flash(col, 0.3); this.sfx?.combo(); break;
      case 'ember': this.fx.push({ k: 'plus', x, y, t0: t, dur: life }); this.blast(x, y, 'l', 1.3); this.sfx?.bomb(false); break;
      case 'sweep': this.fx.push({ k: 'lantern', x: 0, y, t0: t, dur: life, reach: D * 0.9, from: 0.5 }); this.flash('l', 0.2); break;
      case 'beams': beam('h', 0, 0.75, 'laser'); beam('v', 0, 0.75, 'laser'); this.burst(x, y, 'w', 1.2, 14); this.kick(0.05, 200); break;
      case 'prism': this.fx.push({ k: 'rays', x, y, t0: t, dur: life * 1.2, pts: f.cells.map(j => [colOf(j) + 0.5, rowOf(j) + 0.5]), reach: f.cells.map(j => this.reach(f, j) / this.speed) }); this.flash('w', 0.25); break;
      case 'volt': this.fx.push({ k: 'hops', x, y, col, t0: t, dur: life * 1.2, pts: this.order(f).map(j => [colOf(j) + 0.5, rowOf(j) + 0.5]), reach: this.order(f).map(j => this.reach(f, j) / this.speed) }); this.sfx?.bolt(); break;
      case 'hammer': this.ring(x, y, 'l', 1.2, 380); break;
    }
  }
  drop(w) {
    const sp = this.speed, F = TIMING.fall / sp, t = now(), idx = new Map(), next = this.cells.slice();
    this.cells.forEach((p, i) => p && idx.set(p.id, i));
    for (const [id] of w.fall) if (idx.has(id)) next[idx.get(id)] = null;
    let first = Infinity;
    for (const [id, to] of w.fall) {
      if (!idx.has(id)) continue;
      next[to] = this.cells[idx.get(id)];
      const v = this.vis.get(id);
      if (!v) continue;
      const [fc, fr] = this.posOf(v, t), dur = F * Math.min(0.82, 0.4 + 0.15 * Math.sqrt(Math.max(0, rowOf(to) - fr)));
      Object.assign(v, { col: colOf(to), row: rowOf(to), top: false, mv: { kind: 'fall', fc, fr, t0: t, dur } });
      first = Math.min(first, dur);
    }
    const per = new Map();
    for (const s of w.spawn) per.set(colOf(s.i), (per.get(colOf(s.i)) || 0) + 1);
    for (const s of w.spawn) {
      const p = { id: s.id, c: s.c, s: s.s || '' }, c = colOf(s.i), dist = per.get(c) + 0.25;
      const v = this.mkVis(p, s.i), delay = F * 0.025 * c, dur = F * Math.min(0.82, 0.4 + 0.15 * Math.sqrt(dist));
      v.mv = { kind: 'fall', fc: c, fr: rowOf(s.i) - dist, t0: t + delay, dur };
      next[s.i] = p;
      this.vis.set(s.id, v);
      first = Math.min(first, delay + dur);
    }
    this.cells = next;
    if (first < Infinity) this.at(first * sp, () => this.sfx?.land());
  }
  /** Trick Hat specials that were not used go back to plain gems. */
  async fadeTemps(list) {
    const t = now();
    for (const i of list) {
      const p = this.cells[i];
      if (!p) continue;
      const v = this.vis.get(p.id);
      if (v && v.s) {
        Object.assign(v, { ghost: { s: v.s, t0: t, dur: TIMING.fade / this.speed }, s: '', tmp: undefined });
        this.puff(v.col + 0.5, v.row + 0.5);
      }
      p.s = ''; delete p.tmp;
    }
    await this.beat(TIMING.fade);
  }
  /** Every piece swirls around the middle to its new place (a shuffle, or a dead board rearranged). */
  async swirl({ moves = [], recolor = [] }, label) {
    const T = TIMING, t = now(), dur = (T.reshuffle * 0.9) / this.speed, rc = new Map(recolor), byId = new Map(), next = Array(N).fill(null);
    this.cells.forEach(p => p && byId.set(p.id, p));
    this.sfx?.shuffle();
    if (label) this.banner(label, 'info');
    for (const [id, to] of moves) {
      const p = byId.get(id);
      if (!p) continue;
      next[to] = p;
      if (rc.has(id)) p.c = rc.get(id);
      const v = this.vis.get(id);
      if (!v) continue;
      const [fc, fr] = this.posOf(v, t), tc = colOf(to), tr = rowOf(to), a0 = Math.atan2(fr - 3, fc - 3), a1 = Math.atan2(tr - 3, tc - 3);
      const da = ((a1 - a0 + 4 * Math.PI) % (2 * Math.PI)) + Math.PI * 0.6, delay = rand(0, 0.12) * dur;
      Object.assign(v, { col: tc, row: tr, top: false, mv: { kind: 'swirl', a0, da, r0: Math.hypot(fc - 3, fr - 3), r1: Math.hypot(tc - 3, tr - 3), t0: t + delay, dur: dur - delay } });
      if (rc.has(id)) v.rc = { t: t + delay + (dur - delay) * 0.5, c: p.c };
    }
    this.cells = next;
    this.fx.push({ k: 'vortex', x: 3.5, y: 3.5, t0: t, dur });
    await this.beat(T.reshuffle);
  }
  /** Snap to the server's board: keep every drawn gem that agrees, fix or replace the rest. */
  reconcile(final) {
    const keep = new Set();
    this.cells = Array.from({ length: N }, (_, i) => (final[i] ? { ...final[i] } : null));
    this.cells.forEach((p, i) => {
      if (!p) return;
      keep.add(p.id);
      const v = this.vis.get(p.id);
      if (!v) { this.vis.set(p.id, this.mkVis(p, i)); return; }
      if (v.col !== colOf(i) || v.row !== rowOf(i)) Object.assign(v, { col: colOf(i), row: rowOf(i), mv: null });
      Object.assign(v, { c: p.c, s: p.s || '', tmp: p.tmp, rc: null, pop: null, fade: null, top: false });
    });
    for (const id of [...this.vis.keys()]) if (!keep.has(id)) this.vis.delete(id);
  }
  /** The booster meter fills up: a jingle once the last gem has landed in it. */
  readySoon(seat) {
    const el = this.targets.charge && this.targets.charge[seat];
    const end = Math.max(now(), ...this.flights.filter(f => f.charge).map(f => f.t0 + f.dur));
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (this.dead) return;
      this.sfx?.ready();
      el?.animate?.([{ filter: 'brightness(1) drop-shadow(0 0 0 transparent)' }, { filter: 'brightness(1.8) drop-shadow(0 0 12px #ffd27a)' }, { filter: 'brightness(1)' }], { duration: 700 });
    }, end - now() + 60);
    this.timers.add(id);
  }

  /* ───── effect helpers ───── */
  kick(amp, ms) { if (!this.reduced) this.shake = { t0: now(), dur: ms, amp }; }
  flash(col, a) { this.flashes.push({ col, a, t0: now(), dur: 320 }); }
  ring(x, y, col, R, ms = 380) { this.fx.push({ k: 'ring', x, y, col, R, t0: now(), dur: ms }); }
  blast(x, y, col, R, big = false) {
    this.fx.push({ k: 'blast', x, y, col, R, t0: now(), dur: (big ? 700 : 520) / Math.min(2, this.speed) });
    this.burst(x, y, col, R * 0.9, big ? 30 : 16);
    this.kick(big ? 0.16 : 0.07, big ? 420 : 240);
  }
  /** A ring and a spray of sparks (and stars, for magic). */
  burst(x, y, col, R, n, stars = false) {
    this.ring(x, y, col, R * 0.8, 320);
    for (let k = 0; k < n; k++) {
      const a = rand(0, 6.283), v = rand(1.5, 4.5) * R;
      this.part({ kind: stars && k % 3 === 0 ? 'star' : 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, gr: 2, drag: 2.5, life: rand(0.35, 0.7), size: rand(0.1, 0.2), col });
    }
  }
  /** A matched gem breaks into shards and sparks of its colour. */
  shatter(v) {
    const [px, py] = this.posOf(v, now()), x = px + 0.5, y = py + 0.5, look = this.look(v.c), gem = GEMS[look];
    const fills = [gem.hi, gem.base, mix(gem.base, '#ffffff', 0.3), gem.glow];
    for (let k = 0; k < (this.reduced ? 3 : 7); k++) {
      const a = rand(0, 6.283), sp = rand(2, 4.5);
      this.part({ kind: 'shard', x: x + Math.cos(a) * 0.1, y: y + Math.sin(a) * 0.1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, gr: 13, drag: 0.6, life: rand(0.45, 0.75), size: rand(0.09, 0.16), rot: rand(0, 6.283), vr: rand(-12, 12), fill: fills[k % 4] });
    }
    for (let k = 0; k < (this.reduced ? 2 : 6); k++) {
      const a = rand(0, 6.283), sp = rand(2.5, 6);
      this.part({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, gr: 3, drag: 3, life: rand(0.3, 0.55), size: rand(0.08, 0.16), col: look });
    }
    this.fx.push({ k: 'pop', x, y, col: look, t0: now(), dur: 260 });
  }
  puff(x, y) {
    for (let k = 0; k < 6; k++) {
      const a = rand(0, 6.283), sp = rand(0.4, 1.2);
      this.part({ kind: 'puff', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.4, gr: -0.5, drag: 1.5, life: rand(0.4, 0.7), size: rand(0.25, 0.4) });
    }
  }
  part(p) {
    const cap = this.reduced ? 90 : 340;
    if (this.parts.length >= cap) this.parts.splice(0, this.parts.length - cap + 1);
    p.age = 0;
    this.parts.push(p);
  }
  banner(s, kind) {
    if (!s) return;
    const t = now();
    for (const b of this.texts) if (b.kind !== 'pts' && t - b.t0 < b.dur) b.dur = Math.min(b.dur, t - b.t0 + 160);
    this.texts.push({ kind, s, t0: t, dur: kind === 'boost' || kind === 'info' ? 1000 : 1150 });
  }
  /** A collected gem leaves the board for its meter (drawn on the overlay). */
  fly(v, fl) {
    const [px, py] = this.posOf(v, now()), [x0, y0] = this.toView(px + 0.5, py + 0.5);
    this.flights.push({ x0, y0, el: fl.el, charge: !!fl.charge, frac: fl.frac || 0, look: this.look(v.c), t0: now() + rand(0, 70), dur: rand(520, 720) / Math.min(2, this.speed), bend: rand(-90, 90), lift: rand(40, 110) });
  }

  /* ───── drawing ───── */
  frame() {
    this.raf = requestAnimationFrame(this.frame);
    const t = now(), dt = Math.min(1, (t - (this.lastT || t)) / 1000); // particles age in real time, step at most 50 ms
    this.lastT = t;
    if (this.back) this.draw(t, dt);
    this.drawOverlay(t, dt);
  }
  glow(g, key, x, y, r, a = 1) {
    if (a <= 0 || r <= 0) return;
    g.globalAlpha = Math.min(1, a);
    g.drawImage(this.glows[key], x - r, y - r, r * 2, r * 2);
  }
  strokePaths(g, paths, col, lw, a) {
    g.beginPath();
    for (const p of paths) p.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = lw; g.lineJoin = 'round'; g.lineCap = 'round';
    g.stroke();
  }
  draw(t, dt) {
    const g = this.g, d = this.dpr, u = this.cs * d;
    let sx = 0, sy = 0;
    if (this.shake) {
      const k = (t - this.shake.t0) / this.shake.dur;
      if (k >= 1) this.shake = null;
      else { const a = this.shake.amp * this.cs * (1 - k) ** 2; sx = rand(-a, a); sy = rand(-a, a); }
    }
    const bx = (this.ox + this.pad + sx) * d, by = (this.oy + this.pad + sy) * d;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    g.drawImage(this.back, sx * d, sy * d);
    g.setTransform(u, 0, 0, u, bx, by); // cell units from here on
    this.drawUnder(g, t);
    g.save();
    g.beginPath(); g.rect(0, 0, W, H); g.clip();
    this.drawGems(g, t);
    g.restore();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.drawImage(this.front, sx * d, sy * d);
    g.setTransform(u, 0, 0, u, bx, by);
    this.drawFx(g, t);
    this.drawParts(g, dt);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.setTransform(d, 0, 0, d, sx * d, sy * d);
    this.drawTexts(g, t);
  }
  /** On the tray, under the gems: hover, selection, hint and the booster's target preview. */
  drawUnder(g, t) {
    const pulse = 0.5 + 0.5 * Math.sin(t / 260);
    const cell = (i, fill, stroke, lw = 0.04) => {
      rrect(g, colOf(i) + 0.05, rowOf(i) + 0.05, 0.9, 0.9, 0.16);
      g.globalAlpha = 1;
      if (fill) { g.fillStyle = fill; g.fill(); }
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
    };
    this.preview = null;
    if (this.mode === 'target' && !this.locked()) {
      const focus = this.press && this.press.target ? this.press.i : this.hover;
      this.preview = focus >= 0 && this.opts.preview ? this.opts.preview(focus) || [] : [];
      for (const i of this.preview) cell(i, `rgba(255,200,110,${0.16 + 0.1 * pulse})`, `rgba(255,224,160,${0.45 + 0.3 * pulse})`);
      if (focus >= 0) cell(focus, 'rgba(255,236,190,.22)', '#ffe7a8', 0.06);
    } else if (this.hover >= 0 && this.mode === 'swap' && !this.locked()) cell(this.hover, 'rgba(255,240,210,.08)');
    if (this.sel >= 0) {
      g.globalCompositeOperation = 'lighter';
      this.glow(g, 'l', colOf(this.sel) + 0.5, rowOf(this.sel) + 0.5, 0.95, 0.4 + 0.25 * pulse);
      g.globalCompositeOperation = 'source-over';
      cell(this.sel, null, `rgba(255,231,168,${0.6 + 0.4 * pulse})`, 0.05);
    }
    if (this.hintPair && !this.locked()) {
      const k = Math.max(0, Math.sin(((t - this.hintT) / 1000) * Math.PI * 1.4));
      g.globalCompositeOperation = 'lighter';
      for (const i of this.hintPair) this.glow(g, 'l', colOf(i) + 0.5, rowOf(i) + 0.5, 0.85, 0.55 * k);
      g.globalCompositeOperation = 'source-over';
    }
    g.globalAlpha = 1;
  }
  drawGems(g, t) {
    const tops = [];
    for (const v of this.vis.values()) if (v.top || v.mv) tops.push(v); else this.drawGem(g, v, t);
    for (const v of tops) this.drawGem(g, v, t);
    // now and then a gem catches the lamp
    if (!this.reduced && t > this.nextTwinkle && this.twinkles.length < 4 && this.vis.size) {
      this.nextTwinkle = t + rand(220, 600);
      const ids = [...this.vis.keys()];
      this.twinkles.push({ id: ids[(Math.random() * ids.length) | 0], t0: t, dur: rand(500, 850), r: rand(0.12, 0.2) });
    }
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = 1;
    this.twinkles = this.twinkles.filter(w => {
      const v = this.vis.get(w.id), k = (t - w.t0) / w.dur;
      if (!v || k >= 1) return false;
      if (v.mv || v.pop || v.fade) return true;
      const s = Math.sin(Math.PI * k) * w.r;
      g.save(); g.translate(v.col + 0.36, v.row + 0.3); g.rotate(k * 1.5); g.drawImage(this.star, -s, -s, s * 2, s * 2); g.restore();
      return true;
    });
    g.globalCompositeOperation = 'source-over';
  }
  drawGem(g, v, t) {
    let [x, y] = this.posOf(v, t);
    const i = v.mv ? -1 : v.row * W + v.col, pr = this.press;
    x += 0.5; y += 0.5;
    if (v.rc && t >= v.rc.t) Object.assign(v, { c: v.rc.c, rc: null, flashT: t });
    const look = this.look(v.c);
    let s = 1, sx = 1, sy = 1, a = 1, flash = 0;
    if (i >= 0 && i === this.sel) { s = 1.08; y -= 0.035 * Math.abs(Math.sin(t / 220)); }
    else if (i >= 0 && i === this.hover && this.mode === 'swap' && !this.locked()) s = 1.05;
    if (pr && !pr.target && i === pr.i) { if (Math.abs(pr.dx) > Math.abs(pr.dy)) x += clamp(pr.dx, -0.25, 0.25); else y += clamp(pr.dy, -0.25, 0.25); }
    if (this.hintPair && i >= 0 && this.hintPair.includes(i) && !this.locked()) {
      const o = this.hintPair[0] === i ? this.hintPair[1] : this.hintPair[0], k = Math.max(0, Math.sin(((t - this.hintT) / 1000) * Math.PI * 1.4)) ** 2 * 0.1;
      x += (colOf(o) - colOf(i)) * k; y += (rowOf(o) - rowOf(i)) * k;
    }
    if (v.born) { const k = (t - v.born) / 420; if (k >= 1) v.born = 0; else s *= Math.max(0.02, E.elastic(k)); }
    if (v.landT && t >= v.landT) {
      const k = (t - v.landT) / 230;
      if (k >= 1) v.landT = 0;
      else { const q = Math.sin(k * Math.PI * 2) * (1 - k); sy = 1 - 0.13 * q; sx = 1 + 0.09 * q; }
    }
    if (v.pop && t >= v.pop.t0) { const k = clamp((t - v.pop.t0) / v.pop.dur, 0, 1); s *= 1 + 0.32 * Math.sin((k * Math.PI) / 2); flash = k; }
    if (v.fade && t >= v.fade.t0) { const k = clamp((t - v.fade.t0) / v.fade.dur, 0, 1); s *= 1 - 0.5 * k; a = 1 - k * k; flash = Math.max(flash, k * 0.7); }
    if (v.flashT) { const k = (t - v.flashT) / 320; if (k >= 1) v.flashT = 0; else flash = Math.max(flash, 1 - k); }
    if (v.s && a > 0.3) {
      const p = 0.5 + 0.5 * Math.sin(t / 300 + v.ph);
      g.globalCompositeOperation = 'lighter';
      this.glow(g, look, x, y, (0.62 + 0.08 * p) * s, v.s === 'bolt' ? 0.5 + 0.25 * p : 0.28 + 0.2 * p);
      g.globalCompositeOperation = 'source-over';
    }
    const sp = this.sprite(look, v.s), w = SPR * s * sx, h = SPR * s * sy, top = y - h / 2 + (1 - sy) * GEM_R * s;
    g.globalAlpha = a;
    g.drawImage(sp, x - w / 2, top, w, h);
    if (v.ghost) {
      const k = (t - v.ghost.t0) / v.ghost.dur;
      if (k >= 1) v.ghost = null;
      else { const gs = SPR * s * (1 + 0.35 * k); g.globalAlpha = 1 - k; g.drawImage(this.sprite(look, v.ghost.s), x - gs / 2, y - gs / 2, gs, gs); }
    }
    if (flash > 0) {
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = a * flash * 0.9;
      g.drawImage(sp, x - w / 2, top, w, h);
      g.globalCompositeOperation = 'source-over';
    }
    g.globalAlpha = 1;
    if (v.s && a > 0.3 && !(v.pop && t >= v.pop.t0)) this.decorate(g, v, x, y, s, t, look);
  }
  /** What makes a special look alive: running sparks, a lit fuse, crackling arcs, the Trick Hat's halo. */
  decorate(g, v, x, y, s, t, look) {
    g.globalCompositeOperation = 'lighter';
    if (v.s === 'h' || v.s === 'v') {
      for (const side of [-1, 1]) {
        const k = (t / 650 + v.ph + (side > 0 ? 0 : 0.5)) % 1, d = (0.1 + k * 0.36) * s;
        this.glow(g, look, v.s === 'h' ? x + side * d : x, v.s === 'h' ? y : y + side * d, 0.12 * s * (1 - k * 0.6), 1 - k);
      }
    } else if (v.s === 'bomb') {
      const fx = x + 0.34 * s, fy = y - 0.35 * s, f = rand(0.8, 1.2), r = 0.11 * s * f;
      this.glow(g, 'l', fx, fy, 0.17 * s * f, 0.95);
      g.globalAlpha = 1; g.save(); g.translate(fx, fy); g.rotate(t / 150); g.drawImage(this.star, -r, -r, r * 2, r * 2); g.restore();
      if (!this.reduced && Math.random() < 0.08) this.part({ kind: 'spark', x: fx, y: fy, vx: rand(-0.6, 0.6), vy: rand(-1.6, -0.6), gr: 3, drag: 1, life: rand(0.25, 0.45), size: 0.06, col: 'l' });
    } else if (v.s === 'bolt') {
      if (!v.arcs || t - v.arcT > 90) {
        v.arcT = t;
        v.arcs = [0, 1].map(() => { const a = rand(0, 6.283), b = a + rand(-0.9, 0.9); return jag(Math.cos(a) * 0.3, Math.sin(a) * 0.3, Math.cos(b) * 0.5, Math.sin(b) * 0.5, 0.4, 3); });
      }
      g.save(); g.translate(x, y); g.scale(s, s);
      this.strokePaths(g, v.arcs, GEMS[look].glow, 0.05, 0.6);
      this.strokePaths(g, v.arcs, '#ffffff', 0.018, 0.9);
      g.restore();
    }
    g.globalCompositeOperation = 'source-over';
    if (v.tmp != null) {
      g.save(); g.setLineDash([0.08, 0.06]); g.lineDashOffset = -t / 1500;
      g.beginPath(); g.arc(x, y, 0.47 * s, 0, 6.283);
      g.globalAlpha = 0.55 + 0.35 * Math.sin(t / 180); g.strokeStyle = '#ffe7a8'; g.lineWidth = 0.04; g.stroke();
      g.restore();
    }
    g.globalAlpha = 1;
  }
  drawBeam(g, f, k, t, laser) {
    const el = t - f.t0, head = clamp(el / f.reach, 0, 1) * 7, fade = clamp((el - f.reach) / (f.dur - f.reach), 0, 1);
    const along = f.dir === 'h' ? f.x : f.y, lo = Math.min(head, along), hi = Math.min(head, 7 - along), wd = f.wd * (1 - fade * 0.6), c = tint(f.col);
    g.save(); g.translate(f.x, f.y); if (f.dir === 'v') g.rotate(Math.PI / 2);
    const gr = g.createLinearGradient(0, -wd / 2, 0, wd / 2);
    gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(0.3, rgba(c, 0.55)); gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(0.7, rgba(c, 0.55)); gr.addColorStop(1, rgba(c, 0));
    g.globalAlpha = (1 - fade) * (laser ? 0.75 + 0.25 * Math.random() : 1);
    g.fillStyle = gr; g.fillRect(-lo, -wd / 2, lo + hi, wd);
    if (laser) { g.fillStyle = '#ffffff'; g.fillRect(-lo, -0.02, lo + hi, 0.04); }
    if (head < 7) for (const hx of [-lo, hi]) { this.glow(g, f.col, hx, 0, wd * 1.2, 1); this.glow(g, 'w', hx, 0, wd * 0.5, 1); }
    g.restore();
  }
  drawFx(g, t) {
    if (this.preview && this.preview.length) {
      g.globalCompositeOperation = 'lighter';
      for (const i of this.preview) this.glow(g, 'l', colOf(i) + 0.5, rowOf(i) + 0.5, 0.6, 0.22);
    }
    this.fx = this.fx.filter(f => t < f.t0 + f.dur);
    for (const f of this.fx) {
      if (t < f.t0) continue;
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = 1;
      FX[f.k].call(this, g, f, (t - f.t0) / f.dur, t);
    }
    g.globalCompositeOperation = 'lighter';
    this.flashes = this.flashes.filter(f => {
      const k = (t - f.t0) / f.dur;
      if (k >= 1) return false;
      this.glow(g, f.col, 3.5, 3.5, 6, f.a * (1 - k) ** 2);
      return true;
    });
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  }
  drawParts(g, dt) {
    if (!this.parts.length) return;
    const st = Math.min(0.05, dt);
    this.parts = this.parts.filter(p => (p.age += dt) < p.life);
    for (const p of this.parts) {
      const f = Math.exp(-p.drag * st), k = p.age / p.life;
      p.vx *= f; p.vy = p.vy * f + p.gr * st; p.x += p.vx * st; p.y += p.vy * st;
      if (p.kind === 'shard') {
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1 - k * k; g.fillStyle = p.fill;
        p.rot += p.vr * dt;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        g.beginPath(); g.moveTo(0, -p.size); g.lineTo(p.size * 0.8, p.size * 0.6); g.lineTo(-p.size * 0.7, p.size * 0.5); g.closePath(); g.fill();
        g.restore();
      } else if (p.kind === 'puff') {
        g.globalCompositeOperation = 'source-over';
        this.glow(g, 'w', p.x, p.y, p.size * (0.6 + k), 0.35 * (1 - k));
      } else if (p.kind === 'star') {
        const r = p.size * 1.6 * (1 - k * 0.5);
        g.globalCompositeOperation = 'lighter'; g.globalAlpha = 1 - k;
        g.drawImage(this.star, p.x - r, p.y - r, r * 2, r * 2);
      } else {
        g.globalCompositeOperation = 'lighter';
        this.glow(g, p.col, p.x, p.y, p.size * (1 - k * 0.5), 1 - k);
      }
    }
  }
  /** Score popups and banners, in CSS pixels. */
  drawTexts(g, t) {
    if (!this.texts.length) return;
    const cs = this.cs, bx = this.ox + this.pad, by = this.oy + this.pad;
    this.texts = this.texts.filter(x => t < x.t0 + x.dur);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    for (const x of this.texts) {
      if (t < x.t0) continue;
      const k = (t - x.t0) / x.dur;
      g.save();
      if (x.kind === 'pts') {
        const size = cs * (0.52 + 0.08 * Math.min(x.n, 4)), s = k < 0.18 ? E.back(k / 0.18) : 1;
        g.translate(bx + x.x * cs, by + (x.y - 0.7 * E.out(k)) * cs); g.scale(s, s);
        g.globalAlpha = k > 0.65 ? (1 - k) / 0.35 : 1;
        g.font = `700 ${size}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
        g.lineWidth = size * 0.2; g.strokeStyle = 'rgba(40,22,6,.85)'; g.strokeText(x.s, 0, 0);
        const gr = g.createLinearGradient(0, -size / 2, 0, size / 2);
        gr.addColorStop(0, '#fff8d8'); gr.addColorStop(1, '#f2b84a');
        g.fillStyle = gr; g.fillText(x.s, 0, 0);
      } else {
        const small = x.kind === 'boost' || x.kind === 'info', size = cs * (small ? 0.6 : 0.85);
        g.font = `italic 600 ${size}px 'Fraunces', Georgia, serif`;
        const fit = Math.min(1, (6.4 * cs) / g.measureText(x.s).width), s = (k < 0.2 ? E.back(k / 0.2) : 1) * fit;
        g.translate(bx + 3.5 * cs, by + ((small ? 1.4 : 3.5) - 0.3 * Math.max(0, k - 0.75)) * cs); g.scale(s, s);
        g.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : Math.min(1, k / 0.06);
        g.shadowColor = x.kind === 'extra' ? 'rgba(120,200,255,.9)' : 'rgba(255,170,70,.9)'; g.shadowBlur = size * 0.45 * this.dpr;
        g.lineWidth = size * 0.14; g.strokeStyle = 'rgba(30,16,4,.9)'; g.strokeText(x.s, 0, 0);
        g.shadowColor = 'transparent';
        const gr = g.createLinearGradient(0, -size / 2, 0, size / 2);
        gr.addColorStop(0, x.kind === 'extra' ? '#eef8ff' : '#fff6d6'); gr.addColorStop(1, x.kind === 'extra' ? '#6cbcff' : '#e9b553');
        g.fillStyle = gr; g.fillText(x.s, 0, 0);
      }
      g.restore();
    }
  }
  /** Gems in flight to the meters, over the whole page. */
  drawOverlay(t, dt) {
    const g = this.og;
    if (!this.flights.length && !this.oparts.length) {
      if (this.ovDirty) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.ov.width, this.ov.height); this.ovDirty = false; }
      return;
    }
    this.ovDirty = true;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.ov.width, this.ov.height);
    g.setTransform(this.odpr, 0, 0, this.odpr, 0, 0);
    g.globalCompositeOperation = 'lighter';
    const rects = new Map();
    this.flights = this.flights.filter(f => {
      if (t < f.t0) return true;
      let r = rects.get(f.el);
      if (!r) rects.set(f.el, (r = f.el.getBoundingClientRect()));
      const k = (t - f.t0) / f.dur, x1 = r.left + r.width / 2, y1 = r.top + r.height / 2;
      if (k >= 1) { this.arrive(f, x1, y1); return false; }
      const cx = (f.x0 + x1) / 2 + f.bend, cy = Math.min(f.y0, y1) - f.lift, R = Math.min(18, this.cs * 0.3) * (1 - 0.5 * k);
      const at = e => [(1 - e) ** 2 * f.x0 + 2 * (1 - e) * e * cx + e * e * x1, (1 - e) ** 2 * f.y0 + 2 * (1 - e) * e * cy + e * e * y1];
      const e = E.io(k), [x, y] = at(e);
      for (let j = 5; j >= 1; j--) { const [tx, ty] = at(Math.max(0, e - j * 0.03)); this.glow(g, f.look, tx, ty, R * (1 - j * 0.13), 0.55 - j * 0.09); }
      this.glow(g, f.look, x, y, R * 1.8, 0.85);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1 - k * 0.4;
      g.drawImage(this.sprite(f.look, ''), x - R * 1.2, y - R * 1.2, R * 2.4, R * 2.4);
      g.globalCompositeOperation = 'lighter';
      this.glow(g, 'w', x, y, R * 0.5, 0.8);
      return true;
    });
    const st = Math.min(0.05, dt);
    this.oparts = this.oparts.filter(p => (p.age += dt) < p.life);
    for (const p of this.oparts) {
      const f = Math.exp(-5 * st);
      p.vx *= f; p.vy *= f; p.x += p.vx * st; p.y += p.vy * st;
      this.glow(g, p.look, p.x, p.y, p.size * (1 - (p.age / p.life) * 0.5), 1 - p.age / p.life);
    }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  }
  arrive(f, x, y) {
    for (let k = 0; k < (this.reduced ? 2 : 6); k++) {
      const a = rand(0, 6.283), v = rand(60, 200);
      this.oparts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.25, 0.45), age: 0, size: rand(5, 9), look: f.look });
    }
    if (this.oparts.length > 120) this.oparts.splice(0, this.oparts.length - 120);
    f.el.animate?.([{ filter: 'brightness(1)' }, { filter: 'brightness(1.6)' }, { filter: 'brightness(1)' }], { duration: 240 });
    if (f.charge) this.sfx?.charge(f.frac); else this.sfx?.collect();
  }
}
