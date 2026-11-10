/**
 * Client for Craft's allow-listed local CLI installer.
 *
 * The backend owns the command, the child process and verification. This module
 * only starts a job and polls its bounded state, so a lost response never
 * triggers a second install.
 */
export const TOOL_INSTALL_STAGES = {
  preflight: '检查环境',
  install: '安装中',
  verify: '验证可执行文件',
  writeback: '写入配置',
  done: '完成',
};

export function describeJob(job) {
  if (!job) return { label: '等待安装', percent: 0, terminal: false };
  const percent = job.state === 'succeeded' ? 100
    : job.stage === 'install' ? 55
      : job.stage === 'verify' ? 85
        : job.stage === 'writeback' ? 95
          : job.stage === 'preflight' ? 15 : 0;
  const label = job.state === 'failed' ? '安装失败'
    : job.state === 'cancelled' ? '已取消'
      : job.state === 'succeeded' ? '安装完成'
        : TOOL_INSTALL_STAGES[job.stage] || '安装中';
  return { label, percent, terminal: job.state !== 'running' };
}

export function startToolInstall({ api, provider, onUpdate = () => {}, interval = 350, timeout = 10 * 60 * 1000 }) {
  if (typeof api !== 'function') throw new Error('安装需要本机 Craft 运行时');
  if (typeof provider !== 'string' || !provider) throw new Error('缺少工具标识');
  return api('/api/workbench/tool-install', { method: 'POST', body: { provider } })
    .then(result => {
      const job = result && result.job;
      if (!job || typeof job.id !== 'string') throw new Error('安装任务未返回编号');
      onUpdate(job);
      return waitForJob({ api, job, onUpdate, interval, timeout });
    });
}

export function waitForJob({ api, job, onUpdate = () => {}, interval = 350, timeout = 10 * 60 * 1000 }) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (Date.now() > deadline) { reject(new Error('安装超时；任务可能仍在后台继续，请稍后重新检测')); return; }
      api('/api/workbench/tool-install/' + encodeURIComponent(job.id))
        .then(result => {
          const next = result && result.job;
          if (!next) throw new Error('安装任务状态丢失');
          onUpdate(next);
          if (next.state !== 'running') { resolve(next); return; }
          setTimeout(poll, interval);
        })
        .catch(reject);
    };
    poll();
  });
}

export function cancelToolInstall({ api, id }) {
  return api('/api/workbench/tool-install/' + encodeURIComponent(id) + '/cancel', { method: 'POST', body: {} })
    .then(result => result && result.job);
}

export function installOutputText(job) {
  if (!job) return '';
  const stage = describeJob(job).label;
  const tail = job.output ? '\n' + job.output : '';
  return '[' + stage + ']' + (job.error ? '\n' + job.error : '') + tail;
}
