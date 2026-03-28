import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Keyboard, Moon, Settings, Sun, X } from 'lucide-react';
import {
  ShortcutAction,
  ShortcutDefinition,
  SHORTCUT_LABELS,
  formatShortcut,
  shortcutFromKeyboardEvent,
  shortcutFromMouseEvent
} from '../utils/shortcuts';
import { ColorBucketPopup } from './ColorBucketPopup';

type ThemeMode = 'light' | 'dark';
type SurfaceThemeMode = 'light' | 'dark' | 'custom';

interface SettingsPopupProps {
  uiTheme: ThemeMode;
  shortcuts: Record<ShortcutAction, ShortcutDefinition>;
  shortcutError: string | null;
  onShortcutChange: (action: ShortcutAction, shortcut: ShortcutDefinition) => boolean;
  themes: {
    ui: ThemeMode;
    canvas2d: SurfaceThemeMode;
    view3d: SurfaceThemeMode;
    printPaper: SurfaceThemeMode;
  };
  onThemeChange: (key: 'ui' | 'canvas2d' | 'view3d' | 'printPaper', value: ThemeMode | SurfaceThemeMode) => void;
  customThemeColors: {
    canvas2d: string;
    view3d: string;
    printPaper: string;
  };
  onCustomThemeColorChange: (key: 'canvas2d' | 'view3d' | 'printPaper', value: string) => void;
  otherSettings: {
    showMagnetGuides: boolean;
    backgroundClickExitsTool: boolean;
    hideRegularPolygonButtons: boolean;
  };
  onOtherSettingChange: (key: 'showMagnetGuides' | 'backgroundClickExitsTool' | 'hideRegularPolygonButtons', value: boolean) => void;
  onClose: () => void;
}

const shortcutActions: ShortcutAction[] = [
  'cancel',
  'undo',
  'redo',
  'copy',
  'cut',
  'deleteSelection',
  'open',
  'save',
  'saveAs',
  'exportMesh',
  'print',
  'toggle3D',
  'rotateTool',
  'linkTool',
  'lassoTool',
  'bucketTool',
  'reflectTool',
  'magnetTool',
  'magnetVertexTool',
  'magnetEdgeTool',
  'reverseLastMagnet'
];

export const SettingsPopup: React.FC<SettingsPopupProps> = ({
  uiTheme,
  shortcuts,
  shortcutError,
  onShortcutChange,
  themes,
  onThemeChange,
  customThemeColors,
  onCustomThemeColorChange,
  otherSettings,
  onOtherSettingChange,
  onClose
}) => {
  const [openSection, setOpenSection] = useState<'shortcuts' | 'appearance' | 'other' | null>(null);
  const [listeningAction, setListeningAction] = useState<ShortcutAction | null>(null);
  const [customColorTarget, setCustomColorTarget] = useState<'canvas2d' | 'view3d' | 'printPaper' | null>(null);
  const pendingMouseShortcutRef = useRef<ShortcutDefinition | null>(null);
  const pendingMouseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!listeningAction) return;

    const clearPendingMouseShortcut = () => {
      if (pendingMouseTimerRef.current !== null) {
        window.clearTimeout(pendingMouseTimerRef.current);
        pendingMouseTimerRef.current = null;
      }
      pendingMouseShortcutRef.current = null;
    };

    const applyShortcut = (shortcut: ShortcutDefinition) => {
      const accepted = onShortcutChange(listeningAction, shortcut);
      if (accepted) {
        clearPendingMouseShortcut();
        setListeningAction(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutFromKeyboardEvent(event);
      if (!shortcut) return;
      event.preventDefault();
      event.stopPropagation();
      applyShortcut(shortcut);
    };

    const handleMouseUp = (event: MouseEvent) => {
      const shortcut = shortcutFromMouseEvent(event, 1);
      if (!shortcut) return;
      event.preventDefault();
      event.stopPropagation();

      const pending = pendingMouseShortcutRef.current;
      if (
        pending &&
        pending.mouseButton === shortcut.mouseButton &&
        !!pending.ctrlOrMeta === !!shortcut.ctrlOrMeta &&
        !!pending.shift === !!shortcut.shift &&
        !!pending.alt === !!shortcut.alt
      ) {
        clearPendingMouseShortcut();
        applyShortcut({ ...shortcut, clickCount: 2 });
        return;
      }

      clearPendingMouseShortcut();
      pendingMouseShortcutRef.current = shortcut;
      pendingMouseTimerRef.current = window.setTimeout(() => {
        applyShortcut(shortcut);
      }, 260);
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('mouseup', handleMouseUp, true);
    window.addEventListener('contextmenu', handleContextMenu, true);
    return () => {
      clearPendingMouseShortcut();
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
      window.removeEventListener('contextmenu', handleContextMenu, true);
    };
  }, [listeningAction, onShortcutChange]);

  const sectionButtonClass = 'flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-left text-sm font-semibold text-gray-800 hover:bg-gray-50';

  return (
    <div className={`menu-panel absolute bottom-3 left-full z-50 ml-2 max-h-[calc(100%-1.5rem)] w-[30rem] overflow-visible rounded-2xl border shadow-2xl ${uiTheme === 'dark' ? 'ui-theme-dark border-[#3d3d3d] bg-[#141414] text-gray-100' : 'border-gray-200 bg-gray-100'}`}>
      <div className={`menu-subtle sticky top-0 z-10 flex items-center justify-between rounded-t-2xl border-b px-5 py-3.5 ${uiTheme === 'dark' ? 'border-[#3d3d3d] bg-[#242424]' : 'border-gray-200 bg-gray-100'}`}>
        <div className="flex items-center gap-2 text-base font-semibold text-gray-800">
          <Settings size={18} className="text-blue-600" />
          <span>Settings</span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600" title="Close Settings">
          <X size={18} />
        </button>
      </div>

      <div className="thin-scrollbar max-h-[calc(100vh-8rem)] space-y-3 overflow-y-auto p-3">
        <div className={`menu-subtle rounded-xl border p-2 ${uiTheme === 'dark' ? 'border-[#3d3d3d] bg-[#242424]' : 'border-gray-200 bg-gray-100'}`}>
          <button type="button" onClick={() => setOpenSection(openSection === 'shortcuts' ? null : 'shortcuts')} className={sectionButtonClass}>
            <span className="flex items-center gap-2">
              <Keyboard size={16} className="text-blue-600" />
              Shortcuts
            </span>
            <ChevronDown size={16} className={`transition-transform ${openSection === 'shortcuts' ? 'rotate-180' : ''}`} />
          </button>

          {openSection === 'shortcuts' && (
            <div className={`menu-surface mt-2 space-y-2 rounded-lg border p-3 ${uiTheme === 'dark' ? 'border-[#3d3d3d] bg-[#1b1b1b]' : 'border-gray-200 bg-white'}`}>
              <div className="text-xs text-gray-500">Click a shortcut button, then press a key combination or click a mouse combination. Duplicate assignments are rejected.</div>
              {shortcutError && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  {shortcutError}
                </div>
              )}
              {shortcutActions.map(action => (
                <div key={action} className={`menu-subtle grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border px-3 py-2 ${uiTheme === 'dark' ? 'border-[#3d3d3d] bg-[#242424]' : 'border-gray-200 bg-gray-50'}`}>
                  <span className="text-sm text-gray-700">{SHORTCUT_LABELS[action]}</span>
                  <button
                    type="button"
                    onClick={() => setListeningAction(current => current === action ? null : action)}
                    className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      listeningAction === action
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'menu-hover border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {listeningAction === action ? 'Press / Click...' : formatShortcut(shortcuts[action])}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`menu-subtle rounded-xl border p-2 ${uiTheme === 'dark' ? 'border-[#3d3d3d] bg-[#242424]' : 'border-gray-200 bg-gray-100'}`}>
          <button type="button" onClick={() => setOpenSection(openSection === 'appearance' ? null : 'appearance')} className={sectionButtonClass}>
            <span className="flex items-center gap-2">
              <Moon size={16} className="text-indigo-600" />
              Dark Mode
            </span>
            <ChevronDown size={16} className={`transition-transform ${openSection === 'appearance' ? 'rotate-180' : ''}`} />
          </button>

          {openSection === 'appearance' && (
            <div className={`menu-surface mt-2 space-y-2 rounded-lg border p-3 ${uiTheme === 'dark' ? 'border-[#3d3d3d] bg-[#1b1b1b]' : 'border-gray-200 bg-gray-50'}`}>
              {[
                ['ui', 'Menus And Bars'],
                ['canvas2d', '2D Canvas'],
                ['view3d', '3D Background'],
                ['printPaper', 'Print Paper Preview']
              ].map(([key, label]) => {
                const themeKey = key as 'ui' | 'canvas2d' | 'view3d' | 'printPaper';
                const isCustomCapable = themeKey !== 'ui';
                const availableModes = (isCustomCapable ? ['light', 'dark', 'custom'] : ['light', 'dark']) as (ThemeMode | SurfaceThemeMode)[];

                return (
                  <div key={key} className={`menu-subtle rounded-lg border px-3 py-3 ${uiTheme === 'dark' ? 'border-[#3d3d3d] bg-[#242424]' : 'border-gray-200 bg-white'}`}>
                    <div className="mb-2 text-sm font-medium text-gray-700">{label}</div>
                    <div className={`menu-surface flex gap-2 rounded-lg border p-1 ${uiTheme === 'dark' ? 'border-[#3d3d3d] bg-[#1b1b1b]' : 'border-gray-200 bg-gray-50'}`}>
                      {availableModes.map(mode => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            onThemeChange(themeKey, mode);
                            if (mode === 'custom' && themeKey !== 'ui') {
                              setCustomColorTarget(themeKey as 'canvas2d' | 'view3d' | 'printPaper');
                            }
                          }}
                          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                            themes[themeKey] === mode
                              ? 'bg-blue-100 text-blue-700'
                              : 'menu-hover text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          {mode === 'light' ? <Sun size={14} /> : mode === 'dark' ? <Moon size={14} /> : <Settings size={14} />}
                          {mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'Custom'}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={`menu-subtle rounded-xl border p-2 ${uiTheme === 'dark' ? 'border-[#3d3d3d] bg-[#242424]' : 'border-gray-200 bg-gray-100'}`}>
          <button type="button" onClick={() => setOpenSection(openSection === 'other' ? null : 'other')} className={sectionButtonClass}>
            <span className="flex items-center gap-2">
              <Settings size={16} className="text-blue-600" />
              Other Settings
            </span>
            <ChevronDown size={16} className={`transition-transform ${openSection === 'other' ? 'rotate-180' : ''}`} />
          </button>

          {openSection === 'other' && (
            <div className={`menu-surface mt-2 space-y-2 rounded-lg border p-3 ${uiTheme === 'dark' ? 'border-[#3d3d3d] bg-[#1b1b1b]' : 'border-gray-200 bg-white'}`}>
              <label className={`menu-subtle flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm text-gray-700 ${uiTheme === 'dark' ? 'border-[#3d3d3d] bg-[#242424]' : 'border-gray-200 bg-gray-50'}`}>
                <span>Show Magnet Circles Preview And Require Enter</span>
                <input
                  type="checkbox"
                  checked={otherSettings.showMagnetGuides}
                  onChange={event => onOtherSettingChange('showMagnetGuides', event.target.checked)}
                />
              </label>
              <label className={`menu-subtle flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm text-gray-700 ${uiTheme === 'dark' ? 'border-[#3d3d3d] bg-[#242424]' : 'border-gray-200 bg-gray-50'}`}>
                <span>Background Click Exits Active Tool</span>
                <input
                  type="checkbox"
                  checked={otherSettings.backgroundClickExitsTool}
                  onChange={event => onOtherSettingChange('backgroundClickExitsTool', event.target.checked)}
                />
              </label>
              <label className={`menu-subtle flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm text-gray-700 ${uiTheme === 'dark' ? 'border-[#3d3d3d] bg-[#242424]' : 'border-gray-200 bg-gray-50'}`}>
                <span>Hide Regular 3/4/5/6-Gon Buttons</span>
                <input
                  type="checkbox"
                  checked={otherSettings.hideRegularPolygonButtons}
                  onChange={event => onOtherSettingChange('hideRegularPolygonButtons', event.target.checked)}
                />
              </label>
            </div>
          )}
        </div>
      </div>

      {customColorTarget && (
        <ColorBucketPopup
          uiTheme={uiTheme}
          initialColor={customThemeColors[customColorTarget]}
          title="Custom Surface Color"
          description="Pick the background color for this surface."
          applyLabel="Apply Color"
          allowAlpha={false}
          targetFace={null}
          onApply={color => {
            onCustomThemeColorChange(customColorTarget, color);
            onThemeChange(customColorTarget, 'custom');
            setCustomColorTarget(null);
          }}
          onClose={() => setCustomColorTarget(null)}
        />
      )}
    </div>
  );
};
