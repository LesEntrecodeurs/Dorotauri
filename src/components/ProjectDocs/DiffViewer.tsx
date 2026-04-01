import type { FileDiff } from './useDiffData';

interface DiffViewerProps {
  diff: FileDiff;
  fileName: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  added:    { label: 'Added',    color: 'bg-green-500/20 text-green-400' },
  modified: { label: 'Modified', color: 'bg-amber-500/20 text-amber-400' },
  deleted:  { label: 'Deleted',  color: 'bg-red-500/20 text-red-400' },
  renamed:  { label: 'Renamed',  color: 'bg-blue-500/20 text-blue-400' },
};

export function DiffViewer({ diff, fileName }: DiffViewerProps) {
  const statusInfo = STATUS_LABELS[diff.status];

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
        <span className="text-xs font-mono truncate flex-1">{fileName}</span>
        {statusInfo && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusInfo.color}`}>
            {statusInfo.label}
          </span>
        )}
        {(diff.additions > 0 || diff.deletions > 0) && (
          <span className="text-[10px] font-mono shrink-0">
            {diff.additions > 0 && <span className="text-green-400">+{diff.additions}</span>}
            {diff.additions > 0 && diff.deletions > 0 && <span className="text-muted-foreground mx-1">/</span>}
            {diff.deletions > 0 && <span className="text-red-400">-{diff.deletions}</span>}
          </span>
        )}
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-y-auto">
        {diff.isBinary ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Binary file changed
          </div>
        ) : diff.hunks.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No changes
          </div>
        ) : (
          <table className="w-full border-collapse font-mono text-xs">
            <tbody>
              {diff.hunks.map((hunk, hi) => (
                <HunkBlock key={hi} header={hunk.header} lines={hunk.lines} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function HunkBlock({
  header,
  lines,
}: {
  header: string;
  lines: FileDiff['hunks'][0]['lines'];
}) {
  return (
    <>
      {/* Hunk header */}
      <tr>
        <td colSpan={4} className="px-3 py-1 bg-primary/10 text-primary/70 text-[11px] select-none">
          {header}
        </td>
      </tr>
      {/* Diff lines */}
      {lines.map((line, li) => {
        const bgClass =
          line.lineType === 'add'
            ? 'bg-green-500/10'
            : line.lineType === 'remove'
              ? 'bg-red-500/10'
              : '';
        const prefixChar =
          line.lineType === 'add' ? '+' : line.lineType === 'remove' ? '-' : ' ';
        const prefixColor =
          line.lineType === 'add'
            ? 'text-green-400'
            : line.lineType === 'remove'
              ? 'text-red-400'
              : 'text-transparent';

        return (
          <tr key={li} className={bgClass}>
            <td className="w-[1px] whitespace-nowrap px-2 py-0 text-right text-muted-foreground/40 select-none tabular-nums">
              {line.oldLine ?? ''}
            </td>
            <td className="w-[1px] whitespace-nowrap px-2 py-0 text-right text-muted-foreground/40 select-none tabular-nums">
              {line.newLine ?? ''}
            </td>
            <td className={`w-[1px] whitespace-nowrap px-1 py-0 select-none ${prefixColor}`}>
              {prefixChar}
            </td>
            <td className="whitespace-pre px-1 py-0">{line.content}</td>
          </tr>
        );
      })}
    </>
  );
}
