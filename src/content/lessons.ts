// The course. Every snippet here is executed by the same interpreter the
// playground uses, and the test-suite runs all of them.

export interface Block {
  kind: 'text' | 'code' | 'sketch' | 'note';
  text?: string;
  code?: string;
  /** the snippet is *meant* to fail (used in the error lesson) */
  err?: boolean;
}

export interface Challenge {
  prompt: string;
  starter: string;
  /** q expression that must evaluate to 1b once the learner's code has run */
  check: string;
  /** a known-good answer, used by the test-suite (and the Solution button) */
  solution: string;
  hint?: string;
}

export interface Lesson {
  id: string;
  title: string;
  blurb: string;
  blocks: Block[];
  challenge?: Challenge;
}

const t = (text: string): Block => ({ kind: 'text', text });
const c = (code: string): Block => ({ kind: 'code', code });
const bad = (code: string): Block => ({ kind: 'code', code, err: true });
const s = (code: string): Block => ({ kind: 'sketch', code });
const n = (text: string): Block => ({ kind: 'note', text });

export const LESSONS: Lesson[] = [
  {
    id: 'atoms',
    title: 'Atoms and vectors',
    blurb: 'Everything is data. Most things are lists.',
    blocks: [
      t(
        'q has no scalars-versus-arrays distinction to worry about: an operation on a single value works the same on a million of them. A single value is an **atom**, a list of values of one type is a **vector**.'
      ),
      c('2+3'),
      c('1 2 3 4 * 10'),
      t('Vectors are written with spaces, no commas and no brackets. Mixing them with atoms just works — the atom is reused for every item:'),
      c('1 2 3 + 100'),
      c('1 2 3 + 10 20 30'),
      t('`til n` gives you the first n integers, and `count` measures anything:'),
      c('til 10'),
      c('count til 10'),
      n(
        'Try editing any snippet and pressing Evaluate. The console panel shows exactly what a real q session would print.'
      ),
    ],
    challenge: {
      prompt: 'Make `v` the first 20 even numbers (0 2 4 … 38).',
      starter: 'v:',
      check: 'v ~ 2*til 20',
      solution: 'v:2*til 20',
      hint: 'til 20 gives 0..19. What turns that into evens?',
    },
  },
  {
    id: 'right-to-left',
    title: 'Right to left',
    blurb: 'The one rule that makes q look strange, and then obvious.',
    blocks: [
      t(
        'q has **no operator precedence**. Expressions are evaluated from right to left, so `2*3+4` is 2 times (3+4), not (2 times 3) plus 4.'
      ),
      c('2*3+4'),
      c('(2*3)+4'),
      t(
        'Read a q expression the way you would read English right-to-left: *"sum of the first ten integers"* is literally `sum til 10`.'
      ),
      c('sum til 10'),
      c('count where 0 = (til 20) mod 3'),
      n(
        'The Trace button (next to Run) peels an expression apart and shows every intermediate value, right to left — along with its parse tree. It is the fastest way to build intuition.'
      ),
      t('You can see the tree yourself. `parse` turns source into the nested lists q actually evaluates, and `eval` runs them:'),
      c('parse "2*3+4"'),
      c('eval parse "2*3+4"'),
    ],
    challenge: {
      prompt: 'Compute the average of the squares of 1..10 into `a`.',
      starter: 'a:',
      check: 'a ~ avg x*x:1+til 10',
      solution: 'a:avg x*x:1+til 10',
      hint: 'avg of (x*x) where x is 1+til 10. You can assign inside an expression.',
    },
  },
  {
    id: 'lists',
    title: 'Slicing lists',
    blurb: 'Index, filter, sort, reverse.',
    blocks: [
      t('Indexing uses brackets — or just juxtaposition, since a list *is* a function from index to value.'),
      c('v:10 20 30 40 50\nv[2]'),
      c('v 0 4'),
      t('`where` turns a boolean vector into the indices of the 1s. It is the workhorse of q filtering:'),
      c('v>25'),
      c('where v>25'),
      c('v where v>25'),
      t('Some more one-word tools:'),
      c('reverse v'),
      c('asc 3 1 2'),
      c('4 3 1 2 5 iasc 4 3 1 2 5'),
      c('distinct 1 1 2 3 3 3'),
      c('sums 1 2 3 4'),
    ],
    challenge: {
      prompt: 'From `p:34 12 88 5 61`, put the values above 30 into `big`, in descending order.',
      starter: 'p:34 12 88 5 61\nbig:',
      check: 'big ~ 88 61 34',
      solution: 'p:34 12 88 5 61\nbig:desc p where p>30',
      hint: 'desc sorts descending; p where p>30 filters.',
    },
  },
  {
    id: 'functions',
    title: 'Functions',
    blurb: 'Braces, implicit arguments, projections.',
    blocks: [
      t('A function is a pair of braces. If you do not name the arguments you get `x`, `y` and `z` for free:'),
      c('sq:{x*x}\nsq 7'),
      c('sq 1 2 3 4'),
      c('{[a;b] a+b*b}[2;3]'),
      t(
        'Give a two-argument function only its first argument and you get a **projection** — a new function waiting for the rest:'
      ),
      c('add10:10+\nadd10 1 2 3'),
      c('half:{x%2}\nhalf 10 20'),
      n('`%` is divide in q (not modulo — that is `mod`). Division always gives floats.'),
    ],
    challenge: {
      prompt: 'Write `norm`, a function that rescales a vector so its values run from 0 to 1.',
      starter: 'norm:{ }',
      check: '(norm 10 20 30) ~ 0 0.5 1f',
      solution: 'norm:{(x-min x)%max[x]-min x}',
      hint: 'Subtract the minimum, then divide by the range.',
    },
  },
  {
    id: 'iterators',
    title: 'Iterators',
    blurb: 'each, over and scan replace loops.',
    blocks: [
      t('`each` applies a function item by item. Most primitives do not need it — they are already atomic — but it matters for nested data:'),
      c('count each ("abc";"de";"f")'),
      t('`over` (`/`) folds a list down to one value; `scan` (`\\`) keeps the running results:'),
      c('(+/) 1 2 3 4'),
      c('(+\\) 1 2 3 4'),
      c('{x*y} over 1 2 3 4 5'),
      t('With a starting value on the left you get the classic accumulator:'),
      c('100 +\\ 1 2 3'),
      t('And with an integer on the left, a function is applied that many times — a loop with no loop:'),
      c('5 {2*x}\\ 1'),
      n('`sums`, `prds`, `maxs`, `mins`, `deltas` and `ratios` are named shortcuts for the most common scans.'),
    ],
    challenge: {
      prompt: 'Build `fib`, the first 12 Fibonacci numbers starting 1 1.',
      starter: 'fib:',
      check: 'fib ~ 1 1 2 3 5 8 13 21 34 55 89 144',
      solution: 'fib:{x,sum -2#x}/[10;1 1]',
      hint: 'Apply {x,sum -2#x} ten times to the starting pair 1 1.',
    },
  },
  {
    id: 'dicts',
    title: 'Dictionaries',
    blurb: 'Keys to values — and the thing tables are made of.',
    blocks: [
      t('`!` makes a dictionary from a list of keys and a list of values:'),
      c('d:`ada`grace`alan!1815 1906 1912\nd'),
      c('d`grace'),
      c('key d'),
      c('value d'),
      t('Arithmetic and filtering work on the values, keeping the keys attached:'),
      c('d+100'),
      c('where d>1900'),
    ],
    challenge: {
      prompt: 'Build a dictionary `sizes` mapping `small`medium`large to 10, 20 and 40.',
      starter: 'sizes:',
      check: 'sizes ~ `small`medium`large!10 20 40',
      solution: 'sizes:`small`medium`large!10 20 40',
    },
  },
  {
    id: 'tables',
    title: 'Tables',
    blurb: 'A table is a flipped dictionary of columns.',
    blocks: [
      t('Write a table literal with `([] col:values; col:values)`. Every column is a vector, and they must be the same length.'),
      c('t:([] city:`london`paris`rome; pop:8.9 2.1 2.8)\nt'),
      t('A table really is a dictionary of columns, transposed. `flip` shows it:'),
      c('flip t'),
      c('t`pop'),
      c('count t'),
      t('Index a table by row to get a dictionary back:'),
      c('t 1'),
      t('And keyed tables use a key block:'),
      c('([city:`london`paris] pop:8.9 2.1)'),
    ],
    challenge: {
      prompt: 'Make a table `stars` with columns `name` (`sun`vega`rigel) and `mag` (-26.7 0.03 0.13).',
      starter: 'stars:',
      check: 'stars ~ ([] name:`sun`vega`rigel; mag:-26.7 0.03 0.13)',
      solution: 'stars:([] name:`sun`vega`rigel; mag:-26.7 0.03 0.13)',
    },
  },
  {
    id: 'qsql',
    title: 'select and friends',
    blurb: 'qSQL: familiar words, q semantics.',
    blocks: [
      c(
        't:([] sym:`aapl`msft`aapl`nvda`msft; px:187.2 402.1 189.0 875.3 399.5; sz:100 250 400 50 125)\nt'
      ),
      t('`select` with a `where` clause filters rows. Commas mean *and*, evaluated left to right:'),
      c('select from t where px>200'),
      c('select sym, notional:px*sz from t where sz>100'),
      t('`by` groups. The result is a keyed table, sorted by the key:'),
      c('select sum sz, avg px by sym from t'),
      t('`update` adds or replaces columns, `delete` removes rows or columns:'),
      c('update big:sz>200 from t'),
      c('delete sz from t'),
      n(
        'Inside a select, column names are ordinary variables, and `i` is the row number. That is why `select from t where i<3` takes the first three rows.'
      ),
    ],
    challenge: {
      prompt: 'From the table `t` above, produce `res`: total `sz` per `sym`, as a keyed table with the column named `total`.',
      starter:
        't:([] sym:`aapl`msft`aapl`nvda`msft; px:187.2 402.1 189.0 875.3 399.5; sz:100 250 400 50 125)\nres:',
      check: 'res ~ select total:sum sz by sym from t',
      solution:
        't:([] sym:`aapl`msft`aapl`nvda`msft; px:187.2 402.1 189.0 875.3 399.5; sz:100 250 400 50 125)\nres:select total:sum sz by sym from t',
    },
  },
  {
    id: 'first-picture',
    title: 'Your first picture',
    blurb: 'A scene is a table. Every row is a shape.',
    blocks: [
      t(
        'Here is the whole idea of this playground: **a drawing is a table**. One row per shape, one column per property. `draw` renders it.'
      ),
      s(
        'bg `#0b0e13\ndraw ([] shape:`circle`rect`tri;\n       x:120 260 400;\n       y:150 150 150;\n       r:50 40 45;\n       fill:`crimson`gold`mint)'
      ),
      t(
        'Missing columns fall back to sensible defaults, so the smallest possible scene is just some coordinates:'
      ),
      s('draw ([] x:100 200 300; y:100 160 220)'),
      t(
        'Because it is a table, you build pictures with the tools you already learned. `til`, `update`, `where` — no drawing API to memorise:'
      ),
      s(
        'bg `#07090d\ni:til 40\ndraw ([] x:20+18*i; y:200+120*sin 0.3*i; r:4+3*i%10; fill:hsv[i%40;0.6;1])'
      ),
      t(
        'Writing the table out by hand gets old, so there are **constructors** for the common shapes. They return ordinary tables too, and `,` joins them into one scene:'
      ),
      s(
        'bg `#0b0e13\nu:.p5.w%5\ncircles[u*1 2;.p5.cy;30;`crimson`gold],rects[u*3;.p5.cy;70;50;`mint],tris[u*4;.p5.cy;34;`#b892ff]'
      ),
      n(
        'Constructors: `circles[x;y;r]` `rings` `rects[x;y;w;h]` `squares[x;y;s]` `bars[x;y0;w;h]` `lines[x;y;x2;y2]` `tris[x;y;r]` `ngons[x;y;r;n]` `points[x;y]` `texts[x;y;txt]` `arcs[x;y;r;a0;a1]` `path[xs;ys]` `poly[xs;ys]`. Each takes an optional colour as a final argument.'
      ),
      t('And four combinators restyle a whole scene at once:'),
      c('paint[circles[100 200;100;30];`gold]'),
      n(
        '`paint` sets fill · `outline` sets stroke · `fade` sets alpha · `spin` rotates · `nudge[scene;dx;dy]` moves. Shapes: `circle `ring `rect `box `line `tri `ngon `text `point `path `poly `arc `ellipse. Columns: x y r w h x2 y2 rot fill stroke sw a txt size pts n round.'
      ),
      t('For data, `plot` and `scatter` scale a vector to the canvas for you:'),
      s('bg `#07090d\nwalk:sums (200?1.0)-0.5\nplot (walk; 20 mavg walk)'),
    ],
    challenge: {
      prompt: 'Draw a row of 10 circles of increasing radius. Store the scene in `scene` and draw it.',
      starter: 'scene:\ndraw scene',
      check: '(count scene) = 10',
      solution: 'scene:([] x:50+60*til 10; y:150; r:5+3*til 10; fill:`cyan)\ndraw scene',
      hint: 'x:50+60*til 10 spaces them out; r can be another vector.',
    },
  },
  {
    id: 'colour',
    title: 'Colour',
    blurb: 'Names, hex symbols, hsv, palettes.',
    blocks: [
      t(
        'A colour is a symbol: a name like `` `crimson ``, or a hex literal like `` `#ff6b6b ``. `hsv` and `rgb` build them, and are vectorised.'
      ),
      c('hsv[0.6;0.7;1]'),
      c('rgb[255;107;107]'),
      t('`pal` is a dictionary of ready-made palettes:'),
      c('key pal'),
      c('pal`sunset'),
      s(
        'bg `#0b0e13\np:pal`vapor\ni:til 40\ndraw ([] x:30+22*i; y:.p5.cy; r:16; fill:p i mod count p)'
      ),
      t('Rainbows are one `hsv` away, because the hue argument is just a vector:'),
      s('bg `black\ni:til 60\ndraw ([] x:12+16*i; y:.p5.cy; w:14; h:200; shape:`rect; fill:hsv[i%60;0.75;1])'),
    ],
  },
  {
    id: 'animation',
    title: 'Animation',
    blurb: 'A frame is a pure function of time.',
    blocks: [
      t(
        'Define a function called `frame` that takes the time in seconds and returns a scene table. The playground calls it about sixty times a second. No mutable state, no draw loop — just a function of `t`.'
      ),
      s(
        'bg `#07090d\nframe:{[t]\n  i:til 30;\n  ([] x:20+22*i; y:.p5.cy+90*sin[t+0.3*i]; r:8; fill:hsv[(i%30)+0.1*t;0.6;1]) }'
      ),
      t('Handy globals while a sketch runs:'),
      c('.p5.w'),
      n(
        '`.p5.t` seconds · `.p5.f` frame number · `.p5.w` `.p5.h` canvas size · `.p5.cx` `.p5.cy` centre · `.p5.mx` `.p5.my` pointer · `.p5.down` pressed · `.p5.touch` a table of touches.'
      ),
      t('Everything is still a table, so an animation can be filtered and joined like data:'),
      s(
        'bg `#07090d\nframe:{[t]\n  i:til 120;\n  s:([] x:i*.p5.w%120; y:.p5.cy+120*sin[(0.1*i)+2*t]; r:3; fill:`#5ec2ff);\n  hi:select from s where y<.p5.cy;\n  s,update r:7, fill:`#ff7ab2 from hi }'
      ),
    ],
    challenge: {
      prompt: 'Animate a single circle bouncing left and right across the canvas.',
      starter: 'frame:{[t] }',
      check: 'not (frame[0.0]~frame[1.0])',
      solution:
        'frame:{[t] ([] x:.p5.cx+(0.4*.p5.w)*sin t; y:.p5.cy; r:30; fill:`gold) }',
      hint: 'Use sin t to move x, and keep y fixed.',
    },
  },
  {
    id: 'interaction',
    title: 'Interaction',
    blurb: 'The pointer is just another variable.',
    blocks: [
      t('`.p5.mx` and `.p5.my` follow the mouse or finger. Because they are ordinary values you can put them straight into a table.'),
      s(
        'bg `#0a0d13\nframe:{[t]\n  k:til 12;\n  a:(2*pi*k%12)+t;\n  p:polar[70;a];\n  update x:.p5.mx+x, y:.p5.my+y, r:10, fill:hsv[k%12;0.7;1] from p }'
      ),
      t('`.p5.down` is true while the pointer is held, and `?[cond;a;b]` picks values elementwise:'),
      s(
        'bg `#0a0d13\nframe:{[t]\n  i:til 200;\n  d:?[.p5.down;120;40];\n  p:polar[d*sqrt i%200;i*2.4];\n  update x:.p5.cx+x, y:.p5.cy+y, r:3, fill:?[.p5.down;`#ff7ab2;`#5ec2ff] from p }'
      ),
      n('On a phone the whole canvas is a touch surface — `.p5.touch` is a table of active touches with x, y and id columns.'),
    ],
  },
  {
    id: 'state',
    title: 'State without loops',
    blurb: 'init, step, view — an animation as a fold.',
    blocks: [
      t(
        'Some sketches need memory. Instead of mutating globals, define three things: `init` (the starting state), `step[state;t]` (the next state) and `view[state]` (a scene table). The runtime folds `step` over time.'
      ),
      s(
        'bg `#06080c\ninit:([] x:200?800f; y:200?600f; vx:(200?2.0)-1; vy:(200?2.0)-1)\n\nstep:{[s;t]\n  s:update x:x+vx, y:y+vy from s;\n  s:update vx:?[(x<0)|x>.p5.w;neg vx;vx] from s;\n  update vy:?[(y<0)|y>.p5.h;neg vy;vy] from s }\n\nview:{[s] update shape:`circle, r:3, fill:`#7dd3fc from s }'
      ),
      t(
        'The state can be anything: a table of particles, a matrix, a dictionary, even a single number. This is the same shape as `over`/`scan` — the animation is a fold you can watch.'
      ),
      n('If you prefer mutation, `::` assigns to a global from inside a function: `count::count+1`.'),
    ],
    challenge: {
      prompt: 'Make a state sketch whose state is a single number that grows by 1 every frame.',
      starter: 'init:0\nstep:{[s;t] }\nview:{[s] }',
      check: '2 = step[step[init;0];0]',
      solution:
        'init:0\nstep:{[s;t] s+1}\nview:{[s] ([] x:.p5.cx; y:.p5.cy; r:1+s mod 100; fill:`gold)}',
    },
  },
  {
    id: 'input',
    title: 'Mouse and keyboard',
    blurb: 'Every input is just a q value you can read.',
    blocks: [
      t(
        'While a sketch runs, the pointer lives in `.p5.mx` and `.p5.my`, and `.p5.mouse` is a dictionary of the lot:'
      ),
      c('.p5.mouse'),
      s(
        'bg `#0a0d13\nframe:{[t]\n  k:til 12;\n  p:polar[70;(2*pi*k%12)+t];\n  r:update x:.p5.mx+x, y:.p5.my+y, r:9, fill:hsv[k%12;0.7;1] from p;\n  r,texts[.p5.mx;.p5.my-100;"follow me";12] }'
      ),
      t(
        'Keys are a symbol list in `.p5.keys`, and `pressed` asks about one (or several) directly. It is vectorised, so arithmetic on key state works:'
      ),
      c('pressed `left`right`space'),
      n(
        'Key names are what you would expect: `` `a `` .. `` `z ``, `` `left `` `` `right `` `` `up `` `` `down ``, `` `space ``, `` `enter ``, `` `shift ``. Typing in the editor never reaches the sketch — click the canvas first.'
      ),
      t('A steering demo: acceleration is the difference of two booleans.'),
      s(
        'bg `#07090d\ninit:`x`y`vx`vy!(.p5.cx;.p5.cy;0f;0f)\nstep:{[s;t]\n  s[`vx]:0.95*s[`vx]+0.5*pressed[`right]-pressed `left;\n  s[`vy]:0.95*s[`vy]+0.5*pressed[`down]-pressed `up;\n  s[`x]:(s[`x]+s`vx) mod .p5.w;\n  s[`y]:(s[`y]+s`vy) mod .p5.h;\n  s }\nview:{[s] circles[s`x;s`y;14;`gold],texts[80;24;"arrow keys";12] }'
      ),
      t('`.p5.down` is true while the pointer is held, `.p5.clicks` counts clicks, and `.p5.touch` is a table of active touches on a phone.'),
    ],
    challenge: {
      prompt: 'Write `speed`, a function of no arguments returning 2 when space is held and 1 otherwise.',
      starter: 'speed:{ }',
      check: '1 = speed[]',
      solution: 'speed:{1+pressed `space}',
      hint: 'A boolean is a number: 1+pressed `space.',
    },
  },
  {
    id: 'timers',
    title: 'Timers: \\t and .z.ts',
    blurb: 'How kdb+ schedules work — and a second way to animate.',
    blocks: [
      t(
        'Real kdb+ processes rarely have a draw loop. They set a **timer** and do periodic work in `.z.ts`. Both work here.'
      ),
      c('\\t 250        / fire every 250 milliseconds'),
      c('.z.ti        / the current interval'),
      t(
        'Assign a function to `.z.ts` and it is called on every tick, with the current timestamp as its argument. Anything you `draw` stays on the canvas until the next tick.'
      ),
      s(
        'bg `#0a0d13\nn:0\n\\t 200\n.z.ts:{[now]\n  n::n+1;\n  draw circles[.p5.cx;.p5.cy;20+8*n mod 9;hsv[0.05*n;0.6;1]],\n       texts[.p5.cx;.p5.cy+120;"tick ",string n;13] }'
      ),
      t(
        'That is the shape of a tickerplant: a timer appends rows to a table, and everything downstream reads the table. Here the "downstream" is a chart.'
      ),
      s(
        'bg `#0a0d13\ntrade:0#([] time:`time$(); px:`float$())\npx:100f\n\\t 100\n.z.ts:{[now]\n  px::px+0.5*(rand 1.0)-0.5;\n  `trade insert (`time$now; px);\n  if[300<count trade; trade::-300#trade];\n  draw plot trade`px }'
      ),
      t('The rest of the `.z` namespace is the clock, and it is always ticking:'),
      c('.z.D'),
      c('.z.T'),
      n(
        '`.z.p`/`.z.P` timestamp · `.z.t`/`.z.T` time · `.z.d`/`.z.D` date · `.z.z`/`.z.Z` datetime · `.z.n`/`.z.N` timespan. Lower case is UTC, upper case is local — exactly as in kdb+.'
      ),
      t('`\\t` with an expression instead of a number times it, in milliseconds:'),
      c('\\t sum til 100000'),
      t('Loops exist too, but you rarely want them. `do` and `while` are statements, not expressions:'),
      c('i:0; do[5; i+:2]; i'),
      c('i:0; while[i<10; i+:3]; i'),
      n('Prefer the iterators — `10 f/ x` does something ten times and gives you the answer back.'),
    ],
    challenge: {
      prompt: 'Set the timer to 500 milliseconds and confirm it with .z.ti.',
      starter: '',
      check: '500 = .z.ti',
      solution: '\\t 500',
    },
  },
  {
    id: 'timeseries',
    title: 'Time series',
    blurb: 'The kdb+ speciality: bucket, aggregate, plot.',
    blocks: [
      t('q was built for time. Temporal types are first-class, and arithmetic on them just works:'),
      c('09:30:00.000 + 1000*til 5'),
      c('2024.03.01 + til 5'),
      t('`xbar` rounds values down to a bucket — the single most useful function in market data:'),
      c('10 xbar 0 7 13 25 37'),
      c('00:05 xbar 09:31 09:36 09:44'),
      t('Put it together: fake some ticks, bucket them into five-minute bars, and you have a candlestick chart.'),
      c(
        'trade:([] time:09:00:00.000+1000*til 500; px:100+sums (500?0.4)-0.2)\nselect o:first px, h:max px, l:min px, c:last px by bar:00:05 xbar time from trade'
      ),
      n('Try the Candlesticks example in the gallery to see this drawn.'),
    ],
    challenge: {
      prompt: 'Bucket `t:09:00 09:07 09:12 09:31` into 15-minute buckets, into `b`.',
      starter: 't:09:00 09:07 09:12 09:31\nb:',
      check: 'b ~ 09:00 09:00 09:00 09:30',
      solution: 't:09:00 09:07 09:12 09:31\nb:00:15 xbar t',
    },
  },
  {
    id: 'sound',
    title: 'A table is a score',
    blurb: 'Sound from the same data structure.',
    blocks: [
      t(
        'The `play` verb takes a table with a frequency column `f` and optional `t` (start, seconds), `d` (duration) and `amp`. A melody is a table you can `select` from.'
      ),
      c('scale:220*1 1.125 1.25 1.333 1.5 1.667 1.875 2\nscale'),
      s(
        'notes:8#scale\nplay ([] f:notes; t:0.2*til 8; d:0.25; amp:0.2)\ndraw ([] x:60+70*til 8; y:.p5.cy-0.4*notes-220; r:18; fill:hsv[(til 8)%8;0.6;1])'
      ),
      n('`beep[freq;dur;amp]` plays a single tone. Browsers only allow audio after you interact with the page.'),
    ],
  },
  {
    id: 'idioms',
    title: 'Idioms worth stealing',
    blurb: 'Small phrases that show up everywhere.',
    blocks: [
      t('**Cross for grids** — `grid[nx;ny]` is a cross join, and cross joins build lattices:'),
      c('grid[3;2]'),
      t('**Group** turns a vector into a dictionary of indices, which is how `by` works underneath:'),
      c('group `a`b`a`c`b'),
      t('**Each-prior** compares neighbours — `deltas` is `-\':`:'),
      c('deltas 10 13 12 20'),
      t('**Amend at index** changes elements without a loop:'),
      c('@[10 20 30 40; 1 3; :; 0]'),
      t('**Vector conditional** picks elementwise:'),
      c('?[1 0 1 0b; `on; `off]'),
      t('**Rotate** shifts a list, wrapping around. It is how you write neighbour rules:'),
      c('1 rotate 1 2 3 4'),
      t('**Reshape** builds matrices:'),
      c('3 4#til 12'),
      t('**raze** flattens one level; **flip** transposes:'),
      c('raze 3 4#til 12'),
      c('flip 3 4#til 12'),
    ],
    challenge: {
      prompt: 'Using `grid` and `where`, build `d`: the grid coordinates of a 5×5 board where x equals y (the diagonal).',
      starter: 'd:',
      check: 'd ~ select from grid[5;5] where x=y',
      solution: 'd:select from grid[5;5] where x=y',
    },
  },
  {
    id: 'debug',
    title: 'When it goes wrong',
    blurb: 'Reading q errors.',
    blocks: [
      t(
        "q errors are terse: a single quote and a word. Here are the ones you will actually hit."
      ),
      t('**`\'length`** — vectors of different sizes in an atomic operation:'),
      bad('1 2 3 + 4 5'),
      t('**`\'type`** — wrong kind of data, like arithmetic on characters:'),
      bad('2 + "hi"'),
      t('**`\'rank`** — the wrong number of arguments:'),
      bad('{x+y}[1;2;3]'),
      t('**a bare name** — that name is not defined. Watch out for typos and for the fact that q is case sensitive.'),
      n(
        'This playground adds a plain-English hint under every error, and the Data tab shows every variable you have defined with its type and size.'
      ),
      t('`0N!x` prints a value in the middle of an expression and returns it — the q printf:'),
      c('sum 0N!2*til 5'),
    ],
  },
];
