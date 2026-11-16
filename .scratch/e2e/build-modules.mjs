import { readFileSync, writeFileSync } from 'node:fs';

const lines = readFileSync('web/mode-pages.js', 'utf8').split(/\r?\n/);
const slice = (a, b) => lines.slice(a - 1, b).join('\n');

function indent(text) {
  return text.split('\n').map((line) => (line.trim() ? '  ' + line : line)).join('\n');
}

function wrap({ file, header, name, deps, body, extra = '', returns }) {
  const destructure = deps.length ? `  const { ${deps.join(', ')} } = ctx;\n` : '';
  writeFileSync(file, `${header}\nexport function ${name}(ctx) {\n${destructure}${extra}${indent(body)}\n${returns}\n}\n`);
}

wrap({
  file: 'web/session-form.js',
  header: `/**
 * 新建会话表单：领航员与控制台共用的唯一一份实现。
 *
 * 这里只放两个模式都需要的“创建任务 + 选择执行器”表单，模式专属页面不引用
 * 它之外的任何内容，避免三套页面互相加载。
 */`,
  name: 'createNewSessionDrawer',
  deps: ['state', 'api', 'toast', 'fail', 'openTask', 'esc', 'label', 'dismissInline', 'renderFolderTree'],
  extra: `  const doc = ctx.doc || (typeof document === 'undefined' ? null : document);
  const host = ctx.host || (typeof window === 'undefined' ? {} : window);
`,
  body: slice(592, 706).replace('function newSessionDrawer(workspace) {', 'function newSessionDrawer(workspace) {'),
  returns: '  return newSessionDrawer;',
});

wrap({
  file: 'web/workshop-page.js',
  header: `/**
 * 工作台页面（按项目与原生会话工作）。
 *
 * 独立模块：只依赖窄 ctx，不引用控制台或领航员的任何代码。
 */`,
  name: 'createWorkshopPage',
  deps: ['state', 'api', 'toast', 'fail', 'go', 'esc', 'icon', 'label', 'importNativeSession',
    'mountAgentWorkspace', 'workspacePathOf', 'renderFolderTree', 'asideBlock'],
  extra: `  const host = ctx.host || (typeof window === 'undefined' ? {} : window);
`,
  body: slice(16, 155),
  returns: '  return { viewHome };',
});

wrap({
  file: 'web/pilot-page.js',
  header: `/**
 * 领航员页面（面向非技术用户：只说目标）。
 *
 * 独立模块：只依赖窄 ctx，不引用控制台或工作台的任何代码。
 */`,
  name: 'createPilotPage',
  deps: ['state', 'api', 'toast', 'fail', 'openTask', 'esc', 'icon', 'label', 'pill', 'head',
    'settled', 'failureText', 'writePilotSession', 'asideBlock'],
  extra: `  const host = ctx.host || (typeof window === 'undefined' ? {} : window);
`,
  body: slice(157, 590),
  returns: '  return { viewPilot };',
});

wrap({
  file: 'web/control-page.js',
  header: `/**
 * 控制台页面（看见全局：任务、审批、阻塞）。
 *
 * 独立模块：只依赖窄 ctx 与共享的新建会话表单。
 */`,
  name: 'createControlPage',
  deps: ['state', 'api', 'go', 'openTask', 'esc', 'icon', 'label', 'pill', 'head', 'emptyState',
    'countChip', 'settled', 'openInlineOn', 'failureText', 'asideBlock', 'newSessionDrawer'],
  body: slice(708, 837),
  returns: '  return { viewMyTasks };',
});

console.log('generated');
