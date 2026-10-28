import * as Tone from "tone";
import type { Score, TrackId } from "../compose/score";

export const TAIL_SECONDS = 6;

const PAN_LANES = 5;

const toFreq = (midi: number) => Tone.Frequency(midi, "midi").toFrequency();

type Lane = Tone.PolySynth<any>;
type Voices = Record<TrackId, Lane[]>;

const laneFor = (pan: number): number =>
  Math.max(0, Math.min(PAN_LANES - 1, Math.round(((pan + 1) / 2) * (PAN_LANES - 1))));

const lanePan = (lane: number): number => (lane / (PAN_LANES - 1)) * 2 - 1;

function lanesFor(make: () => Lane, out: Tone.ToneAudioNode): Lane[] {
  return Array.from({ length: PAN_LANES }, (_, lane) => {
    const panner = new Tone.Panner(lanePan(lane)).connect(out);
    return make().connect(panner);
  });
}

export class Engine {
  private voices: Voices | null = null;
  private score: Score | null = null;
  private scheduled = false;

  get duration(): number {
    return this.score ? (this.score.lengthBeats * 60) / this.score.bpm : 0;
  }

  get position(): number {
    return Tone.getTransport().seconds;
  }

  get isPlaying(): boolean {
    return Tone.getTransport().state === "started";
  }

  setScore(score: Score): void {
    if (this.voices) {
      const transport = Tone.getTransport();
      transport.stop();
      transport.cancel(0);
      this.releaseAll();
    }
    this.score = score;
    this.scheduled = false;
  }

  private async build(): Promise<Voices> {
    if (this.voices) return this.voices;

    const limiter = new Tone.Limiter(-1).toDestination();
    const reverb = new Tone.Reverb({ decay: 9, preDelay: 0.05, wet: 0.5 }).connect(limiter);
    await reverb.ready;
    const echo = new Tone.PingPongDelay({ delayTime: "8n.", feedback: 0.35, wet: 0.22 }).connect(reverb);

    const droneBus = new Tone.Filter(500, "lowpass").connect(reverb);
    const padBus = new Tone.Filter(1400, "lowpass").connect(reverb);

    const drone = lanesFor(
      () =>
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "triangle" },
          envelope: { attack: 3, decay: 0.5, sustain: 0.9, release: 4 },
          volume: -12,
        }),
      droneBus,
    );

    const pad = lanesFor(
      () =>
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "fatsawtooth", count: 3, spread: 24 },
          envelope: { attack: 2.5, decay: 1, sustain: 0.8, release: 4 },
          volume: -22,
        }),
      padBus,
    );

    const lead = lanesFor(() => {
      const synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 2,
        modulationIndex: 2.5,
        oscillator: { type: "sine" },
        envelope: { attack: 0.02, decay: 0.8, sustain: 0.2, release: 3 },
        modulation: { type: "triangle" },
        modulationEnvelope: { attack: 0.01, decay: 0.5, sustain: 0, release: 1 },
        volume: -13,
      });
      synth.connect(reverb);
      return synth;
    }, echo);

    this.voices = { drone, pad, lead };
    return this.voices;
  }

  private schedule(): void {
    const { score, voices } = this;
    if (!score || !voices) return;

    const transport = Tone.getTransport();
    transport.cancel(0);
    const spb = 60 / score.bpm;

    for (const n of score.notes) {
      const voice = voices[n.track][laneFor(n.pan ?? 0)]!;
      const freq = toFreq(n.midi);
      const dur = n.duration * spb;
      transport.schedule((time) => voice.triggerAttackRelease(freq, dur, time, n.velocity), n.time * spb);
    }
    this.scheduled = true;
  }

  private sustainFrom(at: number): void {
    const { score, voices } = this;
    if (!score || !voices) return;
    const spb = 60 / score.bpm;

    for (const n of score.notes) {
      const start = n.time * spb;
      const end = (n.time + n.duration) * spb;
      if (start < at && end - at > 0.3) {
        voices[n.track][laneFor(n.pan ?? 0)]!.triggerAttackRelease(toFreq(n.midi), end - at, Tone.now() + 0.05, n.velocity);
      }
    }
  }

  private releaseAll(): void {
    if (!this.voices) return;
    for (const lanes of Object.values(this.voices)) for (const v of lanes) v.releaseAll();
  }

  async play(): Promise<void> {
    if (!this.score) return;
    await Tone.start();
    await this.build();
    if (!this.scheduled) this.schedule();

    const transport = Tone.getTransport();
    const at = transport.seconds;
    if (at > 0) this.sustainFrom(at);
    transport.start();
  }

  pause(): void {
    Tone.getTransport().pause();
    this.releaseAll();
  }

  stop(): void {
    if (!this.voices) return;
    Tone.getTransport().stop();
    this.releaseAll();
  }

  seek(seconds: number): void {
    const transport = Tone.getTransport();
    transport.seconds = Math.max(0, Math.min(seconds, this.duration));
    if (this.isPlaying) {
      this.releaseAll();
      this.sustainFrom(transport.seconds);
    }
  }
}