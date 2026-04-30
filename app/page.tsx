"use client";

import { useMemo, useState } from "react";
import { UrlInput } from "@/components/url-input";
import { VideoResult } from "@/components/video-result";
import { FormatList, type UiFormat } from "@/components/format-list";
import { UpgradeCard } from "@/components/upgrade-card";

type ParseResult = {
  platform: string;
  info: {
    title: string;
    duration: number | null;
    thumbnail: string | null;
    formats: UiFormat[];
  };
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState("");

  const valueCards = useMemo(
    () => [
      { title: "极速解析", text: "链接秒级识别，减少等待时间" },
      { title: "多平台支持", text: "YouTube/B站/抖音/TikTok/Twitter(X)/小红书/微信视频 一站下载" },
      { title: "手机可用", text: "移动端同样三步搞定视频保存" },
    ],
    [],
  );

  const handleParse = async () => {
    if (!url.trim()) {
      setError("请先粘贴视频链接");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as ParseResult | { message: string };
      if (!res.ok) {
        throw new Error("message" in data ? data.message : "解析失败");
      }
      setResult(data as ParseResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "解析失败");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (formatId: string) => {
    if (!result) return;
    setError("");
    setDownloadingId(formatId);
    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          formatId,
          title: result.info.title,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        throw new Error(data.message || "下载失败");
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${result.info.title}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载失败");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#070912] text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 md:px-8 md:py-12">
        <header className="space-y-4">
          <div className="inline-flex rounded-full border border-cyan-300/30 bg-cyan-500/15 px-3 py-1 text-xs text-cyan-200">
            SaveAny Video Downloader
          </div>
          <h1 className="text-3xl font-black leading-tight md:text-5xl">
            万能视频下载站
            <br />
            更快下载，全平台可用，手机也能一键保存
          </h1>
          <p className="max-w-3xl text-sm text-zinc-300 md:text-base">
            不用复杂操作，粘贴链接即可解析并下载。支持 YouTube、Bilibili、抖音、TikTok、小红书、微信视频。
          </p>
        </header>

        <UrlInput url={url} onChange={setUrl} onSubmit={handleParse} loading={loading} />

        <section className="grid gap-3 md:grid-cols-3">
          {valueCards.map((card) => (
            <article key={card.title} className="rounded-2xl border border-white/15 bg-white/5 p-4">
              <h2 className="text-lg font-bold text-white">{card.title}</h2>
              <p className="mt-2 text-sm text-zinc-300">{card.text}</p>
            </article>
          ))}
        </section>

        {error ? <p className="rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}

        {result ? (
          <section className="grid gap-4 md:grid-cols-2">
            <VideoResult
              title={result.info.title}
              duration={result.info.duration}
              thumbnail={result.info.thumbnail}
              platform={result.platform}
            />
            <div className="space-y-3 rounded-3xl border border-white/15 bg-white/10 p-4">
              <h2 className="text-lg font-bold">可选下载格式</h2>
              <FormatList formats={result.info.formats} downloadingId={downloadingId} onDownload={handleDownload} />
            </div>
          </section>
        ) : null}

        <UpgradeCard />

        <p className="text-xs text-zinc-400">
          仅用于下载你拥有合法权限的视频内容。请遵守所在地区法律法规和平台条款。
        </p>
      </div>
    </div>
  );
}
