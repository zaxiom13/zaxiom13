# q·sketch

**Learn q/kdb+ by drawing with it.** A complete q interpreter written from scratch in
TypeScript, wired to p5.js, running entirely in your browser — no server, no kdb+ licence,
nothing to install.

> A scene is a table. Every row is a shape. Build pictures with `select`, `update` and `where`.

```q
bg `#07090d
n:90
frame:{[t]
  i:til n;
  x:(.p5.w%n)*0.5+i;
  y:.p5.cy+120*sin[(0.15*i)+3*t];
  ([] x:x; y:y; r:4+3*sin[(0.3*i)-2*t]; fill:hsv[(i%n)+0.1*t;0.65;1]) }
```

## What's in here

- **A q interpreter** (`src/q/`) — lexer, parser, evaluator, 167 builtins, qSQL
  (`select`/`exec`/`update`/`delete` with `by` and `where`, plus the functional forms
  `?[t;c;b;a]` and `![t;c;b;a]`), dictionaries, keyed tables,
  joins, iterators (`each`/`over`/`scan`/`each-prior`/`each-left`/`each-right`),
  projections, temporal types, and a console formatter that reproduces q's own output.
- **A parity harness** (`tools/parity.mjs`, `parity/corpus.json`) — every runnable example
  from the [official kdb+ documentation](https://github.com/KxSystems/docs) is replayed
  against this interpreter and compared character-for-character with what KX prints.
  You can run it yourself from the **Parity** tab in the app.
- **A p5.js bridge** (`src/sketch/`) — tables become scenes, three animation styles,
  pointer/touch input, Perlin noise, colour helpers, and a tiny synth so a table can be a
  musical score.
- **A course** (`src/content/lessons.ts`) — eighteen lessons from atoms to candlesticks,
  each with runnable snippets and a checked challenge.
- **A gallery** (`src/content/examples.ts`) — candlesticks, Conway's life, flow fields,
  phyllotaxis, rule 110, a sorting visualiser and more, all in q.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # interpreter, examples and lesson snippets
npm run parity     # replay the kdb+ documentation corpus
npm run build      # static site in dist/
```

Everything is static: `dist/` can be dropped on any host (there is a GitHub Pages workflow
in `.github/workflows/`).

## The idea

kdb+ is famously terse and famously hard to *feel*. The fastest way to internalise
right-to-left evaluation, atomic operations and table thinking is to see them move.

So the drawing model is deliberately not an API. There is no `circle(x, y, r)`. There is a
table:

```q
draw ([] shape:`circle`rect`tri; x:120 260 400; y:150 150 150; r:50 40 45;
         fill:`crimson`gold`mint)
```

Which means everything you learn about q is immediately a drawing tool:

```q
/ a lattice: cross join
g:grid[16;10]
/ move it: update
g:update x:40+40*x, y:40+40*y from g
/ colour it: vectorised hsv
draw update r:6+4*sin[0.35*i], fill:hsv[i%40;0.6;1] from g
```

### Three ways to animate

| you define | you get |
| --- | --- |
| `frame:{[t] … }` returning a scene | a pure function of time, called ~60×/s |
| `init`, `step:{[s;t] … }`, `view:{[s] … }` | the animation as a fold over state |
| `draw:{[t] … }` calling `.p5.circle` etc. | classic immediate mode, if you insist |

While a sketch runs, `.p5.t`, `.p5.f`, `.p5.w`, `.p5.h`, `.p5.cx`, `.p5.cy`, `.p5.mx`,
`.p5.my`, `.p5.down` and `.p5.touch` are ordinary q values. The `q)` prompt under the
canvas talks to the *live* sketch, so you can pause it and poke at its state.

## How close is the interpreter to real kdb+?

The **Parity** tab answers that honestly, in your browser. Of the 2203 documentation
examples that ship with the app (the `ref/` and `basics/` pages):

- **75.8%** reproduce kdb+'s printed output character-for-character
- 224 need data we don't ship and are reported separately, never counted as passes
- the rest are listed with a diff, so nothing is swept under the rug

The full corpus (`npm run parity`, 3852 examples including the whitepapers) sits at
**72.4%**. Known gaps, roughly in order of how often they bite:

- **enumerations** (`` `sym$x ``, type 20+) are not implemented
- **`parse`** builds real parse trees for expressions and qSQL, but not for every
  exotic form
- **file, IPC and system verbs** (`0:`, `1:`, `hopen`, `\l`, …) are absent by design
- **error output** is the error name only — no `[0] expr ^` backtrace
- strings are UTF-16, not bytes, so `count "Zürich"` is 6 here and 7 in kdb+
- integer overflow wraps at 32 bits but not at 64 (JavaScript doubles)
- `timestamp`/`timespan` use BigInt and are exact; other temporals are doubles
- one deliberate *extension*: `` `#ff6b6b `` is a colour symbol literal, which real q would
  reject. Nothing else in the language was changed to make drawing convenient.

The corpus is regenerated with `node tools/scrape-corpus.mjs /path/to/KxSystems/docs`.

## Layout

```
src/q/          interpreter      value.ts lexer.ts parser.ts eval.ts format.ts trace.ts builtins/
src/sketch/     p5 bridge        runtime.ts scene.ts palette.ts audio.ts
src/ui/         interface        editor.ts inspector.ts lessons-view.ts reference-view.ts parity-view.ts
src/content/    course + gallery lessons.ts examples.ts reference-docs.ts
tools/          parity harness, corpus scraper, screenshots
test/           vitest: interpreter goldens, every example, every lesson snippet
```

## Credits

- Documentation examples used for parity testing come from
  [KxSystems/docs](https://github.com/KxSystems/docs), © KX Systems, licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). They are reproduced here as
  test fixtures.
- q and kdb+ are products of KX Systems. This project is an independent, unaffiliated
  reimplementation for teaching.
- Drawing by [p5.js](https://p5js.org), editing by [CodeMirror 6](https://codemirror.net).
