export type UiFormat = {
  id: string;
  ext: string;
  quality: string;
  size: number | null;
  hasAudio: boolean;
};

type FormatListProps = {
  formats: UiFormat[];
  downloadingId: string | null;
  onDownload: (formatId: string) => void;
};

function formatSize(size: number | null) {
  if (!size) return "未知";
  const mb = size / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function FormatList({ formats, downloadingId, onDownload }: FormatListProps) {
  return (
    <div className="grid gap-3">
      {formats.map((item) => (
        <div
          key={`${item.id}-${item.ext}`}
          className="flex flex-col gap-3 rounded-2xl border border-white/15 bg-black/30 p-4 md:flex-row md:items-center md:justify-between"
        >
          <div className="space-y-1">
            <p className="text-sm font-semibold text-white">{item.quality}</p>
            <p className="text-xs text-zinc-300">
              格式 {item.ext.toUpperCase()} · 体积 {formatSize(item.size)} · {item.hasAudio ? "含音频" : "无音频"}
            </p>
          </div>
          <button
            onClick={() => onDownload(item.id)}
            disabled={downloadingId === item.id}
            className="h-10 rounded-xl bg-white px-5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloadingId === item.id ? "下载中..." : "下载此格式"}
          </button>
        </div>
      ))}
    </div>
  );
}
