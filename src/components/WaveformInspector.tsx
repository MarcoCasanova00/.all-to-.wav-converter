import React, { useEffect, useRef } from 'react';
import { Download, Play, Repeat, Square } from 'lucide-react';
import {
  formatBytes,
  formatDuration,
  formatSlotNumber,
  ParsedSample,
  WavBuildOptions,
} from '../lib/electribeParser';

interface WaveformInspectorProps {
  sample: ParsedSample | null;
  isPlaying: boolean;
  isLooping: boolean;
  playbackProgress: number; // 0..1
  exportOptions: WavBuildOptions;
  onTogglePlay: (startRatio?: number) => void;
  onToggleLoop: () => void;
  onDownloadSample: (sample: ParsedSample) => void;
}

export const WaveformInspector: React.FC<WaveformInspectorProps> = ({
  sample,
  isPlaying,
  isLooping,
  playbackProgress,
  exportOptions,
  onTogglePlay,
  onToggleLoop,
  onDownloadSample,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.fillStyle = '#0B0D11';
    ctx.fillRect(0, 0, width, height);

    // Subtle grid lines
    ctx.strokeStyle = '#191D26';
    ctx.lineWidth = 1;
    const midY = height / 2;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.moveTo(0, height * 0.25);
    ctx.lineTo(width, height * 0.25);
    ctx.moveTo(0, height * 0.75);
    ctx.lineTo(width, height * 0.75);
    for (let x = 0.25; x < 1; x += 0.25) {
      ctx.moveTo(Math.round(width * x) + 0.5, 0);
      ctx.lineTo(Math.round(width * x) + 0.5, height);
    }
    ctx.stroke();

    if (!sample) {
      ctx.restore();
      return;
    }

    const totalFrames = Math.max(1, sample.numFrames);
    const startRatio = sample.esli ? sample.esli.startFrame / totalFrames : 0;
    const endRatio = sample.esli ? sample.esli.endFrame / totalFrames : 1;
    const loopRatio = sample.esli ? sample.esli.loopStartFrame / totalFrames : 0;

    // Shade trimmed-out regions if trim is active or bounds differ
    if (startRatio > 0.005) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.fillRect(0, 0, startRatio * width, height);
    }
    if (endRatio < 0.995) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.fillRect(endRatio * width, 0, (1 - endRatio) * width, height);
    }

    // Draw waveform bars
    const peaks = sample.peaks;
    const barCount = peaks.length;
    const barStep = width / barCount;
    const barWidth = Math.max(1, barStep - 1);
    const maxAmp = height * 0.43;

    for (let i = 0; i < barCount; i++) {
      const ratio = i / barCount;
      const inTrim = ratio >= startRatio && ratio <= endRatio;
      const isPlayed = isPlaying && ratio <= playbackProgress;

      if (!inTrim && exportOptions.applyTrim) {
        ctx.fillStyle = '#262B38';
      } else if (isPlayed) {
        ctx.fillStyle = '#FB923C';
      } else {
        ctx.fillStyle = inTrim ? '#64748B' : '#334155';
      }

      const amp = Math.max(1.5, peaks[i] * maxAmp);
      const x = i * barStep;
      ctx.fillRect(x, midY - amp, barWidth, amp * 2);
    }

    // Draw Start/End trim markers if trimmed
    if (sample.esli && (startRatio > 0.002 || endRatio < 0.998)) {
      ctx.strokeStyle = '#94A3B8';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      if (startRatio > 0.002) {
        const sx = Math.round(startRatio * width) + 0.5;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, height);
        ctx.stroke();
      }
      if (endRatio < 0.998) {
        const ex = Math.round(endRatio * width) + 0.5;
        ctx.beginPath();
        ctx.moveTo(ex, 0);
        ctx.lineTo(ex, height);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Draw Loop Start marker if non-one-shot and loop > 0
    if (sample.esli && !sample.esli.oneShot && loopRatio > 0.002 && loopRatio < 0.998) {
      const lx = Math.round(loopRatio * width) + 0.5;
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lx, 0);
      ctx.lineTo(lx, height);
      ctx.stroke();
    }

    // Draw active playhead
    if (isPlaying || playbackProgress > 0) {
      const px = Math.round(playbackProgress * width) + 0.5;
      ctx.strokeStyle = '#F97316';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }

    ctx.restore();
  }, [sample, isPlaying, playbackProgress, exportOptions.applyTrim]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!sample) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onTogglePlay(ratio);
  };

  if (!sample) {
    return (
      <aside className="bg-[#13161D] border border-[#252A36] rounded-lg p-5 flex flex-col justify-center items-center text-center min-h-[380px]">
        <p className="text-sm font-medium text-zinc-300">No sample selected</p>
        <p className="text-xs text-zinc-500 mt-1 max-w-[260px]">
          Select any sample row in the library table to inspect its waveform, Electribe chunk metadata, and export options.
        </p>
      </aside>
    );
  }

  const startMs = sample.esli
    ? ((sample.esli.startFrame / Math.max(1, sample.sampleRate)) * 1000).toFixed(1)
    : '0.0';
  const endMs = sample.esli
    ? ((sample.esli.endFrame / Math.max(1, sample.sampleRate)) * 1000).toFixed(1)
    : (sample.durationSec * 1000).toFixed(1);

  return (
    <aside className="bg-[#13161D] border border-[#252A36] rounded-lg overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#252A36] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono tabular-nums">
            <span>Slot {formatSlotNumber(sample.displaySlot)}</span>
            <span aria-hidden="true">·</span>
            <span className="font-sans text-zinc-400">{sample.category}</span>
            <span aria-hidden="true">·</span>
            <span>{sample.channels === 1 ? 'Mono' : 'Stereo'}</span>
          </div>
          <h2 className="text-base font-semibold text-zinc-100 truncate mt-1">
            {sample.name}
          </h2>
        </div>
      </div>

      {/* Waveform Canvas */}
      <div className="p-5 border-b border-[#252A36]">
        <div className="relative rounded border border-[#252A36] overflow-hidden bg-[#0B0D11]">
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            title="Click anywhere on waveform to audition from position"
            className="w-full h-[168px] block cursor-crosshair"
          />
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-[#1D212B] bg-[#0F1218] text-[11px] font-mono tabular-nums text-zinc-500">
            <span>0.00s</span>
            <span>Click waveform to seek</span>
            <span>{formatDuration(sample.durationSec)}</span>
          </div>
        </div>

        {/* Transport & Single Export */}
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onTogglePlay()}
            className="flex-1 inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md bg-orange-500 hover:bg-orange-400 text-zinc-950 font-semibold text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
          >
            {isPlaying ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Audition</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onToggleLoop}
            aria-pressed={isLooping}
            title="Toggle loop audition"
            className={`inline-flex items-center justify-center gap-1.5 h-10 px-3.5 rounded-md border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 ${
              isLooping
                ? 'bg-orange-500/15 border-orange-500/50 text-orange-300'
                : 'bg-[#181C25] border-[#282E3B] text-zinc-300 hover:border-zinc-500'
            }`}
          >
            <Repeat className="w-3.5 h-3.5" />
            <span>Loop</span>
          </button>

          <button
            type="button"
            onClick={() => onDownloadSample(sample)}
            className="inline-flex items-center justify-center gap-1.5 h-10 px-3.5 rounded-md bg-[#181C25] hover:bg-[#222733] border border-[#282E3B] text-zinc-100 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Save .wav</span>
          </button>
        </div>
      </div>

      {/* Technical Metadata Readout */}
      <div className="p-5">
        <h3 className="text-xs font-semibold text-zinc-400 tracking-wide mb-3">
          Audio & Chunk Properties
        </h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
          <div className="flex items-center justify-between py-1 border-b border-[#1E232E]">
            <dt className="text-zinc-500">Sample Rate</dt>
            <dd className="font-mono tabular-nums text-zinc-200">
              {sample.sampleRate.toLocaleString()} Hz
            </dd>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-[#1E232E]">
            <dt className="text-zinc-500">Bit Depth</dt>
            <dd className="font-mono tabular-nums text-zinc-200">
              {sample.bitsPerSample}-bit {sample.audioFormat === 3 ? 'Float' : 'PCM'}
            </dd>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-[#1E232E]">
            <dt className="text-zinc-500">Frames</dt>
            <dd className="font-mono tabular-nums text-zinc-200">
              {sample.numFrames.toLocaleString()}
            </dd>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-[#1E232E]">
            <dt className="text-zinc-500">PCM Size</dt>
            <dd className="font-mono tabular-nums text-zinc-200">
              {formatBytes(sample.pcmDataSize)}
            </dd>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-[#1E232E]">
            <dt className="text-zinc-500">File Offset</dt>
            <dd className="font-mono tabular-nums text-zinc-200">
              0x{sample.fileOffset.toString(16).toUpperCase().padStart(6, '0')}
            </dd>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-[#1E232E]">
            <dt className="text-zinc-500">Korg Chunk</dt>
            <dd className="font-mono text-zinc-200">
              {sample.esli ? 'esli (1172 B)' : sample.hasKorgMetadata ? 'korg' : 'Standard'}
            </dd>
          </div>

          {sample.esli && (
            <>
              <div className="flex items-center justify-between py-1 border-b border-[#1E232E]">
                <dt className="text-zinc-500">Play Mode</dt>
                <dd className="font-mono text-zinc-200">
                  {sample.esli.oneShot ? 'One-Shot' : 'Loop'}
                </dd>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-[#1E232E]">
                <dt className="text-zinc-500">Pitch Tune</dt>
                <dd className="font-mono tabular-nums text-zinc-200">
                  {sample.esli.tune > 0 ? `+${sample.esli.tune}` : sample.esli.tune}
                </dd>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-[#1E232E]">
                <dt className="text-zinc-500">Trim Window</dt>
                <dd className="font-mono tabular-nums text-zinc-200">
                  {startMs}–{endMs} ms
                </dd>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-[#1E232E]">
                <dt className="text-zinc-500">Slices</dt>
                <dd className="font-mono tabular-nums text-zinc-200">
                  {sample.esli.sliceCount}
                </dd>
              </div>
            </>
          )}
        </dl>
      </div>
    </aside>
  );
};
