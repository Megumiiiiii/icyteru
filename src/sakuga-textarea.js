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
  set value(v) { if (this.ta) this.ta.value = v ?? ''; else this.setAttribute('value', v ?? ''); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { this.toggleAttribute('disabled', !!v); }

  attributeChangedCallback(name, _old, value) {
    if (!this.ta) return;
    if (name === 'value') this.value = value ?? '';
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

  // Grow upward like the plain composer: reset, measure, clamp at the CSS max.
  grow() {
    const ta = this.ta;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(48, Math.min(ta.scrollHeight, 280))}px`;
    ta.style.overflowY = ta.scrollHeight > 280 ? 'auto' : 'hidden';
  }

  caretPoint() {
    const ta = this.ta;
    const box = ta.getBoundingClientRect();
    const cs = getComputedStyle(ta);
    const canvas = this.mctx || (this.mctx = document.createElement('canvas').getContext('2d'));
    canvas.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const before = ta.value.slice(0, ta.selectionStart ?? ta.value.length);
    const line = before.split('\n').pop() || '';
    const lineIndex = before.split('\n').length - 1;
    const padLeft = parseFloat(cs.paddingLeft) || 12;
    const padTop = parseFloat(cs.paddingTop) || 12;
    const lineHeight = parseFloat(cs.lineHeight) || 20;
    const width = Math.min(canvas.measureText(line).width, Math.max(0, box.width - padLeft * 2));
    const x = box.left + padLeft + width;
    const y = box.top + padTop + lineIndex * lineHeight + lineHeight * 0.55;
    return { x: Math.min(x, box.left + box.width - 10), y: Math.min(y, box.top + box.height - 6), box };
  }

  setup() {
    const ta = this.ta = this.$('textarea');
    this.s = new Spring(1, 700, 16);
    this.grow();
    ta.addEventListener('focus', () => {
      const c = at(ta, 0, 0);
      this.s.x = 1.01;
      ticks(c.x - 4, c.y - 2, { dir: -1.05, n: 3, r: 4, len: 14, fan: 0.36, life: 0.45 });
    });
    ta.addEventListener('input', () => {
      this.grow();
      this.s.x = 0.994;
      const point = this.caretPoint();
      puff(point.x, point.y, { size: rnd(4, 6), n: 2, vy: -22, vx: rnd(-10, 10), life: 0.4 });
      if (Math.random() < 0.3) shards(point.x, point.y - 3, { n: 2, speed: 110, size: 3, life: 0.5 });
    });
    ta.addEventListener('change', () => this.dispatchEvent(new Event('change', { bubbles: true })));
  }

  frame(dt) {
    const y = this.s.step(dt);
    this.ta.style.transform = Math.abs(y - 1) < 0.0006 ? '' : `scale(${y})`;
  }
}

fx.define('sakuga-textarea', SakugaTextarea);
}
if (window.SakugaFX) component(window.SakugaFX);
})();
