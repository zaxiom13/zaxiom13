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

/ four shapes, spread across whatever canvas you have
u:.p5.w%5
scene:([]
  shape:\`circle\`circle\`circle\`rect\`text;
  x:u*1 2 3 4 2.5;
  y:.p5.cy*0.85 0.85 0.85 0.85 1.6;
  r:0.28*u;
  w:0.55*u;
  h:0.4*u;
  fill:\`#ff6b6b\`#ffd93d\`#6bcb77\`#4d96ff\`white;
  txt:("";"";"";"";"tables are pictures"))

draw scene`,
  },
  {
    id: 'shapes',
    title: 'Shape helpers',
    blurb: 'circles, rects, texts, plot — table builders so you can skip the boilerplate.',
    tags: ['start'],
    code: `/ Every helper returns a table. Join them with , and they are one scene.
bg \`#0b0e13
u:.p5.w%6

a:circles[u*1 2 3;.p5.cy-40;28;\`#ff6b6b\`#ffd93d\`#6bcb77]
b:rects[u*4;.p5.cy-40;70;50;\`#4d96ff]
c:tris[u*5;.p5.cy-40;34;\`#b892ff]
d:rings[u*1 2 3 4 5;.p5.cy+60;22;\`#2a3b4d]
e:texts[.p5.cx;.p5.cy+140;"circles rects tris rings texts";13]

/ combinators tweak a whole scene at once
a,b,c,d,e`,
  },
  {
    id: 'plotting',
    title: 'Plot anything',
    blurb: 'plot and scatter scale your data to the canvas for you.',
    tags: ['start', 'data'],
    code: `/ plot y  ·  plot[x;y]  ·  scatter[x;y]  - auto-scaled to the canvas.
bg \`#07090d

walk:sums (300?1.0)-0.5
lines2:plot (walk; 20 mavg walk)     / one scale, two colours
dots:scatter[til 300;walk;2;\`#1f6feb]

dots,lines2,texts[130;24;"random walk (blue) + 20-point moving average (pink)";12]`,
  },
  {
    id: 'steer',
    title: 'Keyboard: steer a ship',
    blurb: 'pressed`left / .p5.keys — arrow keys or WASD, with a trail.',
    tags: ['input', 'state'],
    code: `/ Click the canvas once, then use the arrow keys (or WASD).
bg \`#07090d
init:\`x\`y\`vx\`vy\`trail!(.p5.cx;.p5.cy;0f;0f;())

step:{[s;t]
  ax:0.5*(pressed[\`right]|pressed[\`d])-pressed[\`left]|pressed \`a;
  ay:0.5*(pressed[\`down]|pressed[\`s])-pressed[\`up]|pressed \`w;
  boost:1+pressed \`space;
  s[\`vx]:0.95*s[\`vx]+ax*boost;
  s[\`vy]:0.95*s[\`vy]+ay*boost;
  s[\`x]:(s[\`x]+s\`vx) mod .p5.w;
  s[\`y]:(s[\`y]+s\`vy) mod .p5.h;
  s[\`trail]:(-120) sublist s[\`trail],enlist(s\`x;s\`y);
  s }

view:{[s]
  n:count s\`trail;
  tr:$[n; circles[s[\`trail][;0];s[\`trail][;1];1+3*(til n)%n;\`#1f6feb]; ()];
  ship:circles[s\`x;s\`y;13;\`gold];
  hud:texts[90;24;"keys: ",", " sv string .p5.keys;12];
  $[n; tr,ship,hud; ship,hud] }`,
  },
  {
    id: 'paint',
    title: 'Mouse: finger painting',
    blurb: 'Drag on the canvas. Every dot is a row appended to a table.',
    tags: ['input', 'state'],
    code: `/ Hold the mouse (or a finger) down and drag.
bg \`#0b0e13
init:([] x:\`float$(); y:\`float$(); r:\`float$(); c:\`symbol$())

step:{[s;t]
  if[not .p5.down; :s];
  s:s upsert (.p5.mx; .p5.my; 6+10*abs sin 2*t; hsv[0.1*t;0.65;1]);
  (-600) sublist s }

view:{[s] $[count s; fade[circles[s\`x;s\`y;s\`r;s\`c];0.75]; texts[.p5.cx;.p5.cy;"drag to paint";18]] }`,
  },
  {
    id: 'tick',
    title: 'Timer: a live tickerplant',
    blurb: '\\t and .z.ts — the kdb+ way to do periodic work.',
    tags: ['finance', 'timer'],
    code: `/ \\t sets a timer interval; .z.ts runs on every tick. This is how real
/ kdb+ processes schedule work - and it makes a fine animation clock.
bg \`#0a0d13
trade:0#([] time:\`time$(); px:\`float$())
px:100f

\\t 100

.z.ts:{[now]
  px::px+0.5*(rand 1.0)-0.5;
  \`trade insert (\`time$now; px);
  if[400<count trade; trade::-400#trade];
  n:count trade;
  chart:$[n>20; plot (trade\`px; 20 mavg trade\`px); plot trade\`px];
  hud:texts[110;24;"tick ",string[n]," px ",string 0.01*floor 100*px;13];
  draw chart,hud }`,
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
trade:([] time:09:00:00.000+1000*til n; px:100+sums (n?0.4)-0.2)

/ one candle per minute
c:select o:first px, h:max px, l:min px, c:last px
  by bar:00:01 xbar time.minute from trade
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
gen:{[s]
  nbr:sum shift[s;;] ./: (1 1;1 0;1 -1;0 1;0 -1;-1 1;-1 0;-1 -1);
  (nbr=3)|s&nbr=2 }

/ ten generations a second, not sixty
step:{[s;t] $[0=.p5.f mod 6; gen s; s] }

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
r0:W#0
r0[W div 2]:1
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

/ one bubble pass every few frames
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

draw update shape:\`circle, x:remap[t;0;max t;50;.p5.w-50],
            y:remap[f;min f;max f;.p5.h-60;60],
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
