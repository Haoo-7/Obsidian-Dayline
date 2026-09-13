const VIEWPORT_PROPERTIES = [
  '--journal-mood-viewport-height',
  '--journal-mood-viewport-width',
  '--journal-mood-viewport-top',
  '--journal-mood-viewport-left',
];

/** Keep the phone modal inside the keyboard's remaining viewport without rebuilding its form. */
export function bindMoodModalViewport(modalEl: HTMLElement, contentEl: HTMLElement): () => void {
  const doc = modalEl.ownerDocument;
  const view = doc.defaultView;
  if (!view || !doc.body.matches('.dayline-mobile.dayline-phone')) return () => {};

  const viewport = view.visualViewport;
  // Measure viewport units outside the keyboard-constrained app/modal hosts.
  const probe = doc.createElement('div');
  probe.className = 'journal-mood-viewport-probe';
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;'
    + ' min-width: 0; min-height: 0; max-width: none; max-height: none; margin: 0; padding: 0;'
    + ' border: 0; box-sizing: border-box; visibility: hidden; pointer-events: none; contain: strict;';
  doc.body.appendChild(probe);
  let frame: number | null = null;
  let revealFocus = false;
  let disposed = false;
  let touchActive = false;
  let deferredSync = false;
  let baselineWidth: number | undefined;
  let baselineHeight: number | undefined;
  let previousDimensions: number[] | undefined;
  const sync = () => {
    frame = null;
    if (disposed) return;
    const layout = probe.getBoundingClientRect();
    const layoutHeight = layout.height > 0 ? layout.height : view.innerHeight;
    const layoutWidth = layout.width > 0 ? layout.width : view.innerWidth;
    const viewportHeight = viewport && viewport.height > 0 ? viewport.height : view.innerHeight;
    const viewportWidth = viewport && viewport.width > 0 ? viewport.width : view.innerWidth;
    const keyboardValue = [modalEl, doc.body, doc.documentElement]
      .map((element) => view.getComputedStyle(element).getPropertyValue('--keyboard-height').trim())
      .find((value) => value !== '') || '0';
    const keyboard = /^(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/.test(keyboardValue)
      ? Number.parseFloat(keyboardValue) : 0;
    if (baselineWidth !== layoutWidth) {
      baselineWidth = layoutWidth;
      baselineHeight = undefined;
    }
    // A closing animation can clear the inset before the WebView expands.
    // Keep the largest keyboard-free sample at this width for this modal session.
    const editing = doc.activeElement?.matches('input, textarea, [contenteditable="true"]');
    if (keyboard === 0 && !editing && !doc.body.classList.contains('keyboard-animating')) {
      baselineHeight = Math.max(baselineHeight || 0, layoutHeight);
    }
    // Only subtract from a known unshrunk baseline, never the current probe or
    // VisualViewport. If opened with a keyboard already present, that baseline
    // is unknown; use the two measured viewports until a keyboard-free sample.
    const keyboardBottom = baselineHeight !== undefined && keyboard < baselineHeight
      ? baselineHeight - keyboard : layoutHeight;
    const availableBottom = Math.min(layoutHeight, keyboardBottom);
    const top = Math.max(0, viewport?.offsetTop || 0);
    const left = Math.max(0, viewport?.offsetLeft || 0);
    const height = Math.max(0, Math.min(top + viewportHeight, availableBottom) - top);
    const width = Math.max(0, Math.min(left + viewportWidth, layoutWidth) - left);
    for (const [index, value] of [height, width, top, left].entries()) {
      modalEl.style.setProperty(VIEWPORT_PROPERTIES[index], `${value}px`);
    }
    modalEl.classList.add('has-mood-viewport');
    modalEl.classList.toggle('is-compact-viewport', height < 480);
    const dimensions = [layoutHeight, layoutWidth, viewportHeight, viewportWidth, availableBottom];
    const shouldReveal = revealFocus || (previousDimensions !== undefined
      && dimensions.some((value, index) => value !== previousDimensions![index]));
    previousDimensions = dimensions;
    revealFocus = false;
    const focused = doc.activeElement;
    if (!shouldReveal || !focused || !contentEl.contains(focused)
      || !focused.matches('input, textarea, select, button, [tabindex]')) return;

    // Scroll only this modal, not the document or host workspace. A viewport pan
    // alone must not pull the user back to the focused field during native scroll.
    const bounds = contentEl.getBoundingClientRect();
    const target = focused.getBoundingClientRect();
    const visibleTop = Math.max(bounds.top + contentEl.clientTop, top) + 8;
    const visibleBottom = Math.min(bounds.top + contentEl.clientTop + contentEl.clientHeight, top + height) - 8;
    if (visibleBottom <= visibleTop || target.height === 0) return;
    const fits = target.height <= visibleBottom - visibleTop;
    let delta = 0;
    if (target.top < visibleTop && target.bottom > visibleBottom) return;
    if (target.top < visibleTop) delta = fits ? target.top - visibleTop : target.bottom - visibleBottom;
    else if (target.bottom > visibleBottom) delta = fits ? target.bottom - visibleBottom : target.top - visibleTop;
    if (delta) contentEl.scrollTop += delta;
  };

  const schedule = (reveal: boolean) => {
    if (disposed) return;
    revealFocus ||= reveal;
    // iOS can pan visualViewport between touchstart and the new field's focus.
    // Defer all geometry work until the gesture ends, or the modal moves under
    // the finger and the browser cancels the focus/click.
    if (touchActive) {
      deferredSync = true;
      return;
    }
    if (frame === null) frame = view.requestAnimationFrame(sync);
  };
  const beginTouch = () => {
    touchActive = true;
    deferredSync = true;
    if (frame !== null) {
      view.cancelAnimationFrame(frame);
      frame = null;
    }
  };
  const endTouch = () => {
    if (!touchActive) return;
    touchActive = false;
    if (!deferredSync) return;
    deferredSync = false;
    schedule(false);
  };
  const onResize = () => schedule(false);
  const onScroll = () => schedule(false);
  const onFocus = () => schedule(true);
  const onHostChange = () => schedule(false);
  const onOrientationChange = () => {
    baselineWidth = undefined;
    baselineHeight = undefined;
    schedule(false);
  };
  const resizeObserver = view.ResizeObserver ? new view.ResizeObserver(onHostChange) : null;
  resizeObserver?.observe(probe);
  // Native keyboard state can change root styles/classes without a window
  // resize. This also catches the end of Obsidian's keyboard animation.
  const hostObserver = new view.MutationObserver(onHostChange);
  for (const host of [doc.documentElement, doc.body]) {
    hostObserver.observe(host, { attributes: true, attributeFilter: ['style', 'class'] });
  }
  viewport?.addEventListener('resize', onResize);
  viewport?.addEventListener('scroll', onScroll);
  view.addEventListener('resize', onResize);
  view.addEventListener('orientationchange', onOrientationChange);
  contentEl.addEventListener('focusin', onFocus);
  contentEl.addEventListener('focusout', onFocus);
  contentEl.addEventListener('touchstart', beginTouch, { passive: true });
  doc.addEventListener('touchend', endTouch, { passive: true });
  doc.addEventListener('touchcancel', endTouch, { passive: true });
  sync();

  return () => {
    disposed = true;
    if (frame !== null) view.cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    hostObserver.disconnect();
    probe.remove();
    viewport?.removeEventListener('resize', onResize);
    viewport?.removeEventListener('scroll', onScroll);
    view.removeEventListener('resize', onResize);
    view.removeEventListener('orientationchange', onOrientationChange);
    contentEl.removeEventListener('focusin', onFocus);
    contentEl.removeEventListener('focusout', onFocus);
    contentEl.removeEventListener('touchstart', beginTouch);
    doc.removeEventListener('touchend', endTouch);
    doc.removeEventListener('touchcancel', endTouch);
    for (const property of VIEWPORT_PROPERTIES) modalEl.style.removeProperty(property);
    modalEl.classList.remove('has-mood-viewport', 'is-compact-viewport');
  };
}
