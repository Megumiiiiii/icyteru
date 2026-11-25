// Sakuga Progress component (MIT, Copyright (c) 2026 Justin Finkelman, https://github.com/finktheartist/sakuga-vfx)
// Reuses the shared window.SakugaFX engine loaded by ./sakuga-core.js.
export function registerSakugaProgress() {
  const fx = window.SakugaFX;
  if (!fx || customElements.get('sakuga-progress')) return;
  const { Spring, clamp, lerp, rnd, at, esc, persist, blob, shape, puff, lines, ticks, burst, shards, sfx } = fx;
  const LOBES = [[0, -0.95, 1], [0.78, -0.55, 0.74], [-0.72, -0.78, 0.72], [0.36, -1.7, 0.7], [-0.4, -1.62, 0.62], [1.1, -1.32, 0.52], [-1.18, -0.28, 0.52], [0.62, 0.3, 0.5], [-0.86, 0.5, 0.52], [-1.5, 0.82, 0.38], [-2.05, 1.0, 0.24], [0.16, 0.72, 0.4]];

  class SakugaProgress extends fx.Base {
    static observedAttributes = ['value', 'label'];
    static css = `
      :host { display: block; width: var(--sk-progress-width, 100%); max-width: 100%; }
      .prog { position: relative; padding-top: 46px; padding-bottom: 6px; }
      .bar { position: relative; height: 24px; border: 3px solid var(--sk-ink); border-radius: 13px; background: var(--sk-card); overflow: hidden; }
      .bar i { position: relative; display: block; height: 100%; width: calc(var(--v, 0) * 100%); background: var(--sk-fill); }
      .bar i::before, .bar i::after { content: ""; position: absolute; top: 3px; height: 7px; width: 7px; background: #fff; border-radius: 2px; transform: skewX(-28deg); left: 16px; opacity: .92; }
      .bar i::after { left: 28px; width: 5px; }
      .pct { display: table; margin: 38px auto 0; padding: 2px 10px 3px; border: 2px solid var(--sk-ink); background: var(--sk-card); color: var(--sk-ink); box-shadow: 4px 4px 0 var(--sk-fill); transform: skewX(-12deg); font: italic 900 14px/1.1 "Marker Felt", "Chalkboard SE", "Comic Sans MS", -apple-system, "Segoe UI", sans-serif; letter-spacing: -.01em; white-space: nowrap; will-change: transform; }`;
    get value() { return this.goal; }
    get done() { return !!this.doneAt; }
    attributeChangedCallback(name, _, v) { if (!this.box) return; if (name === 'value') this.set(v === null ? 0 : +v); else this.box.setAttribute('aria-label', v || 'Loading'); }
    render() { return `<div class="prog" role="progressbar" part="progress" aria-label="${esc(this.getAttribute('label') || 'Loading')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="bar" part="bar"><i></i></div><span class="pct" part="label">0%</span></div>`; }
    set(n, instant) {
      n = clamp(+n || 0); if (this.doneAt && n >= 1) return;
      if (n < this.p - 0.001 || instant) { if (n < this.p) this.clear(); this.p = n; }
      this.goal = n;
    }
    reset() { this.clear(); this.p = 0; this.goal = 0; }
    clear() { this.doneAt = 0; this.said = false; }
    setup() {
      this.box = this.$('.prog'); this.bar = this.$('.bar'); this.pct = this.$('.pct'); this.back = this.backLayer();
      this.p = 0; this.goal = clamp(+this.getAttribute('value') || 0); this.doneAt = 0; this.said = false; this.t = 0; this.acc = 0; this.spd = 0; this.lastPct = ''; this.vis = false;
      this.lobes = LOBES.map(([x, y, r], i) => ({ x, y, r, ph: rnd(6.28), w: rnd(1.4, 2.6), i }));
      this.peb = [0.14, 0.31, 0.5, 0.69, 0.87].map((u) => ({ u, s: rnd(2.8, 4.4), ph: rnd(6.28), rot: rnd(-0.5, 0.5), lift: new Spring(0, 70, 7), pts: [[-1, 0.4], [-0.5, -0.8], [0.5, -1], [1, 0.1], [0.3, 0.9]].map(([x, y]) => [x * rnd(0.8, 1.2), y * rnd(0.8, 1.2)]) }));
      this.size = new Spring(0, 90, 13); this.lag = new Spring(0, 120, 16); this.ck = new Spring(0, 260, 13); this.tag = new Spring(1, 500, 13); this.rest = new Spring(0, 160, 14);
    }
    connectedCallback() { super.connectedCallback(); if (this.ready && !this.layer) this.layer = persist((k, tt, dt) => this.paint(tt, dt)); }
    disconnectedCallback() { super.disconnectedCallback(); if (this.layer) { this.layer.dead = true; this.layer = null; } }
    paint(tt, dt) {
      if (!this.vis) return; const g = fx.g, P = fx.P, b = at(this.bar), L = b.x - b.w / 2, R = b.x + b.w / 2, p = this.p, done = this.doneAt, lead = L + 4 + (b.w - 8) * p, cy = b.y, gy = cy + b.h / 2 + 20;
      const reach = clamp(p * 1.25 + (done ? 1 : 0)), gx1 = lerp(L + 8, R - 8, reach);
      if (reach > 0.02) { g.strokeStyle = P.line; g.lineWidth = 1.3; g.beginPath(); g.moveTo(L + 8, gy); g.lineTo(gx1, gy); for (let x = L + 22; x < gx1 - 6; x += 32) { g.moveTo(x, gy); g.lineTo(x + 3, gy - 3.5); g.moveTo(x + 5, gy); g.lineTo(x + 6.5, gy - 2); } g.stroke(); }
      for (const q of this.peb) {
        const px = L + b.w * q.u; q.lift.to = !done && lead > px - 14 ? 1 : 0; const up = q.lift.step(dt); if (reach < q.u - 0.04 && up < 0.01) continue;
        const y = gy - q.s * 0.7 - up * (5 + q.s * 1.2) + Math.sin(tt * 3 + q.ph) * 1.5 * up, path = new Path2D();
        g.save(); g.translate(px, y); g.rotate(q.rot + up * Math.sin(tt * 2 + q.ph) * 0.5); q.pts.forEach(([x, yy], n) => path[n ? 'lineTo' : 'moveTo'](x * q.s, yy * q.s)); path.closePath(); shape(path, 1, q.s * 0.45); g.restore();
        if (up > 0.15 && up < 0.9 && q.lift.v > 0.6) { g.save(); g.strokeStyle = P.accent; g.lineWidth = 2; g.beginPath(); for (const a of [-1.9, -1.57, -1.24]) { g.moveTo(px + Math.cos(a) * (q.s + 4), y + Math.sin(a) * (q.s + 4)); g.lineTo(px + Math.cos(a) * (q.s + 9), y + Math.sin(a) * (q.s + 9)); } g.stroke(); g.restore(); }
      }
      this.rest.to = done ? 1 : 0; const rs = Math.max(0, this.rest.step(dt));
      if (rs > 0.02) for (const [x, d] of [[L + 28, -1], [R - 32, 1]]) { blob([[x, gy - 7 * rs, 6.5 * rs], [x + 6 * d, gy - 5 * rs, 5 * rs], [x - 5 * d, gy - 4 * rs, 4.5 * rs], [x + 2 * d, gy - 12 * rs, 4.5 * rs]].map(([cx, cyy, r], n) => [cx, cyy, r * (1 + Math.sin(tt * 3 + n) * 0.06)]), 1.2, true, { lx: 1, arcs: true }); }
      this.size.to = done || p < 0.015 ? 0 : 8 + 16 * Math.sqrt(p); this.lag.to = this.spd; const S = Math.max(0, this.size.step(dt)), drag = this.lag.step(dt);
      if (S > 0.6) blob(this.lobes.map((l) => { const boil = 1 + 0.16 * Math.sin(tt * l.w + l.ph), roll = 0.82 + 0.22 * Math.sin(tt * 2.6 - l.i * 0.9);
        return [lead + 2 + (l.x + Math.cos(tt * l.w * 0.7 + l.ph) * 0.1 - drag * 1.4 * Math.max(0, -l.y) * 0.5) * S, cy - 2 + (l.y + Math.sin(tt * l.w * 0.7 + l.ph) * 0.1) * S, l.r * S * boil * roll]; }), 1.4, true, { lx: 1, arcs: true, deep: 1.5 });
      this.ck.to = done ? 1 : 0; const c = Math.max(0, this.ck.step(dt));
      if (c > 0.02) { const x = b.x + 2, y = cy - b.h / 2 - 34; g.save(); g.translate(x, y); g.rotate((1 - c) * -0.5); g.scale(c * 0.72, c * 0.72);
        g.save(); g.strokeStyle = P.accent; g.lineWidth = 9; g.lineJoin = 'miter'; g.lineCap = 'butt'; g.beginPath(); g.moveTo(-28, 2); g.lineTo(-8, 22); g.lineTo(30, -26); g.stroke();
        g.lineCap = 'round'; g.lineWidth = 4; g.beginPath(); for (const [a, d] of [[-2.6, 58], [-2.95, 60], [-0.35, 56], [-0.1, 60]]) { g.moveTo(Math.cos(a) * d, Math.sin(a) * d * 0.7); g.lineTo(Math.cos(a) * (d + 13), Math.sin(a) * (d + 13) * 0.7); } g.stroke(); g.restore();
        const s = 13 * (0.9 + 0.1 * Math.sin(tt * 5)), q = s * 0.14, sp = new Path2D(); g.translate(64, 22); sp.moveTo(0, -s); sp.quadraticCurveTo(q, -q, s * 0.75, 0); sp.quadraticCurveTo(q, q, 0, s); sp.quadraticCurveTo(-q, q, -s * 0.75, 0); sp.quadraticCurveTo(-q, -q, 0, -s); g.fillStyle = P.fill; g.fill(sp); g.strokeStyle = P.ink; g.lineWidth = 2.2; g.stroke(sp); g.restore(); }
    }
    frame(dt) {
      this.t += dt; const r = this.box.getBoundingClientRect(); this.vis = r.bottom > -80 && r.top < innerHeight + 80;
      const was = this.p; if (!this.doneAt && this.p < this.goal) this.p = Math.min(this.goal, this.p + dt * clamp((this.goal - this.p) * 3, 0.12, 0.9));
      this.spd = lerp(this.spd, dt > 0 ? (this.p - was) / dt : 0, Math.min(1, dt * 8));
      const b = at(this.bar), L = b.x - b.w / 2, lead = L + 4 + (b.w - 8) * this.p, top = b.y - b.h / 2, p = this.p, spd = this.spd;
      if (!this.doneAt && this.vis) {
        if (p > 0.06 && spd > 0.02) { this.acc += dt * (3.5 + spd * 50);
          while (this.acc > 1) { this.acc -= 1; const S = 8 + 16 * Math.sqrt(p);
            if (Math.random() < 0.5) puff(lead - S * rnd(0.9, 1.5), top - S * rnd(0.1, 0.9), { size: rnd(2.5, 4.5) + p * 2.5, n: 2, vx: -rnd(35, 75), vy: rnd(-10, 4), life: rnd(0.35, 0.6) });
            else lines(lead - S * 1.3, top - S * rnd(0.2, 1.2), { n: 1, dir: Math.PI, len: 24 + spd * 120, spread: 3, life: 0.28 });
            if (Math.random() < 0.16) ticks(lead + S * 1.0, top - S * 1.3, { dir: -0.7, n: 3, r: 4, len: 7, life: 0.32 }); } }
        if (!this.said && p > 0.28 && p < 0.92) { this.said = true; sfx('gogo', b.x - 24, top - 42, { size: 108, rot: -0.1, life: 2.6 }); ticks(b.x + 38, top - 54, { dir: -0.5, n: 2, r: 4, len: 8, life: 0.55 }); ticks(L + 8, top - 28, { dir: Math.PI + 0.3, n: 2, r: 4, len: 8, life: 0.55 }); }
      }
      if (!this.doneAt && p >= 1) {
        this.doneAt = this.t; const R = b.x + b.w / 2;
        if (this.vis) { burst(R - 54, b.y, { r: 68, spikes: 13, life: 0.45, layer: this.back }); burst(R - 44, b.y, { r: 32, life: 0.28 }); shards(R - 44, b.y, { n: 9, speed: 220, size: 5.5, life: 0.8, arc: 6.28 });
          for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28 + rnd(0.5); puff(R - 52 + Math.cos(a) * 52, b.y + Math.sin(a) * 26, { size: rnd(6, 10), n: 3, vx: Math.cos(a) * 38, vy: Math.sin(a) * 24 - 6, life: rnd(0.55, 0.9) }); }
          sfx('don', b.x - 18, top - 42, { size: 120, rot: -0.12, life: 1.0 }); }
        this.tag.x = 1.4; this.emit('sakuga:done');
      }
      const n = this.doneAt ? 100 : Math.floor(p * 100), key = this.doneAt ? (this.getAttribute('done-label') || 'Complete ✓') : n + '%';
      if (key !== this.lastPct) { this.lastPct = key; this.pct.textContent = key; if (n % 5 === 0 && !this.doneAt) this.tag.x = 1.1; }
      this.pct.style.transform = `skewX(-12deg) scale(${this.tag.step(dt)})`;
      this.box.style.setProperty('--v', p); this.box.setAttribute('aria-valuenow', n);
    }
  }
  fx.define('sakuga-progress', SakugaProgress);
}
