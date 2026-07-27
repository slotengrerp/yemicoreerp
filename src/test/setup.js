import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Reset the DOM and any state that persists between tests so one test's
// data never leaks into the next.
afterEach(() => {
  cleanup();
});

beforeEach(() => {
  window.localStorage.clear();
});

// jsdom doesn't implement window.print / window.open by default, and several
// modules call these directly when printing documents. Stub them so print
// buttons don't crash tests — the tests aren't checking print output itself.
window.print = () => {};
if (!window.open) {
  window.open = () => ({ document: { write: () => {}, close: () => {} } });
}
