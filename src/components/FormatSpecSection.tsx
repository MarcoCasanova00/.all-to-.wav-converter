import React from 'react';

export const FormatSpecSection: React.FC = () => {
  return (
    <section
      id="format-spec"
      className="mt-14 pt-10 border-t border-[#1D212B]"
    >
      <div className="max-w-3xl">
        <h2 className="text-xl font-semibold text-zinc-100 tracking-tight">
          Korg Electribe .all Binary Architecture
        </h2>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
          The Korg Electribe Sampler (<code className="text-zinc-200">e2sSample.all</code>) packs up to 999 mono or stereo PCM samples into a single SD-card container. Every extraction runs locally in your browser with zero file uploads.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="border border-[#252A36] bg-[#13161D] rounded-lg p-5">
          <div className="text-xs font-mono text-orange-400 mb-2">
            01. Header & Pointer Table
          </div>
          <h3 className="text-sm font-semibold text-zinc-100">
            4,096-Byte Global Index
          </h3>
          <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
            Starts with the ASCII signature <code className="text-zinc-300">"e2s sample all"</code> at <code className="text-zinc-300">0x0000</code>. Beginning at <code className="text-zinc-300">0x0058</code>, a sequence of 32-bit little-endian integers stores byte offsets for each populated sample slot.
          </p>
        </div>

        <div className="border border-[#252A36] bg-[#13161D] rounded-lg p-5">
          <div className="text-xs font-mono text-orange-400 mb-2">
            02. Korg Metadata Chunk
          </div>
          <h3 className="text-sm font-semibold text-zinc-100">
            Embedded korg / esli Block
          </h3>
          <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
            Each embedded <code className="text-zinc-300">RIFF/WAVE</code> payload carries a trailing <code className="text-zinc-300">korg</code> chunk containing a 1,172-byte <code className="text-zinc-300">esli</code> struct with sample names, 18 category IDs, tune, loop markers, and trim points.
          </p>
        </div>

        <div className="border border-[#252A36] bg-[#13161D] rounded-lg p-5">
          <div className="text-xs font-mono text-orange-400 mb-2">
            03. Clean WAV Rebuild
          </div>
          <h3 className="text-sm font-semibold text-zinc-100">
            Universal DAW Compatibility
          </h3>
          <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
            Standard PCM WAV mode strips the proprietary <code className="text-zinc-300">korg</code> chunk and rebuilds pure <code className="text-zinc-300">fmt </code> + <code className="text-zinc-300">data</code> headers (with optional Start–End trimming) so every sample loads cleanly in Ableton, Logic, and hardware samplers.
          </p>
        </div>
      </div>
    </section>
  );
};
