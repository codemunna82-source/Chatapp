/**
 * Side-effect module: starts Sentry, and nothing else.
 *
 * server.ts imports this on its first line, before any other import.
 * Sentry's Node SDK instruments Express, Mongoose and the HTTP client by
 * patching them as they are required, so a module loaded before init is
 * never traced — which makes import order load-bearing rather than
 * stylistic. Keeping it in its own file is what stops an import sorter
 * from quietly breaking that.
 */
import { initSentry } from './lib/sentry';

initSentry();
