// Synthesizes a genuine spec-compliant binary Korg e2sSample.all library
// containing 4096-byte header, 32-bit LE offset table, RIFF/WAVE PCM blocks,
// and embedded 1172-byte korg/esli metadata chunks.

interface DemoPatchSpec {
  slot: number;
  name: string;
  categoryId: number;
  durationSec: number;
  oneShot: boolean;
  tune: number;
  trimEndRatio?: number;
  loopStartRatio?: number;
  synth: (t: number, duration: number) => number;
}

const SAMPLE_RATE = 48000;

const DEMO_PATCHES: DemoPatchSpec[] = [
  {
    slot: 0,
    name: '909 Analog Kick',
    categoryId: 2, // Kick
    durationSec: 0.48,
    oneShot: true,
    tune: 0,
    synth: (t) => {
      const pitchEnv = 140 * Math.exp(-t * 36) + 46;
      const body = Math.sin(2 * Math.PI * pitchEnv * t) * Math.exp(-t * 6.5);
      const click = (Math.random() * 2 - 1) * Math.exp(-t * 220) * 0.28;
      return Math.tanh((body + click) * 1.45) * 0.88;
    },
  },
  {
    slot: 1,
    name: 'Crisp Electro Snare',
    categoryId: 3, // Snare
    durationSec: 0.36,
    oneShot: true,
    tune: 2,
    synth: (t) => {
      const tone =
        Math.sin(2 * Math.PI * (195 + 120 * Math.exp(-t * 50)) * t) *
        Math.exp(-t * 18) *
        0.55;
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 14) * 0.65;
      return Math.tanh((tone + noise) * 1.2) * 0.82;
    },
  },
  {
    slot: 2,
    name: 'Vintage 808 Clap',
    categoryId: 4, // Clap
    durationSec: 0.42,
    oneShot: true,
    tune: 0,
    synth: (t) => {
      const burst =
        t < 0.011 || (t > 0.014 && t < 0.024) || (t > 0.028 && t < 0.039)
          ? 1
          : 0;
      const tail = Math.exp(-Math.max(0, t - 0.035) * 12) * 0.65;
      const env = Math.max(burst, tail);
      const noise = Math.random() * 2 - 1;
      return noise * env * 0.72;
    },
  },
  {
    slot: 3,
    name: 'Closed Hat Tight',
    categoryId: 5, // HiHat
    durationSec: 0.16,
    oneShot: true,
    tune: 4,
    trimEndRatio: 0.78,
    synth: (t) => {
      const freqs = [298, 415, 588, 792, 1140, 1480];
      let metal = 0;
      for (const f of freqs) {
        metal += Math.sign(Math.sin(2 * Math.PI * f * t));
      }
      const noise = (Math.random() * 2 - 1) * 0.55;
      return ((metal / freqs.length) * 0.45 + noise) * Math.exp(-t * 38) * 0.7;
    },
  },
  {
    slot: 4,
    name: 'FM Perc Metallic',
    categoryId: 13, // Perc.
    durationSec: 0.34,
    oneShot: true,
    tune: -3,
    synth: (t) => {
      const mod = Math.sin(2 * Math.PI * 523 * t) * 3.8 * Math.exp(-t * 16);
      return (
        Math.sin(2 * Math.PI * 310 * t + mod) * Math.exp(-t * 12) * 0.78
      );
    },
  },
  {
    slot: 5,
    name: 'Acid 303 Bass',
    categoryId: 0, // Analog
    durationSec: 0.65,
    oneShot: false,
    tune: 0,
    loopStartRatio: 0.35,
    synth: (t) => {
      const f = 110;
      const phase = (t * f) % 1;
      const saw = 2 * phase - 1;
      const res =
        Math.sin(2 * Math.PI * (620 * Math.exp(-t * 6) + 220) * t) *
        0.4 *
        Math.exp(-t * 3.2);
      const env = Math.min(1, t * 140) * Math.exp(-t * 2.4);
      return Math.tanh((saw * 0.6 + res) * 1.4) * env * 0.8;
    },
  },
  {
    slot: 6,
    name: 'Dub Minor Stab',
    categoryId: 7, // Hits
    durationSec: 0.95,
    oneShot: true,
    tune: 0,
    synth: (t) => {
      const notes = [261.63, 311.13, 392.0, 466.16];
      let sum = 0;
      for (const n of notes) {
        sum += Math.sin(2 * Math.PI * n * t) * 0.5 + Math.sin(2 * Math.PI * n * 2 * t) * 0.18;
      }
      const env = Math.min(1, t * 90) * Math.exp(-t * 3.4);
      return (sum / notes.length) * env * 0.85;
    },
  },
  {
    slot: 7,
    name: '124 BPM Arp Loop',
    categoryId: 15, // Loop
    durationSec: 1.935,
    oneShot: false,
    tune: 0,
    loopStartRatio: 0,
    synth: (t) => {
      const stepDur = 60 / 124 / 2;
      const stepIdx = Math.floor(t / stepDur);
      const localT = t - stepIdx * stepDur;
      const scale = [130.81, 155.56, 196.0, 233.08, 261.63, 196.0, 155.56, 233.08];
      const freq = scale[stepIdx % scale.length];
      const wave =
        Math.sin(2 * Math.PI * freq * t) * 0.65 +
        Math.sin(2 * Math.PI * freq * 2 * t) * 0.25;
      const env = Math.min(1, localT * 120) * Math.exp(-localT * 9);
      return wave * env * 0.78;
    },
  },
];

function writeAscii(target: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    target[offset + i] = text.charCodeAt(i);
  }
}

function buildDemoWavWithKorgChunk(spec: DemoPatchSpec): Uint8Array {
  const numFrames = Math.floor(spec.durationSec * SAMPLE_RATE);
  const pcmSize = numFrames * 2; // 16-bit mono
  const esliSize = 1172;
  const korgChunkDataSize = 8 + esliSize; // 'esli' + uint32 size + 1172 bytes
  const totalSize = 12 + (8 + 16) + (8 + pcmSize) + (8 + korgChunkDataSize);

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);

  // RIFF / WAVE
  writeAscii(buf, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeAscii(buf, 8, 'WAVE');

  // fmt  chunk (16 bytes PCM mono 48kHz 16-bit)
  let c = 12;
  writeAscii(buf, c, 'fmt ');
  view.setUint32(c + 4, 16, true);
  view.setUint16(c + 8, 1, true); // PCM
  view.setUint16(c + 10, 1, true); // Mono
  view.setUint32(c + 12, SAMPLE_RATE, true);
  view.setUint32(c + 16, SAMPLE_RATE * 2, true);
  view.setUint16(c + 20, 2, true);
  view.setUint16(c + 22, 16, true);
  c += 24;

  // data chunk
  writeAscii(buf, c, 'data');
  view.setUint32(c + 4, pcmSize, true);
  const pcmStart = c + 8;
  for (let i = 0; i < numFrames; i++) {
    const t = i / SAMPLE_RATE;
    const sample = Math.max(-1, Math.min(1, spec.synth(t, spec.durationSec)));
    view.setInt16(pcmStart + i * 2, Math.round(sample * 32767), true);
  }
  c = pcmStart + pcmSize;

  // korg chunk containing esli subchunk
  writeAscii(buf, c, 'korg');
  view.setUint32(c + 4, korgChunkDataSize, true);
  writeAscii(buf, c + 8, 'esli');
  view.setUint32(c + 12, esliSize, true);

  const esliStart = c + 16;
  view.setUint16(esliStart + 0x00, spec.slot, true);
  writeAscii(buf, esliStart + 0x02, spec.name.slice(0, 15));
  view.setUint16(esliStart + 0x12, spec.categoryId, true);
  view.setUint16(esliStart + 0x14, 500 + spec.slot, true);
  view.setUint16(esliStart + 0x22, 1000, true);
  view.setUint16(esliStart + 0x24, 65535, true);
  view.setUint32(esliStart + 0x28, 0, true); // startPoint
  view.setUint32(
    esliStart + 0x2c,
    Math.floor((spec.loopStartRatio ?? 0) * numFrames),
    true
  );
  view.setUint32(
    esliStart + 0x30,
    Math.floor((spec.trimEndRatio ?? 1) * numFrames),
    true
  );
  buf[esliStart + 0x34] = spec.oneShot ? 1 : 0;
  view.setUint32(esliStart + 0x3c, pcmSize, true);
  view.setUint32(esliStart + 0x48, SAMPLE_RATE, true);
  view.setInt8(esliStart + 0x4d, spec.tune);

  return buf;
}

export function generateDemoElectribeAllBuffer(): ArrayBuffer {
  const wavBlocks = DEMO_PATCHES.map((patch) => ({
    slot: patch.slot,
    bytes: buildDemoWavWithKorgChunk(patch),
  }));

  const headerSize = 4096;
  const totalPayload = wavBlocks.reduce((acc, b) => acc + b.bytes.length, 0);
  const out = new Uint8Array(headerSize + totalPayload);
  const view = new DataView(out.buffer);

  // Magic identifier at 0x0000
  writeAscii(out, 0, 'e2s sample all');

  // Write WAV blocks and populate 32-bit LE offset table starting at 0x0058
  let cursor = headerSize;
  for (const block of wavBlocks) {
    view.setUint32(0x58 + block.slot * 4, cursor, true);
    out.set(block.bytes, cursor);
    cursor += block.bytes.length;
  }

  return out.buffer;
}
