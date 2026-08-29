// MUST stay the first import. ES imports are hoisted and evaluated in
// order, so this is what guarantees Sentry is running before App's module
// tree is loaded — the window where an invalid env var or a missing native
// module throws, which is otherwise the silent white screen a release
// build shows.
import './src/lib/instrument';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
