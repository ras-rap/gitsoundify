import { scoreSeconds, TRACKS, type Score, type TrackId } from "../compose/score";

export { scoreSeconds };

/** Ticks per quarter note. Score times are in beats, so ticks = beats * PPQ. */
const PPQ = 480; 

/** General MIDI program numbers, one per track. */
const PROGRAM: Record<TrackId, number> = {
  drone: 89, 
  pad: 88, 
  lead: 11, 
};
const CHANNEL: Record<TrackId, number> = { drone: 0, pad: 1, lead: 2 };

/** MIDI variable-length quantity: 7 bits per byte, high bit set on all but the last. */
export function vlq(value: number): number[] {
  let v = Math.max(0, Math.floor(value));
  const bytes = [v & 0x7f];
  v >>>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return bytes;
}

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0) & 0x7f);
/** Meta event: 0xff, type, VLQ payload length, then the payload. */
const textMeta = (type: number, text: string) => {
  const data = ascii(text);
  return [0xff, type, ...vlq(data.length), ...data];
};

/** Chunk framing: 4-char id, big-endian uint32 payload length, then the payload. */
function chunk(id: string, data: number[]): number[] {
  return [...ascii(id), ...u32(data.length), ...data];
}

interface TimedEvent {
  tick: number;
  /** Tie-break within a tick: 0 (note-off, CC) sorts before 1 (note-on, program/meta). */
  order: number;
  bytes: number[];
}

/** Events may arrive in any order: deltas are VLQ gaps from the previous tick, so they are sorted first. */
function encodeTrack(events: TimedEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data: number[] = [];
  let last = 0;
  for (const e of sorted) {
    data.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  data.push(...vlq(0), 0xff, 0x2f, 0x00);
  return chunk("MTrk", data);
}

/** Map pan -1..1 onto CC value 0..127, where 64 is centre. */
const panByte = (pan: number) => Math.max(0, Math.min(127, Math.round((clamp1(pan) + 1) * 63.5)));
const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));

export function scoreToMidi(score: Score): Uint8Array {
  // Tempo meta (0x51) carries microseconds per quarter note, hence 60e6 / bpm; 0x58 is the 4/4 time signature.
  const tempoTrack: TimedEvent[] = [
    { tick: 0, order: 1, bytes: textMeta(0x03, `${score.name} (${score.mode})`) },
    { tick: 0, order: 1, bytes: [0xff, 0x51, 0x03, ...u32(Math.round(60_000_000 / score.bpm)).slice(1)] },
    { tick: 0, order: 1, bytes: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
  ];

  const tracks = TRACKS.map((id) => {
    const ch = CHANNEL[id];
    const events: TimedEvent[] = [
      { tick: 0, order: 1, bytes: textMeta(0x03, id) },
      { tick: 0, order: 1, bytes: [0xc0 | ch, PROGRAM[id]] },
    ];
    for (const n of score.notes) {
      if (n.track !== id) continue;
      const on = Math.round(n.time * PPQ);
      const off = Math.max(on + 1, Math.round((n.time + n.duration) * PPQ)); // Zero-length notes still get one tick.
      const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 127))); // Floor at 1: velocity 0 means note-off.
      if (n.pan !== undefined) {
        // CC 10 is pan. Emitted at order 0 so it applies before the note-on below.
        events.push({ tick: on, order: 0, bytes: [0xb0 | ch, 10, panByte(n.pan)] });
      }
      events.push({ tick: on, order: 1, bytes: [0x90 | ch, n.midi, vel] });
      events.push({ tick: off, order: 0, bytes: [0x80 | ch, n.midi, 0] });
    }
    return encodeTrack(events);
  });

  // Format 1: one tempo track plus a track per instrument, with PPQ as the division field.
  const header = chunk("MThd", [...u16(1), ...u16(1 + tracks.length), ...u16(PPQ)]);
  return Uint8Array.from([...header, ...encodeTrack(tempoTrack), ...tracks.flat()]);
}