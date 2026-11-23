import JSZip from 'jszip';

export const ELECTRIBE_CATEGORIES = [
  'Analog',
  'Audio In',
  'Kick',
  'Snare',
  'Clap',
  'HiHat',
  'Cymbal',
  'Hits',
  'Shots',
  'Voice',
  'SE',
  'FX',
  'Tom',
  'Perc.',
  'Phrase',
  'Loop',
  'PCM',
  'User',
] as const;

export interface EsliMetadata {
  sampleNumber: number;
  name: string;
  categoryId: number;
  category: string;
  importNumber: number;
  playLogPeriod: number;
  volume: number;
  startFrame: number;
  loopStartFrame: number;
  endFrame: number;
  oneShot: boolean;
  samplingFrequency: number;
  tune: number;
  sliceCount: number;
}

export interface ParsedSample {
  id: string;
  slotIndex: number;
  displaySlot: number;
  name: string;
  categoryId: number;
  category: string;
  fileOffset: number;
  rawBlockSize: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  audioFormat: number;
  blockAlign: number;
  numFrames: number;
  durationSec: number;
  pcmDataOffset: number;
  pcmDataSize: number;
  hasKorgMetadata: boolean;
  esli?: EsliMetadata;
  rawRiffBytes: Uint8Array;
  fmtChunkBytes: Uint8Array;
  pcmDataBytes: Uint8Array;
  peaks: Float32Array;
}

export type LibraryFormatType =
  | 'e2sSample.all'
  | 'RIFF Bundle (.all)'
  | 'Unknown';

export interface ParsedLibrary {
  fileName: string;
  fileSize: number;
  formatType: LibraryFormatType;
  headerMagic: string;
  totalSlots: number;
  samples: ParsedSample[];
  totalAudioBytes: number;
  warnings: string[];
}

export type WavExportMode = 'standard' | 'raw';
export type ZipFolderLayout = 'flat-numbered' | 'flat-named' | 'by-category';

export interface WavBuildOptions {
  mode: WavExportMode;
  applyTrim: boolean;
}

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  const end = Math.min(bytes.length, start + length);
  for (let i = start; i < end; i++) {
    const code = bytes[i];
    if (code === 0) break;
    if (code >= 32 && code <= 126) {
      out += String.fromCharCode(code);
    }
  }
  return out.trim();
}

function readFourCC(bytes: Uint8Array, offset: number): string {
  if (offset + 4 > bytes.length) return '';
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3]
  );
}

export function sanitizeFilename(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

export function formatSlotNumber(slot: number): string {
  return String(slot).padStart(3, '0');
}

export function buildSampleFilename(
  sample: ParsedSample,
  layout: ZipFolderLayout
): string {
  const slotStr = formatSlotNumber(sample.displaySlot);
  const safeName = sanitizeFilename(sample.name, `Sample_${slotStr}`);
  const safeCat = sanitizeFilename(sample.category, 'User');

  switch (layout) {
    case 'flat-named':
      return `${safeName}.wav`;
    case 'by-category':
      return `${safeCat}/${slotStr}_${safeName}.wav`;
    case 'flat-numbered':
    default:
      return `${slotStr}_${safeName}.wav`;
  }
}

function computeWaveformPeaks(
  pcmBytes: Uint8Array,
  channels: number,
  bitsPerSample: number,
  audioFormat: number,
  bins = 220
): Float32Array {
  const peaks = new Float32Array(bins);
  const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8));
  const blockAlign = Math.max(1, channels * bytesPerSample);
  const numFrames = Math.floor(pcmBytes.length / blockAlign);

  if (numFrames === 0) return peaks;

  const view = new DataView(
    pcmBytes.buffer,
    pcmBytes.byteOffset,
    pcmBytes.byteLength
  );

  const framesPerBin = Math.max(1, Math.floor(numFrames / bins));
  const step = Math.max(1, Math.floor(framesPerBin / 24));

  for (let b = 0; b < bins; b++) {
    const startFrame = Math.floor((b * numFrames) / bins);
    const endFrame = Math.min(
      numFrames,
      Math.max(startFrame + 1, Math.floor(((b + 1) * numFrames) / bins))
    );
    let maxAbs = 0;

    for (let f = startFrame; f < endFrame; f += step) {
      for (let ch = 0; ch < channels; ch++) {
        const bytePos = f * blockAlign + ch * bytesPerSample;
        if (bytePos + bytesPerSample > pcmBytes.length) break;

        let sampleVal = 0;
        if (audioFormat === 3 && bitsPerSample === 32) {
          sampleVal = Math.abs(view.getFloat32(bytePos, true));
        } else if (bitsPerSample === 16) {
          sampleVal = Math.abs(view.getInt16(bytePos, true)) / 32768;
        } else if (bitsPerSample === 8) {
          sampleVal = Math.abs(pcmBytes[bytePos] - 128) / 128;
        } else if (bitsPerSample === 24) {
          const b0 = pcmBytes[bytePos];
          const b1 = pcmBytes[bytePos + 1];
          const b2 = pcmBytes[bytePos + 2];
          let val = b0 | (b1 << 8) | (b2 << 16);
          if (val & 0x800000) val |= ~0xffffff;
          sampleVal = Math.abs(val) / 8388608;
        } else if (bitsPerSample === 32) {
          sampleVal = Math.abs(view.getInt32(bytePos, true)) / 2147483648;
        }

        if (sampleVal > maxAbs) maxAbs = sampleVal;
      }
    }

    peaks[b] = Math.min(1, maxAbs);
  }

  return peaks;
}

function parseEsliPayload(
  payload: Uint8Array,
  numFrames: number,
  pcmDataSize: number
): EsliMetadata | undefined {
  if (payload.length < 0x50) return undefined;
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength
  );

  const sampleNumber = view.getUint16(0x00, true);
  const name = readAscii(payload, 0x02, 16);
  const categoryId = view.getUint16(0x12, true);
  const importNumber = view.getUint16(0x14, true);
  const playLogPeriod = view.getUint16(0x22, true);
  const volume = view.getUint16(0x24, true);
  const rawStart = view.getUint32(0x28, true);
  const rawLoopStart = view.getUint32(0x2c, true);
  const rawEnd = view.getUint32(0x30, true);
  const oneShot = payload[0x34] !== 0;
  const samplingFrequency = view.getUint32(0x48, true);
  const tune = view.getInt8(0x4d);

  // Determine whether start/loop/end are encoded in frames or byte offsets
  const bytesPerFrame = numFrames > 0 ? Math.max(1, Math.round(pcmDataSize / numFrames)) : 2;
  const isByteOffset =
    numFrames > 0 && rawEnd > numFrames && rawEnd <= pcmDataSize;

  const toFrames = (val: number) => {
    const f = isByteOffset ? Math.floor(val / bytesPerFrame) : val;
    return Math.max(0, Math.min(numFrames, f));
  };

  const startFrame = toFrames(rawStart);
  const endFrame = rawEnd > 0 ? toFrames(rawEnd) : numFrames;
  const loopStartFrame = toFrames(rawLoopStart);

  // Count non-empty time slices at 0x50 (64 slots x 16 bytes)
  let sliceCount = 0;
  if (payload.length >= 0x50 + 1024) {
    for (let s = 0; s < 64; s++) {
      const sliceOffset = 0x50 + s * 16;
      const sliceLen = view.getUint32(sliceOffset + 4, true);
      if (sliceLen > 0) sliceCount++;
    }
  }

  const category =
    categoryId < ELECTRIBE_CATEGORIES.length
      ? ELECTRIBE_CATEGORIES[categoryId]
      : 'User';

  return {
    sampleNumber,
    name,
    categoryId,
    category,
    importNumber,
    playLogPeriod,
    volume,
    startFrame,
    loopStartFrame,
    endFrame: endFrame >= startFrame ? endFrame : numFrames,
    oneShot,
    samplingFrequency,
    tune,
    sliceCount,
  };
}

function parseRiffWaveBlock(
  fullBytes: Uint8Array,
  blockOffset: number,
  slotIndex: number
): ParsedSample | null {
  if (blockOffset + 12 > fullBytes.length) return null;
  if (
    readFourCC(fullBytes, blockOffset) !== 'RIFF' ||
    readFourCC(fullBytes, blockOffset + 8) !== 'WAVE'
  ) {
    return null;
  }

  const rootView = new DataView(
    fullBytes.buffer,
    fullBytes.byteOffset,
    fullBytes.byteLength
  );
  const riffChunkSize = rootView.getUint32(blockOffset + 4, true);
  const blockEnd = Math.min(fullBytes.length, blockOffset + 8 + riffChunkSize);
  const rawBlockSize = blockEnd - blockOffset;

  let fmtChunkBytes: Uint8Array | null = null;
  let pcmDataBytes: Uint8Array | null = null;
  let pcmDataOffset = 0;
  let infoName = '';
  let korgChunkBytes: Uint8Array | null = null;

  let audioFormat = 1;
  let channels = 1;
  let sampleRate = 48000;
  let bitsPerSample = 16;
  let blockAlign = 2;

  let cursor = blockOffset + 12;
  while (cursor + 8 <= blockEnd) {
    const chunkId = readFourCC(fullBytes, cursor);
    const chunkSize = rootView.getUint32(cursor + 4, true);
    const dataStart = cursor + 8;
    const dataEnd = Math.min(blockEnd, dataStart + chunkSize);

    if (chunkId === 'fmt ' && dataEnd - dataStart >= 16) {
      fmtChunkBytes = fullBytes.subarray(dataStart, dataEnd);
      audioFormat = rootView.getUint16(dataStart, true);
      channels = rootView.getUint16(dataStart + 2, true);
      sampleRate = rootView.getUint32(dataStart + 4, true);
      blockAlign = rootView.getUint16(dataStart + 12, true);
      bitsPerSample = rootView.getUint16(dataStart + 14, true);
    } else if (chunkId === 'data') {
      pcmDataBytes = fullBytes.subarray(dataStart, dataEnd);
      pcmDataOffset = dataStart;
    } else if (chunkId === 'LIST' && dataEnd - dataStart >= 4) {
      const listType = readFourCC(fullBytes, dataStart);
      if (listType === 'INFO') {
        let ic = dataStart + 4;
        while (ic + 8 <= dataEnd) {
          const subId = readFourCC(fullBytes, ic);
          const subSize = rootView.getUint32(ic + 4, true);
          const subStart = ic + 8;
          const subEnd = Math.min(dataEnd, subStart + subSize);
          if (subId === 'INAM') {
            infoName = readAscii(fullBytes, subStart, subEnd - subStart);
          }
          ic = subStart + subSize + (subSize & 1);
        }
      }
    } else if (chunkId === 'korg') {
      korgChunkBytes = fullBytes.subarray(dataStart, dataEnd);
    }

    // Prevent infinite loop on malformed 0-byte or huge chunk sizes
    const paddedSize = chunkSize + (chunkSize & 1);
    if (cursor + 8 + paddedSize <= cursor) break;
    cursor += 8 + paddedSize;
  }

  if (!fmtChunkBytes || !pcmDataBytes) {
    return null;
  }

  const safeChannels = Math.max(1, channels);
  const safeSampleRate = sampleRate > 0 ? sampleRate : 48000;
  const safeBits = bitsPerSample > 0 ? bitsPerSample : 16;
  const safeBlockAlign =
    blockAlign > 0 ? blockAlign : safeChannels * Math.max(1, safeBits >> 3);
  const numFrames = Math.floor(pcmDataBytes.length / safeBlockAlign);
  const durationSec = numFrames / safeSampleRate;

  let esli: EsliMetadata | undefined;
  if (korgChunkBytes && korgChunkBytes.length >= 0x58) {
    const korgTag = readFourCC(korgChunkBytes, 0);
    if (korgTag === 'esli') {
      const korgView = new DataView(
        korgChunkBytes.buffer,
        korgChunkBytes.byteOffset,
        korgChunkBytes.byteLength
      );
      const subSize = korgView.getUint32(4, true);
      const esliPayload =
        subSize >= 0x50 && 8 + subSize <= korgChunkBytes.length
          ? korgChunkBytes.subarray(8, 8 + subSize)
          : korgChunkBytes.subarray(4);
      esli = parseEsliPayload(esliPayload, numFrames, pcmDataBytes.length);
    }
  }

  const displaySlot =
    esli && esli.sampleNumber >= 0 && esli.sampleNumber < 1000
      ? esli.sampleNumber + 1
      : slotIndex + 1;

  const fallbackName = `Sample_${formatSlotNumber(displaySlot)}`;
  const resolvedName =
    (esli?.name && esli.name.length > 0 ? esli.name : infoName) || fallbackName;

  const peaks = computeWaveformPeaks(
    pcmDataBytes,
    safeChannels,
    safeBits,
    audioFormat
  );

  return {
    id: `${slotIndex}-${blockOffset}`,
    slotIndex,
    displaySlot,
    name: resolvedName,
    categoryId: esli ? esli.categoryId : 17,
    category: esli ? esli.category : 'User',
    fileOffset: blockOffset,
    rawBlockSize,
    channels: safeChannels,
    sampleRate: safeSampleRate,
    bitsPerSample: safeBits,
    audioFormat,
    blockAlign: safeBlockAlign,
    numFrames,
    durationSec,
    pcmDataOffset,
    pcmDataSize: pcmDataBytes.length,
    hasKorgMetadata: Boolean(korgChunkBytes),
    esli,
    rawRiffBytes: fullBytes.subarray(blockOffset, blockEnd),
    fmtChunkBytes,
    pcmDataBytes,
    peaks,
  };
}

export function parseElectribeAllFile(
  buffer: ArrayBuffer,
  fileName: string
): ParsedLibrary {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const warnings: string[] = [];
  const samples: ParsedSample[] = [];

  const headerMagic = readAscii(bytes, 0, 32);
  const isE2S = headerMagic.toLowerCase().startsWith('e2s sample all');

  let formatType: LibraryFormatType = 'Unknown';
  let totalSlots = 0;

  if (isE2S && bytes.length >= 4096) {
    formatType = 'e2sSample.all';
    const tableStart = 0x58;
    const tableEnd = Math.min(4096, bytes.length);
    totalSlots = Math.floor((tableEnd - tableStart) / 4);

    for (let slot = 0; slot < totalSlots; slot++) {
      const offset = view.getUint32(tableStart + slot * 4, true);
      if (offset === 0) continue;
      if (offset >= bytes.length) {
        warnings.push(
          `Slot ${formatSlotNumber(slot + 1)} points past end of file (0x${offset.toString(16)}).`
        );
        continue;
      }

      const parsed = parseRiffWaveBlock(bytes, offset, slot);
      if (parsed) {
        samples.push(parsed);
      } else {
        warnings.push(
          `Slot ${formatSlotNumber(slot + 1)} at 0x${offset.toString(16)} did not contain a valid RIFF/WAVE block.`
        );
      }
    }
  }

  // Fallback: Scan for embedded RIFF/WAVE blocks if not an E2S offset table or if 0 entries parsed
  if (samples.length === 0) {
    let seq = 0;
    let pos = 0;
    while (pos + 12 <= bytes.length) {
      if (
        bytes[pos] === 0x52 && // R
        bytes[pos + 1] === 0x49 && // I
        bytes[pos + 2] === 0x46 && // F
        bytes[pos + 3] === 0x46 && // F
        bytes[pos + 8] === 0x57 && // W
        bytes[pos + 9] === 0x41 && // A
        bytes[pos + 10] === 0x56 && // V
        bytes[pos + 11] === 0x45 // E
      ) {
        const parsed = parseRiffWaveBlock(bytes, pos, seq);
        if (parsed) {
          samples.push(parsed);
          seq++;
          pos += Math.max(12, parsed.rawBlockSize);
          continue;
        }
      }
      pos += 2;
    }

    if (samples.length > 0) {
      formatType = isE2S ? 'e2sSample.all' : 'RIFF Bundle (.all)';
      totalSlots = samples.length;
    }
  }

  if (samples.length === 0) {
    if (headerMagic.includes('ESX') || fileName.toLowerCase().endsWith('.esx')) {
      warnings.push(
        'Detected an ESX-1 project container without standard RIFF/WAVE headers. This converter currently extracts RIFF/WAVE-backed .all sample libraries (such as Korg Electribe 2 Sampler e2sSample.all).'
      );
    } else {
      warnings.push(
        'No embedded WAV sample blocks were found in this file. Note that Korg Electribe synth models (EA-1, ER-1, EM-1, Electribe 2 Synth) store sequence patterns in .all files rather than PCM audio.'
      );
    }
  }

  const totalAudioBytes = samples.reduce((acc, s) => acc + s.pcmDataSize, 0);

  return {
    fileName,
    fileSize: bytes.length,
    formatType,
    headerMagic: headerMagic || '(none)',
    totalSlots,
    samples,
    totalAudioBytes,
    warnings,
  };
}

export function buildWavUint8Array(
  sample: ParsedSample,
  options: WavBuildOptions
): Uint8Array {
  if (options.mode === 'raw' && !options.applyTrim) {
    return sample.rawRiffBytes;
  }

  let pcmSlice = sample.pcmDataBytes;
  if (options.applyTrim && sample.esli) {
    const startByte = Math.max(
      0,
      Math.min(pcmSlice.length, sample.esli.startFrame * sample.blockAlign)
    );
    const endByte = Math.max(
      startByte,
      Math.min(pcmSlice.length, sample.esli.endFrame * sample.blockAlign)
    );
    if (endByte > startByte) {
      pcmSlice = pcmSlice.subarray(startByte, endByte);
    }
  }

  // Reconstruct clean standard RIFF/WAVE with 'fmt ' and 'data' chunks
  const fmtPayload = sample.fmtChunkBytes;
  const fmtPad = fmtPayload.length & 1;
  const dataPad = pcmSlice.length & 1;

  const totalSize =
    12 + (8 + fmtPayload.length + fmtPad) + (8 + pcmSlice.length + dataPad);
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  // RIFF header
  out.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  view.setUint32(4, totalSize - 8, true);
  out.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"

  // fmt  chunk
  let cursor = 12;
  out.set([0x66, 0x6d, 0x74, 0x20], cursor); // "fmt "
  view.setUint32(cursor + 4, fmtPayload.length, true);
  out.set(fmtPayload, cursor + 8);
  cursor += 8 + fmtPayload.length + fmtPad;

  // data chunk
  out.set([0x64, 0x61, 0x74, 0x61], cursor); // "data"
  view.setUint32(cursor + 4, pcmSlice.length, true);
  out.set(pcmSlice, cursor + 8);

  return out;
}

export function buildWavBlob(
  sample: ParsedSample,
  options: WavBuildOptions
): Blob {
  const bytes = buildWavUint8Array(sample, options);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: 'audio/wav' });
}

export async function buildSamplesZipBlob(
  samples: ParsedSample[],
  options: WavBuildOptions,
  layout: ZipFolderLayout,
  onProgress?: (completed: number, total: number) => void
): Promise<Blob> {
  const zip = new JSZip();
  const usedNames = new Map<string, number>();

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    let targetPath = buildSampleFilename(sample, layout);

    // Deduplicate identical file paths inside ZIP
    const count = usedNames.get(targetPath) ?? 0;
    usedNames.set(targetPath, count + 1);
    if (count > 0) {
      targetPath = targetPath.replace(/\.wav$/i, `_${count + 1}.wav`);
    }

    const wavBytes = buildWavUint8Array(sample, options);
    zip.file(targetPath, wavBytes);

    if (onProgress && (i % 10 === 0 || i === samples.length - 1)) {
      onProgress(i + 1, samples.length);
    }
  }

  return zip.generateAsync({
    type: 'blob',
    compression: 'STORE', // WAV PCM is incompressible; STORE makes large exports near-instant
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0.00s';
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1).padStart(4, '0');
  return `${mins}:${secs}`;
}
