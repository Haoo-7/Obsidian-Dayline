const METADATA_CONTROL_SELECTOR = '.cal-media-info-button, .dayline-note-media-info';

export function getMediaControlOwner(target: any): any {
  if (!target) return target;
  const closest = target.closest?.('.internal-embed');
  if (closest) return closest;
  let current = target.parentElement;
  while (current) {
    if (current.classList?.contains?.('internal-embed')) return current;
    current = current.parentElement;
  }
  return target;
}

export function shouldAddMediaInfoControl(target: any, owners: any): boolean {
  return !owners?.has?.(getMediaControlOwner(target));
}

export function isMetadataControlTarget(target: any): boolean {
  return Boolean(target?.closest?.(METADATA_CONTROL_SELECTOR));
}

export function shouldOpenCalendarDateFromPointer(target: any): boolean {
  return !isMetadataControlTarget(target);
}

export function shouldDismissMetadataFromPointer(target: any, tooltip: any): boolean {
  if (tooltip?.contains?.(target)) return false;
  return !isMetadataControlTarget(target);
}
