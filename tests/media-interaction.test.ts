import { describe, expect, it, vi } from 'vitest';
import { getMediaControlOwner, isMetadataControlTarget, shouldAddMediaInfoControl, shouldDismissMetadataFromPointer, shouldOpenCalendarDateFromPointer } from '../src/media-interaction';

describe('media interaction boundaries', () => {
  it('keeps the date cell primary action separate from the metadata control', () => {
    const control = { closest: vi.fn(() => control) };
    const image = { closest: vi.fn(() => null) };
    expect(isMetadataControlTarget(control)).toBe(true);
    expect(shouldOpenCalendarDateFromPointer(control)).toBe(false);
    expect(shouldOpenCalendarDateFromPointer(image)).toBe(true);
  });

  it('dismisses metadata outside the tooltip/control while retaining control toggles', () => {
    const control = { closest: vi.fn(() => control) };
    const outside = { closest: vi.fn(() => null) };
    const tooltip = { contains: (target: any) => target === tooltip };
    expect(shouldDismissMetadataFromPointer(tooltip, tooltip)).toBe(false);
    expect(shouldDismissMetadataFromPointer(control, tooltip)).toBe(false);
    expect(shouldDismissMetadataFromPointer(outside, tooltip)).toBe(true);
  });

  it('assigns one info-control owner to an outer embed and nested image', () => {
    const outer: any = { closest: vi.fn(() => outer), parentElement: null };
    const image: any = { closest: vi.fn(() => outer), parentElement: outer };
    const owners = new WeakSet<object>();
    expect(getMediaControlOwner(image)).toBe(outer);
    expect(shouldAddMediaInfoControl(image, owners)).toBe(true);
    owners.add(outer);
    expect(shouldAddMediaInfoControl(outer, owners)).toBe(false);
  });
});
