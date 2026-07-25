// A very small WebAudio synth so a table can be a musical score.

export class AudioEngine {
  ctx: AudioContext | null = null;

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const C = (window as any).AudioContext ?? (window as any).webkitAudioContext;
      if (!C) return null;
      this.ctx = new C();
    }
    if (this.ctx!.state === 'suspended') this.ctx!.resume().catch(() => {});
    return this.ctx;
  }

  note(freq: number, delay = 0, dur = 0.2, amp = 0.2, type: OscillatorType = 'triangle') {
    const ctx = this.ensure();
    if (!ctx || !Number.isFinite(freq) || freq <= 0) return;
    const t0 = ctx.currentTime + Math.max(0, delay);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, amp)), t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.05, dur));
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + Math.max(0.06, dur) + 0.05);
  }
}
