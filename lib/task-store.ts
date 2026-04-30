type TaskStatus = "queued" | "running" | "done" | "failed";

type DownloadTask = {
  id: string;
  status: TaskStatus;
  filePath?: string;
  error?: string;
  createdAt: number;
};

const tasks = new Map<string, DownloadTask>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 24;
const ipHits = new Map<string, number[]>();

export function createTask(id: string) {
  const task: DownloadTask = {
    id,
    status: "queued",
    createdAt: Date.now(),
  };
  tasks.set(id, task);
  return task;
}

export function setTaskRunning(id: string) {
  const task = tasks.get(id);
  if (task) {
    task.status = "running";
  }
}

export function setTaskDone(id: string, filePath: string) {
  const task = tasks.get(id);
  if (task) {
    task.status = "done";
    task.filePath = filePath;
  }
}

export function setTaskFailed(id: string, error: string) {
  const task = tasks.get(id);
  if (task) {
    task.status = "failed";
    task.error = error;
  }
}

export function isRateLimited(ip: string) {
  const now = Date.now();
  const previous = ipHits.get(ip) ?? [];
  const fresh = previous.filter((ts) => now - ts < WINDOW_MS);
  fresh.push(now);
  ipHits.set(ip, fresh);
  return fresh.length > MAX_REQUESTS;
}

export function cleanupOldTasks(maxAgeMs = 1000 * 60 * 30) {
  const now = Date.now();
  for (const [id, task] of tasks.entries()) {
    if (now - task.createdAt > maxAgeMs) {
      tasks.delete(id);
    }
  }
}
