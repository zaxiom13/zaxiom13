// The editor, behind a two-stage interface.
//
// CodeMirror is the single biggest thing in the bundle, so the page starts with
// a plain textarea that is usable immediately and upgrades itself to the real
// editor as soon as it has downloaded. Everything else in the app talks to this
// interface and never knows which one it has.

export interface CodeSource {
  get(): string;
  set(text: string): void;
  insert(text: string): void;
  /** the selection, or the current line when nothing is selected */
  selectionOrLine(): string;
  focus(): void;
}

export interface CodeOpts {
  parent: HTMLElement;
  doc: string;
  onRun: () => void;
  onChange?: (doc: string) => void;
}

export function createTextareaSource(opts: CodeOpts): CodeSource {
  const ta = document.createElement('textarea');
  ta.className = 'plain-editor';
  ta.spellcheck = false;
  ta.autocapitalize = 'off';
  ta.setAttribute('autocorrect', 'off');
  ta.value = opts.doc;
  ta.addEventListener('input', () => opts.onChange?.(ta.value));
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey || e.shiftKey) && e.key === 'Enter') {
      e.preventDefault();
      opts.onRun();
    }
  });
  opts.parent.append(ta);
  return {
    get: () => ta.value,
    set(text) {
      ta.value = text;
      opts.onChange?.(text);
    },
    insert(text) {
      const s = ta.selectionStart ?? ta.value.length;
      const e = ta.selectionEnd ?? s;
      ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
      ta.selectionStart = ta.selectionEnd = s + text.length;
      ta.focus();
      opts.onChange?.(ta.value);
    },
    selectionOrLine() {
      const s = ta.selectionStart ?? 0;
      const e = ta.selectionEnd ?? 0;
      if (e > s) return ta.value.slice(s, e);
      const before = ta.value.lastIndexOf('\n', Math.max(0, s - 1)) + 1;
      let after = ta.value.indexOf('\n', s);
      if (after < 0) after = ta.value.length;
      return ta.value.slice(before, after);
    },
    focus: () => ta.focus(),
  };
}
