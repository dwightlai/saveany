type UrlInputProps = {
  url: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
};

export function UrlInput({ url, onChange, onSubmit, loading }: UrlInputProps) {
  return (
    <div className="w-full rounded-3xl border border-white/20 bg-white/10 p-3 backdrop-blur-xl">
      <div className="flex flex-col gap-3 md:flex-row">
        <input
          value={url}
          onChange={(e) => onChange(e.target.value)}
          placeholder="粘贴 YouTube/B站/抖音/TikTok/Twitter(X)/小红书/微信视频 链接"
          className="h-14 flex-1 rounded-2xl border border-white/10 bg-black/20 px-5 text-base text-white outline-none placeholder:text-zinc-400"
        />
        <button
          onClick={onSubmit}
          disabled={loading}
          className="h-14 rounded-2xl bg-gradient-to-r from-cyan-400 via-blue-500 to-violet-500 px-8 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "解析中..." : "立即解析"}
        </button>
      </div>
    </div>
  );
}
