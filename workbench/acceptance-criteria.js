// Acceptance-criteria parsing, extracted from the monolithic app.js so the
// enum mapping is testable and covered by the incremental coverage gate.
// The original in-app helper was dead code (the `task-acceptance` form it read
// is not rendered); it is removed from app.js rather than duplicated here.
export const CRITERION_WORDS = {
  file: 'file', '文件': 'file',
  program: 'program', '命令': 'program',
  model: 'model', '模型': 'model',
  human: 'human', '人工': 'human',
  business_signal: 'business_signal', '业务信号': 'business_signal',
};

const CRITERION_LINE = /^(program|model|human|business_signal|file|命令|文件|模型|人工|业务信号)\s*[:：]\s*(.+)$/u;

/** Turn plain-language acceptance lines into typed runtime criteria + files. */
export function parseCriteria(rawLines) {
  const specs = (Array.isArray(rawLines) ? rawLines : []).map((line, index) => {
    const text = String(line ?? '');
    const match = text.match(CRITERION_LINE);
    // The regex and CRITERION_WORDS share one key set, so a matched word always
    // resolves; no unreachable `|| 'human'` fallback is kept.
    const kind = match ? CRITERION_WORDS[match[1]] : 'human';
    const body = match ? match[2].trim() : text;
    return {
      id: `criterion_${index + 1}`,
      name: (kind === 'file' ? '产出文件：' : '') + body,
      method: kind === 'file' ? 'program' : kind,
      required: true,
      file_path: kind === 'file' ? body : null,
    };
  });
  return {
    criteria: specs.map((spec) => ({ id: spec.id, name: spec.name, method: spec.method, required: true })),
    files: specs.filter((spec) => spec.file_path),
  };
}
