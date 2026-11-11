/** Apply only the selected patches and reload the detail after a stale-state failure. */
export async function applyChangeSetSelection({ api, url, patchIndices, expectedStateRevision, onEmpty, onSuccess, onFailure, onRefresh }) {
  if (!Array.isArray(patchIndices) || patchIndices.length === 0) {
    onEmpty();
    return;
  }
  try {
    await api(url + '/apply', { method: 'POST', body: { patch_indices: patchIndices, expected_state_revision: expectedStateRevision } });
    onSuccess();
  } catch (error) {
    onFailure(error);
    try {
      const latest = await api(url);
      onRefresh(latest);
    } catch (refreshError) {
      onFailure(refreshError);
    }
  }
}
