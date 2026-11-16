/**
 * Compatibility facade for the three-mode pages.
 *
 * The app no longer imports this module: it fetches the owning mode's page on
 * first paint so a single-surface build never downloads the other two. Tests
 * and embedding hosts that want all three views at once can keep using this
 * factory; it composes exactly the same independent modules.
 */
import { createControlPage } from './control-page.js';
import { createPilotPage } from './pilot-page.js';
import { createWorkshopPage } from './workshop-page.js';
import { createNewSessionDrawer } from './session-form.js';

export function createModePages(ctx) {
  const newSessionDrawer = createNewSessionDrawer(ctx);
  const workshop = createWorkshopPage(ctx);
  const pilot = createPilotPage(ctx);
  const control = createControlPage({ ...ctx, newSessionDrawer });
  return {
    viewHome: workshop.viewHome,
    viewPilot: pilot.viewPilot,
    viewMyTasks: control.viewMyTasks,
    newSessionDrawer,
  };
}
