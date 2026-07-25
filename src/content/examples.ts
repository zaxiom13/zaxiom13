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
    blurb: 'A scene is just a table. Every row is a shape with a 2-vector p.',
    tags: ['start'],
    code: `/ A scene is a TABLE. One row = one shape. Position is a 2-vector column p.
/ Ctrl+Enter (or the Run button) draws it.
bg \`#0e1116

/ four shapes, spread across whatever canvas you have
u:.p5.w%5
scene:([]
  shape:\`circle\`circle\`circle\`rect\`text;
  p:flip(u*1 2 3 4 2.5; .p5.cp[1]*0.85 0.85 0.85 0.85 1.6);
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
/ Positions are 2-vectors: a single point, or a list of points.
bg \`#0b0e13
u:.p5.w%6
cy:.p5.cp[1]

a:circles[flip(u*1 2 3;3#cy-40);28;\`#ff6b6b\`#ffd93d\`#6bcb77]
b:rects[(u*4;cy-40);70;50;\`#4d96ff]
c:tris[(u*5;cy-40);34;\`#b892ff]
d:rings[flip(u*1 2 3 4 5;5#cy+60);22;\`#2a3b4d]
e:texts[.p5.cp+0 140f;"circles rects tris rings texts";13]

/ one scene, drawn once
draw a,b,c,d,e`,
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

draw dots,lines2,texts[130 24f;"random walk (blue) + 20-point moving average (pink)";12]`,
  },
  {
    id: 'steer',
    title: 'Keyboard: steer a ship',
    blurb: 'pressed`left / .p5.keys — arrow keys or WASD, with a glowing trail.',
    tags: ['input', 'state'],
    code: `/ Click the canvas once, then use the arrow keys (or WASD).
/ State is p (position) and v (velocity) — classic integrate: v+=a; p+=v.
bg \`#07090d
init:\`p\`v\`trail!(.p5.cp;0 0f;())

frame:{[s;t]
  a:(0.5*(pressed[\`right]|pressed[\`d])-pressed[\`left]|pressed \`a;
      0.5*(pressed[\`down]|pressed[\`s])-pressed[\`up]|pressed \`w);
  boost:1+pressed \`space;
  s[\`v]:0.95*s[\`v]+a*boost;
  s[\`p]:(s[\`p]+s\`v) mod .p5.wh;
  s[\`trail]:(-120) sublist s[\`trail],enlist s\`p;

  n:count s\`trail;
  if[n; draw circles[s\`trail;1+3*(til n)%n;\`#1f6feb]];
  draw circles[s\`p;13;\`gold];
  draw texts[90 24f;"keys: ",", " sv string .p5.keys;12];
  s }`,
  },
  {
    id: 'paint',
    title: 'Mouse: finger painting',
    blurb: 'Drag on the canvas. Every dot is a row appended to a table.',
    tags: ['input', 'state'],
    code: `/ Hold the mouse (or a finger) down and drag. .p5.mp is the mouse 2-vector.
bg \`#0b0e13
init:([] p:(); r:\`float$(); c:\`symbol$())

frame:{[s;t]
  if[.p5.down;
    s:(-600) sublist s upsert (.p5.mp; 6+10*abs sin 2*t; hsv[0.1*t;0.65;1]) ];
  draw $[count s;
         fade[circles[s\`p;s\`r;s\`c];0.75];
         texts[.p5.cp;"drag to paint";18]];
  s }`,
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
  hud:texts[110 24f;"tick ",string[n]," px ",string 0.01*floor 100*px;13];
  draw chart,hud }`,
  },
  {
    id: 'julia',
    title: 'Julia set',
    blurb: 'The .c namespace: a whole complex plane, iterated every frame.',
    tags: ['complex', 'animation'],
    code: `/ z := z*z + c, for every pixel, sixty times a second.
bg \`black
W:130; H:95
zs:.c.grid[W;H;.c.z[-1.7;-1.2];.c.z[1.7;1.2]]   / the complex plane
xy:grid[W;H]                                    / where to draw each one (p column)
cw:.p5.w%W; ch:.p5.h%H

frame:{[t]
  c:.c.polar[0.7885;0.25*t];                    / c walks round a circle
  n:.c.escape[zs;c;48];                         / iterations survived
  s:update n:n, v:(n%48) xexp 0.45 from xy;     / gamma for contrast
  draw select shape:\`rect, p:flip(cw*(0.5+p[;0]);ch*(0.5+p[;1])), w:cw+1, h:ch+1,
              fill:?[n=48;\`#05060a;hsv[0.55+0.45*v;0.85;0.15+0.85*v]] from s }`,
  },
  {
    id: 'conformal',
    title: 'Conformal map',
    blurb: 'Push a grid of complex numbers through z², 1/z and friends.',
    tags: ['complex', 'animation'],
    code: `/ A conformal map moves the plane around while keeping angles.
bg \`#06080c
zs:.c.grid[70;70;.c.z[-1.6;-1.6];.c.z[1.6;1.6]]
hue:0.5+0.09*.c.arg zs                          / colour by where it started

frame:{[t]
  w:.c.add[.c.mul[zs;zs];.c.polar[0.9;0.4*t]];  / z^2 + a rotating constant
  w:.c.add[w;.c.mul[.c.inv .c.add[zs;.c.z[1.2;0]];0.35]];
  s:0.2*.p5.h;
  draw points[(.p5.cp)+/:flip(s*.c.re w;s*.c.im w); hsv[hue;0.7;1]] }`,
  },
  {
    id: 'grid',
    title: 'Grid of dots',
    blurb: 'til, cross and update: build a lattice, colour it by position.',
    tags: ['start', 'tables'],
    code: `/ grid[nx;ny] is a table of 2-vector coordinates - it is just a cross join.
bg \`#0b0e13

g:grid[16;10]
g:update p:40+40*p from g
g:update r:6+4*sin[0.35*i], fill:hsv[i%40;0.6;1] from g

draw g`,
  },
  {
    id: 'sine',
    title: 'Sine field',
    blurb: 'Animation is a pure function of time returning a table.',
    tags: ['animation'],
    code: `/ frame runs ~60 times a second; t is seconds since you pressed Run.
/ Call draw to put something on the canvas.
bg \`#080b10

n:90
frame:{[t]
  i:til n;
  p:flip((.p5.w%n)*0.5+i; .p5.cp[1]+120*sin[(0.15*i)+3*t]);
  draw circles[p; 4+3*sin[(0.3*i)-2*t]; hsv[(i%n)+0.1*t;0.65;1]] }`,
  },
  {
    id: 'orbit',
    title: 'Mouse orbit',
    blurb: 'Interactivity: .p5.mp is an ordinary q 2-vector.',
    tags: ['animation', 'input'],
    code: `bg \`#0a0d13

frame:{[t]
  k:til 24;
  a:(2*pi*k%24)+0.6*t;
  d:60+40*sin[t+k];
  ring:update p:(.p5.mp)+/:p, r:5+3*cos[t*2+k],
              fill:hsv[(k%24)+0.05*t;0.7;1] from polar[d;a];
  cursor:rings[.p5.mp; 100+20*sin 2*t; \`#2a3b4d];
  draw ring,cursor }`,
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

trace:([] shape:\`path; pts:enlist flip (t\`x;t\`y); stroke:\`#5ec2ff; sw:2)
dots:select shape:\`circle, p:flip(x;y), r:2, fill:\`#1f6feb from t where 0=i mod 8
draw trace,dots`,
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

wick:([] shape:\`line; p:flip(xs;sy[c\`h;lo;hi]); p2:flip(xs;sy[c\`l;lo;hi]); stroke:\`#8fa1b3)
body:([] shape:\`rect; p:flip(xs;0.5*sy[c\`o;lo;hi]+sy[c\`c;lo;hi]);
        w:w; h:1|abs sy[c\`o;lo;hi]-sy[c\`c;lo;hi];
        fill:?[c[\`c]>c\`o;\`#26a65b;\`#e5484d])
draw wick,body`,
  },
  {
    id: 'life',
    title: "Conway's life",
    blurb: 'State mode: init / step / view. The board is a boolean matrix.',
    tags: ['animation', 'state'],
    code: `/ frame with two parameters is a fold over time: s is the board.
bg \`#08090c
N:36

init:(N;N)#(N*N)?0 0 0 1b

shift:{[m;dx;dy] (dy rotate) each dx rotate m}
gen:{[s]
  nbr:sum shift[s;;] ./: (1 1;1 0;1 -1;0 1;0 -1;-1 1;-1 0;-1 -1);
  (nbr=3)|s&nbr=2 }

frame:{[s;t]
  s:$[0=.p5.f mod 6; gen s; s];        / ten generations a second, not sixty
  cell:.p5.h%N;
  g:update on:raze s from grid[N;N];
  draw select shape:\`rect, p:cell*(0.5+p), w:cell-2, h:cell-2,
              fill:\`#7ee787 from g where on;
  s }`,
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
  draw circles[(.p5.cp)+/:(polar[6*sqrt k;(k*2.399963)+0.15*t]\`p); 1.5+3*k%n; hsv[(k%n)+0.05*t;0.7;1]] }`,
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
  x:.p5.cp[0]+(0.36*.p5.w)*sin[3*u+0.3*t];
  y:.p5.cp[1]+(0.36*.p5.h)*sin[4*u];
  draw path[x; y; hsv[0.1*t;0.6;1]] }`,
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
draw select shape:\`rect, p:cell*(0.5+p), w:cell, h:cell, fill:\`#c8f7c5 from g where on`,
  },
  {
    id: 'sortviz',
    title: 'Sorting, visualised',
    blurb: 'iasc gives you the permutation; watch it settle.',
    tags: ['animation', 'state'],
    code: `bg \`#0a0d13
n:60
init:n?100f

frame:{[s;t]
  if[0=.p5.f mod 3;                     / one bubble pass every few frames
    i:til n-1;
    j:where s[i]>s[i+1];
    j:j where 0=j mod 2;
    s:@[s;j,j+1;:;s[j+1],s j] ];
  w:.p5.w%n;
  draw rects[flip(w*0.5+til n; .p5.h-0.5*s*3); w-2; s*3; hsv[s%140;0.6;1]];
  s }`,
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

draw update shape:\`circle, p:flip(remap[t;0;max t;50;.p5.w-50];remap[f;min f;max f;.p5.h-60;60]),
            r:14, fill:hsv[(f%440);0.6;1] from score`,
  },
  {
    id: 'flow',
    title: 'Noise flow field',
    blurb: 'Perlin noise drives acceleration; particles integrate v+=a, p+=v.',
    tags: ['animation', 'state'],
    code: `/ Showcase: a table of particles with p and v. Noise → accel → velocity → position.
bg \`#06080c
n:500
init:([] p:flip(n?.p5.w;n?.p5.h); v:flip(n#0f;n#0f))

frame:{[s;t]
  a:(2*pi)*noise[0.005*s[\`p][;0];0.005*s[\`p][;1];0.12*t];
  s:update v:0.92*v+flip(0.55*cos a;0.55*sin a) from s;
  s:update p:p+v from s;
  s:update p:p mod\\: .p5.wh from s;
  keep:0.985>n?1.0;                            / respawn a few each frame
  s:update p:?[keep;p;flip(n?.p5.w;n?.p5.h)], v:?[keep;v;flip(n#0f;n#0f)] from s;
  draw fade[circles[s\`p; 1.6; hsv[0.55+0.15*(s[\`p][;0])%.p5.w;0.5;1]];0.8];
  s }`,
  },
  {
    id: 'bars',
    title: 'Group by, drawn',
    blurb: 'A bar chart is select ... by ... plus geometry in a p column.',
    tags: ['qsql', 'tables'],
    code: `bg \`#0b0e13
n:400
t:([] sym:n?\`AAPL\`MSFT\`GOOG\`AMZN\`NVDA; sz:n?100)

agg:0!select total:sum sz by sym from t
agg:update i:til count agg from agg
h:remap[agg\`total;0;max agg\`total;0;.p5.h-120]
w:(.p5.w-60)%1.4*count agg
xs:40+w*1.4*agg\`i

bars:([] shape:\`rect; p:flip(xs; .p5.h-50-0.5*h); w:w; h:h; fill:pal[\`kdb] agg\`i)
labs:([] shape:\`text; p:flip(xs; count[xs]#.p5.h-30); txt:string agg\`sym; size:12; fill:\`#8fa1b3)
vals:([] shape:\`text; p:flip(xs; .p5.h-70-h); txt:string agg\`total; size:11; fill:\`#dfe7ef)
draw bars,labs,vals`,
  },
];
