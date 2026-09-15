// MUST stay the first import. ES imports are hoisted and evaluated in
// order, so this is what guarantees Sentry is running before App's module
// tree is loaded — the window where an invalid env var or a missing native
// module throws, which is otherwise the silent white screen a release
// build shows.
import './src/lib/instrument';

/**
 * Before React, on purpose.
 *
 * A call notification's Accept and Reject can wake this process with no
 * app running, and notifee requires its background handler to be
 * registered before the runtime has finished starting — a press that
 * arrives first finds nothing listening. Importing here is what
 * guarantees the ordering; a component would be far too late.
 */
import { registerCallBackgroundTask } from './src/calling/callBackground';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerCallBackgroundTask();

registerRootComponent(App);
