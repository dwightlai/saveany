import fs from "node:fs";

export type WeixinFallbackInfo = {
  title: string;
  duration: number | null;
  thumbnail: string | null;
  playUrl: string;
};

type BrowserMeta = {
  title: string | null;
  thumbnail: string | null;
};

const WEIXIN_HEADERS: Record<string, string> = {
  Origin: "https://channels.weixin.qq.com",
  Referer: "https://channels.weixin.qq.com/",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

function findStringDeep(input: unknown, matcher: (value: string) => boolean): string | null {
  if (typeof input === "string") return matcher(input) ? input : null;
  if (Array.isArray(input)) {
    for (const item of input) {
      const hit = findStringDeep(item, matcher);
      if (hit) return hit;
    }
    return null;
  }
  if (input && typeof input === "object") {
    for (const value of Object.values(input as Record<string, unknown>)) {
      const hit = findStringDeep(value, matcher);
      if (hit) return hit;
    }
  }
  return null;
}

function findAllStringsDeep(input: unknown, matcher: (value: string) => boolean, out: Set<string>) {
  if (typeof input === "string") {
    if (matcher(input)) out.add(input);
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) findAllStringsDeep(item, matcher, out);
    return;
  }
  if (input && typeof input === "object") {
    for (const value of Object.values(input as Record<string, unknown>)) {
      findAllStringsDeep(value, matcher, out);
    }
  }
}

function extractM3u8UrlsFromJsonTree(input: unknown) {
  const raw = JSON.stringify(input).replaceAll("\\/", "/");
  const re = /https?:\/\/[^\s"']+\.m3u8(?:\?[^\s"']*)?/gi;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const s = raw;
  re.lastIndex = 0;
  while ((m = re.exec(s)) !== null) {
    const u = m[0];
    if (/^https?:\/\//i.test(u)) out.add(u);
  }
  return out;
}

function extractShortUri(url: string): string | null {
  try {
    const u = new URL(url);
    const sphMatch = u.pathname.match(/\/sph\/([A-Za-z0-9_-]+)/);
    if (sphMatch?.[1]) return sphMatch[1];
    const id = u.searchParams.get("id");
    if (id) return id.replace(/[^A-Za-z0-9_-]/g, "");
    const tail = u.pathname.match(/\/sph\/?([A-Za-z0-9_-]+)/);
    return tail?.[1] || null;
  } catch {
    return null;
  }
}

async function resolveToFinderUrl(url: string) {
  const res = await fetch(url, {
    redirect: "follow",
    cache: "no-store",
    headers: {
      "User-Agent": WEIXIN_HEADERS["User-Agent"],
    },
  });
  return res.url || url;
}

function scoreTencentMediaUrl(u: string) {
  let s = 0;
  const low = u.toLowerCase();
  if (/stodownload\?/i.test(low) && !/\.m3u8/i.test(low)) s -= 250;
  if (/picformat=|wxampicformat=/i.test(low)) s -= 120;
  if (/\.m3u8(\?|$)/i.test(u)) s += 85;
  if (/master|playlist|index\.m3u8|multi_bitrate/i.test(low)) s += 140;
  if (/\.m4s(\?|$)/i.test(low)) s -= 80;
  if (/\.mp4(\?|$)/i.test(low)) s += 35;
  if (/finder\.video\.qq\.com/i.test(low)) s += 25;
  s += Math.min(Math.floor(u.length / 12), 35);
  return s;
}

function pickBestTencentUrl(urls: Iterable<string>) {
  const list = [...urls]
    .filter((u) => /^https?:\/\//i.test(u) && !/\.(jpg|jpeg|png|webp)(\?|$)/i.test(u))
    .filter((u) => !(/stodownload\?/i.test(u) && !/\.m3u8/i.test(u)));
  if (!list.length) return null;
  let best = list[0];
  let bestScore = scoreTencentMediaUrl(best);
  for (const u of list) {
    const sc = scoreTencentMediaUrl(u);
    if (sc > bestScore) {
      best = u;
      bestScore = sc;
    }
  }
  if (bestScore < 1) return null;
  return best;
}

async function isVideoUrl(url: string) {
  try {
    const h: Record<string, string> = { "User-Agent": WEIXIN_HEADERS["User-Agent"] };
    if (/qq\.com|finder\.video/i.test(url)) {
      h.Referer = "https://channels.weixin.qq.com/";
    }
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      cache: "no-store",
      headers: h,
    });
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    return contentType.startsWith("video/");
  } catch {
    return false;
  }
}

function getBrowserExecutablePath() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (fromEnv) return fromEnv;
  const list = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const item of list) {
    if (fs.existsSync(item)) return item;
  }
  return undefined;
}

async function fetchWeixinByBrowser(shareUrl: string): Promise<WeixinFallbackInfo | null> {
  try {
    const mod = (await import("puppeteer-core")) as typeof import("puppeteer-core");
    const executablePath = getBrowserExecutablePath();
    if (!executablePath) return null;
    const browser = await mod.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      );
      const candidates = new Set<string>();
      const cdp = await page.createCDPSession();
      await cdp.send("Network.enable");
      cdp.on("Network.responseReceived", (evt) => {
        const u = evt.response.url;
        if (/\.m3u8(\?|$)/i.test(u) && /^https?:\/\//i.test(u)) candidates.add(u);
      });
      page.on("response", (res) => {
        const u = res.url();
        const h = res.headers();
        const c = (h["content-type"] || "").toLowerCase();
        if (/stodownload\?/i.test(u) && !/\.m3u8/i.test(u)) return;
        if (
          /video\/|mpegurl|x-mpegurl/.test(c) ||
          /\.(mp4|m3u8)(\?|$)/i.test(u) ||
          /finder\.video\.qq\.com/i.test(u)
        ) {
          candidates.add(u);
        }
      });
      const final = await resolveToFinderUrl(shareUrl);
      const short = extractShortUri(final) || extractShortUri(shareUrl);
      const goto =
        short != null
          ? `https://channels.weixin.qq.com/finder-preview/pages/sph?id=${encodeURIComponent(short)}`
          : shareUrl;
      await page.goto(goto, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForSelector("video", { timeout: 12000 }).catch(() => null);
      await page
        .evaluate(() => {
          const v = document.querySelector("video");
          if (v) void (v as HTMLVideoElement).play().catch(() => {});
        })
        .catch(() => null);
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 8000 }).catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const httpSrc = await page.evaluate(() => {
        const v = document.querySelector("video") as HTMLVideoElement | null;
        const s = v?.currentSrc || v?.src || "";
        return /^https?:\/\//i.test(s) ? s : "";
      });
      if (httpSrc) candidates.add(httpSrc);
      const perfUrls = (await page.evaluate(() => {
        try {
          return performance
            .getEntriesByType("resource")
            .map((e) => (e as PerformanceResourceTiming).name)
            .filter((name) => /\.m3u8(\?|$)/i.test(name) && /^https?:\/\//i.test(name));
        } catch {
          return [] as string[];
        }
      })) as string[];
      for (const u of perfUrls) candidates.add(u);
      const meta = (await page.evaluate(() => {
        const title =
          document.title ||
          document.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
          document.querySelector('meta[name="description"]')?.getAttribute("content") ||
          "";
        const thumbnail =
          document.querySelector('meta[property="og:image"]')?.getAttribute("content") ||
          document.querySelector('meta[name="twitter:image"]')?.getAttribute("content") ||
          "";
        return {
          title: title.trim() || null,
          thumbnail: thumbnail.trim() || null,
        };
      })) as BrowserMeta;
      const urls = [...candidates].filter((u) => /^https?:\/\//i.test(u) && !/\.jpg|\.jpeg|\.png|\.webp/i.test(u));
      const picked = pickBestTencentUrl(urls);
      if (!picked) return null;
      return {
        title: meta.title || "微信视频号",
        duration: null,
        thumbnail: meta.thumbnail || null,
        playUrl: picked,
      };
    } finally {
      await browser.close().catch(() => null);
    }
  } catch {
    return null;
  }
}

async function fetchWeixinByLocalApi(
  shareUrl: string,
  fallbackTitle: string,
  fallbackThumbnail: string | null,
): Promise<WeixinFallbackInfo | null> {
  const localApiBase = process.env.WX_CHANNEL_API_BASE?.trim();
  if (!localApiBase) return null;
  try {
    const endpoint = `${localApiBase.replace(/\/$/, "")}/api/channels/feed/profile?url=${encodeURIComponent(shareUrl)}`;
    const localRes = await fetch(endpoint, { cache: "no-store" });
    if (!localRes.ok) return null;
    const localData = (await localRes.json()) as Record<string, unknown>;
    const localObj = (((localData.data as Record<string, unknown> | undefined)?.object as Record<string, unknown>) ||
      {}) as Record<string, unknown>;
    const objectDesc = (localObj.objectDesc as Record<string, unknown> | undefined) || {};
    const media = (objectDesc.media as Array<Record<string, unknown>> | undefined) || [];
    const first = media[0] || {};
    const localUrl =
      (first.url as string) || findStringDeep(localData, (v) => /^https?:\/\/.+/i.test(v) && /video|mp4|m3u8/i.test(v));
    if (!localUrl) return null;
    const token = (first.urlToken as string) || "";
    const playUrl =
      token && !localUrl.includes("token=")
        ? `${localUrl}${localUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
        : localUrl;
    const localTitle = (objectDesc.description as string) || fallbackTitle || "微信视频号";
    return {
      title: localTitle,
      duration: null,
      thumbnail: fallbackThumbnail,
      playUrl,
    };
  } catch {
    return null;
  }
}

export async function fetchWeixinFallbackInfo(shareUrl: string): Promise<WeixinFallbackInfo | null> {
  const finalUrl = await resolveToFinderUrl(shareUrl);
  const shortUri = extractShortUri(finalUrl) || extractShortUri(shareUrl);
  if (!shortUri) return null;
  const defaultTitle = "微信视频号";
  let fallbackTitle = defaultTitle;
  let fallbackThumbnail: string | null = null;

  const pageUrl = `https://channels.weixin.qq.com/finder-preview/pages/sph?id=${encodeURIComponent(shortUri)}`;
  const rid = crypto.randomUUID().replace(/-/g, "");
  const apiUrl = `https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info?_rid=${rid}&_pageUrl=${encodeURIComponent(pageUrl)}`;

  const payload = {
    shortUri,
    baseReq: { generalToken: "" },
  };

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        ...WEIXIN_HEADERS,
        Referer: pageUrl,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      const feedInfo = ((data.data as Record<string, unknown> | undefined)?.feedInfo || {}) as Record<string, unknown>;
      const title = (feedInfo.description as string) || defaultTitle;
      const thumbnail = (feedInfo.coverUrl as string) || null;
      fallbackTitle = title;
      fallbackThumbnail = thumbnail;
      const candidates = new Set<string>();
      findAllStringsDeep(
        data,
        (v) =>
          /^https?:\/\/.+/i.test(v) &&
          /(finder\.video\.qq\.com|qq\.com)/i.test(v) &&
          !(/stodownload\?/i.test(v) && !/\.m3u8/i.test(v)),
        candidates,
      );
      const list = [...candidates]
        .filter((u) => !/picformat=|wxampicformat=|image\/|\.jpg|\.png|\.webp/i.test(u))
        .filter((u) => !(/stodownload\?/i.test(u) && !/\.m3u8/i.test(u)));
      const scoredUrls = new Set<string>(list);
      for (const u of extractM3u8UrlsFromJsonTree(data)) scoredUrls.add(u);
      const deepM3u8 = findStringDeep(data, (v) => /^https?:\/\/.+/i.test(v) && /\.m3u8(\?|$)/i.test(v));
      if (deepM3u8) scoredUrls.add(deepM3u8);
      const deepMp4 = findStringDeep(
        data,
        (v) =>
          /^https?:\/\/.+/i.test(v) &&
          (/\.mp4(\?|$)/i.test(v) || (/finder\.video\.qq\.com/i.test(v) && !/stodownload\?/i.test(v))),
      );
      if (deepMp4) scoredUrls.add(deepMp4);
      for (const url of list) {
        if (await isVideoUrl(url)) scoredUrls.add(url);
      }
      const best = pickBestTencentUrl(scoredUrls);
      if (best) {
        return {
          title,
          duration: null,
          thumbnail,
          playUrl: best,
        };
      }
      const direct = findStringDeep(
        data,
        (v) =>
          /^https?:\/\/.+/i.test(v) &&
          /(\.mp4(\?|$)|video\/|m3u8)/i.test(v) &&
          !(/stodownload\?/i.test(v) && !/\.m3u8/i.test(v)),
      );
      if (direct) {
        return {
          title,
          duration: null,
          thumbnail,
          playUrl: direct,
        };
      }
    }
  } catch {}

  const localApiFallback = await fetchWeixinByLocalApi(shareUrl, fallbackTitle, fallbackThumbnail);
  if (localApiFallback) return localApiFallback;

  const browserFallback = await fetchWeixinByBrowser(shareUrl);
  if (browserFallback) {
    if (!browserFallback.thumbnail && fallbackThumbnail) {
      return {
        title: browserFallback.title,
        duration: null,
        thumbnail: fallbackThumbnail,
        playUrl: browserFallback.playUrl,
      };
    }
    return browserFallback;
  }
  return null;
}
