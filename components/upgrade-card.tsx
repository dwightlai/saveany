export function UpgradeCard() {
  return (
    <section className="rounded-3xl border border-fuchsia-300/30 bg-gradient-to-br from-fuchsia-500/20 to-indigo-500/20 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <span className="inline-block rounded-full bg-fuchsia-400/20 px-3 py-1 text-xs font-semibold text-fuchsia-200">
            PRO 升级位
          </span>
          <h3 className="text-2xl font-bold text-white">升级会员，下载速度更快，批量任务更省时间</h3>
          <p className="text-sm text-zinc-200">
            当前版本为公开测试版，后续将上线极速队列、批量下载、专属节点与更高优先级能力。
          </p>
        </div>
        <button className="h-11 rounded-xl bg-white px-5 text-sm font-semibold text-black">升级会员</button>
      </div>
    </section>
  );
}
