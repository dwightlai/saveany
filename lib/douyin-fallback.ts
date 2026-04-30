export type DouyinFallbackInfo = {
  title: string;
  duration: number | null;
  thumbnail: string | null;
  playUrl: string;
};

const DOUYIN_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: "https://www.douyin.com/",
};

function extractVideoId(url: string): string | null {
  const patterns = [/\/video\/(\d{8,24})/, /\/note\/(\d{8,24})/, /[?&](?:modal_id|item_ids|group_id|aweme_id)=(\d{8,24})/];
  for (const p of patterns) {
    const m = url.match(p);
    if (m?.[1]) return m[1];
  }
  const fallback = url.match(/(?<!\d)(\d{8,24})(?!\d)/);
  return fallback?.[1] || null;
}

async function resolveFinalUrl(inputUrl: string) {
  const res = await fetch(inputUrl, {
    headers: DOUYIN_HEADERS,
    redirect: "follow",
    cache: "no-store",
  });
  return res.url || inputUrl;
}

function extractRouterData(html: string): Record<string, unknown> | null {
  const marker = "window._ROUTER_DATA = ";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  let idx = start + marker.length;
  while (idx < html.length && /\s/.test(html[idx])) idx += 1;
  if (html[idx] !== "{") return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = idx; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const payload = html.slice(idx, i + 1);
        try {
          return JSON.parse(payload) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

type DouyinItem = {
  desc?: string;
  video?: {
    duration?: number;
    play_addr?: { url_list?: string[] };
    cover?: { url_list?: string[] };
    origin_cover?: { url_list?: string[] };
    dynamic_cover?: { url_list?: string[] };
  };
};

function extractItemFromRouterData(routerData: Record<string, unknown>): DouyinItem | null {
  const loaderData = routerData.loaderData;
  if (!loaderData || typeof loaderData !== "object") return null;
  for (const node of Object.values(loaderData as Record<string, unknown>)) {
    if (!node || typeof node !== "object") continue;
    const videoInfoRes = (node as Record<string, unknown>).videoInfoRes;
    if (!videoInfoRes || typeof videoInfoRes !== "object") continue;
    const list = (videoInfoRes as Record<string, unknown>).item_list;
    if (Array.isArray(list) && list[0] && typeof list[0] === "object") {
      return list[0] as DouyinItem;
    }
  }
  return null;
}

function findStringDeep(input: unknown, matcher: (value: string) => boolean): string | null {
  if (typeof input === "string") {
    return matcher(input) ? input : null;
  }
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

function findNumberDeep(input: unknown, keys: string[]): number | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const n = findNumberDeep(item, keys);
        if (n !== null) return n;
      }
      continue;
    }
    const n = findNumberDeep(value, keys);
    if (n !== null) return n;
  }
  return null;
}

export async function fetchDouyinFallbackInfo(shareUrl: string): Promise<DouyinFallbackInfo | null> {
  try {
    const resolved = await resolveFinalUrl(shareUrl);
    const videoId = extractVideoId(resolved) || extractVideoId(shareUrl);
    if (!videoId) return null;

    const sharePageUrl = `https://www.iesdouyin.com/share/video/${videoId}/`;
    const pageRes = await fetch(sharePageUrl, {
      headers: DOUYIN_HEADERS,
      cache: "no-store",
      redirect: "follow",
    });
    const html = await pageRes.text();
    const routerData = extractRouterData(html);
    if (!routerData) return null;

    const item = extractItemFromRouterData(routerData);
    const playUrlRaw = item?.video?.play_addr?.url_list?.[0];
    if (!playUrlRaw) return null;

    const title = item?.desc?.trim() || "抖音视频";
    const thumbnail =
      item?.video?.cover?.url_list?.[0] || item?.video?.origin_cover?.url_list?.[0] || item?.video?.dynamic_cover?.url_list?.[0] || null;
    const durationMs = item?.video?.duration;

    return {
      title,
      thumbnail,
      duration: typeof durationMs === "number" ? Math.floor(durationMs / 1000) : null,
      playUrl: playUrlRaw.replace("playwm", "play"),
    };
  } catch {
    const token = process.env.TIKHUB_API_TOKEN?.trim();
    if (!token) return null;

    const endpoint =
      process.env.DOUYIN_PROVIDER_ENDPOINT?.trim() ||
      "https://api.tikhub.io/api/v1/douyin/web/fetch_one_video_by_share_url";
    const requestUrl = `${endpoint}?share_url=${encodeURIComponent(shareUrl)}`;
    const res = await fetch(requestUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as Record<string, unknown>;
    const data = (payload.data || payload) as Record<string, unknown>;
    const playUrl =
      findStringDeep(data, (v) => /^https?:\/\/.+/i.test(v) && (v.includes(".mp4") || v.includes("play"))) || null;
    if (!playUrl) return null;
    const title =
      findStringDeep(data, (v) => v.length > 0 && v.length < 200 && !/^https?:\/\//i.test(v)) || "抖音视频";
    const thumbnail =
      findStringDeep(data, (v) => /^https?:\/\/.+/i.test(v) && /(jpg|jpeg|png|webp)(\?|$)/i.test(v)) || null;
    const duration = findNumberDeep(data, ["duration", "video_duration", "duration_ms"]);
    return {
      title,
      thumbnail,
      duration: duration && duration > 1000 ? Math.floor(duration / 1000) : duration,
      playUrl,
    };
  }
}
