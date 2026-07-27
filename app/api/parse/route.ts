import { NextRequest, NextResponse } from "next/server";
import { cleanupOldTasks, isRateLimited } from "@/lib/task-store";
import { detectPlatform } from "@/lib/platform";
import { getVideoInfo } from "@/lib/yt-dlp";
import { fetchDouyinFallbackInfo } from "@/lib/douyin-fallback";
import { fetchWeixinFallbackInfo } from "@/lib/weixin-fallback";

export const runtime = "nodejs";

function getClientIp(req: NextRequest) {
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return "unknown";
  return xff.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: NextRequest) {
  cleanupOldTasks();
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return NextResponse.json({ message: "请求过于频繁，请稍后重试" }, { status: 429 });
  }

  let body: { url?: string };
  try {
    body = (await req.json()) as { url?: string };
  } catch {
    return NextResponse.json({ message: "请求参数格式错误" }, { status: 400 });
  }

  const url = body.url?.trim();
  if (!url) {
    return NextResponse.json({ message: "请先粘贴视频链接" }, { status: 400 });
  }

  const platform = detectPlatform(url);
  if (!platform) {
    return NextResponse.json({ message: "暂不支持该平台链接" }, { status: 400 });
  }

  if (platform === "douyin") {
    const fallback = await fetchDouyinFallbackInfo(url);
    if (fallback) {
      return NextResponse.json({
        platform,
        info: {
          id: `dy-fallback-${Date.now()}`,
          title: fallback.title,
          duration: fallback.duration,
          thumbnail: fallback.thumbnail,
          webpageUrl: url,
          formats: [
            {
              id: `direct::${Buffer.from(fallback.playUrl, "utf8").toString("base64url")}`,
              ext: "mp4",
              quality: "高清(直链)",
              size: null,
              hasAudio: true,
            },
          ],
        },
      });
    }
    return NextResponse.json({ message: "抖音专用解析暂时失败，请换一个抖音链接重试" }, { status: 502 });
  }

  if (platform === "weixin") {
    const fallback = await fetchWeixinFallbackInfo(url);
    if (fallback) {
      return NextResponse.json({
        platform,
        info: {
          id: `wx-fallback-${Date.now()}`,
          title: fallback.title,
          duration: fallback.duration,
          thumbnail: fallback.thumbnail,
          webpageUrl: url,
          formats: [
            {
              id: `direct::${Buffer.from(fallback.playUrl, "utf8").toString("base64url")}`,
              ext: "mp4",
              quality: "高清(直链)",
              size: null,
              hasAudio: true,
            },
          ],
        },
      });
    }
    return NextResponse.json(
      { message: "该视频号链接未返回可下载直链。可配置 WX_CHANNEL_API_BASE 启用视频号本地代理解析" },
      { status: 502 },
    );
  }

  try {
    const info = await getVideoInfo(url);
    const audibleFormats = info.formats.filter((f) => f.hasAudio);
    const formats = audibleFormats.length ? audibleFormats : info.formats;
    if (!info.formats.length) {
      return NextResponse.json({ message: "未获取到可下载格式，请更换视频重试" }, { status: 400 });
    }
    return NextResponse.json({ platform, info: { ...info, formats } });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "解析失败，请稍后重试" },
      { status: 500 },
    );
  }
}
