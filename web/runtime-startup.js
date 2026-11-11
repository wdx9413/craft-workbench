/** Let the desktop shell report a failed real Runtime before the Workbench calls its API. */
export function runDesktopStartupGate(invoke, continueBoot, showFailure) {
  if (typeof invoke !== 'function') {
    continueBoot();
    return null;
  }
  return invoke('workbench_startup_error').then(function (message) {
    if (message) {
      showFailure(message);
      return false;
    }
    continueBoot();
    return true;
  }).catch(function () {
    showFailure();
    return false;
  });
}
