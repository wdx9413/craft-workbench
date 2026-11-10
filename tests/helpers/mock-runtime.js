// Mock runtime layer for Workbench integration tests (plain ESM, no TS types
// so `--experimental-strip-types` import resolution matches the .js entry).
//
// The Workbench is a pure front-end shell: every UI module receives data
// through an injected `api(path, opts)` and never touches the database
// directly. This module provides a single in-memory backend that exposes the
// `/api/workbench/*` surface the UI talks to, so V2/V3 integration tests can
// exercise the three-mode journey (领航员 / 控制台 / 工作台) with realistic
// data without a live `craft` server (per delivery directive: missing real
// data is mocked).
export function createMockRuntime(options = {}) {
  const tasks = new Map();
  for (const t of options.tasks ?? []) {
    tasks.set(t.id, {
      id: t.id,
      title: t.title,
      workspace: t.workspace ?? 'ws-1',
      status: t.status ?? 'running',
      approvals: t.approvals ?? 0,
      blocked: t.blocked ?? false,
    });
  }
  const mods = new Map();
  for (const m of options.mods ?? []) {
    mods.set(m.id, {
      id: m.id,
      name: m.name,
      status: m.status ?? 'active',
      enabled: m.enabled ?? true,
      version: m.version ?? 1,
      shadow_test: m.shadow_test ?? 'pending',
    });
  }
  const pilot = {
    thread_id: options.pilot?.thread_id ?? 'pilot-thread-1',
    failure_observations: (options.pilot?.failure_observations ?? []).map((o) => ({ ...o })),
    outcomes: {
      total: options.pilot?.outcomes?.total ?? 0,
      counts: options.pilot?.outcomes?.counts ?? {},
      items: options.pilot?.outcomes?.items ?? [],
    },
  };
  const calls = [];

  function lastSegment(path, marker) {
    const idx = path.indexOf(marker);
    if (idx < 0) return '';
    return path.slice(idx + marker.length).replace(/\/.*$/u, '').replace(/\?.*$/u, '');
  }

  function respond(path, opts) {
    const method = (opts?.method ?? 'GET').toUpperCase();
    if (path.includes('/task-board')) {
      const list = [...tasks.values()];
      const buckets = {};
      for (const t of list) {
        const key = t.status || 'running';
        (buckets[key] ||= []).push({ id: t.id, title: t.title, workspace_id: t.workspace, state: key, reason: '' });
      }
      return {
        order: Object.keys(buckets),
        labels: { running: '执行中', awaiting_approval: '待审批', failed: '失败', completed: '已完成' },
        buckets,
        tasks: Object.fromEntries(list.map((t) => [t.id, t])),
      };
    }
    if (path.includes('/pilot/failure-observations')) return { items: pilot.failure_observations };
    if (path.includes('/pilot/outcomes')) return pilot.outcomes;
    if (path.includes('/plugin-discovery/list')) {
      return { items: options.discoveries ?? [] };
    }
    if (path.includes('/plugin-discovery/approve')) return { ok: true, auto_installed: false, writes_host_config: false };
    if (path.includes('/mods/shadow-test/run')) {
      const id = opts?.body?.id ?? 'm1';
      const m = mods.get(String(id));
      if (m) m.shadow_test = 'passed';
      return { ok: true, shadow_test: 'passed', checks: 4 };
    }
    if (path.includes('/mods/rollback/previous')) {
      const id = opts?.body?.id ?? 'm1';
      const m = mods.get(String(id));
      if (m) m.version = Math.max(1, (m.version ?? 1) - 1);
      return { ok: true, rolled_back_to: (m?.version ?? 1) };
    }
    if (path.includes('/mods/rollback')) {
      return { ok: true, rolled_back_to: opts?.body?.to_version ?? 1 };
    }
    if (path.includes('/pilot/blocked-queue')) {
      return {
        items: [...tasks.values()].filter((t) => t.blocked).map((t) => ({
          session_id: 'pilot-thread-1',
          task_id: t.id,
          suspended_reason: t.title,
          executor_template: 'craft',
          suspended_at: '2026-11-08T00:00:00Z',
        })),
      };
    }
    if (path.includes('/pilot/resume-session')) return { ok: true, resumed: true };
    if (path.includes('/mods/list')) return { items: [...mods.values()] };
    if (path.includes('/mods/') && path.includes('/rollback/previous')) return { ok: true, rolled_back_to: 1 };
    if (path.includes('/mods/') && path.includes('/revoke')) {
      mods.delete(lastSegment(path.split('?')[0], '/mods/'));
      return { ok: true };
    }
    if (path.includes('/mods/') && path.includes('/approve')) {
      const m = mods.get(lastSegment(path.split('?')[0], '/mods/'));
      if (m) { m.status = 'approved'; m.enabled = true; }
      return { ok: true };
    }
    if (path.includes('/mods/') && path.includes('/disable')) {
      const m = mods.get(lastSegment(path.split('?')[0], '/mods/'));
      if (m) m.enabled = false;
      return { ok: true };
    }
    if (path.includes('/pilot/adoption')) return { ok: true };
    if (path.includes('/agent-sessions/providers')) {
      return { providers: [{ id: 'craft', label: 'Craft 内部' }, { id: 'codex', label: 'Codex' }] };
    }
    if (path.includes('/summary')) {
      return { totals: { tasks: tasks.size, blocked: [...tasks.values()].filter((t) => t.blocked).length } };
    }
    if (method === 'POST' && path.includes('/pilot/')) return { ok: true, dispatched: true };
    return {};
  }

  function api(path, opts) {
    calls.push(`${opts?.method ?? 'GET'} ${path}`);
    return Promise.resolve(respond(path, opts));
  }
  function dispatch(path, opts) {
    calls.push(`${opts?.method ?? 'GET'} ${path}`);
    return Promise.resolve(respond(path, opts));
  }

  return { api, calls, dispatch, state: { tasks, mods, pilot } };
}

export function mockContext(runtime, overrides = {}) {
  const base = {
    state: { page: 'home', settings: null, composer: { folder: 'ws-1', models: [] }, execution: {}, folderGroups: [] },
    api: runtime.api,
    toast: () => {},
    fail: () => {},
    go: () => {},
    openTask: () => {},
    importNativeSession: () => Promise.resolve({}),
    mountAgentWorkspace: () => {},
    workspacePathOf: () => '/ws',
    folderNameOf: () => 'ws',
    renderFolderTree: () => {},
    asideBlock: (title) => `<aside>${String(title)}</aside>`,
    openInlineOn: () => {},
    dismissInline: () => {},
    settled: (p, fallback) => Promise.resolve(p).catch(() => fallback),
    icon: () => '<i></i>',
    esc: (v) => String(v ?? ''),
    label: (_m, v) => String(v ?? ''),
    pill: (v) => v,
    head: (t) => t,
    emptyState: (t) => t,
    countChip: (v) => String(v),
    host: { setTimeout: () => 0, clearTimeout: () => {} },
    doc: null,
    writePilotSession: () => {},
  };
  return { ...base, ...overrides };
}

export function assertCalled(runtime, substring) {
  const hit = runtime.calls.some((c) => c.includes(substring));
  if (!hit) throw new Error(`expected runtime call containing ${JSON.stringify(substring)}, saw: ${JSON.stringify(runtime.calls)}`);
}
