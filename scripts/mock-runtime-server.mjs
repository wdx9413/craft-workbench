// V1 · 可独立运行的 Workbench mock 运行时服务。
//
// 正式路径由已安装的 `craft` 包提供 Runtime；本服务用于本地演示与集成冒烟，
// 不替代真实 Host、也不写入 ~/.craft_data。数据合同与
// tests/helpers/mock-runtime.js 保持一致（真实数据用 mock）。
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workbenchDir = resolve(root, 'workbench');

function createState() {
  return {
    tasks: new Map([
      ['t-1', { id: 't-1', title: '修复登录态', workspace: 'ws-1', status: 'running' }],
      ['t-2', { id: 't-2', title: '发布前评审', workspace: 'ws-1', status: 'awaiting_approval' }],
    ]),
    goal: null,
    hatchedObjects: [],
    // Realistic attention cards keep the Console approval page from being an
    // empty state during interactive audits: one open card a person must read,
    // one already deferred, and the L1/HT metrics the page pairs together.
    attention: {
      cards: [
        { id: 'att-1', audience: 'human', status: 'open', action: 'external_write', reason: '发布脚本需要写入远程仓库', source_kind: 'task_run', priority: 72, task_id: 't-2' },
        { id: 'att-2', audience: 'human', status: 'deferred', action: 'read_only', reason: '查看发布报告', source_kind: 'work_review', priority: 12, task_id: 't-1' },
      ],
      rules: [{ id: 'rule-1', action: 'read_only', scope_kind: 'workspace', scope_id: 'ws-1', status: 'active' }],
      l1: { l1_ratio: 0.62, l1_count: 31, l2_count: 14, l3_count: 5, total_decisions: 50, deterministic_checkers: 8 },
      touchpoints: { objects_measured: 12, total_touchpoints: 19, ht_requires_wall_clock: true },
    },
    plugins: [
      { id: 'craft-context', name: 'Craft Context', package_version: '0.15.0', runtime_status: 'active', enabled: true },
      { id: 'agent-skills', name: 'Agent Skills', package_version: '1.2.0', runtime_status: 'active', enabled: false },
    ],
    // Field names follow resource-pages.js: `content` renders, `scope` reads the
    // scope label, and `proposed_by` names who put the memory forward.
    memory: [
      { id: 'mem-1', scope_kind: 'project', scope_id: 'ws-1', content: '发布前必须跑全量回归', scope: 'project:ws-1', kind: '规则', status: 'active', evidence_count: 2, recall_weight: 1.25, helpful_signals: 3, pending_corrections: 0,
        conflict_peers: [{ id: 'mem-2', content: '紧急发布可跳过全量回归', kind: '规则', status: 'active' }] },
    ],
    knowledgeClaims: [
      { id: 'claim-1', kind: '规则', content: '评审通过前不得合并', status: 'active', scope: 'project:/repo', evidence_ids: ['ev-1', 'ev-2', 'ev-3'], recall_weight: 1.1, helpful_signals: 4, pending_corrections: 0, proposed_by: 'operator' },
    ],
    // The experience page reads `result.workflows` (not items) and renders
    // name + description rows with an edit affordance.
    workflows: [
      { id: 'wf-1', name: '发布检查单', description: '发布前必须逐项确认回归、评审与回滚方案', status: 'candidate', stage: 'shadow' },
    ],
    // One Codex link keeps the session surfaces exerciseable: the composer's
    // resume/takeover path and the `/goal` command both need a live session id.
    agentLinks: [
      { id: 'link-codex-1', provider: 'codex', model: 'gpt-5-codex', workspace: 'D:/documents/project/mytest', turn_state: 'idle', permission: 'ask' },
    ],
    workspaces: [
      { id: 'ws-1', path: 'D:/documents/project/mytest', display_name: 'mytest' },
    ],
    mods: new Map([
      ['m1', { id: 'm1', name: 'no-hardcode', status: 'active', enabled: true, version: 2, shadow_test: 'passed' }],
    ]),
    // Starts empty: the evaluation-flow test asserts a fresh runtime has no
    // history and that two POSTs produce exactly two shared-state runs.
    evaluations: new Map(),
    installJobs: new Map(),
    messages: new Map([
      ['msg-1', { id: 'msg-1', from: '联系人甲', subject: '登录态回归', unread: true, read: false, readAt: null, processedAt: null, priority: 'normal' }],
      ['msg-2', { id: 'msg-2', from: '联系人乙', subject: '发布审批', unread: true, read: false, readAt: null, processedAt: null, priority: 'high' }],
    ]),
    extensions: [
      { id: 'ext-1', name: 'Agent Skills', format: 'skill', status: 'installed', scope: 'project' },
      { id: 'ext-2', name: 'Local MCP', format: 'mcp', status: 'available', scope: 'workspace' },
    ],
    proactive: { reminder: true, prepare: false, execute: false },
    pilot: {
      thread_id: 'pilot-thread-1',
      failure_observations: [{ id: 'fo-1', task_id: 't-1', summary: '超时未落盘', evidence_count: 1 }],
      outcomes: { total: 2, counts: { accepted: 1, accepted_with_edits: 1, rejected: 0 }, items: [] },
    },
  };
}

function json(res, value, status = 200) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function taskBoard(state) {
  const buckets = {};
  for (const t of state.tasks.values()) {
    const key = t.status || 'running';
    (buckets[key] ||= []).push({ id: t.id, title: t.title, workspace_id: t.workspace, state: key, reason: '' });
  }
  return {
    order: Object.keys(buckets),
    labels: { running: '执行中', awaiting_approval: '待审批', failed: '失败', completed: '已完成' },
    buckets,
    tasks: Object.fromEntries([...state.tasks.values()].map((t) => [t.id, t])),
  };
}

function route(state, pathname, method, body, query) {
  if (pathname === '/api/runtime-info') return { source: 'mock', version: 'fixture', dataRoot: 'mock://fixtures' };
  if (pathname === '/api/workbench/tool-install' && method === 'GET') {
    return { providers: ['codex', 'claude', 'dsh'].map((id) => ({ id, label: id, package: id, scripts: [], docs: '', command: 'npm install -g ' + id })), jobs: [...state.installJobs.values()] };
  }
  if (pathname === '/api/workbench/tool-install' && method === 'POST') {
    const id = 'install_mock_' + String(state.installJobs.size + 1);
    const job = { id, provider: String(body?.provider ?? ''), label: String(body?.provider ?? ''), state: 'running', stage: 'install', command: 'npm install -g', output: '$ npm install -g\ninstalling…\n', exit_code: null, detected_executable: null, error: null, started_at: new Date().toISOString(), finished_at: null };
    state.installJobs.set(id, { job, polls: 0 });
    return { job };
  }
  const installMatch = /^\/api\/workbench\/tool-install\/([A-Za-z0-9_-]+)(\/cancel)?$/u.exec(pathname);
  if (installMatch) {
    const entry = state.installJobs.get(installMatch[1]);
    if (!entry) return { error: 'Install job not found' };
    if (installMatch[2] === '/cancel') { entry.job.state = 'cancelled'; entry.job.stage = 'done'; entry.job.error = '安装已取消'; return { job: entry.job }; }
    entry.polls += 1;
    if (entry.polls >= 2) {
      entry.job.state = 'succeeded';
      entry.job.stage = 'done';
      entry.job.exit_code = 0;
      entry.job.detected_executable = '/mock/bin/' + entry.job.provider;
      entry.job.output += '[已验证] 可用\n';
      entry.job.finished_at = new Date().toISOString();
    }
    return { job: entry.job };
  }
  if (pathname.startsWith('/api/workbench/task-board')) return taskBoard(state);
  if (pathname.startsWith('/api/workbench/pilot/failure-observations')) return { items: state.pilot.failure_observations };
  if (pathname.startsWith('/api/workbench/pilot/outcomes')) return state.pilot.outcomes;
  if (pathname.startsWith('/api/workbench/pilot/blocked-queue')) {
    return { items: [...state.tasks.values()].filter((t) => t.status === 'blocked').map((t) => ({ session_id: state.pilot.thread_id, task_id: t.id, suspended_reason: t.title })) };
  }
  if (pathname.startsWith('/api/workbench/mods/list')) return { items: [...state.mods.values()] };
  if (pathname.startsWith('/api/workbench/contributions')) return { contributions: [] };
  if (pathname.startsWith('/api/workbench/plugin-discovery/list')) return { items: [] };
  if (pathname.startsWith('/api/workbench/mods/shadow-test/run')) {
    const mod = state.mods.get(String(body?.id ?? 'm1'));
    if (mod) mod.shadow_test = 'passed';
    return { ok: true, shadow_test: 'passed', checks: 4 };
  }
  if (pathname.startsWith('/api/workbench/mods/rollback/previous')) {
    const mod = state.mods.get(String(body?.id ?? 'm1'));
    if (mod) mod.version = Math.max(1, (mod.version ?? 1) - 1);
    return { ok: true, rolled_back_to: mod?.version ?? 1 };
  }
  if (pathname.startsWith('/api/workbench/agent-sessions/providers')) {
    // Realistic statuses let the browser exercise tool switching and the
    // install affordance without touching the host machine.
    return { providers: [
      { id: 'craft', name: 'Craft', status: 'available', version: 'built-in' },
      { id: 'codex', name: 'Codex', status: 'not_found', install_url: 'https://developers.openai.com/codex/cli/' },
      { id: 'claude', name: 'Claude Code', status: 'not_found', install_url: 'https://code.claude.com/docs/en/setup' },
      { id: 'dsh', name: 'DSH', status: 'not_found', install_url: 'https://github.com/deepseek-ai/deepseek-harness' },
    ] };
  }
  if (pathname.startsWith('/api/workbench/agent-sessions/models')) return { models: [{ id: 'gpt-5-codex', name: 'GPT-5 Codex', configured: true }] };
  if (pathname.startsWith('/api/workbench/claude-models')) return { models: [{ id: 'claude-sonnet', name: 'Claude Sonnet', configured: true }] };
  if (pathname.startsWith('/api/workbench/dsh-models')) return { models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] };
  if (pathname.startsWith('/api/config/models')) return { models: [{ id: 'craft-gateway', name: 'Craft Gateway', configured: true }] };
  if (pathname.startsWith('/api/workbench/codex-skills')) return { skills: [{ name: 'review', description: 'Review the change' }] };
  if (pathname.startsWith('/api/workbench/claude-commands')) return { commands: [{ name: 'plan', description: 'Plan first' }] };
  // The composer's `@` suggestion needs files under a chosen workspace, and the
  // browser-hosted workbench needs a picker fallback. Both must precede the
  // generic agent-sessions branch: its startsWith match would otherwise answer
  // these paths with an empty link list.
  // File suggestions answer the composer's live query so `@cli` narrows the list
  // instead of showing every file the runtime knows about.
  const suggestedFiles = [
    { path: 'lib/client.js', name: 'client.js' },
    { path: 'lib/index.js', name: 'index.js' },
    { path: 'docs/readme.md', name: 'readme.md' },
  ];
  if (pathname.startsWith('/api/workbench/agent-sessions/files')) {
    const suggestedQuery = String(query.get('query') ?? '').toLowerCase();
    const limit = Math.max(1, Math.min(100, Number(query.get('limit') ?? 100) || 100));
    const files = suggestedFiles.filter((file) => !query
      || file.path.toLowerCase().includes(suggestedQuery) || file.name.toLowerCase().includes(suggestedQuery));
    return { files: files.slice(0, limit) };
  }
  if (pathname.endsWith('/pick-project-folder')) return { path: 'D:/documents/project/mytest' };
  // `/goal` needs an open Codex session: the goal itself is read and written
  // through the same per-session route the real runtime owns.
  const goalMatch = /^\/api\/workbench\/agent-sessions\/[^/]+\/goal$/u.exec(pathname);
  if (goalMatch) {
    if (method === 'POST') { state.goal = String(body?.objective ?? ''); return { goal: { objective: state.goal, status: 'active' } }; }
    return { goal: state.goal ? { objective: state.goal, status: 'active' } : null };
  }
  if (pathname.startsWith('/api/workbench/agent-sessions')) {
    if (pathname.endsWith('/resume')) return { ok: true, status: { connected: true } };
    if (pathname.endsWith('/takeover')) return { ok: true };
    return { links: state.agentLinks };
  }
  if (pathname.startsWith('/api/workbench/claude-runs')) return { runs: [] };
  if (pathname === '/api/tasks' && method === 'POST') return { task: { id: 'mock-task', title: 'Mock task', goal: 'Mock goal', workspace: '/tmp/mock' } };
  if (pathname === '/api/tasks/mock-task/messages' && method === 'POST') return { assistant: { content: 'mock assistant reply' } };
  if (pathname === '/api/tasks/mock-task' && method === 'GET') return { task: { id: 'mock-task', title: 'Mock task', model_id: 'craft-gateway' }, messages: [] };
  if (pathname.startsWith('/api/workbench/summary')) {
    return { totals: { tasks: state.tasks.size, blocked: [...state.tasks.values()].filter((t) => t.status === 'blocked').length } };
  }
  if (pathname.startsWith('/api/workbench/mods/') && pathname.endsWith('/disable')) return { ok: true };
  if (pathname.startsWith('/api/workbench/mods/') && pathname.endsWith('/approve')) return { ok: true };
  if (pathname.startsWith('/api/workbench/mods/') && pathname.endsWith('/revoke')) return { ok: true };
  if (pathname.startsWith('/api/workbench/pilot/resume-session')) return { ok: true, resumed: true };
  if (pathname.startsWith('/api/workbench/pilot/') && method === 'POST') return { ok: true, dispatched: true };
  if (pathname.startsWith('/api/workbench/messages/list')) {
    const unreadOnly = query.get('unread_only') === 'true';
    return { items: [...state.messages.values()].filter((m) => !unreadOnly || !m.read) };
  }
  if (pathname === '/api/workbench/messages/poll') return { polled: 0, sources: 1 };
  if (pathname === '/api/workbench/messages/batch') {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    if (body?.action === 'read') {
      for (const id of ids) {
        const message = state.messages.get(String(id));
        if (message) { message.read = true; message.unread = false; }
      }
    }
    return { ok: true, affected: ids.length, succeeded: ids.length, failed: 0, partial_failures: [] };
  }
  if (pathname.startsWith('/api/workbench/messages/') && pathname.endsWith('/read')) return { ok: true };
  if (pathname.startsWith('/api/workbench/messages/process-intent')) return { ok: true, dispatched: false };
  if (pathname === '/api/workbench/native-tools') {
    return { tools: [{ name: 'read_file', description: '读取文件', parameters: { properties: { path: { type: 'string' } } } }] };
  }
  if (pathname === '/api/workbench/native-tools/call') {
    return { ok: true, result: { path: String(body?.path ?? '') } };
  }
  if (pathname === '/api/workbench/internal-approvals') return { approvals: [] };
  if (pathname === '/api/workbench/extensions/list') return { items: state.extensions };
  if (pathname.startsWith('/api/workbench/extensions/activate')) return { ok: true, activated: String(body?.id ?? '') };
  // Attention / approval surfaces: the inbox decides, the gate lists learnable
  // rules, and the metrics pair L1 with the deterministic checker count.
  if (pathname === '/api/inbox/refresh') return { cards: state.attention.cards };
  if (pathname === '/api/inbox/decide') {
    const card = state.attention.cards.find((item) => item.id === String(body?.id ?? ''));
    if (card) card.status = body?.decision === 'defer' ? 'deferred' : 'acknowledged';
    return { ok: true, card };
  }
  if (pathname.startsWith('/api/action-gate/rules/all')) return { rules: state.attention.rules };
  if (pathname.startsWith('/api/action-gate/rules/revoke')) {
    const rule = state.attention.rules.find((item) => item.id === String(body?.id ?? ''));
    if (rule) { rule.status = 'revoked'; rule.revoked_reason = String(body?.reason ?? 'revoked by operator'); }
    return { ok: true, rule };
  }
  if (pathname.startsWith('/api/claims/l1-report')) return state.attention.l1;
  if (pathname.startsWith('/api/metrics/touchpoints')) return state.attention.touchpoints;
  if (pathname.startsWith('/api/approval-grants')) {
    const id = pathname.split('/')[3];
    if (method === 'DELETE' && id) return { ok: true, revoked: id };
    return { grants: [{ id: 'grant-1', action: 'read_only', scope_kind: 'workspace', scope_id: 'ws-1', status: 'active', expires_at: '2026-12-01T00:00:00Z' }] };
  }
  if (pathname.startsWith('/api/subscriptions')) {
    if (pathname.includes('/revoke')) return { ok: true, revoked: true };
    if (pathname.includes('/reconfirm')) return { ok: true, reconfirmed: true };
    if (pathname.includes('/audit')) return { events: [{ id: 'evt-1', kind: 'dispatch', at: '2026-11-08T10:00:00Z' }] };
    return { subscriptions: [{ id: 'sub-1', event_kind: 'work_completed', status: 'active', expires_at: '2026-12-01T00:00:00Z', dispatches: 3 }] };
  }
  if (pathname.startsWith('/api/subscription-drift')) {
    if (pathname.includes('/sweep')) return { swept: 1, suspended: 0 };
    // The page lists registered fingerprints so a person can see drift before it
    // suspends anything. One active entry plus one suspended entry shows both
    // ends of the honest state space: drift only ever suspends, never revokes.
    return { subscriptions: [
      { subscription_id: 'sub-1', state: 'active', events_seen: 4, last_event_at: '2026-11-08T10:00:00Z' },
      { subscription_id: 'sub-2', state: 'suspended', events_seen: 2, last_event_at: '2026-11-07T18:30:00Z', changed_fields: ['schema', 'endpoint'], suspended_reason: '上游结构漂移，待人工重新激活' },
    ] };
  }
  if (pathname.startsWith('/api/objects')) {
    if (pathname.endsWith('/acknowledge')) return { ok: true };
    if (pathname.endsWith('/authorize')) return { ok: true, authorized: true };
    if (pathname.endsWith('/hatch')) {
      // The sheet reads `result.object.id` and immediately paints the object page,
      // so the mock must answer with the created object, not a bare id.
      const created = {
        id: 'obj-hatched-1',
        title: String(body?.intention ?? '新对象'),
        kind: String(body?.object_kind ?? 'delivery'),
        bucket: 'needs_you',
        state: 'open',
        open_adjudications: 1,
        awaiting_fields: ['验收标准'],
      };
      state.hatchedObjects.push(created);
      return { ok: true, object: created, object_id: created.id };
    }
    if (pathname.startsWith('/api/objects/receipts')) return { receipts: [] };
    if (method === 'POST') return { ok: true, object: { id: 'obj-1', state: 'open' } };
    // The page renders a rail grouped by `bucket` plus one focused work object
    // with its fields and a single pending adjudication card.
    return {
      counts: { needs_you: 1, in_progress: 1, done: 1 },
      rail: [...state.hatchedObjects.map((item) => ({ ...item, kind: item.kind })), 
        { id: 'obj-1', bucket: 'needs_you', title: '发布门禁', kind: 'delivery', state: 'open', open_adjudications: 1, awaiting_fields: ['回滚方案'] },
        { id: 'obj-2', bucket: 'in_progress', title: '登录态回归排查', kind: 'investigation', state: 'working' },
        { id: 'obj-3', bucket: 'done', title: '评审纪要归档', kind: 'review', state: 'completed', marked: true },
      ],
      focus: (() => {
        const requested = query.get('object_id');
        const hatched = requested ? state.hatchedObjects.find((item) => item.id === requested) : null;
        if (hatched) {
          return { ...hatched, fields: { 目标: hatched.title }, adjudication: { id: 'adj-' + hatched.id, summary: '确认对象范围与验收标准', decision_kind: 'authorize', priority: 40, batch_effects: 1 } };
        }
        return {
          id: 'obj-1', title: '发布门禁', kind: 'delivery', state: 'open',
          fields: { 目标: '发布后 30 分钟内可回滚', 产物: '发布检查单' },
          adjudication: { id: 'adj-1', summary: '允许发布脚本写入远程仓库', decision_kind: 'authorize', priority: 72, batch_effects: 3 },
          waiting_adjudications: 1,
        };
      })(),
    };
  }
  if (pathname.startsWith('/api/executor-templates')) {
    if (method === 'POST') return { ok: true, template: { id: 'exec-new' } };
    return { templates: [{ id: 'exec-1', name: '代码评审', provider: 'craft', model: 'craft-gateway', permission: 'ask', capability_ids: ['read_only'], max_steps: 24 }] };
  }
  if (pathname.startsWith('/api/supervisor-profiles')) {
    if (method === 'POST') return { ok: true, profile: { id: 'sup-new' } };
    return { profiles: [{ id: 'sup-1', name: '发布门禁', review_level: 'standard', can_block: true, supervision_model: null, deterministic_rules: [{ id: 'r1' }] }] };
  }
  if (pathname.startsWith('/api/workbench/plugins')) {
    if (pathname.includes('/install')) return { ok: true, installed: String(body?.spec ?? '') };
    return { items: state.plugins };
  }
  if (pathname.startsWith('/api/workbench/skills')) return { skills: [{ id: 'skill-1', name: 'code-review', format: 'skill' }] };
  if (pathname.startsWith('/api/workbench/memory')) return { items: state.memory };
  if (pathname.startsWith('/api/workbench/knowledge/claims')) return { claims: state.knowledgeClaims };
  if (pathname.startsWith('/api/workbench/workflows')) return { items: state.workflows };
  if (pathname.startsWith('/api/workbench/experience/proposals')) return { items: [{ id: 'prop-1', name: '回归先行', status: 'shadow' }] };
  if (pathname.startsWith('/api/workbench/experience/procedures')) {
    if (pathname.includes('/export')) return { ok: true, exported: 'wf-1' };
    return { items: state.workflows };
  }
  // Relation health separates internal relation gaps (a defect) from external
  // references (often just dependencies this checkout cannot resolve).
  if (pathname.startsWith('/api/workbench/codebase/status')) {
    return {
      status: 'ready',
      workspace_id: query.get('workspace_id'),
      // The page reads the newest index plus top-level diagnostics; the per-index
      // relation_analysis keeps the bounded per-row payload.
      indexes: [{ id: 'idx-1', relation_analysis: { status: 'partial', relations: 512 } }],
      relation_diagnostics: {
        unresolved_relations: 7,
        external_references: 42,
        unresolved_type_references: 3,
        unresolved_heritage: 1,
        unresolved_imports: 2,
        unresolved_calls: 1,
        unresolved_call_samples: ['lib/client.js:42 → parseMessage'],
        unresolved_type_reference_samples: ['lib/index.js:12 → Session'],
        degraded_languages: ['ps1'],
        local_type_parameters: 19,
        computed_invocations: 88,
        inline_invocations: 4,
      },
    };
  }
  if (pathname.startsWith('/api/workspaces')) return { workspaces: state.workspaces };
  // The object page composes a decision control per pending adjudication: an
  // answer that renders a control, or an honest "too big to scan" measurement.
  if (pathname.startsWith('/api/decisions')) {
    return {
      rendered: true,
      // The control is rendered by `renderer` name with its own field shape:
      // a comparison pairs two options, each with a label and a detail.
      control: {
        renderer: 'comparison',
        summary: '允许发布脚本写入远程仓库',
        options: [
          { value: 'approve', label: '授权', detail: '记录 3 个同类 effect 的授权' },
          { value: 'reject', label: '拒绝', detail: '保持现状，发布脚本不写入远程仓库' },
        ],
      },
      measurement: { estimated_lines: 3 },
    };
  }
  if (pathname.startsWith('/api/sources')) return { sources: [] };
  if (pathname.startsWith('/api/connectors')) return { connectors: [] };
  if (pathname.startsWith('/api/usage')) return { totals: { total_tokens: 128 }, daily: {}, weekly: {}, monthly: {}, yearly: {} };
  if (pathname.startsWith('/api/host-runs')) return { runs: [] };
  if (pathname.startsWith('/api/verified-work-loops')) return { loops: [] };
  if (pathname.startsWith('/api/work-reviews')) return { reviews: [] };
  if (pathname.startsWith('/api/task-runs')) return { runs: [] };
  if (pathname.startsWith('/api/model-dispatches')) return { dispatches: [] };
  if (pathname.startsWith('/api/acceptance-plans')) return { plans: [] };
  if (pathname.startsWith('/api/connector-assets')) return { assets: [] };
  if (pathname.startsWith('/api/workbench/context-storage')) {
    if (pathname.includes('/export')) return { ok: true, exported: true };
    return { config: { mode: 'local' } };
  }
  if (pathname.startsWith('/api/workbench/call')) return { ok: true, result: {} };
  // Context pages read a shared resources endpoint keyed by kind; memory needs
  // history candidates alongside active rows so the page can audit recalls.
  if (pathname.startsWith('/api/workbench/resources')) {
    const kind = query.get('kind');
    if (kind === 'memory') {
      return { items: state.memory.map((item) => ({ ...item, committed: true, history: [{ version: 1, at: '2026-11-01T10:00:00Z', actor: 'operator' }] })) };
    }
    if (kind === 'knowledge') return { items: state.knowledgeClaims.map((item) => ({ ...item, committed: true })) };
    if (kind === 'workflows') return { workflows: state.workflows, runs: [] };
    return { items: [] };
  }
  if (pathname.startsWith('/api/knowledge')) return { claims: state.knowledgeClaims };
  if (pathname.startsWith('/api/projects')) return { projects: [] };
  if (pathname === '/api/workbench/proactive/settings') {
    if (method === 'POST') {
      for (const key of ['reminder', 'prepare', 'execute']) {
        if (typeof body?.[key] === 'boolean') state.proactive[key] = body[key];
      }
    }
    return { ...state.proactive };
  }
  if (pathname === '/api/settings') {
    // A profile that has never been saved still exposes a settings document;
    // the Workbench must render defaults, never crash on a missing runtime.
    return { dataRoot: process.cwd(), locale: 'zh-CN', secretsStored: false, workbench: { defaultPermission: 'auto' } };
  }
  if (pathname === '/api/workbench/evaluations') {
    if (method === 'POST') {
      // The panel derives its run id from the operation id (a deterministic
      // idempotency contract), then polls that id: the mock must register the
      // run under the same derivation or every poll lands on "unknown".
      // Direct API callers without an operation keep the stable eval-N naming.
      const operation = typeof body?.operation_id === 'string' && body.operation_id ? body.operation_id : null;
      const id = operation ? createHash('sha256').update(operation).digest('hex') : `eval-${state.evaluations.size + 1}`;
      // The second poll settles the run, mirroring the tool-install flow: a
      // submission must reach a completed report, not hang in "结果未知".
      state.evaluations.set(id, { id, state: 'running', evaluator_version: '0.7.0', report: null,
        workspace: String(body?.workspace ?? ''), input_paths: [body?.suite, body?.subject, body?.runtime], polls: 0 });
      return { id, state: 'running' };
    }
    return { runs: [...state.evaluations.values()] };
  }
  if (pathname.startsWith('/api/workbench/evaluations/') && pathname.endsWith('/events')) {
    const id = pathname.split('/')[4];
    const run = state.evaluations.get(id);
    if (run && run.state === 'running') {
      run.polls += 1;
      if (run.polls >= 2) {
        run.state = 'completed';
        run.completed_at = new Date().toISOString();
        run.report = { run_id: id, status: 'complete', expected: 2, passed: 2, failed: 0, inconclusive: 0, invalid: 0, missing: 0,
          results: [{ case_id: 'case-1', verdict: 'passed' }, { case_id: 'case-2', verdict: 'passed' }] };
      }
    }
    return { evaluation: run ?? { id, state: 'unknown' }, events: [] };
  }
  if (pathname.startsWith('/api/workbench/evaluations/') && pathname.endsWith('/cancel')) {
    const id = pathname.split('/')[4];
    const run = state.evaluations.get(id);
    if (run && run.state === 'running') run.state = 'cancelled';
    return { evaluation: run ?? { id, state: 'unknown' } };
  }
  if (pathname === '/api/workbench/evaluations/compare') {
    // A comparable pair needs two distinct completed runs; the metrics mirror
    // what the panel renders when a verdict is possible.
    const completed = [...state.evaluations.values()].filter((run) => run.state === 'completed');
    const comparable = completed.length >= 2;
    return { comparison: { metrics: {
      status: comparable ? 'comparable' : 'insufficient',
      expected_pairs: comparable ? 2 : 0,
      measured_pairs: comparable ? 2 : 0,
      candidate_wins: comparable ? 1 : 0,
      baseline_wins: comparable ? 1 : 0,
      ties: 0,
    } } };
  }
  // The knowledge-effect gate binds one retrieval run to a baseline/candidate
  // pair; the mock answers honestly that the inputs look complete.
  if (pathname === '/api/workbench/evaluations/knowledge-assess') {
    const retrieval = String(body?.retrieval_run_id ?? '');
    return { assessment: {
      status: retrieval ? 'eligible' : 'ineligible',
      retrieval_run_id: retrieval,
      baseline_id: body?.baseline_id,
      candidate_id: body?.candidate_id,
      reasons: retrieval ? [] : ['缺少检索运行 ID'],
    } };
  }
  if (pathname.startsWith('/api/workbench/evaluations/') && pathname.endsWith('/report')) {
    const id = pathname.split('/')[4];
    const run = state.evaluations.get(id);
    return { report: run?.report ?? null };
  }
  if (pathname.startsWith('/api/workbench/evaluations/')) {
    const id = pathname.split('/')[4];
    return state.evaluations.get(id) ?? { id, state: 'unknown' };
  }
  // The design page lists saved drafts with their remaining questions; the
  // catalog drives the per-question editor.
  if (pathname.startsWith('/api/workbench/workflow-designs')) {
    const catalog = [
      { key: 'inputs', question: '这个流程需要哪些输入？' },
      { key: 'steps', question: '步骤按什么顺序执行？' },
      { key: 'verification', question: '如何验证每一步做对了？' },
      { key: 'failure', question: '失败时怎么处置？' },
    ];
    if (method === 'POST') {
      return {
        design: { id: String(body?.design_id ?? 'design-1'), name: String(body?.name ?? '未命名'), version: 2, answers: body?.answers ?? {} },
        questions: catalog.slice(1), next_question: catalog[1],
        markdown: '# ' + String(body?.name ?? '未命名') + '\n\n' + catalog.map((q) => '## ' + q.question + '\n' + String((body?.answers ?? {})[q.key] ?? '')).join('\n\n'),
      };
    }
    return {
      truncated: false,
      question_catalog: catalog,
      designs: [{
        design: { id: 'design-1', name: '发布检查单', version: 1, answers: { inputs: '变更清单与回滚方案' } },
        questions: catalog.slice(1),
      }],
    };
  }
  if (pathname.startsWith('/api/workbench/context-audits')) {
    if (method === 'POST') return { id: 'audit-1', status: 'inconclusive', integrity: 'verified_against_saved_report' };
    return { status: 'inconclusive', report: null };
  }
  return {};
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

export function createMockServer() {
  const state = createState();
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;
    if (pathname === '/health') return json(res, { status: 'ok' });
    if (pathname.startsWith('/api/')) {
      // A search param flips the runtime into "token required" mode so callers can
      // exercise the unauthorized boot path against a real HTTP server.
      if (url.searchParams.get('requireToken') === '1') return json(res, { error: 'Workbench token required' }, 401);
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { return json(res, { error: 'invalid JSON body' }, 400); }
      return json(res, route(state, pathname, req.method ?? 'GET', body, url.searchParams));
    }
    const relative = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^([/\\])+/, '');
    if (relative.startsWith('..')) { res.writeHead(403); return res.end('forbidden'); }
    const file = resolve(workbenchDir, relative);
    if (!file.startsWith(workbenchDir)) { res.writeHead(403); return res.end('forbidden'); }
    try {
      const content = await readFile(file);
      // No-cache on the mock runtime: it serves the live working tree, so a stale
      // 304 would hide code changes from an interactive audit session.
      res.writeHead(200, {
        'content-type': contentTypes[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-cache, no-store, must-revalidate',
      });
      res.end(content);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
}

export async function selfTest() {
  const server = createMockServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const checks = [
      ['/api/workbench/task-board?limit=50', (v) => v.order.length === 2 && v.buckets.running[0].title === '修复登录态'],
      ['/api/workbench/mods/list', (v) => v.items[0].name === 'no-hardcode'],
      ['/api/workbench/pilot/outcomes', (v) => v.total === 2],
      ['/api/workbench/pilot/blocked-queue', (v) => Array.isArray(v.items)],
      ['/index.html', (v) => v.includes('./app.js')],
    ];
    for (const [path, check] of checks) {
      const response = await fetch(base + path);
      if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);
      const value = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text();
      if (!check(value)) throw new Error(`${path} -> unexpected payload: ${JSON.stringify(value).slice(0, 120)}`);
    }
    return checks.length;
  } finally {
    await new Promise((done) => server.close(done));
  }
}

/** Static delivery surface: index.html + every relative ESM import of app.js.
 *  Used to verify the whole startup chain is actually served over HTTP. */
export async function staticSurface() {
  const index = await readFile(resolve(workbenchDir, 'index.html'), 'utf8');
  const entry = await readFile(resolve(workbenchDir, 'app.js'), 'utf8');
  const imports = [...entry.matchAll(/from\s+['"]\.\/([\w-]+\.js)['"]/gu)].map((match) => match[1]);
  const links = [...index.matchAll(/(?:href|src)=["']\.\/([\w.-]+\.(?:css|js|svg))["']/gu)].map((match) => match[1]);
  const assets = [...new Set(['index.html', 'app.js', ...imports, ...links])].sort();
  return { assets, imports, links };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.MOCK_RUNTIME_PORT ?? 4317);
  if (process.argv.includes('--self-test')) {
    selfTest().then((count) => { console.log(`mock runtime self-test: ${count} checks passed`); }).catch((error) => { console.error(error.message); process.exitCode = 1; });
  } else {
    const server = createMockServer();
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actualPort = address && typeof address === 'object' ? address.port : port;
      console.log(`Mock 演示数据已启动，不会连接或修改 Craft 用户数据。打开 http://127.0.0.1:${actualPort}/`);
      console.log('此服务只用于开发与验收，不会连接或修改 Craft 用户数据。');
    });
  }
}
