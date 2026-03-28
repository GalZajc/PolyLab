export type ShortcutAction =
  | 'cancel'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'cut'
  | 'open'
  | 'save'
  | 'saveAs'
  | 'exportMesh'
  | 'deleteSelection'
  | 'print'
  | 'rotateTool'
  | 'linkTool'
  | 'magnetTool'
  | 'magnetVertexTool'
  | 'magnetEdgeTool'
  | 'reverseLastMagnet'
  | 'bucketTool'
  | 'lassoTool'
  | 'reflectTool'
  | 'toggle3D';

export interface ShortcutDefinition {
  trigger?: 'keyboard' | 'mouse';
  key?: string;
  mouseButton?: 0 | 1 | 2;
  clickCount?: 1 | 2;
  ctrlOrMeta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, ShortcutDefinition> = {
  cancel: { key: 'Escape' },
  undo: { key: 'z', ctrlOrMeta: true },
  redo: { key: 'y', ctrlOrMeta: true },
  copy: { key: 'c', ctrlOrMeta: true },
  cut: { key: 'x', ctrlOrMeta: true },
  open: { key: 'o', ctrlOrMeta: true },
  save: { key: 's', ctrlOrMeta: true },
  saveAs: { key: 's', ctrlOrMeta: true, shift: true },
  exportMesh: { key: 'e', ctrlOrMeta: true },
  deleteSelection: { key: 'Delete' },
  print: { key: 'p', ctrlOrMeta: true },
  rotateTool: { key: 'r' },
  linkTool: { key: 'l' },
  magnetTool: { key: 'm' },
  magnetVertexTool: { key: 'm', shift: true },
  magnetEdgeTool: { key: 'm', ctrlOrMeta: true },
  reverseLastMagnet: { trigger: 'mouse', mouseButton: 0, clickCount: 2 },
  bucketTool: { key: 'b' },
  lassoTool: { key: 'l', ctrlOrMeta: true },
  reflectTool: { key: 'r', ctrlOrMeta: true },
  toggle3D: { key: 'Enter', shift: true }
};

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  cancel: 'Select Mode / Cancel',
  undo: 'Undo',
  redo: 'Redo',
  copy: 'Copy Selection',
  cut: 'Cut Selection',
  open: 'Open JSON',
  save: 'Save',
  saveAs: 'Save As',
  exportMesh: 'Export Mesh',
  deleteSelection: 'Delete Selection',
  print: 'Print / Export',
  rotateTool: 'Rotate Tool',
  linkTool: 'Link Tool',
  magnetTool: 'Magnet Tool',
  magnetVertexTool: 'Magnet Tool: Hinges + Vertices',
  magnetEdgeTool: 'Magnet Tool: Hinges + Edges',
  reverseLastMagnet: 'Reverse Last Magnet Fold',
  bucketTool: 'Bucket Tool',
  lassoTool: 'Lasso Tool',
  reflectTool: 'Reflect Tool',
  toggle3D: 'Toggle 3D View'
};

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift']);

export function normalizeShortcutKey(key: string): string {
  if (key.length === 1) return key.toLowerCase();
  return key;
}

export function isMouseShortcut(shortcut: ShortcutDefinition): boolean {
  return shortcut.trigger === 'mouse' || typeof shortcut.mouseButton === 'number';
}

export function shortcutToId(shortcut: ShortcutDefinition): string {
  if (isMouseShortcut(shortcut)) {
    return [
      shortcut.ctrlOrMeta ? 'mod' : '',
      shortcut.shift ? 'shift' : '',
      shortcut.alt ? 'alt' : '',
      shortcut.clickCount === 2 ? 'double' : 'single',
      `mouse${shortcut.mouseButton ?? 0}`
    ].filter(Boolean).join('+');
  }

  return [
    shortcut.ctrlOrMeta ? 'mod' : '',
    shortcut.shift ? 'shift' : '',
    shortcut.alt ? 'alt' : '',
    normalizeShortcutKey(shortcut.key || '')
  ].filter(Boolean).join('+');
}

export function formatShortcut(shortcut: ShortcutDefinition): string {
  const parts: string[] = [];
  if (shortcut.ctrlOrMeta) parts.push('Ctrl');
  if (shortcut.shift) parts.push('Shift');
  if (shortcut.alt) parts.push('Alt');

  if (isMouseShortcut(shortcut)) {
    const mouseButtonLabel = shortcut.mouseButton === 1 ? 'Middle' : shortcut.mouseButton === 2 ? 'Right' : 'Left';
    parts.push(`${shortcut.clickCount === 2 ? 'Double ' : ''}${mouseButtonLabel} Click`);
    return parts.join(' + ');
  }

  let keyLabel = normalizeShortcutKey(shortcut.key || '');
  if (keyLabel.length === 1) keyLabel = keyLabel.toUpperCase();
  if (keyLabel) parts.push(keyLabel);
  return parts.join(' + ');
}

export function matchesShortcut(event: KeyboardEvent, shortcut: ShortcutDefinition): boolean {
  if (isMouseShortcut(shortcut) || !shortcut.key) return false;
  const usesModifier = event.ctrlKey || event.metaKey;
  if (!!shortcut.ctrlOrMeta !== usesModifier) return false;
  if (!!shortcut.shift !== event.shiftKey) return false;
  if (!!shortcut.alt !== event.altKey) return false;
  return normalizeShortcutKey(event.key) === normalizeShortcutKey(shortcut.key);
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): ShortcutDefinition | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  return {
    trigger: 'keyboard',
    key: normalizeShortcutKey(event.key),
    ctrlOrMeta: event.ctrlKey || event.metaKey || undefined,
    shift: event.shiftKey || undefined,
    alt: event.altKey || undefined
  };
}

export function shortcutFromMouseEvent(
  event: Pick<MouseEvent, 'button' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  clickCount: 1 | 2
): ShortcutDefinition | null {
  if (event.button !== 0 && event.button !== 1 && event.button !== 2) return null;
  return {
    trigger: 'mouse',
    mouseButton: event.button,
    clickCount,
    ctrlOrMeta: event.ctrlKey || event.metaKey || undefined,
    shift: event.shiftKey || undefined,
    alt: event.altKey || undefined
  };
}
