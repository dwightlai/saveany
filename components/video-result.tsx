import Image from "next/image";

type VideoResultProps = {
  title: string;
  duration: number | null;
  thumbnail: string | null;
  platform: string;
};

function formatDuration(duration: number | null) {
  if (!duration) return "--:--";
  const mins = Math.floor(duration / 60);
  const secs = duration % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function VideoResult({ title, duration, thumbnail, platform }: VideoResultProps) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/15 bg-white/10">
      <div className="relative aspect-video w-full bg-zinc-900">
        {thumbnail ? (
          <Image src={thumbnail} alt={title} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-400">暂无封面</div>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
          {platform.toUpperCase()}
        </span>
      </div>
      <div className="space-y-2 p-4">
        <h3 className="line-clamp-2 text-base font-semibold text-white">{title}</h3>
        <p className="text-sm text-zinc-300">时长 {formatDuration(duration)}</p>
      </div>
    </div>
  );
}
