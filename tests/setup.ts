import '@testing-library/jest-dom/vitest';

// jsdom has no CSS.supports, which ui-sdk's modal calls to lock page scroll. Browsers have it.
if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') {
  Object.defineProperty(globalThis, 'CSS', { value: { supports: () => false }, configurable: true });
}

// jsdom has no ResizeObserver, which ui-sdk's toast region uses for layout. Browsers and the webview have it.
if (typeof ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub, configurable: true });
}

// jsdom has no Web Animations API. ui-sdk reads running animations when a toast leaves; none run under test.
if (typeof Element !== 'undefined' && typeof Element.prototype.getAnimations !== 'function') {
  Element.prototype.getAnimations = function getAnimations(): Animation[] {
    return [];
  };
}
