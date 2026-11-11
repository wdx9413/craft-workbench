/** Inline, pessimistic recovery for one version of a pending native input. */
export function appendQueueRecovery(row, { resolve, isCurrent, hold, release, onResolved }) {
  const controls = document.createElement('div'); controls.className = 'agent-queue-recovery';
  controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', '核对排队消息');
  row.append(controls);
  let busy = false;
  const button = (label, click, danger = false) => {
    const node = document.createElement('button'); node.type = 'button'; node.className = danger ? 'btn queue-discard' : 'btn';
    node.textContent = label; node.onclick = click; return node;
  };
  const keep = () => { if (!busy && isCurrent()) release(); };
  controls.onkeydown = event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); keep(); } };
  async function run(action) {
    if (busy || !isCurrent()) return;
    if (hold() === false) return;
    busy = true;
    const waiting = document.createElement('p'); waiting.textContent = action === 'inspect' ? '正在核对接收回执…' : '正在移出队列…';
    controls.setAttribute('aria-busy', 'true'); controls.replaceChildren(waiting);
    try {
      const result = await resolve(action);
      if (!isCurrent()) return;
      if (result.resolved) { await onResolved(result); return; }
      const explanation = document.createElement('p');
      explanation.textContent = result.manual_discard_allowed
        ? '是否已发送仍未确认。移出会删除这条待核对消息，原生历史保留。'
        : '回合或派发进程仍未确认结束。请先查看原生历史，消息继续保留。';
      const retain = button('保留消息', keep);
      controls.replaceChildren(explanation, retain);
      if (result.manual_discard_allowed) controls.append(button('已核对，移出队列', () => run('discard'), true));
      retain.focus();
    } catch (error) {
      if (!isCurrent()) return;
      const explanation = document.createElement('p'); explanation.textContent = '核对未完成：' + error.message;
      const retain = button('保留消息', keep);
      controls.replaceChildren(explanation, button('重试核对', () => run('inspect')), retain);
      retain.focus();
    } finally { busy = false; if (isCurrent()) controls.setAttribute('aria-busy', 'false'); }
  }
  controls.append(button('核对', () => run('inspect')));
}
