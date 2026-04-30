import fs from "node:fs";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { cleanupOldTasks, createTask, isRateLimited, setTaskDone, setTaskFailed, setTaskRunning } from "@/lib/task-store";
import { detectPlatform } from "@/lib/platform";
import { downloadVideo, removeFileSafe, ytDlpDownloadMediaUrl, ytDlpPipeBinaryUrl } from "@/lib/yt-dlp";

export const runtime = "nodejs";

function getClientIp(req: NextRequest) {
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return "unknown";
  return xff.split(",")[0]?.trim() || "unknown";
}

const TENCENT_DIRECT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function isTencentVideoUrl(url: string) {
  return /finder\.video\.qq\.com|\.qq\.com\/|\.gtimg\.com|video\.qq\.com/i.test(url);
}

function ffmpegHeadersArg(url: string): string[] {
  if (!isTencentVideoUrl(url)) return [];
  const block =
    `Referer: https://channels.weixin.qq.com/\r\n` +
    `Origin: https://channels.weixin.qq.com\r\n` +
    `User-Agent: ${TENCENT_DIRECT_UA}\r\n`;
  return ["-headers", block];
}

function directFetchInit(url: string): RequestInit {
  if (!isTencentVideoUrl(url)) return { cache: "no-store", redirect: "follow" };
  return {
    cache: "no-store",
    redirect: "follow",
    headers: {
      Referer: "https://channels.weixin.qq.com/",
      Origin: "https://channels.weixin.qq.com",
      "User-Agent": TENCENT_DIRECT_UA,
      Accept: "*/*",
    },
  };
}

function bufferHasFtyp(buf: Uint8Array) {
  const n = Math.min(buf.length, 65536);
  for (let i = 0; i <= n - 4; i++) {
    if (buf[i] === 0x66 && buf[i + 1] === 0x74 && buf[i + 2] === 0x79 && buf[i + 3] === 0x70) return true;
  }
  return false;
}

function bufferHasIsoBmffRoot(buf: Uint8Array) {
  if (bufferHasFtyp(buf)) return true;
  const n = Math.min(buf.length, 131072);
  for (let i = 0; i <= n - 4; i++) {
    const a = buf[i];
    const b = buf[i + 1];
    const c = buf[i + 2];
    const d = buf[i + 3];
    if (a === 0x6d && b === 0x6f && c === 0x6f && d === 0x76) return true;
    if (a === 0x6d && b === 0x6f && c === 0x6f && d === 0x66) return true;
    if (a === 0x73 && b === 0x74 && c === 0x79 && d === 0x70) return true;
  }
  return false;
}

function isLikelyHtmlOrJson(buf: Uint8Array) {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, Math.min(256, buf.length))).trimStart();
  return head.startsWith("<!") || head.startsWith("<html") || head.startsWith("{") || head.startsWith("<?xml");
}

function isPlausibleVideoBody(buf: ArrayBuffer, contentType: string) {
  const u8 = new Uint8Array(buf);
  const ct = contentType.toLowerCase();
  if (isLikelyHtmlOrJson(u8)) return false;
  if (bufferHasIsoBmffRoot(u8)) return true;
  if (ct.includes("video/") && buf.byteLength >= 200_000) return true;
  if (ct.includes("octet-stream") && buf.byteLength >= 200_000) return true;
  if (buf.byteLength >= 512_000) return true;
  return false;
}

function isPlausibleTencentVideo(buf: ArrayBuffer) {
  const u8 = new Uint8Array(buf);
  if (isLikelyHtmlOrJson(u8)) return false;
  if (bufferHasIsoBmffRoot(u8)) return true;
  if (buf.byteLength >= 400_000) return true;
  return false;
}

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  const u8 = new Uint8Array(buf);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

async function ffmpegUrlToMp4InMemory(url: string): Promise<Buffer> {
  const ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  return new Promise<Buffer>((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-protocol_whitelist",
      "file,http,https,tcp,tls,crypto",
      ...ffmpegHeadersArg(url),
      "-i",
      url,
      "-c",
      "copy",
      "-bsf:a",
      "aac_adtstoasc",
      "-f",
      "mp4",
      "pipe:1",
    ];
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("ffmpeg 拉流超时"));
    }, 300_000);
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", () => {
      clearTimeout(timer);
      reject(new Error("未找到 ffmpeg，请安装后配置 FFMPEG_PATH"));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(chunks));
        return;
      }
      reject(new Error(stderr.trim() || "ffmpeg 拉流失败"));
    });
  });
}

async function transcodeM3u8ToMp4(url: string): Promise<Buffer> {
  const ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  return new Promise<Buffer>((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-protocol_whitelist",
      "file,http,https,tcp,tls,crypto",
      ...ffmpegHeadersArg(url),
      "-i",
      url,
      "-c",
      "copy",
      "-f",
      "mp4",
      "pipe:1",
    ];
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("m3u8 转码超时"));
    }, 180000);
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", () => {
      clearTimeout(timer);
      reject(new Error("未找到 ffmpeg，请安装后配置 FFMPEG_PATH"));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(chunks));
        return;
      }
      reject(new Error(stderr.trim() || "m3u8 转码失败"));
    });
  });
}

export async function POST(req: NextRequest) {
  cleanupOldTasks();
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return NextResponse.json({ message: "请求过于频繁，请稍后重试" }, { status: 429 });
  }

  let body: { url?: string; formatId?: string; title?: string };
  try {
    body = (await req.json()) as { url?: string; formatId?: string; title?: string };
  } catch {
    return NextResponse.json({ message: "请求参数格式错误" }, { status: 400 });
  }

  const url = body.url?.trim();
  const formatId = body.formatId?.trim();
  const title = (body.title || "video").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "video";

  if (!url || !formatId) {
    return NextResponse.json({ message: "缺少下载参数" }, { status: 400 });
  }

  if (!detectPlatform(url)) {
    return NextResponse.json({ message: "暂不支持该平台链接" }, { status: 400 });
  }

  const localTaskId = crypto.randomUUID();
  createTask(localTaskId);
  setTaskRunning(localTaskId);

  try {
    if (formatId.startsWith("direct::")) {
      const directUrl = Buffer.from(formatId.slice("direct::".length), "base64url").toString("utf8");
      if (isTencentVideoUrl(directUrl)) {
        try {
          const dl = await ytDlpDownloadMediaUrl(directUrl);
          const data = await fs.promises.readFile(dl.filePath);
          await removeFileSafe(dl.filePath);
          const arr = bufferToArrayBuffer(data);
          if (isPlausibleTencentVideo(arr)) {
            setTaskDone(localTaskId, directUrl);
            return new NextResponse(arr, {
              status: 200,
              headers: {
                "content-type": "application/octet-stream",
                "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${title}.mp4`)}`,
                "content-length": String(arr.byteLength),
                "cache-control": "no-store",
              },
            });
          }
        } catch {}
      }
      if (/\.m3u8(\?|$)/i.test(directUrl)) {
        let data: Buffer;
        try {
          data = await transcodeM3u8ToMp4(directUrl);
        } catch {
          try {
            data = await ytDlpPipeBinaryUrl(directUrl);
          } catch {
            setTaskFailed(localTaskId, "m3u8 拉流失败");
            return NextResponse.json({ message: "视频合成失败，请确认已安装 ffmpeg、yt-dlp" }, { status: 502 });
          }
        }
        const u8m = new Uint8Array(data);
        const badM3u8 = isTencentVideoUrl(directUrl)
          ? !isPlausibleTencentVideo(bufferToArrayBuffer(data))
          : isLikelyHtmlOrJson(u8m) || data.length < 500;
        if (badM3u8) {
          setTaskFailed(localTaskId, "m3u8 输出异常");
          return NextResponse.json({ message: "视频合成失败，请重试" }, { status: 502 });
        }
        setTaskDone(localTaskId, directUrl);
        return new NextResponse(u8m, {
          status: 200,
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${title}.mp4`)}`,
            "content-length": String(data.length),
            "cache-control": "no-store",
          },
        });
      }
      const directRes = await fetch(directUrl, directFetchInit(directUrl));
      if (!directRes.ok) {
        setTaskFailed(localTaskId, "直链下载失败");
        return NextResponse.json({ message: "直链下载失败，请重试" }, { status: 502 });
      }
      const contentType = (directRes.headers.get("content-type") || "").toLowerCase();
      if (/mpegurl|x-mpegurl/.test(contentType)) {
        let data: Buffer;
        try {
          data = await transcodeM3u8ToMp4(directUrl);
        } catch {
          try {
            data = await ytDlpPipeBinaryUrl(directUrl);
          } catch {
            setTaskFailed(localTaskId, "m3u8 拉流失败");
            return NextResponse.json({ message: "视频合成失败，请确认已安装 ffmpeg、yt-dlp" }, { status: 502 });
          }
        }
        const u8 = new Uint8Array(data);
        const badM3u8b = isTencentVideoUrl(directUrl)
          ? !isPlausibleTencentVideo(bufferToArrayBuffer(data))
          : isLikelyHtmlOrJson(u8) || data.length < 500;
        if (badM3u8b) {
          setTaskFailed(localTaskId, "m3u8 输出异常");
          return NextResponse.json({ message: "视频合成失败，请重试" }, { status: 502 });
        }
        setTaskDone(localTaskId, directUrl);
        return new NextResponse(u8, {
          status: 200,
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${title}.mp4`)}`,
            "content-length": String(data.length),
            "cache-control": "no-store",
          },
        });
      }
      let arr = await directRes.arrayBuffer();
      if (isTencentVideoUrl(directUrl) && !isPlausibleVideoBody(arr, contentType)) {
        for (const fn of [ffmpegUrlToMp4InMemory, ytDlpPipeBinaryUrl]) {
          try {
            const buf = await fn(directUrl);
            const ru = new Uint8Array(buf);
            const next = ru.buffer.slice(ru.byteOffset, ru.byteOffset + ru.byteLength) as ArrayBuffer;
            if (isPlausibleTencentVideo(next)) {
              arr = next;
              break;
            }
          } catch {}
        }
      }
      if (isTencentVideoUrl(directUrl) && !isPlausibleTencentVideo(arr)) {
        setTaskFailed(localTaskId, "直链内容无效");
        return NextResponse.json(
          { message: "微信视频下载失败，请确认已安装 ffmpeg、yt-dlp，或配置 WX_CHANNEL_API_BASE 后重试" },
          { status: 502 },
        );
      }
      setTaskDone(localTaskId, directUrl);
      return new NextResponse(arr, {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${title}.mp4`)}`,
          "content-length": String(arr.byteLength),
          "cache-control": "no-store",
        },
      });
    }

    const result = await downloadVideo(url, formatId);
    setTaskDone(localTaskId, result.filePath);

    const stat = await fs.promises.stat(result.filePath);
    if (stat.size > 500 * 1024 * 1024) {
      await removeFileSafe(result.filePath);
      return NextResponse.json({ message: "文件过大，请选择更低清晰度" }, { status: 400 });
    }

    const data = await fs.promises.readFile(result.filePath);
    await removeFileSafe(result.filePath);

    return new NextResponse(data, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${title}.mp4`)}`,
        "content-length": String(data.length),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    setTaskFailed(localTaskId, error instanceof Error ? error.message : "下载失败");
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "下载失败，请稍后重试" },
      { status: 500 },
    );
  }
}
