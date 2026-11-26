// Sakuga Textarea (MIT, Justin Finkelman) — a multiline fork of sakuga-vfx/input/input.js.
// Same dust-per-keystroke behaviour, but the field is a <textarea rows> that grows
// with the draft instead of a single-line 230px input.
(() => {
function component(fx) {
const { Spring, rnd, at, esc, ticks, puff, shards } = fx;

class SakugaTextarea extends fx.Base {
  static delegates = true;
  static observedAttributes = ['value', 'placeholder', 'disabled', 'label', 'rows'];
  static css = `
    :host { display: block; width: 100%; min-width: 0; }
    textarea {
      display: block; box-sizing: border-box; width: 100%; min-height: 48px; max-height: 280px;
      padding: 12px 15px; resize: none; overflow-y: hidden;
      border: var(--sk-bw) solid var(--sk-ink); border-radius: var(--sk-r);
      background: var(--sk-card); color: var(--sk-ink);
      font: 600 15px/1.45 "Avenir Next", "Nunito", -apple-system, "Segoe UI", system-ui, sans-serif;
      outline: none; caret-color: var(--sk-ink); box-shadow: var(--sk-sh);
      will-change: transform;
    }
    textarea::placeholder { color: var(--sk-ink); opacity: .42; }
    textarea:disabled { opacity: .5; }`;

  get value() { return this.ta ? this.ta.value : this.getAttribute('value') || ''; }
  // Clearing the draft after a send happens through this setter, so the height
  // has to be recomputed here or a long message leaves the box tall.
  set value(v) {
    const next = v ?? '';
    if (!this.ta) {
      this.setAttribute('value', next);
      return;
    }
    if (this.ta.value === next) return;
    this.ta.value = next;
    this.grow();
  }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { this.toggleAttribute('disabled', !!v); }

  attributeChangedCallback(name, _old, value) {
    if (!this.ta) return;
    if (name === 'value') {
      this.value = value ?? '';
    }
    else if (name === 'disabled') this.ta.disabled = this.disabled;
    else if (name === 'placeholder') this.ta.placeholder = value ?? '';
    else if (name === 'label') this.ta.setAttribute('aria-label', value || 'Message');
    else if (name === 'rows') this.grow();
  }

  render() {
    const a = (n, d = '') => esc(this.getAttribute(n) ?? d);
    return `<textarea part="textarea" rows="${a('rows', '1')}" placeholder="${a('placeholder')}"
      aria-label="${a('label', 'Message')}" autocomplete="off" spellcheck="true"${this.disabled ? ' disabled' : ''}>${a('value')}</textarea>`;
  }

  // Grow upward like the plain composer: reset, measure once, clamp at the CSS max.
  grow() {
    const ta = this.ta;
    if (!ta) return;
    ta.style.height = 'auto';
    const measured = ta.scrollHeight;
    const height = `${Math.max(48, Math.min(measured, 280))}px`;
    const overflow = measured > 280 ? 'auto' : 'hidden';
    ta.style.height = height;
    if (ta.style.overflowY !== overflow) ta.style.overflowY = overflow;
  }

  metrics() {
    if (this._metrics) return this._metrics;
    const cs = getComputedStyle(this.ta);
    this._metrics = {
      font: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
      padLeft: parseFloat(cs.paddingLeft) || 12,
      padTop: parseFloat(cs.paddingTop) || 12,
      lineHeight: parseFloat(cs.lineHeight) || 20
    };
    return this._metrics;
  }

  caretPoint() {
    const ta = this.ta;
    const box = ta.getBoundingClientRect();
    const { font, padLeft, padTop, lineHeight } = this.metrics();
    const canvas = this.mctx || (this.mctx = document.createElement('canvas').getContext('2d'));
    if (canvas.font !== font) canvas.font = font;
    const before = ta.value.slice(0, ta.selectionStart ?? ta.value.length);
    const nl = before.lastIndexOf('\n');
    const line = nl >= 0 ? before.slice(nl + 1) : before;
    let lineIndex = 0;
    for (let i = 0; i < before.length; i++) if (before.charCodeAt(i) === 10) lineIndex++;
    const width = Math.min(canvas.measureText(line).width, Math.max(0, box.width - padLeft * 2));
    const x = box.left + padLeft + width;
    const y = box.top + padTop + lineIndex * lineHeight + lineHeight * 0.55;
    return { x: Math.min(x, box.left + box.width - 10), y: Math.min(y, box.top + box.height - 6), box };
  }

  setup() {
    const ta = this.ta = this.$('textarea');
    this.s = new Spring(1, 700, 16);
    this._moving = false;
    this._lastFx = 0;
    this.grow();
    ta.addEventListener('focus', () => {
      const c = at(ta, 0, 0);
      this.s.x = 1.01;
      this._moving = true;
      ticks(c.x - 4, c.y - 2, { dir: -1.05, n: 3, r: 4, len: 14, fan: 0.36, life: 0.45 });
    });
    ta.addEventListener('input', () => {
      this.grow();
      this.s.x = 0.994;
      this._moving = true;
      const now = performance.now();
      if (now - this._lastFx < 90) return;
      this._lastFx = now;
      const point = this.caretPoint();
      puff(point.x, point.y, { size: rnd(4, 6), n: 2, vy: -22, vx: rnd(-10, 10), life: 0.4 });
      if (Math.random() < 0.3) shards(point.x, point.y - 3, { n: 2, speed: 110, size: 3, life: 0.5 });
    });
    ta.addEventListener('change', () => this.dispatchEvent(new Event('change', { bubbles: true })));
  }

  frame(dt) {
    if (!this._moving) return;
    const y = this.s.step(dt);
    if (Math.abs(y - 1) < 0.0006 && Math.abs(this.s.v) < 0.01) {
      this.s.x = 1;
      this.s.v = 0;
      this._moving = false;
      this.ta.style.transform = '';
      return;
    }
    this.ta.style.transform = `scale(${y})`;
  }
}

fx.define('sakuga-textarea', SakugaTextarea);
}
if (window.SakugaFX) component(window.SakugaFX);
})();
