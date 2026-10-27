/**
 * Dayline settings "Support" section.
 *
 * A sponsor block that lives inside the settings tab rather than on its own
 * page: two ordinary settings rows and a drawer under the coffee row holding the
 * actual code. The restraint is the design — nothing here may look like a nag,
 * and the copy has to say that no feature is paywalled and that a star is a
 * valid alternative, before anyone reaches for a phone.
 *
 * The rows are built with Obsidian's own `setting-item` markup and a plain
 * `<button>`, so the update button is styled by the theme exactly like every
 * other button in the pane. Rebuilding that chrome by hand is what made an
 * earlier version look foreign next to its neighbours.
 *
 * Plain DOM rather than `new Setting(...)` keeps the open/closed state, the busy
 * state of the update check and the accessible names unit-testable without
 * mounting the settings tab, which is `// @ts-nocheck` and too large to build.
 */

export const SUPPORT_SECTION_ID = 'support';
export const SUPPORT_CONTAINER_CLASS = 'dayline-settings-support';
export const SUPPORT_TOGGLE_CLASS = 'dayline-settings-support-toggle';
export const SUPPORT_TOGGLE_LABEL_CLASS = 'dayline-settings-support-toggle-label';
/** Selection hook only — deliberately carries no styles so the theme keeps the button. */
export const SUPPORT_CHECK_CLASS = 'dayline-settings-support-check';
export const SUPPORT_DRAWER_CLASS = 'dayline-settings-support-drawer';
export const SUPPORT_QR_CLASS = 'dayline-settings-support-qr';
export const SUPPORT_STAR_CLASS = 'dayline-settings-support-star';

/** The public repository, opened by the "leave a star" line. */
export const SUPPORT_REPOSITORY_URL = 'https://github.com/Haoo-7/Obsidian-Dayline';

/** Chevron points up while the drawer is open; CSS turns it when it closes. */
const CHEVRON_PATH = 'M6 9l6 6 6-6';

export interface SupportSectionOptions {
  /**
   * `t()` bound to the live settings, so the block follows the UI language.
   * Takes placeholder values because the version line is a template.
   */
  localize: (key: string, values?: Record<string, unknown>) => string;
  /**
   * The tip code as a data URL. It is inlined at build time because the image
   * has to ship inside `main.js`: users copy plugin folders around and mobile
   * sync rewrites them, so a relative asset path would break there.
   */
  qrSrc: string;
  /** Plugin version shown in the about row. */
  version?: string;
  /**
   * Runs the update check. The caller owns the notices, so this module stays
   * free of Obsidian APIs; it only owns the busy state.
   */
  checkUpdate?: () => Promise<void> | void;
  repositoryUrl?: string;
  /** Injection target for tests that use their own JSDOM document. */
  doc?: Document;
}

/** Ids only need to be unique inside one rendered pane, but they must be. */
let drawerIdCounter = 0;

function createChevron(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', CHEVRON_PATH);
  svg.appendChild(path);
  return svg;
}

interface RowParts {
  row: HTMLDivElement;
  control: HTMLDivElement;
}

/** One Obsidian settings row: name and description left, control right. */
function createRow(doc: Document, name: string, description: string): RowParts {
  const row = doc.createElement('div');
  row.className = 'setting-item';

  const info = doc.createElement('div');
  info.className = 'setting-item-info';

  const title = doc.createElement('div');
  title.className = 'setting-item-name';
  title.textContent = name;
  info.appendChild(title);

  const desc = doc.createElement('div');
  desc.className = 'setting-item-description';
  desc.textContent = description;
  info.appendChild(desc);

  row.appendChild(info);

  const control = doc.createElement('div');
  control.className = 'setting-item-control';
  row.appendChild(control);

  return { row, control };
}

/**
 * Render the support block into `container` and return the created root.
 *
 * The drawer starts open: the whole point of a sponsor block this quiet is that
 * it has to be useful on the one visit it gets, and a collapsed row would hide
 * the only thing the section exists for.
 */
export function renderSupportSection(container: HTMLElement, options: SupportSectionOptions): HTMLElement {
  const doc = options.doc ?? container.ownerDocument ?? document;
  const localize = options.localize;
  const repositoryUrl = options.repositoryUrl ?? SUPPORT_REPOSITORY_URL;

  const root = doc.createElement('div');
  root.className = SUPPORT_CONTAINER_CLASS;
  root.dataset.daylineSettingsSupport = '';

  /* ---- About row: version, licence, and the update check ---- */
  const about = createRow(
    doc,
    localize('supportAboutName'),
    localize('supportAboutDesc', { version: options.version ?? '' }),
  );
  root.appendChild(about.row);

  if (options.checkUpdate) {
    const checkUpdate = options.checkUpdate;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = SUPPORT_CHECK_CLASS;
    button.textContent = localize('supportCheckUpdate');
    about.control.appendChild(button);

    const runCheck = async (): Promise<void> => {
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = localize('supportChecking');
      try {
        await checkUpdate();
      } finally {
        button.disabled = false;
        button.textContent = localize('supportCheckUpdate');
      }
    };
    button.addEventListener('click', () => { void runCheck(); });
  }

  /* ---- Coffee row: the toggle ---- */
  const coffee = createRow(doc, localize('supportCoffeeName'), localize('supportCoffeeDesc'));
  root.appendChild(coffee.row);

  drawerIdCounter += 1;
  const drawerId = `dayline-settings-support-drawer-${drawerIdCounter}`;

  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = SUPPORT_TOGGLE_CLASS;
  toggle.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-controls', drawerId);

  const toggleLabel = doc.createElement('span');
  toggleLabel.className = SUPPORT_TOGGLE_LABEL_CLASS;
  toggleLabel.textContent = localize('supportCollapse');
  toggle.appendChild(toggleLabel);
  toggle.appendChild(createChevron(doc));
  coffee.control.appendChild(toggle);

  /* ---- Drawer: the code and what it pays for ---- */
  const drawer = doc.createElement('div');
  drawer.className = SUPPORT_DRAWER_CLASS;
  drawer.id = drawerId;

  const qr = doc.createElement('img');
  qr.className = SUPPORT_QR_CLASS;
  qr.src = options.qrSrc;
  qr.alt = localize('supportQrAlt');
  qr.decoding = 'async';
  drawer.appendChild(qr);

  const detail = doc.createElement('div');
  detail.className = `${SUPPORT_CONTAINER_CLASS}-detail`;

  const title = doc.createElement('p');
  title.className = `${SUPPORT_CONTAINER_CLASS}-title`;
  title.textContent = localize('supportScanTitle');
  detail.appendChild(title);

  const note = doc.createElement('p');
  note.className = `${SUPPORT_CONTAINER_CLASS}-note`;
  note.textContent = localize('supportScanNote');
  detail.appendChild(note);

  const uses = doc.createElement('p');
  uses.className = `${SUPPORT_CONTAINER_CLASS}-uses`;
  uses.textContent = localize('supportUses');
  detail.appendChild(uses);

  const star = doc.createElement('p');
  star.className = SUPPORT_STAR_CLASS;
  const starLink = doc.createElement('a');
  starLink.href = repositoryUrl;
  starLink.target = '_blank';
  starLink.rel = 'noopener noreferrer';
  starLink.textContent = localize('supportStar');
  star.appendChild(starLink);
  detail.appendChild(star);

  drawer.appendChild(detail);
  root.appendChild(drawer);

  const setOpen = (next: boolean): void => {
    drawer.hidden = !next;
    toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
    toggleLabel.textContent = localize(next ? 'supportCollapse' : 'supportExpand');
    root.classList.toggle('is-open', next);
  };

  setOpen(true);
  toggle.addEventListener('click', () => setOpen(drawer.hidden));

  container.appendChild(root);
  return root;
}
