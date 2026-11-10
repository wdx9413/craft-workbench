/**
 * Connection presentation and bounded self-healing retry for the Workbench shell.
 *
 * The desktop sidecar is started before the window opens, but a single request can
 * still blip (slow first paint, a transient timeout). Rather than leave the rail on
 * "连接失败" until a manual reload, the shell re-probes with capped backoff and stops
 * after a fixed budget so a genuinely dead backend never spins forever.
 */
export const CONNECTION = {
  ok: { state: 'ok', rail: '已连接 · 仅本机', status: '已连接' },
  failed: { state: 'bad', rail: '连接失败', status: '连接失败' },
  unauthorized: { state: 'bad', rail: '未授权', status: '未授权' },
};

// Cap the watchdog so a dead backend stops probing instead of running indefinitely.
export const CONNECTION_MAX_ATTEMPTS = 24;

/** Backoff for the n-th failed probe (1-based): 5s,10s,20s,40s,then capped at 60s. */
export function connectionRetryDelay(attempt) {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1;
  return Math.min(5000 * 2 ** (Math.min(n, 5) - 1), 60000);
}

/** Whether another probe is still allowed after `done` consecutive failures. */
export function shouldRetryConnection(done, max = CONNECTION_MAX_ATTEMPTS) {
  return Number.isInteger(done) && done >= 0 && done < max;
}
