import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";

type RawFormat = {
  format_id: string;
  ext?: string;
  format_note?: string;
  resolution?: string;
  filesize?: number;
  vcodec?: string;
  acodec?: string;
};

type RawInfo = {
  id: string;
  title: string;
  duration?: number;
  thumbnail?: string;
  webpage_url?: string;
  formats?: RawFormat[];
};

export type VideoFormat = {
  id: string;
  ext: string;
  quality: string;
  size: number | null;
  hasAudio: boolean;
};

export type VideoInfo = {
  id: string;
  title: string;
  duration: number | null;
  thumbnail: string | null;
  webpageUrl: string;
  formats: VideoFormat[];
};

function isDouyinUrl(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "douyin.com" || host.endsWith(".douyin.com");
  } catch {
    return false;
  }
}

async function validateCookieConfig(url: string) {
  if (!isDouyinUrl(url)) return;
  const cookieFile = process.env.YTDLP_COOKIE_FILE?.trim();
  if (!cookieFile) return;

  let raw = "";
  try {
    raw = await fs.readFile(cookieFile, "utf8");
  } catch {
    throw new Error(`Cookie 文件不存在: ${cookieFile}`);
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (lines.length < 5) {
    throw new Error("cookies.txt 内容过少。若不想使用 Cookie，请在 .env.local 配置 TIKHUB_API_TOKEN 启用免 Cookie 兜底");
  }
  if (!/douyin\.com|iesdouyin\.com/i.test(raw)) {
    throw new Error("cookies.txt 中没有抖音域名 Cookie。若不想使用 Cookie，请配置 TIKHUB_API_TOKEN");
  }
  if (!/sessionid|sessionid_ss|passport_auth_status/i.test(raw)) {
    throw new Error("cookies.txt 缺少登录态字段(sessionid)。若不想使用 Cookie，请配置 TIKHUB_API_TOKEN");
  }
}

function getCookieArgs() {
  const fromBrowser = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim();
  if (fromBrowser) {
    return ["--cookies-from-browser", fromBrowser];
  }
  const cookieFile = process.env.YTDLP_COOKIE_FILE?.trim();
  if (cookieFile) {
    return ["--cookies", cookieFile];
  }
  return [];
}

function tencentYtDlpHeaderArgs(mediaUrl: string): string[] {
  if (!/finder\.video\.qq\.com|\.qq\.com\/|video\.qq\.com|\.gtimg\.com/i.test(mediaUrl)) return [];
  return [
    "--add-header",
    "Referer:https://channels.weixin.qq.com/",
    "--add-header",
    "Origin:https://channels.weixin.qq.com",
    "--add-header",
    "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  ];
}

let cachedYtDlpCommand: string | null = null;
let ytDlpResolvePromise: Promise<string> | null = null;

function getYtDlpCommandSync() {
  const fromEnv = process.env.YTDLP_PATH?.trim();
  if (fromEnv) return fromEnv;
  if (process.platform !== "win32") return "yt-dlp";
  try {
    const pkg = require.resolve("yt-dlp-exec/package.json");
    const bin = path.join(path.dirname(pkg), "bin", "yt-dlp.exe");
    if (fsSync.existsSync(bin)) return bin;
  } catch {}
  return "yt-dlp";
}

async function ensureYtDlpCommand() {
  if (cachedYtDlpCommand) return cachedYtDlpCommand;
  if (ytDlpResolvePromise) return ytDlpResolvePromise;
  ytDlpResolvePromise = (async () => {
    const cmd = getYtDlpCommandSync();
    if (cmd !== "yt-dlp") {
      cachedYtDlpCommand = cmd;
      return cmd;
    }
    const file = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp_linux";
    const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${file}`;
    const dir = path.join(os.tmpdir(), "saveany-bin");
    const target = path.join(dir, file);
    if (!fsSync.existsSync(target)) {
      await fs.mkdir(dir, { recursive: true });
      const res = await fetch(downloadUrl, { cache: "no-store" });
      if (!res.ok) throw new Error("服务端未检测到 yt-dlp，请先安装后再试");
      const ab = await res.arrayBuffer();
      await fs.writeFile(target, Buffer.from(ab));
      if (process.platform !== "win32") await fs.chmod(target, 0o755);
    }
    cachedYtDlpCommand = target;
    return target;
  })()
    .finally(() => {
      ytDlpResolvePromise = null;
    });
  return ytDlpResolvePromise;
}

export async function ytDlpPipeBinaryUrl(mediaUrl: string, timeoutMs = 300000): Promise<Buffer> {
  const ytDlpCmd = await ensureYtDlpCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(
      ytDlpCmd,
      [
        ...tencentYtDlpHeaderArgs(mediaUrl),
        "--no-warnings",
        "--no-playlist",
        "--socket-timeout",
        "30",
        ...getCookieArgs(),
        "-f",
        "best",
        "-o",
        "-",
        mediaUrl,
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    const chunks: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("yt-dlp 拉流超时"));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("服务端未检测到 yt-dlp，请先安装后再试"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(mapYtDlpError(stderr)));
        return;
      }
      const buf = Buffer.concat(chunks);
      if (buf.length < 2000) {
        reject(new Error("yt-dlp 输出过小"));
        return;
      }
      resolve(buf);
    });
  });
}

export async function ytDlpDownloadMediaUrl(mediaUrl: string, baseDir?: string) {
  const taskId = randomUUID();
  const outputDir = baseDir || process.env.DOWNLOAD_DIR || path.join(os.tmpdir(), "saveany-downloads");
  await fs.mkdir(outputDir, { recursive: true });
  const template = path.join(outputDir, `${taskId}.%(ext)s`);
  await runYtDlp(
    [
      ...tencentYtDlpHeaderArgs(mediaUrl),
      "--no-warnings",
      "--no-playlist",
      "--socket-timeout",
      "30",
      "--retries",
      "3",
      "--fragment-retries",
      "3",
      ...getCookieArgs(),
      "-f",
      "best",
      "--merge-output-format",
      "mp4",
      "-o",
      template,
      mediaUrl,
    ],
    300000,
  );
  const files = await fs.readdir(outputDir);
  const matched = files.find((name) => name.startsWith(taskId));
  if (!matched) {
    throw new Error("yt-dlp 下载完成但文件不存在");
  }
  return {
    taskId,
    filePath: path.join(outputDir, matched),
    fileName: matched,
  };
}

function runYtDlp(args: string[], timeoutMs = 120000) {
  return ensureYtDlpCommand().then(
    (ytDlpCmd) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(ytDlpCmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("下载任务超时，请稍后重试"));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("服务端未检测到 yt-dlp，请先安装后再试"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(mapYtDlpError(stderr)));
      }
    });
      }),
  );
}

function mapYtDlpError(stderr: string) {
  const text = stderr || "";
  if (text.includes("Fresh cookies")) {
    return "Cookie 无效或已过期，请重新导出 cookies.txt（需先在浏览器登录抖音）";
  }
  if (text.includes("Private video")) return "该视频为私密内容，无法下载";
  if (text.includes("Video unavailable")) return "该视频不可用或已下架";
  if (text.includes("Unsupported URL")) return "链接暂不支持，请检查后重试";
  return text || "yt-dlp 执行失败";
}

function normalizeFormats(formats: RawFormat[] = []) {
  const finalFormats: VideoFormat[] = [];
  for (const item of formats) {
    if (!item.format_id) continue;
    if (!item.vcodec || item.vcodec === "none") continue;
    const quality = item.format_note || item.resolution || "自适应";
    finalFormats.push({
      id: item.format_id,
      ext: item.ext || "mp4",
      quality,
      size: item.filesize ?? null,
      hasAudio: item.acodec !== "none",
    });
  }

  const dedup = new Map<string, VideoFormat>();
  for (const item of finalFormats) {
    const key = `${item.id}-${item.ext}`;
    if (!dedup.has(key)) dedup.set(key, item);
  }
  return [...dedup.values()].slice(0, 30);
}

export async function getVideoInfo(url: string): Promise<VideoInfo> {
  await validateCookieConfig(url);
  const output = await runYtDlp(
    ["-J", "--no-warnings", "--no-playlist", "--socket-timeout", "15", ...getCookieArgs(), url],
    60000,
  );
  let parsed: RawInfo;
  try {
    parsed = JSON.parse(output) as RawInfo;
  } catch {
    throw new Error("解析视频信息失败，请更换链接重试");
  }

  return {
    id: parsed.id,
    title: parsed.title,
    duration: parsed.duration ?? null,
    thumbnail: parsed.thumbnail ?? null,
    webpageUrl: parsed.webpage_url || url,
    formats: normalizeFormats(parsed.formats),
  };
}

export async function downloadVideo(url: string, formatId: string, baseDir?: string) {
  await validateCookieConfig(url);
  const taskId = randomUUID();
  const outputDir = baseDir || process.env.DOWNLOAD_DIR || path.join(os.tmpdir(), "saveany-downloads");
  await fs.mkdir(outputDir, { recursive: true });

  const template = path.join(outputDir, `${taskId}.%(ext)s`);
  await runYtDlp(
    [
      "--no-warnings",
      "--no-playlist",
      ...getCookieArgs(),
      "-f",
      formatId,
      "--merge-output-format",
      "mp4",
      "-o",
      template,
      url,
    ],
    180000,
  );

  const files = await fs.readdir(outputDir);
  const matched = files.find((name) => name.startsWith(taskId));
  if (!matched) {
    throw new Error("下载完成但文件不存在");
  }

  return {
    taskId,
    filePath: path.join(outputDir, matched),
    fileName: matched,
  };
}

export async function removeFileSafe(filePath: string) {
  try {
    await fs.unlink(filePath);
  } catch {
    return;
  }
}
