/**
 * Obsidian DOM helper shim for tests.
 *
 * Obsidian augments `Node` with `createEl`/`createDiv`/`createSpan` and adds
 * helpers such as `empty`/`addClass`/`setText`; it also exposes global
 * `createEl`/`createDiv`/`createSpan` functions. JSDOM provides none of them, so
 * production code written in the Obsidian idiom fails under test.
 *
 * Two install paths exist because test files differ:
 *
 * - The global functions are installed unconditionally at setup time and resolve
 *   `document` lazily. A test in the default `node` environment may create its
 *   own JSDOM later and assign it to `globalThis`, which the lazy lookup picks up.
 * - `installObsidianDomShim(window)` patches a specific window's prototypes. Call
 *   it after creating a JSDOM instance whose `Node`/`HTMLElement` are separate
 *   from the globals.
 */

/** Minimal surface of the DOM constructors this shim patches. */
interface ShimWindow {
  document: Document;
  Node: { prototype: object };
  HTMLElement: { prototype: object };
}

function applyOptions(element: HTMLElement, options: unknown): void {
  if (typeof options === 'string') {
    element.className = options;
    return;
  }
  const info = (options || {}) as {
    cls?: string | string[];
    text?: unknown;
    value?: unknown;
    attr?: Record<string, unknown>;
  };
  if (info.cls) {
    element.className = Array.isArray(info.cls) ? info.cls.join(' ') : String(info.cls);
  }
  if (info.text !== undefined) element.textContent = String(info.text);
  if (info.value !== undefined) (element as HTMLInputElement).value = String(info.value);
  for (const [name, value] of Object.entries(info.attr || {})) {
    if (value !== null && value !== undefined) element.setAttribute(name, String(value));
  }
}

function defineIfAbsent(target: object, name: string, value: unknown): void {
  if (!(name in target)) {
    Object.defineProperty(target, name, { value, writable: true, configurable: true });
  }
}

function makeElement(tag: string, options: unknown): HTMLElement {
  const doc = globalThis.document as Document;
  const element = doc.createElement(tag);
  applyOptions(element, options);
  return element;
}

/** Patch a window's `Node`/`HTMLElement` prototypes with the Obsidian helpers. */
export function installObsidianDomShim(win: ShimWindow): void {
  const nodeProto = win.Node.prototype as Record<string, unknown>;
  const elementProto = win.HTMLElement.prototype as Record<string, unknown>;

  defineIfAbsent(nodeProto, 'createEl', function (this: Node, tag: string, options?: unknown) {
    const element = (this.ownerDocument || win.document).createElement(tag);
    applyOptions(element, options);
    this.appendChild(element);
    return element;
  });
  const chained = (tag: string) => function (this: unknown, options?: unknown) {
    return (this as { createEl: (t: string, o?: unknown) => HTMLElement }).createEl(tag, options);
  };
  defineIfAbsent(nodeProto, 'createDiv', chained('div'));
  defineIfAbsent(nodeProto, 'createSpan', chained('span'));

  defineIfAbsent(elementProto, 'empty', function (this: HTMLElement) { this.replaceChildren(); });
  defineIfAbsent(elementProto, 'addClass', function (this: HTMLElement, ...names: string[]) {
    this.classList.add(...names);
  });
  defineIfAbsent(elementProto, 'removeClass', function (this: HTMLElement, ...names: string[]) {
    this.classList.remove(...names);
  });
  defineIfAbsent(elementProto, 'setText', function (this: HTMLElement, text: string) {
    this.textContent = text;
  });
}

// Installed unconditionally: the accessors resolve `document` when called, so a
// test in the `node` environment that builds its own JSDOM later still works.
defineIfAbsent(globalThis, 'createEl', (tag: string, options?: unknown) => makeElement(tag, options));
defineIfAbsent(globalThis, 'createDiv', (options?: unknown) => makeElement('div', options));
defineIfAbsent(globalThis, 'createSpan', (options?: unknown) => makeElement('span', options));

// Patch the ambient JSDOM when one already exists (jsdom-environment test files).
if (typeof document !== 'undefined' && typeof Node !== 'undefined' && typeof HTMLElement !== 'undefined') {
  installObsidianDomShim(globalThis as unknown as ShimWindow);
}
