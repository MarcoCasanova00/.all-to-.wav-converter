import React from 'react';
import { Download, Play, Search, Square } from 'lucide-react';
import {
  formatBytes,
  formatDuration,
  formatSlotNumber,
  ParsedSample,
} from '../lib/electribeParser';

interface SampleTableProps {
  samples: ParsedSample[];
  totalCount: number;
  selectedId: string | null;
  playingId: string | null;
  checkedIds: Set<string>;
  searchQuery: string;
  categoryFilter: string;
  availableCategories: string[];
  onSearchChange: (q: string) => void;
  onCategoryChange: (cat: string) => void;
  onSelectSample: (sample: ParsedSample) => void;
  onPlaySample: (sample: ParsedSample) => void;
  onToggleCheck: (id: string) => void;
  onToggleCheckAllFiltered: () => void;
  onDownloadSample: (sample: ParsedSample) => void;
}

export const SampleTable: React.FC<SampleTableProps> = ({
  samples,
  totalCount,
  selectedId,
  playingId,
  checkedIds,
  searchQuery,
  categoryFilter,
  availableCategories,
  onSearchChange,
  onCategoryChange,
  onSelectSample,
  onPlaySample,
  onToggleCheck,
  onToggleCheckAllFiltered,
  onDownloadSample,
}) => {
  const allFilteredChecked =
    samples.length > 0 && samples.every((s) => checkedIds.has(s.id));

  return (
    <div className="bg-[#13161D] border border-[#252A36] rounded-lg overflow-hidden flex flex-col">
      {/* Filter & Search Toolbar */}
      <div className="px-4 py-3 border-b border-[#252A36] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-[220px]">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Filter by name or slot (e.g. Kick, 004)..."
              aria-label="Filter samples"
              className="w-full h-10 pl-9 pr-3 rounded-md bg-[#0B0D11] border border-[#252A36] text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-orange-500/70 transition-colors"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => onCategoryChange(e.target.value)}
            aria-label="Filter by Electribe category"
            className="h-10 px-3 rounded-md bg-[#0B0D11] border border-[#252A36] text-sm text-zinc-200 focus:outline-none focus:border-orange-500/70 transition-colors cursor-pointer"
          >
            <option value="ALL">All Categories</option>
            {availableCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3 text-xs text-zinc-400 font-mono tabular-nums whitespace-nowrap">
          <span>
            Showing {samples.length} of {totalCount}
          </span>
          {checkedIds.size > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-orange-400">{checkedIds.size} selected</span>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
        <table className="w-full text-left border-collapse min-w-[660px]">
          <thead className="sticky top-0 z-10 bg-[#101319] border-b border-[#252A36] text-xs font-medium text-zinc-400">
            <tr>
              <th className="py-2.5 pl-4 pr-2 w-10">
                <input
                  type="checkbox"
                  checked={allFilteredChecked}
                  onChange={onToggleCheckAllFiltered}
                  aria-label="Select all visible samples"
                  className="w-4 h-4 rounded border-[#363D4F] bg-[#0B0D11] accent-orange-500 cursor-pointer align-middle"
                />
              </th>
              <th className="py-2.5 px-2 w-12 text-center">Play</th>
              <th className="py-2.5 px-3 w-16">Slot</th>
              <th className="py-2.5 px-3">Sample Name</th>
              <th className="py-2.5 px-3 w-28">Category</th>
              <th className="py-2.5 px-3 w-32">Format</th>
              <th className="py-2.5 px-3 w-20 text-right">Length</th>
              <th className="py-2.5 px-3 w-24 text-right">Size</th>
              <th className="py-2.5 pl-2 pr-4 w-28 text-right">Export</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1C202B] text-sm">
            {samples.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-14 text-center text-zinc-500 text-sm">
                  No samples match the active search or category filter.
                </td>
              </tr>
            ) : (
              samples.map((sample) => {
                const isSelected = sample.id === selectedId;
                const isPlaying = sample.id === playingId;
                const isChecked = checkedIds.has(sample.id);

                return (
                  <tr
                    key={sample.id}
                    onClick={() => onSelectSample(sample)}
                    className={`h-11 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-orange-500/10'
                        : 'hover:bg-[#191D26]'
                    }`}
                  >
                    <td
                      className="pl-4 pr-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => onToggleCheck(sample.id)}
                        aria-label={`Select ${sample.name}`}
                        className="w-4 h-4 rounded border-[#363D4F] bg-[#0B0D11] accent-orange-500 cursor-pointer align-middle"
                      />
                    </td>
                    <td
                      className="px-2 text-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectSample(sample);
                        onPlaySample(sample);
                      }}
                    >
                      <button
                        type="button"
                        aria-label={isPlaying ? `Stop ${sample.name}` : `Play ${sample.name}`}
                        className={`inline-flex items-center justify-center w-8 h-8 rounded transition-colors cursor-pointer ${
                          isPlaying
                            ? 'bg-orange-500 text-zinc-950'
                            : 'text-zinc-300 hover:bg-[#252A36] hover:text-white'
                        }`}
                      >
                        {isPlaying ? (
                          <Square className="w-3.5 h-3.5 fill-current" />
                        ) : (
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        )}
                      </button>
                    </td>
                    <td className="px-3 font-mono tabular-nums text-xs text-zinc-400">
                      {formatSlotNumber(sample.displaySlot)}
                    </td>
                    <td className="px-3 font-medium text-zinc-100 max-w-[200px] truncate">
                      {sample.name}
                    </td>
                    <td className="px-3 text-xs text-zinc-400 whitespace-nowrap">
                      {sample.category}
                    </td>
                    <td className="px-3 text-xs text-zinc-400 font-mono tabular-nums whitespace-nowrap">
                      {sample.channels === 1 ? 'Mono' : 'Stereo'} · {(sample.sampleRate / 1000).toFixed(1).replace(/\.0$/, '')}kHz
                    </td>
                    <td className="px-3 text-right font-mono tabular-nums text-xs text-zinc-300">
                      {formatDuration(sample.durationSec)}
                    </td>
                    <td className="px-3 text-right font-mono tabular-nums text-xs text-zinc-400">
                      {formatBytes(sample.pcmDataSize)}
                    </td>
                    <td
                      className="pl-2 pr-4 text-right"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownloadSample(sample);
                      }}
                    >
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded border border-[#282E3B] bg-[#181C25] hover:bg-[#222733] hover:border-zinc-500 text-xs font-medium text-zinc-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                        <span>.wav</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
