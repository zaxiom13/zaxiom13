// The example gallery. Every example is plain q.

export interface Example {
  id: string;
  title: string;
  blurb: string;
  tags: string[];
  code: string;
}

export const EXAMPLES: Example[] = [
  {
    id: 'hello',
    title: 'Hello, table',
    blurb: 'A scene is just a table. Every row is a shape.',
    tags: ['start'],
    code: `/ A scene is a TABLE. One row = one shape.
/ Ctrl+Enter (or the Run button) draws it.
bg \`#0e1116

scene:([]
  shape:\`circle\`circle\`circle\`rect\`text;
  x:120 220 320 420 260;
  y:160 160 160 160 260;
  r:40 40 40 30 0;
  w:0 0 0 90 0;
  h:0 0 0 60 0;
  fill:\`#ff6b6b\`#ffd93d\`#6bcb77\`#4d96ff\`white;
  txt:("";"";"";"";"tables are pictures"))

draw scene`,
  },
  {
    id: 'grid',
    title: 'Grid of dots',
    blurb: 'til, cross and update: build a lattice, colour it by position.',
    tags: ['start', 'tables'],
    code: `/ grid[nx;ny] is a table of coordinates - it is just a cross join.
bg \`#0b0e13

g:grid[16;10]
g:update x:40+40*x, y:40+40*y from g
g:update r:6+4*sin[0.35*i], fill:hsv[i%40;0.6;1] from g

draw g`,
  },
  {
    id: 'sine',
    title: 'Sine field',
    blurb: 'Animation is a pure function of time returning a table.',
    tags: ['animation'],
    code: `/ Define frame:{[t] ...} and it is called ~60x a second.
/ t is seconds since you pressed Run.
bg \`#080b10

n:90
frame:{[t]
  i:til n;
  x:(.p5.w%n)*0.5+i;
  y:.p5.cy+120*sin[(0.15*i)+3*t];
  ([] x:x; y:y; r:4+3*sin[(0.3*i)-2*t]; fill:hsv[(i%n)+0.1*t;0.65;1]) }`,
  },
  {
    id: 'orbit',
    title: 'Mouse orbit',
    blurb: 'Interactivity: .p5.mx and .p5.my are ordinary q variables.',
    tags: ['animation', 'input'],
    code: `bg \`#0a0d13

frame:{[t]
  k:til 24;
  a:(2*pi*k%24)+0.6*t;
  d:60+40*sin[t+k];
  p:polar[d;a];
  ring:update x:.p5.mx+x, y:.p5.my+y, r:5+3*cos[t*2+k],
              fill:hsv[(k%24)+0.05*t;0.7;1] from p;
  cursor:([] shape:\`ring; x:.p5.mx; y:.p5.my; r:100+20*sin 2*t; stroke:\`#2a3b4d; sw:2);
  ring,cursor }`,
  },
  {
    id: 'walk',
    title: 'Random walk',
    blurb: 'sums turns steps into a path — the classic kdb+ one-liner.',
    tags: ['tables', 'finance'],
    code: `/ A price path: cumulative sums of random steps.
bg \`#0a0d13
n:400
px:100+sums (n?1.0)-0.5

t:([] i:til n; px:px)
t:update x:remap[i;0;n-1;40;.p5.w-40], y:remap[px;min px;max px;.p5.h-60;60] from t

path:([] shape:\`path; pts:enlist flip (t\`x;t\`y); stroke:\`#5ec2ff; sw:2)
dots:select shape:\`circle, x, y, r:2, fill:\`#1f6feb from t where 0=i mod 8
path,dots`,
  },
  {
    id: 'candles',
    title: 'Candlesticks (xbar)',
    blurb: 'Bucket ticks by time with xbar, aggregate OHLC, draw the result.',
    tags: ['finance', 'qsql'],
    code: `/ Synthetic tick data, bucketed into candles - real kdb+ muscle memory.
bg \`#0a0d13
n:2000
trade:([] time:09:00:00.000+250*til n; px:100+sums (n?0.4)-0.2)

/ one candle per 5 minutes
c:select o:first px, h:max px, l:min px, c:last px
  by bar:00:05 xbar time from trade
c:0!c
c:update i:til count c from c

xs:remap[c\`i;0;-1+count c;50;.p5.w-30]
lo:min c\`l; hi:max c\`h
sy:{[v;lo;hi] remap[v;lo;hi;.p5.h-40;40]}
w:(.p5.w-80)%(count c)*1.6

wick:([] shape:\`line; x:xs; y:sy[c\`h;lo;hi]; x2:xs; y2:sy[c\`l;lo;hi]; stroke:\`#8fa1b3)
body:([] shape:\`rect; x:xs;
        y:0.5*sy[c\`o;lo;hi]+sy[c\`c;lo;hi];
        w:w; h:1|abs sy[c\`o;lo;hi]-sy[c\`c;lo;hi];
        fill:?[c[\`c]>c\`o;\`#26a65b;\`#e5484d])
wick,body`,
  },
  {
    id: 'life',
    title: "Conway's life",
    blurb: 'State mode: init / step / view. The board is a boolean matrix.',
    tags: ['animation', 'state'],
    code: `/ init, step and view: an animation as a fold over state.
bg \`#08090c
N:36

init:(N;N)#(N*N)?0 0 0 1b

shift:{[m;dx;dy] (dy rotate) each dx rotate m}
step:{[s;t]
  nbr:sum shift[s;;] ./: (1 1;1 0;1 -1;0 1;0 -1;-1 1;-1 0;-1 -1);
  (nbr=3)|s&nbr=2 }

view:{[s]
  g:grid[N;N];
  cell:16;
  g:update on:raze s from g;
  select shape:\`rect, x:cell*0.5+x, y:cell*0.5+y, w:cell-2, h:cell-2,
         fill:\`#7ee787 from g where on }`,
  },
  {
    id: 'phyllo',
    title: 'Phyllotaxis',
    blurb: 'The golden angle, one line of q, 900 dots.',
    tags: ['maths'],
    code: `bg \`#07090d
n:900
frame:{[t]
  k:til n;
  a:(k*2.399963)+0.15*t;
  r:6*sqrt k;
  p:polar[r;a];
  update x:.p5.cx+x, y:.p5.cy+y, r:1.5+3*k%n, fill:hsv[(k%n)+0.05*t;0.7;1] from p }`,
  },
  {
    id: 'lissajous',
    title: 'Lissajous',
    blurb: 'Two sines, one path, endless variety.',
    tags: ['maths', 'animation'],
    code: `bg \`#07090d
n:600
frame:{[t]
  u:(2*pi)*(til n)%n;
  x:.p5.cx+(0.36*.p5.w)*sin[3*u+0.3*t];
  y:.p5.cy+(0.36*.p5.h)*sin[4*u];
  ([] shape:\`path; pts:enlist flip (x;y); stroke:hsv[0.1*t;0.6;1]; sw:2) }`,
  },
  {
    id: 'rule110',
    title: 'Elementary automaton',
    blurb: 'vs and sv turn neighbourhoods into rule lookups.',
    tags: ['maths', 'bits'],
    code: `/ Rule 110, computed with base-2 decode (2 sv) and encode (2 vs).
bg \`#0a0d13
W:120
rule:110

rowStep:{[r] rule[7-2 sv/: flip (-1 rotate r;r;1 rotate r)]}
rule:reverse 8#(8#2)vs rule
r0:W#0b
r0[W div 2]:1b
rows:rowStep\\[70;r0]

cell:.p5.w%W
g:grid[W;count rows]
g:update on:raze rows from g
select shape:\`rect, x:cell*0.5+x, y:cell*0.5+y, w:cell, h:cell, fill:\`#c8f7c5 from g where on`,
  },
  {
    id: 'sortviz',
    title: 'Sorting, visualised',
    blurb: 'iasc gives you the permutation; watch it settle.',
    tags: ['animation', 'state'],
    code: `bg \`#0a0d13
n:60
init:n?100f

/ one bubble pass per frame
step:{[s;t]
  if[0=.p5.f mod 3;
    i:til n-1;
    j:where s[i]>s[i+1];
    j:j where 0=j mod 2;
    s:@[s;j,j+1;:;s[j+1],s j] ];
  s }

view:{[s]
  w:.p5.w%n;
  ([] shape:\`rect; x:w*0.5+til n; y:.p5.h-0.5*s*3; w:w-2; h:s*3;
      fill:hsv[s%140;0.6;1]) }`,
  },
  {
    id: 'score',
    title: 'A table is a score',
    blurb: 'Rows of frequencies become sound. Tap the canvas to replay.',
    tags: ['sound'],
    code: `/ Sound from a table. Tap Run again to hear it.
bg \`#120b16
scale:220*1 1.125 1.25 1.333 1.5 1.667 1.875 2
notes:16?scale

score:([] f:notes; t:0.18*til 16; d:0.22; amp:0.18)
play score

draw update shape:\`circle, x:40+(.p5.w-80)*t%3, y:.p5.cy-(f-220)*0.9,
            r:14, fill:hsv[(f%440);0.6;1] from score`,
  },
  {
    id: 'flow',
    title: 'Noise flow field',
    blurb: 'Perlin noise, vectorised over a whole table of particles.',
    tags: ['animation', 'state'],
    code: `bg \`#06080c
n:500
init:([] x:n?800f; y:n?600f)

step:{[s;t]
  a:(2*pi)*noise[0.004*s\`x;0.004*s\`y;0.15*t];
  s:update x:x+2.2*cos a, y:y+2.2*sin a from s;
  update x:x mod .p5.w, y:y mod .p5.h from s }

view:{[s] update shape:\`circle, r:1.6,
          fill:hsv[0.55+0.15*x%.p5.w;0.5;1], a:0.8 from s }`,
  },
  {
    id: 'bars',
    title: 'Group by, drawn',
    blurb: 'A bar chart is select ... by ... plus four columns of geometry.',
    tags: ['qsql', 'tables'],
    code: `bg \`#0b0e13
n:400
t:([] sym:n?\`AAPL\`MSFT\`GOOG\`AMZN\`NVDA; sz:n?100)

agg:0!select total:sum sz by sym from t
agg:update i:til count agg from agg
h:remap[agg\`total;0;max agg\`total;0;.p5.h-120]
w:(.p5.w-60)%1.4*count agg

bars:([] shape:\`rect; x:40+w*1.4*agg\`i; y:.p5.h-50-0.5*h; w:w; h:h; fill:pal[\`kdb] agg\`i)
labs:([] shape:\`text; x:40+w*1.4*agg\`i; y:.p5.h-30; txt:string agg\`sym; size:12; fill:\`#8fa1b3)
vals:([] shape:\`text; x:40+w*1.4*agg\`i; y:.p5.h-70-h; txt:string agg\`total; size:11; fill:\`#dfe7ef)
bars,labs,vals`,
  },
];
