/**
 * Side-effect module: starts Sentry, and nothing else.
 *
 * index.ts imports this as its first import. It has to be an import rather
 * than a call, because ES module imports are hoisted: an `initSentry()`
 * statement placed above `import App from './App'` would still run AFTER
 * App and its whole dependency tree had been evaluated, which is exactly
 * the window where a bad env var or a missing native module throws.
 */
import { initSentry } from './sentry';

initSentry();
