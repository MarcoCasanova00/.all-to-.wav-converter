import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  FileAudio,
  FolderOpen,
  HardDriveDownload,
  Layers,
  Upload,
} from 'lucide-react';
import {
  buildSampleFilename,
  buildSamplesZipBlob,
  buildWavBlob,
  formatBytes,
  parseElectribeAllFile,
  ParsedLibrary,
  ParsedSample,
  WavExportMode,
  ZipFolderLayout,
} from './lib/electribeParser';
import { generateDemoElectribeAllBuffer } from './lib/demoGenerator';
import { SampleTable } from './components/SampleTable';
import { WaveformInspector } from './components/WaveformInspector';
import { FormatSpecSection } from './components/FormatSpecSection';

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function decodeSampleToAudioBuffer(
  ctx: AudioContext,
  sample: ParsedSample
): AudioBuffer {
  const frameCount = Math.max(1, sample.numFrames);
  const buffer = ctx.createBuffer(
    sample.channels,
    frameCount,
    sample.sampleRate
  );

  const pcm = sample.pcmDataBytes;
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const bytesPerSample = Math.max(1, Math.floor(sample.bitsPerSample / 8));

  for (let ch = 0; ch < sample.channels; ch++) {
    const channelData = buffer.getChannelData(ch);
    for (let f = 0; f < frameCount; f++) {
      const bytePos = f * sample.blockAlign + ch * bytesPerSample;
      if (bytePos + bytesPerSample > pcm.length) break;

      if (sample.audioFormat === 3 && sample.bitsPerSample === 32) {
        channelData[f] = view.getFloat32(bytePos, true);
      } else if (sample.bitsPerSample === 16) {
        channelData[f] = view.getInt16(bytePos, true) / 32768;
      } else if (sample.bitsPerSample === 8) {
        channelData[f] = (pcm[bytePos] - 128) / 128;
      } else if (sample.bitsPerSample === 24) {
        const b0 = pcm[bytePos];
        const b1 = pcm[bytePos + 1];
        const b2 = pcm[bytePos + 2];
        let val = b0 | (b1 << 8) | (b2 << 16);
        if (val & 0x800000) val |= ~0xffffff;
        channelData[f] = val / 8388608;
      } else if (sample.bitsPerSample === 32) {
        channelData[f] = view.getInt32(bytePos, true) / 2147483648;
      }
    }
  }

  return buffer;
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const playbackMetaRef = useRef<{
    startTime: number;
    duration: number;
    startOffsetSec: number;
    loop: boolean;
  } | null>(null);

  const [library, setLibrary] = useState<ParsedLibrary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  const [exportMode, setExportMode] = useState<WavExportMode>('standard');
  const [applyTrim, setApplyTrim] = useState(false);
  const [zipLayout, setZipLayout] = useState<ZipFolderLayout>('flat-numbered');

  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [zipProgress, setZipProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [isDownloadingOffline, setIsDownloadingOffline] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isOfflineBuild = Boolean(
    (window as unknown as { __ELECTRIBE_OFFLINE__?: boolean })
      .__ELECTRIBE_OFFLINE__
  );

  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);

  const stopAudio = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.onended = null;
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {
        // Ignore already-stopped nodes
      }
      sourceNodeRef.current = null;
    }
    playbackMetaRef.current = null;
    setPlayingId(null);
    setPlaybackProgress(0);
  }, []);

  useEffect(() => {
    return () => {
      stopAudio();
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, [stopAudio]);

  const startPlayback = useCallback(
    (sample: ParsedSample, startRatio = 0, loopOverride?: boolean) => {
      stopAudio();

      if (!audioCtxRef.current) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        audioCtxRef.current = new AudioCtx();
      }

      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const audioBuffer = decodeSampleToAudioBuffer(ctx, sample);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      const effectiveLoop = loopOverride ?? isLooping;
      source.loop = effectiveLoop;

      const totalDur = Math.max(0.001, audioBuffer.duration);
      const offsetSec = Math.max(
        0,
        Math.min(totalDur - 0.001, startRatio * totalDur)
      );

      if (effectiveLoop && sample.esli && sample.esli.endFrame > sample.esli.startFrame) {
        const loopStart = sample.esli.loopStartFrame / sample.sampleRate;
        const loopEnd = sample.esli.endFrame / sample.sampleRate;
        if (loopEnd > loopStart) {
          source.loopStart = loopStart;
          source.loopEnd = loopEnd;
        }
      }

      source.connect(ctx.destination);
      sourceNodeRef.current = source;

      playbackMetaRef.current = {
        startTime: ctx.currentTime,
        duration: totalDur,
        startOffsetSec: offsetSec,
        loop: effectiveLoop,
      };

      setPlayingId(sample.id);

      source.onended = () => {
        if (sourceNodeRef.current === source) {
          stopAudio();
        }
      };

      source.start(0, offsetSec);

      const tick = () => {
        const meta = playbackMetaRef.current;
        const activeCtx = audioCtxRef.current;
        if (!meta || !activeCtx) return;

        const elapsed = activeCtx.currentTime - meta.startTime + meta.startOffsetSec;
        if (meta.loop) {
          setPlaybackProgress((elapsed % meta.duration) / meta.duration);
          rafRef.current = requestAnimationFrame(tick);
        } else if (elapsed >= meta.duration) {
          setPlaybackProgress(0);
        } else {
          setPlaybackProgress(elapsed / meta.duration);
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [isLooping, stopAudio]
  );

  const loadArrayBuffer = useCallback(
    (buffer: ArrayBuffer, fileName: string) => {
      stopAudio();
      setIsParsing(true);
      setErrorMessage(null);
      setStatusNotice(null);

      try {
        const parsed = parseElectribeAllFile(buffer, fileName);
        setLibrary(parsed);
        setSelectedId(parsed.samples[0]?.id ?? null);
        setCheckedIds(new Set());
        setSearchQuery('');
        setCategoryFilter('ALL');
        if (parsed.samples.length > 0) {
          setStatusNotice(
            `Extracted ${parsed.samples.length} WAV ${parsed.samples.length === 1 ? 'sample' : 'samples'} from ${fileName}.`
          );
        }
      } catch (err) {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Unable to parse this binary file.'
        );
      } finally {
        setIsParsing(false);
      }
    },
    [stopAudio]
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      setIsParsing(true);
      setErrorMessage(null);
      try {
        const buffer = await file.arrayBuffer();
        loadArrayBuffer(buffer, file.name);
      } catch {
        setErrorMessage('Failed to read the selected file from disk.');
        setIsParsing(false);
      }
    },
    [loadArrayBuffer]
  );

  const handleLoadDemo = useCallback(() => {
    const demoBuf = generateDemoElectribeAllBuffer();
    loadArrayBuffer(demoBuf, 'e2sSample_demo.all');
  }, [loadArrayBuffer]);

  const handleDownloadDemoAll = useCallback(() => {
    const demoBuf = generateDemoElectribeAllBuffer();
    triggerDownload(
      new Blob([demoBuf], { type: 'application/octet-stream' }),
      'e2sSample_demo.all'
    );
  }, []);

  const handleDownloadOfflineVersion = useCallback(async () => {
    if (isDownloadingOffline) return;
    setIsDownloadingOffline(true);
    setErrorMessage(null);
    try {
      const response = await fetch('/electribe-wav-extractor-offline.html');
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      const htmlText = await response.text();
      const blob = new Blob([htmlText], { type: 'text/html;charset=utf-8' });
      triggerDownload(blob, 'electribe-wav-extractor-offline.html');
      setStatusNotice(
        'Downloaded electribe-wav-extractor-offline.html. Double-click the file anytime to run the full converter offline.'
      );
    } catch {
      setErrorMessage(
        'Could not generate the offline HTML bundle. Please try again.'
      );
    } finally {
      setIsDownloadingOffline(false);
    }
  }, [isDownloadingOffline]);

  const availableCategories = useMemo(() => {
    if (!library) return [];
    const set = new Set<string>();
    for (const s of library.samples) set.add(s.category);
    return Array.from(set).sort();
  }, [library]);

  const filteredSamples = useMemo(() => {
    if (!library) return [];
    const q = searchQuery.trim().toLowerCase();
    return library.samples.filter((s) => {
      if (categoryFilter !== 'ALL' && s.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      const slotStr = String(s.displaySlot).padStart(3, '0');
      return (
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        slotStr.includes(q)
      );
    });
  }, [library, searchQuery, categoryFilter]);

  const selectedSample = useMemo(() => {
    if (!library || !selectedId) return null;
    return library.samples.find((s) => s.id === selectedId) ?? null;
  }, [library, selectedId]);

  const handleTogglePlaySelected = useCallback(
    (startRatio?: number) => {
      if (!selectedSample) return;
      if (playingId === selectedSample.id && startRatio === undefined) {
        stopAudio();
      } else {
        startPlayback(selectedSample, startRatio ?? 0);
      }
    },
    [playingId, selectedSample, startPlayback, stopAudio]
  );

  const handleTogglePlayRow = useCallback(
    (sample: ParsedSample) => {
      if (playingId === sample.id) {
        stopAudio();
      } else {
        startPlayback(sample, 0);
      }
    },
    [playingId, startPlayback, stopAudio]
  );

  const handleToggleLoop = useCallback(() => {
    const next = !isLooping;
    setIsLooping(next);
    if (playingId && selectedSample && playingId === selectedSample.id) {
      startPlayback(selectedSample, 0, next);
    }
  }, [isLooping, playingId, selectedSample, startPlayback]);

  const handleDownloadSingleWav = useCallback(
    (sample: ParsedSample) => {
      const blob = buildWavBlob(sample, { mode: exportMode, applyTrim });
      const filename = buildSampleFilename(sample, 'flat-numbered');
      triggerDownload(blob, filename);
    },
    [exportMode, applyTrim]
  );

  const handleExportZip = useCallback(async () => {
    if (!library || library.samples.length === 0) return;

    const targetSamples =
      checkedIds.size > 0
        ? library.samples.filter((s) => checkedIds.has(s.id))
        : filteredSamples.length > 0
          ? filteredSamples
          : library.samples;

    if (targetSamples.length === 0) return;

    setZipProgress({ done: 0, total: targetSamples.length });
    try {
      const zipBlob = await buildSamplesZipBlob(
        targetSamples,
        { mode: exportMode, applyTrim },
        zipLayout,
        (done, total) => setZipProgress({ done, total })
      );
      const baseName = library.fileName.replace(/\.[^.]+$/, '') || 'electribe_samples';
      triggerDownload(zipBlob, `${baseName}_wav.zip`);
      setStatusNotice(
        `Packaged ${targetSamples.length} .wav ${targetSamples.length === 1 ? 'file' : 'files'} into ${baseName}_wav.zip.`
      );
    } catch {
      setErrorMessage('Failed to build ZIP archive.');
    } finally {
      setZipProgress(null);
    }
  }, [library, checkedIds, filteredSamples, exportMode, applyTrim, zipLayout]);

  const handleToggleCheck = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleCheckAllFiltered = useCallback(() => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      const allChecked =
        filteredSamples.length > 0 &&
        filteredSamples.every((s) => next.has(s.id));
      if (allChecked) {
        for (const s of filteredSamples) next.delete(s.id);
      } else {
        for (const s of filteredSamples) next.add(s.id);
      }
      return next;
    });
  }, [filteredSamples]);

  const exportTargetCount =
    checkedIds.size > 0 ? checkedIds.size : filteredSamples.length;

  return (
    <div
      className="min-h-screen flex flex-col bg-[#0B0D11] text-zinc-100"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".all,.ALL,.esx,.ESX,application/octet-stream"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Global Drag-Over Overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-[#0B0D11]/90 backdrop-blur-xs flex items-center justify-center p-6 pointer-events-none">
          <div className="border-2 border-dashed border-orange-500 rounded-xl px-12 py-10 text-center bg-[#13161D]">
            <Upload className="w-10 h-10 text-orange-400 mx-auto mb-3" />
            <p className="text-lg font-semibold text-zinc-100">
              Drop Electribe .all file to extract WAV samples
            </p>
            <p className="text-sm text-zinc-400 mt-1">
              Parsed locally in memory — nothing leaves your browser
            </p>
          </div>
        </div>
      )}

      {/* 3-Zone Top Bar */}
      <header className="border-b border-[#1D212B] bg-[#0B0D11]/95 sticky top-0 z-30">
        <div className="max-w-[1360px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 shrink-0">
            <img src="/wav/electribe-logo.svg" alt="Korg Electribe" className="h-9 w-auto border border-[#3a4250] bg-[#0B0D11]" />
            <a
              href="#top"
              className="text-base font-bold tracking-tight text-zinc-100 whitespace-nowrap"
            >
              Electribe WAV Extractor
            </a>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-400">
            <a
              href="#workspace"
              className="hover:text-zinc-100 transition-colors whitespace-nowrap shrink-0"
            >
              Converter
            </a>
            <a
              href="#format-spec"
              className="hover:text-zinc-100 transition-colors whitespace-nowrap shrink-0"
            >
              Format Spec
            </a>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-orange-500 hover:bg-orange-400 text-zinc-950 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
            >
              <FolderOpen className="w-4 h-4" />
              <span>Load .all File</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main id="workspace" className="flex-1 max-w-[1360px] w-full mx-auto px-6 py-8">
        {/* Error / Status Banner */}
        {errorMessage && (
          <div className="mb-6 p-4 rounded-lg border border-rose-500/40 bg-rose-500/10 flex items-start gap-3 text-sm text-rose-200">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Unable to process file</p>
              <p className="text-rose-300/90 text-xs mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}

        {statusNotice && !errorMessage && (
          <div className="mb-6 px-4 py-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 flex items-center justify-between gap-4 text-xs text-emerald-200">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{statusNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusNotice(null)}
              className="text-emerald-300 hover:text-white text-xs cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Initial Empty Dropzone Hero */}
        {!library ? (
          <section className="py-6">
            <div className="max-w-3xl">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-zinc-100 text-balance">
                Extract clean .wav samples from Korg Electribe .all libraries
              </h1>
              <p className="text-base text-zinc-400 mt-3 leading-relaxed max-w-2xl">
                Drop an <code className="text-zinc-200">e2sSample.all</code> backup from your Electribe SD card to inspect sample slots, audition waveforms, trim start/end markers, and export universal PCM <code className="text-zinc-200">.wav</code> files individually or as a ZIP archive.
              </p>
            </div>

            {/* Interactive Dropzone */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              className="mt-8 border border-dashed border-[#333A4A] hover:border-orange-500/70 bg-[#13161D] hover:bg-[#161A23] rounded-xl p-10 md:p-14 text-center transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
            >
              <div className="w-12 h-12 rounded-lg bg-[#1C212C] border border-[#2B3242] flex items-center justify-center mx-auto mb-4">
                <FileAudio className="w-6 h-6 text-orange-400" />
              </div>
              <p className="text-base font-semibold text-zinc-100">
                {isParsing
                  ? 'Parsing binary sample table...'
                  : 'Drop your .all file here, or click to browse'}
              </p>
              <p className="text-sm text-zinc-400 mt-1.5">
                Supports Korg Electribe 2 Sampler (e2sSample.all) and RIFF-embedded .all sample banks
              </p>

              <div
                className="mt-6 flex flex-wrap items-center justify-center gap-3"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 h-10 px-5 rounded-md bg-orange-500 hover:bg-orange-400 text-zinc-950 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>Choose .all File</span>
                </button>
                <button
                  type="button"
                  onClick={handleLoadDemo}
                  className="inline-flex items-center gap-2 h-10 px-5 rounded-md bg-[#1B202A] hover:bg-[#232936] border border-[#2C3342] text-zinc-200 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Layers className="w-4 h-4 text-orange-400" />
                  <span>Load Demo Library</span>
                </button>
                {!isOfflineBuild && (
                  <button
                    type="button"
                    disabled={isDownloadingOffline}
                    onClick={handleDownloadOfflineVersion}
                    className="inline-flex items-center gap-2 h-10 px-5 rounded-md bg-[#1B202A] hover:bg-[#232936] border border-[#2C3342] disabled:opacity-60 text-zinc-200 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <HardDriveDownload className="w-4 h-4 text-zinc-300" />
                    <span>
                      {isDownloadingOffline
                        ? 'Preparing Offline File...'
                        : 'Download Offline Version'}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDownloadDemoAll}
                  className="inline-flex items-center gap-1.5 h-10 px-3 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Download sample e2sSample_demo.all</span>
                </button>
              </div>
            </div>
          </section>
        ) : (
          /* Active Library Workspace */
          <section className="space-y-6">
            {/* Library Summary & Batch Export Controls */}
            <div className="bg-[#13161D] border border-[#252A36] rounded-lg p-5">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 font-mono tabular-nums">
                    <span className="text-orange-400 font-sans font-medium">
                      {library.formatType}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatBytes(library.fileSize)}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {library.samples.length} WAV{' '}
                      {library.samples.length === 1 ? 'sample' : 'samples'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatBytes(library.totalAudioBytes)} PCM</span>
                  </div>
                  <h1 className="text-xl font-bold text-zinc-100 mt-1 truncate">
                    {library.fileName}
                  </h1>
                </div>

                {/* Export Configuration Controls */}
                <div className="flex flex-wrap items-center gap-3">
                  {/* Export Mode Segmented Control */}
                  <div
                    role="group"
                    aria-label="WAV export format"
                    className="inline-flex items-center p-1 rounded-md bg-[#0B0D11] border border-[#252A36]"
                  >
                    <button
                      type="button"
                      onClick={() => setExportMode('standard')}
                      className={`h-8 px-3 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        exportMode === 'standard'
                          ? 'bg-[#1D222D] text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Standard PCM WAV
                    </button>
                    <button
                      type="button"
                      onClick={() => setExportMode('raw')}
                      className={`h-8 px-3 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        exportMode === 'raw'
                          ? 'bg-[#1D222D] text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Raw Korg Chunk
                    </button>
                  </div>

                  {/* Trim Toggle */}
                  <label className="inline-flex items-center gap-2 h-10 px-3 rounded-md bg-[#0B0D11] border border-[#252A36] text-xs text-zinc-300 cursor-pointer select-none whitespace-nowrap shrink-0">
                    <input
                      type="checkbox"
                      checked={applyTrim}
                      onChange={(e) => setApplyTrim(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-orange-500 cursor-pointer"
                    />
                    <span>Apply Start–End Trim</span>
                  </label>

                  {/* ZIP Folder Naming */}
                  <select
                    value={zipLayout}
                    onChange={(e) =>
                      setZipLayout(e.target.value as ZipFolderLayout)
                    }
                    aria-label="ZIP filename layout"
                    className="h-10 px-3 rounded-md bg-[#0B0D11] border border-[#252A36] text-xs text-zinc-200 focus:outline-none focus:border-orange-500/70 cursor-pointer"
                  >
                    <option value="flat-numbered">001_Name.wav</option>
                    <option value="flat-named">Name.wav</option>
                    <option value="by-category">Category/001_Name.wav</option>
                  </select>

                  {/* Primary Batch ZIP Export */}
                  <button
                    type="button"
                    disabled={library.samples.length === 0 || zipProgress !== null}
                    onClick={handleExportZip}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-orange-500 hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-950 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
                  >
                    <Archive className="w-4 h-4" />
                    <span>
                      {zipProgress
                        ? `Packing ${zipProgress.done}/${zipProgress.total}...`
                        : checkedIds.size > 0
                          ? `Export Selected (${exportTargetCount}) .zip`
                          : `Export All (${exportTargetCount}) .zip`}
                    </span>
                  </button>
                </div>
              </div>

              {/* Warnings if any */}
              {library.warnings.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[#252A36] space-y-1.5">
                  {library.warnings.map((w, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 text-xs text-amber-300"
                    >
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                      <span>{w}</span>
                    </div>
                  ))}
                  {library.samples.length === 0 && (
                    <div className="pt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="h-9 px-3.5 rounded-md bg-[#1B202A] hover:bg-[#232936] border border-[#2C3342] text-xs font-medium text-zinc-200 cursor-pointer"
                      >
                        Try Another .all File
                      </button>
                      <button
                        type="button"
                        onClick={handleLoadDemo}
                        className="h-9 px-3.5 rounded-md bg-[#1B202A] hover:bg-[#232936] border border-[#2C3342] text-xs font-medium text-orange-300 cursor-pointer"
                      >
                        Load Demo Library Instead
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Asymmetric Split Console: Sample Table + Waveform Inspector */}
            {library.samples.length > 0 && (
              <div className="flex flex-col lg:flex-row items-start gap-6">
                <div className="w-full lg:flex-1 min-w-0">
                  <SampleTable
                    samples={filteredSamples}
                    totalCount={library.samples.length}
                    selectedId={selectedId}
                    playingId={playingId}
                    checkedIds={checkedIds}
                    searchQuery={searchQuery}
                    categoryFilter={categoryFilter}
                    availableCategories={availableCategories}
                    onSearchChange={setSearchQuery}
                    onCategoryChange={setCategoryFilter}
                    onSelectSample={(s) => setSelectedId(s.id)}
                    onPlaySample={handleTogglePlayRow}
                    onToggleCheck={handleToggleCheck}
                    onToggleCheckAllFiltered={handleToggleCheckAllFiltered}
                    onDownloadSample={handleDownloadSingleWav}
                  />
                </div>

                <div className="w-full lg:w-[400px] xl:w-[420px] shrink-0 lg:sticky lg:top-22">
                  <WaveformInspector
                    sample={selectedSample}
                    isPlaying={
                      Boolean(selectedSample) && playingId === selectedSample?.id
                    }
                    isLooping={isLooping}
                    playbackProgress={
                      selectedSample && playingId === selectedSample.id
                        ? playbackProgress
                        : 0
                    }
                    exportOptions={{ mode: exportMode, applyTrim }}
                    onTogglePlay={handleTogglePlaySelected}
                    onToggleLoop={handleToggleLoop}
                    onDownloadSample={handleDownloadSingleWav}
                  />
                </div>
              </div>
            )}
          </section>
        )}

        {/* Format Reference Section */}
        <FormatSpecSection />
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-[#1D212B] py-6 mt-8">
        <div className="max-w-[1360px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
          <span>
            Electribe WAV Extractor · Client-side RIFF/WAVE &amp; esli binary parser
            {isOfflineBuild ? ' · Offline Standalone Edition' : ''}
          </span>
          <div className="flex items-center gap-4">
            <span>All audio decoding and ZIP packaging happens locally in your browser</span>
            {!isOfflineBuild && (
              <button
                type="button"
                disabled={isDownloadingOffline}
                onClick={handleDownloadOfflineVersion}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded border border-[#282E3B] bg-[#13161D] hover:bg-[#1B202A] hover:border-zinc-500 disabled:opacity-60 text-xs font-medium text-zinc-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <HardDriveDownload className="w-3.5 h-3.5 text-orange-400" />
                <span>
                  {isDownloadingOffline
                    ? 'Preparing...'
                    : 'Download Offline Version'}
                </span>
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
