const platformRules = [
  { key: "youtube", hosts: ["youtube.com", "youtu.be"] },
  { key: "bilibili", hosts: ["bilibili.com", "b23.tv"] },
  { key: "douyin", hosts: ["douyin.com"] },
  { key: "tiktok", hosts: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"] },
  { key: "twitter", hosts: ["twitter.com", "x.com", "t.co"] },
  { key: "xiaohongshu", hosts: ["xiaohongshu.com", "xhslink.com"] },
  { key: "weixin", hosts: ["weixin.qq.com", "mp.weixin.qq.com", "channels.weixin.qq.com"] },
] as const;

export type SupportedPlatform = (typeof platformRules)[number]["key"];

export function detectPlatform(url: string): SupportedPlatform | null {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  for (const rule of platformRules) {
    if (rule.hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
      return rule.key;
    }
  }
  return null;
}

export function isSupportedUrl(url: string) {
  return detectPlatform(url) !== null;
}
