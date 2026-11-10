import { mountAgentWorkspace } from './agent-workspace.js';

const BASE = '/api/workbench/agent-sessions';

/** Project-first desktop entry. Conversation history remains in the native CLI. */
export function mountProjectShell({ root, legacy, api, invoke, mountWorkspace = mountAgentWorkspace, defaultPermission = '', defaultProvider = '', onOpenPage = () => {} }) {
  root.classList.add('project-shell');
  root.innerHTML = `<aside class="project-rail"><div class="project-brand"><img class="project-mark" src="./craft-logo.svg" alt=""><strong>Craft</strong><span>工作台</span></div><button class="project-new" type="button">＋　新建会话</button><div class="project-label">最近项目</div><div class="project-recent" aria-live="polite">正在读取…</div><div class="project-label">工作台</div><nav class="project-nav" aria-label="工作台导航"><button type="button" data-page="home">完整工作台</button><button type="button" data-page="approvals">待我批准</button><button type="button" data-page="plugins">插件与技能</button><button type="button" data-page="connectors">连接器 / MCP</button><button type="button" data-page="models">模型</button><button type="button" data-page="memory">记忆</button><button type="button" data-page="knowledge">知识</button><button type="button" data-page="workflows">经验</button><button type="button" data-page="settings">设置</button></nav></aside><main class="project-main"><header class="project-top"><span>工作空间</span><span class="project-local">●　本地</span></header><div class="project-content"><section class="project-agent" hidden></section></div></main>`;
  const q = selector => root.querySelector(selector);
  const agent = q('.project-agent'), recent = q('.project-recent'), nav = q('.project-nav');
  // The conversation view replaces the whole shell, so it must carry every
  // destination the full workbench has instead of hiding settings behind it.
  if (nav) nav.onclick = event => { const button = event.target.closest('[data-page]'); if (button) onOpenPage(button.dataset.page); };
  let lastWorkspace = '';
  function open(taskId, workspace, selectedLink = '') {
    if (workspace) lastWorkspace = workspace;
    agent.hidden = false; agent.replaceChildren();
    const view = document.createElement('div'); agent.append(view);
    mountWorkspace(view, { api, taskId, workspace, selectedLink, defaultPermission, defaultProvider, invoke, onSessionsChanged: refresh, onOpenNative: importNative, onOpenPage });
  }
  let nativeBusy = false;
  async function importNative(thread, provider, model, permission) {
    if (nativeBusy) return;
    nativeBusy = true;
    try {
      if (thread.linked_task_id && thread.linked_id) { open(thread.linked_task_id, thread.workspace, thread.linked_id); return; }
      const task = await api('/api/tasks', { method: 'POST', body: { title: thread.title || '历史会话', goal: '继续已有的原生会话', permission_mode: 'human_approval' } });
      const taskId = task.task?.id || task.id;
      if (!taskId) throw new Error('创建任务失败');
      const nativeBase = provider === 'dsh' ? '/api/workbench/dsh-native' : BASE + '/' + provider + '-native';
      const result = await api(nativeBase, { method: 'POST', body: { task_id: taskId, thread_id: thread.id,
        ...(provider === 'dsh' ? { workspace: thread.workspace, permission } : provider === 'claude' ? { model: model || null, permission } : {}) } });
      open(taskId, result.link.workspace, result.link.id);
      void refresh();
    } catch (error) { throw new Error('无法接入会话：' + error.message); }
    finally { nativeBusy = false; }
  }
  const renderedProjects = new Map();
  let refreshSerial = 0;
  function providerName(value) {
    return value === 'codex' ? 'Codex CLI' : value === 'claude' ? 'Claude Code' : value === 'dsh' ? 'DSH' : value === 'craft' ? 'Craft' : value ? String(value) : '原生工具';
  }
  async function refresh(cursor = null, serial = ++refreshSerial) {
    try {
      const result = await api(BASE + '/projects?limit=50' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      if (serial !== refreshSerial) return;
      if (!cursor) { recent.replaceChildren(); renderedProjects.clear(); }
      recent.querySelector?.('.project-more')?.remove();
      const projects = new Map();
      for (const link of result.links || []) {
        if (!link || typeof link.workspace !== 'string' || !link.workspace) continue;
        if (!lastWorkspace && link.workspace) lastWorkspace = link.workspace;
        const task = { id: link.task_id };
        if (!projects.has(link.workspace)) projects.set(link.workspace, []);
        projects.get(link.workspace).push({ task, link });
      }
      for (const [workspace, entries] of projects) {
        let group = renderedProjects.get(workspace);
        if (!group) {
          group = document.createElement('details'); group.open = true; group.className = 'project-group';
          const title = document.createElement('summary'); title.textContent = workspace.split(/[\\/]/).filter(Boolean).pop() || workspace; title.title = workspace; group.append(title);
          renderedProjects.set(workspace, group); recent.append(group);
        }
        for (const { task, link } of entries) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'project-recent-item';
          const name = document.createElement('strong'); name.textContent = link.title || '工作会话';
          const meta = document.createElement('span'); meta.textContent = providerName(link.provider) + ' · ' + (link.turn_state === 'running' ? '运行中' : link.turn_state === 'unknown' ? '待核对' : link.model || '就绪');
          button.append(name, meta); button.onclick = () => open(task.id, link.workspace, link.id); group.append(button);
        }
      }
      if (result.next_cursor) {
        const more = document.createElement('button'); more.type = 'button'; more.className = 'project-more'; more.textContent = '加载更多';
        more.onclick = () => { more.disabled = true; void refresh(result.next_cursor, serial); }; recent.append(more);
      }
      if (!recent.childNodes.length) recent.textContent = '还没有会话';
    } catch (e) { if (serial === refreshSerial) recent.textContent = '无法读取最近会话：' + e.message; }
  }
  q('.project-new').onclick = () => { open('', lastWorkspace); void refresh(); };
  return { show() { root.hidden = false; legacy.hidden = true; void refresh().then(() => { if (!agent.children.length) open('', lastWorkspace); }); } };
}
