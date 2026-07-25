// Named colour palettes, exposed to q as the dictionary `pal`.
// Each colour is a 3-byte vector, e.g. 0xff6b6b - valid q, and vectorisable.

export const PALETTES: Record<string, string[]> = {
  sunset: ['#ff6b6b', '#ffa36c', '#ffd93d', '#6bcb77', '#4d96ff'],
  neon: ['#ff2e63', '#08d9d6', '#f9ed69', '#b892ff', '#00ff87'],
  ice: ['#caf0f8', '#90e0ef', '#00b4d8', '#0077b6', '#03045e'],
  ember: ['#03071e', '#370617', '#9d0208', '#dc2f02', '#ffba08'],
  forest: ['#081c15', '#1b4332', '#2d6a4f', '#52b788', '#b7e4c7'],
  candy: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#bdb2ff'],
  mono: ['#111111', '#444444', '#777777', '#aaaaaa', '#dddddd'],
  kdb: ['#0a84ff', '#32ade6', '#5e5ce6', '#af52de', '#ff2d55'],
  earth: ['#582f0e', '#7f4f24', '#936639', '#a68a64', '#c2c5aa'],
  vapor: ['#ff71ce', '#01cdfe', '#05ffa1', '#b967ff', '#fffb96'],
};

export function hexToBytes(hex: string): number[] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
