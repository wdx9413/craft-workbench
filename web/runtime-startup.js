/** Let the desktop shell report a failed real Runtime before the Workbench calls its API. */
export function runDesktopStartupGate(invoke, continueBoot, showFailure) {
  if (typeof invoke !== 'function') {
    continueBoot();
    return null;
  }
  // A hung IPC must never leave the shell half-booted: every rail-foot, aside
  // and status-bar control is bound in continueBoot. If the startup probe does
  // not settle in time, continue booting (the runtime status will still be
  // reported by the regular connection watchdog) instead of trapping the user
  // with dead buttons.
  const probe = invoke('workbench_startup_error');
  const timeout = new Promise(function (resolve) {
    setTimeout(function () { resolve({ timedOut: true }); }, 3000);
  });
  return Promise.race([probe.then(message => ({ message })), timeout]).then(function (outcome) {
    if (outcome.timedOut) {
      // A hung IPC must not leave every shell control unbound; boot anyway.
      continueBoot();
      return true;
    }
    if (outcome.message) {
      showFailure(outcome.message);
      return false;
    }
    continueBoot();
    return true;
  }).catch(function () {
    showFailure();
    return false;
  });
}
