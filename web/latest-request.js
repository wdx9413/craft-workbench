/** One render generation covers its page, project and task, including repeated refreshes. */
export function createLatestRequest() {
  let generation = 0;
  async function run(load, commit, fail) {
    const revision = ++generation;
    const ticket = { current: () => revision === generation };
    try {
      const result = await load(ticket);
      if (ticket.current()) commit(result);
    } catch (error) {
      if (ticket.current()) fail(error);
    }
  }
  run.invalidate = () => { generation++; };
  return run;
}

export function createChangesetPager(load, commit, fail, setBusy) {
  let generation = 0;
  return { async load(offset) {
    const revision = ++generation;
    setBusy(true);
    try {
      const result = await load(offset);
      if (revision === generation) commit(result);
    } catch (error) {
      if (revision === generation) fail(error);
    } finally {
      if (revision === generation) setBusy(false);
    }
  } };
}
