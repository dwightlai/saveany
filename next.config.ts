import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.hdslb.com" },
      { protocol: "http", hostname: "**.hdslb.com" },
      { protocol: "https", hostname: "**.bilivideo.com" },
      { protocol: "http", hostname: "**.bilivideo.com" },
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "**.tiktokcdn.com" },
      { protocol: "https", hostname: "**.muscdn.com" },
      { protocol: "https", hostname: "**.xiaohongshu.com" },
      { protocol: "https", hostname: "**.xhscdn.com" },
      { protocol: "http", hostname: "**.xhscdn.com" },
      { protocol: "http", hostname: "**.xiaohongshu.com" },
      { protocol: "https", hostname: "**.qpic.cn" },
      { protocol: "https", hostname: "**.qq.com" },
      { protocol: "http", hostname: "**.qq.com" },
      { protocol: "https", hostname: "**.douyinpic.com" },
      { protocol: "https", hostname: "**.douyinvod.com" },
      { protocol: "https", hostname: "**.byteimg.com" },
      { protocol: "https", hostname: "**.byted-static.com" },
      { protocol: "https", hostname: "**.twimg.com" },
      { protocol: "http", hostname: "**.twimg.com" },
    ],
  },
};

export default nextConfig;
