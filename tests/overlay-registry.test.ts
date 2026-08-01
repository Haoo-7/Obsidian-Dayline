import { describe, expect, it } from 'vitest';
import { OverlayRegistry } from '../src/overlay-registry';

describe('overlay registry', () => {
  it('keeps a shared overlay until its last view releases it', () => {
    const registry = new OverlayRegistry<object, object>();
    const container = {};
    const firstView = {};
    const secondView = {};

    registry.claim(container, firstView);
    registry.claim(container, secondView);
    expect(registry.release(container, firstView)).toBe(false);
    expect(registry.release(container, secondView)).toBe(true);
  });
});
