// Tokenizer for q.

import { QError } from './value';

export type TokKind =
  | 'num'
  | 'sym'
  | 'str'
  | 'name'
  | 'op'
  | 'adv'
  | 'lparen'
  | 'rparen'
  | 'lbrack'
  | 'rbrack'
  | 'lbrace'
  | 'rbrace'
  | 'semi'
  | 'nl'
  | 'eof';

export interface Tok {
  k: TokKind;
  s: string; // source text
  i: number; // start offset
  e: number; // end offset
  t?: number; // q type for numeric/temporal literals
  v?: any; // decoded value
  x?: boolean; // literal carried an explicit type suffix
}

const OPS = [
  '::',
  '<=',
  '>=',
  '<>',
  '+:',
  '-:',
  '*:',
  '%:',
  '&:',
  '|:',
  '^:',
  ',:',
  '#:',
  '_:',
  '$:',
  '?:',
  '@:',
  '.:',
  '=:',
  '~:',
  '!:',
  '+',
  '-',
  '*',
  '%',
  '&',
  '|',
  '^',
  '=',
  '<',
  '>',
  ',',
  '#',
  '_',
  '$',
  '?',
  '@',
  '.',
  '!',
  '~',
  ':',
  "'",
];

const ADVERBS = ["':", '/:', '\\:', "'", '/', '\\'];

export const CONTROL_WORDS = new Set(['if', 'do', 'while']);
export const QSQL_WORDS = new Set(['select', 'exec', 'update', 'delete']);
export const RESERVED = new Set([
  ...CONTROL_WORDS,
  ...QSQL_WORDS,
  'from',
  'by',
  'where',
  'fby',
]);

const isDigit = (c: string) => c >= '0' && c <= '9';
const isAlpha = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
const isNameStart = (c: string) => isAlpha(c); // q names start with a letter
const isNameChar = (c: string) => isAlpha(c) || isDigit(c) || c === '_';

export function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  const push = (t: Tok) => toks.push(t);
  const lastTok = () => (toks.length ? toks[toks.length - 1] : null);

  const atLineStart = (p: number) => {
    let j = p - 1;
    while (j >= 0 && (src[j] === ' ' || src[j] === '\t')) j--;
    return j < 0 || src[j] === '\n';
  };

  while (i < n) {
    const c = src[i];

    // whitespace
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      const nxt = src[i + 1];
      push({ k: 'nl', s: '\n', i, e: i + 1, v: nxt === ' ' || nxt === '\t' });
      i++;
      continue;
    }

    // comments
    if (c === '/') {
      const prev = i > 0 ? src[i - 1] : '\n';
      const lineStart = atLineStart(i);
      if (lineStart) {
        // whole-line comment, or block comment when alone on its line
        let j = i + 1;
        while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\r')) j++;
        if (j >= n || src[j] === '\n') {
          // block comment until a line containing only \
          let k = j;
          while (k < n) {
            const eol = src.indexOf('\n', k);
            const line = src.slice(k, eol === -1 ? n : eol).trim();
            if (line === '\\') {
              k = eol === -1 ? n : eol + 1;
              break;
            }
            if (eol === -1) {
              k = n;
              break;
            }
            k = eol + 1;
          }
          i = k;
          continue;
        }
        const eol = src.indexOf('\n', i);
        i = eol === -1 ? n : eol;
        continue;
      }
      if (prev === ' ' || prev === '\t') {
        const eol = src.indexOf('\n', i);
        i = eol === -1 ? n : eol;
        continue;
      }
    }

    // strings
    if (c === '"') {
      let j = i + 1;
      let out = '';
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\') {
          const d = src[j + 1];
          if (d === 'n') out += '\n';
          else if (d === 't') out += '\t';
          else if (d === 'r') out += '\r';
          else if (d === '\\') out += '\\';
          else if (d === '"') out += '"';
          else if (d >= '0' && d <= '7') {
            const oct = src.slice(j + 1, j + 4);
            out += String.fromCharCode(parseInt(oct, 8));
            j += 2;
          } else out += d;
          j += 2;
        } else {
          out += src[j];
          j++;
        }
      }
      if (j >= n) throw new QError('unmatched "', 'A string literal was never closed.');
      push({ k: 'str', s: src.slice(i, j + 1), i, e: j + 1, v: out });
      i = j + 1;
      continue;
    }

    // symbols
    if (c === '`') {
      let j = i + 1;
      if (src[j] === '"') {
        // `"quoted symbol"
        let k = j + 1;
        let out = '';
        while (k < n && src[k] !== '"') {
          out += src[k];
          k++;
        }
        push({ k: 'sym', s: src.slice(i, k + 1), i, e: k + 1, v: out });
        i = k + 1;
        continue;
      }
      let out = '';
      // extension: `#rrggbb / `#rgb colour symbols (q itself has no such literal)
      if (src[j] === '#') {
        const m = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_])/.exec(src.slice(j));
        if (m) {
          push({ k: 'sym', s: src.slice(i, j + m[0].length), i, e: j + m[0].length, v: m[0] });
          i = j + m[0].length;
          continue;
        }
      }
      if (src[j] === ':') {
        out += ':';
        j++;
      }
      while (j < n && (isNameChar(src[j]) || src[j] === '.' || src[j] === ':')) {
        out += src[j];
        j++;
      }
      push({ k: 'sym', s: src.slice(i, j), i, e: j, v: out });
      i = j;
      continue;
    }

    // numbers (incl. negative literals)
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1])) || (c === '-' && negOk(toks, src, i))) {
      const r = scanNumber(src, i);
      if (r) {
        push({ k: 'num', s: src.slice(i, r.e), i, e: r.e, t: r.t, v: r.v, x: r.x });
        i = r.e;
        continue;
      }
    }

    // names
    if (isNameStart(c) || (c === '.' && isNameStart(src[i + 1]))) {
      let j = i;
      if (src[j] === '.') j++;
      while (j < n && isNameChar(src[j])) j++;
      while (j < n && src[j] === '.' && isNameStart(src[j + 1])) {
        j++;
        while (j < n && isNameChar(src[j])) j++;
      }
      push({ k: 'name', s: src.slice(i, j), i, e: j });
      i = j;
      continue;
    }

    // brackets & separators
    const simple: Record<string, TokKind> = {
      '(': 'lparen',
      ')': 'rparen',
      '[': 'lbrack',
      ']': 'rbrack',
      '{': 'lbrace',
      '}': 'rbrace',
      ';': 'semi',
    };
    if (simple[c]) {
      push({ k: simple[c], s: c, i, e: i + 1 });
      i++;
      continue;
    }

    // adverbs: only when following a value-producing token
    const adv = ADVERBS.find((a) => src.startsWith(a, i));
    if (adv && advOk(lastTok())) {
      push({ k: 'adv', s: adv, i, e: i + adv.length });
      i += adv.length;
      continue;
    }

    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      // ":" forms: keep "::" and compound assignments distinct
      push({ k: 'op', s: op, i, e: i + op.length });
      i += op.length;
      continue;
    }

    if (c === '\\') {
      // a system command at the start of a line: \t 100  ->  system "t 100"
      const eol = src.indexOf('\n', i);
      const line = src.slice(i + 1, eol === -1 ? n : eol);
      if (atLineStart(i) && /^[a-zA-Z]/.test(line)) {
        push({ k: 'name', s: 'system', i, e: i + 1 });
        push({ k: 'str', s: JSON.stringify(line), i: i + 1, e: eol === -1 ? n : eol, v: line });
      }
      i = eol === -1 ? n : eol;
      continue;
    }

    throw new QError(
      'char',
      `Unexpected character ${JSON.stringify(c)} at position ${i}.`
    );
  }
  push({ k: 'eof', s: '', i: n, e: n });
  return toks;
}

function advOk(prev: Tok | null): boolean {
  if (!prev) return false;
  return (
    prev.k === 'name' ||
    prev.k === 'op' ||
    prev.k === 'rparen' ||
    prev.k === 'rbrack' ||
    prev.k === 'rbrace' ||
    prev.k === 'adv' ||
    prev.k === 'num' ||
    prev.k === 'sym' ||
    prev.k === 'str'
  );
}

/** Can a '-' here begin a negative numeric literal? */
function negOk(toks: Tok[], src: string, i: number): boolean {
  const nx = src[i + 1];
  if (!(isDigit(nx) || (nx === '.' && isDigit(src[i + 2])))) return false;
  const prevCh = i > 0 ? src[i - 1] : '';
  const spaced = prevCh === '' || prevCh === ' ' || prevCh === '\t' || prevCh === '\n';
  const prev = toks.length ? toks[toks.length - 1] : null;
  if (!prev) return true;
  // "A minus sign is always the function if the token to the left is a name,
  //  a constant, a right parenthesis or a right bracket, and there is no space
  //  between that token and the minus sign."  -- q syntax reference
  if (spaced) return true;
  return (
    prev.k === 'op' ||
    prev.k === 'lparen' ||
    prev.k === 'lbrack' ||
    prev.k === 'semi' ||
    prev.k === 'lbrace' ||
    prev.k === 'nl' ||
    prev.k === 'adv'
  );
}

interface NumRes {
  e: number;
  t: number;
  v: any;
  x?: boolean;
}

const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysFromEpoch(y: number, m: number, d: number): number {
  // days since 2000.01.01 (Date.UTC maps years 0-99 into the 1900s)
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d);
  dt.setUTCHours(0, 0, 0, 0);
  return Math.round(dt.getTime() / 86400000 - 10957);
}

export function ymdFromDays(days: number): [number, number, number] {
  const ms = (days + 10957) * 86400000;
  const dt = new Date(ms);
  return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
}

function scanNumber(src: string, i: number): NumRes | null {
  const n = src.length;
  let j = i;
  if (src[j] === '-') j++;
  const neg = src[i] === '-';
  const startDigits = j;

  // hex bytes
  if (src[j] === '0' && (src[j + 1] === 'x' || src[j + 1] === 'X') && !neg) {
    let k = j + 2;
    let hex = '';
    while (k < n && /[0-9a-fA-F]/.test(src[k])) {
      hex += src[k];
      k++;
    }
    if (hex.length === 0) return null;
    if (hex.length <= 2) return { e: k, t: -4, v: parseInt(hex, 16) };
    const bytes: number[] = [];
    for (let p = 0; p + 1 < hex.length; p += 2) bytes.push(parseInt(hex.slice(p, p + 2), 16));
    return { e: k, t: 4, v: bytes };
  }

  // null / infinity forms 0N 0W 0n 0w with optional type char
  if (!neg && src[j] === '0' && (src[j + 1] === 'N' || src[j + 1] === 'W')) {
    const inf = src[j + 1] === 'W';
    let k = j + 2;
    let tc = '';
    if (k < n && /[hijefgpmdznuvt]/.test(src[k]) && !isNameChar(src[k + 1] || '')) {
      tc = src[k];
      k++;
    }
    const t = tc ? typeFromChar(tc) : 7;
    return { e: k, t: -t, v: inf ? infFor(t) : nullFor(t) };
  }
  if (src[j] === '0' && (src[j + 1] === 'n' || src[j + 1] === 'w') && !isNameChar(src[j + 2] || '')) {
    const isW = src[j + 1] === 'w';
    return { e: j + 2, t: -9, v: isW ? (neg ? -Infinity : Infinity) : NaN };
  }

  let k = j;
  while (k < n && isDigit(src[k])) k++;
  if (k === startDigits && src[k] !== '.') return null;

  // date / month / timestamp:  2024.01.31 , 2024.01m , 2024.01.31D...
  if (src[k] === '.' && k - startDigits === 4 && isDigit(src[k + 1])) {
    const y = parseInt(src.slice(startDigits, k), 10);
    let p = k + 1;
    let mm = '';
    while (p < n && isDigit(src[p])) {
      mm += src[p];
      p++;
    }
    if (src[p] === 'm') {
      const months = (y - 2000) * 12 + (parseInt(mm, 10) - 1);
      return { e: p + 1, t: -13, v: months };
    }
    if (src[p] === '.') {
      let q = p + 1;
      let dd = '';
      while (q < n && isDigit(src[q])) {
        dd += src[q];
        q++;
      }
      const days = daysFromEpoch(y, parseInt(mm, 10), parseInt(dd, 10));
      if (src[q] === 'D' || src[q] === 'T') {
        const isT = src[q] === 'T';
        const tr = scanTimePart(src, q + 1);
        if (isT) {
          const ms = tr.nanos / 1e6;
          return { e: tr.e, t: -15, v: days + ms / 86400000 };
        }
        return { e: tr.e, t: -12, v: BigInt(days) * 86400000000000n + BigInt(Math.round(tr.nanos)) };
      }
      return { e: q, t: -14, v: days };
    }
  }

  // timespan 0D01:02:03.000000000  or  3D
  if (src[k] === 'D') {
    const days = parseInt(src.slice(startDigits, k), 10) || 0;
    let e = k + 1;
    let nanos = 0n;
    if (isDigit(src[e])) {
      const tr = scanTimePart(src, e);
      nanos = BigInt(Math.round(tr.nanos));
      e = tr.e;
    }
    const total = BigInt(days) * 86400000000000n + nanos;
    return { e, t: -16, v: neg ? -total : total };
  }

  // time-like  12:34 , 12:34:56 , 12:34:56.789
  if (src[k] === ':' && isDigit(src[k + 1])) {
    const hh = parseInt(src.slice(startDigits, k), 10);
    let p = k + 1;
    let mm = '';
    while (p < n && isDigit(src[p])) {
      mm += src[p];
      p++;
    }
    if (src[p] === ':' && isDigit(src[p + 1])) {
      let q = p + 1;
      let ss = '';
      while (q < n && isDigit(src[q])) {
        ss += src[q];
        q++;
      }
      if (src[q] === '.') {
        let r = q + 1;
        let frac = '';
        while (r < n && isDigit(src[r])) {
          frac += src[r];
          r++;
        }
        const ms = Math.round(parseFloat('0.' + frac) * 1000);
        const v = ((hh * 60 + parseInt(mm, 10)) * 60 + parseInt(ss, 10)) * 1000 + ms;
        return { e: r, t: -19, v: neg ? -v : v };
      }
      const v = (hh * 60 + parseInt(mm, 10)) * 60 + parseInt(ss, 10);
      return { e: q, t: -18, v: neg ? -v : v };
    }
    const v = hh * 60 + parseInt(mm, 10);
    return { e: p, t: -17, v: neg ? -v : v };
  }

  // plain numbers
  let isFloat = false;
  if (src[k] === '.') {
    isFloat = true;
    k++;
    while (k < n && isDigit(src[k])) k++;
  }
  if ((src[k] === 'e' || src[k] === 'E') && (isDigit(src[k + 1]) || ((src[k + 1] === '-' || src[k + 1] === '+') && isDigit(src[k + 2])))) {
    isFloat = true;
    k += 2;
    while (k < n && isDigit(src[k])) k++;
  }
  const text = src.slice(i, k);
  let t = isFloat ? -9 : -7;
  let e = k;
  let explicit = false;
  const suf = src[k];
  if (suf && /[bhijefxg]/.test(suf) && !isNameChar(src[k + 1] || '')) {
    if (suf === 'b') {
      const digits = text.replace('-', '');
      if (/^[01]+$/.test(digits)) {
        if (digits.length === 1) return { e: k + 1, t: -1, v: +digits, x: true };
        return { e: k + 1, t: 1, v: digits.split('').map(Number), x: true };
      }
    } else if (suf === 'h') {
      t = -5;
      e = k + 1;
      explicit = true;
    } else if (suf === 'i') {
      t = -6;
      e = k + 1;
      explicit = true;
    } else if (suf === 'j') {
      t = -7;
      e = k + 1;
      explicit = true;
    } else if (suf === 'e') {
      t = -8;
      e = k + 1;
      explicit = true;
    } else if (suf === 'f') {
      t = -9;
      e = k + 1;
      explicit = true;
    }
  }
  const v = parseFloat(text);
  return { e, t, v: t === -9 || t === -8 ? v : Math.trunc(v), x: explicit };
}

function scanTimePart(src: string, i: number): { e: number; nanos: number } {
  let j = i;
  const nums: number[] = [];
  let frac = 0;
  const readInt = () => {
    let s = '';
    while (j < src.length && isDigit(src[j])) {
      s += src[j];
      j++;
    }
    return s === '' ? 0 : parseInt(s, 10);
  };
  nums.push(readInt());
  if (src[j] === ':') {
    j++;
    nums.push(readInt());
    if (src[j] === ':') {
      j++;
      nums.push(readInt());
      if (src[j] === '.') {
        j++;
        let s = '';
        while (j < src.length && isDigit(src[j])) {
          s += src[j];
          j++;
        }
        s = (s + '000000000').slice(0, 9);
        frac = parseInt(s, 10);
      }
    }
  }
  const [h = 0, m = 0, s = 0] = nums;
  return { e: j, nanos: ((h * 3600 + m * 60 + s) * 1e9 + frac) };
}

export function typeFromChar(c: string): number {
  const map: Record<string, number> = {
    b: 1,
    g: 2,
    x: 4,
    h: 5,
    i: 6,
    j: 7,
    e: 8,
    f: 9,
    c: 10,
    s: 11,
    p: 12,
    m: 13,
    d: 14,
    z: 15,
    n: 16,
    u: 17,
    v: 18,
    t: 19,
    '*': 0,
  };
  const t = map[c];
  if (t === undefined) throw new QError('type', `Unknown type character "${c}".`);
  return t;
}

function nullFor(t: number): any {
  if (t === 9 || t === 8 || t === 15) return NaN;
  if (t === 12 || t === 16) return -9223372036854775808n;
  if (t === 7) return -9223372036854775808;
  if (t === 6 || t === 13 || t === 14 || t === 17 || t === 18 || t === 19) return -2147483648;
  if (t === 5) return -32768;
  if (t === 2) return '00000000-0000-0000-0000-000000000000';
  return -9223372036854775808;
}

function infFor(t: number): any {
  if (t === 9 || t === 8 || t === 15) return Infinity;
  if (t === 12 || t === 16) return 9223372036854775807n;
  if (t === 7) return 9223372036854775808;
  if (t === 6 || t === 13 || t === 14 || t === 17 || t === 18 || t === 19) return 2147483647;
  if (t === 5) return 32767;
  return 9223372036854775808;
}
