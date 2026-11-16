import { readFileSync } from 'node:fs';

const lines = readFileSync('web/mode-pages.js', 'utf8').split(/\r?\n/);
const ids = ['state', 'api', 'toast', 'fail', 'go', 'openTask', 'esc', 'icon', 'label', 'pill', 'head',
  'emptyState', 'countChip', 'settled', 'openInlineOn', 'dismissInline', 'doc', 'host', 'failureText',
  'writePilotSession', 'importNativeSession', 'mountAgentWorkspace', 'workspacePathOf', 'folderNameOf',
  'renderFolderTree', 'asideBlock'];
const ranges = { workshop: [16, 155], pilot: [157, 590], session: [592, 706], control: [708, 837] };
for (const [name, [start, end]] of Object.entries(ranges)) {
  const seg = lines.slice(start - 1, end).join('\n');
  const used = ids.filter((id) => new RegExp(`\\b${id}\\b`, 'u').test(seg));
  console.log(name, JSON.stringify(used));
}
