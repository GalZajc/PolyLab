import React, { useEffect, useRef, useState } from 'react';
import { FaceDefinition, ShapeType } from '../types';
import { MagnetMode } from '../types';
import {
  Download,
  Upload,
  MousePointer2,
  Settings,
  X,
  Link,
  FlipHorizontal,
  RotateCw,
  Lasso,
  Magnet,
  PaintBucket,
  Printer,
  ChevronDown
} from 'lucide-react';
import {
  catalanShapePresets,
  createKiteFaceDefinition,
  createParallelogramFaceDefinition,
  createSymmetricPentagonFaceDefinition,
  createTrapezoidFaceDefinition,
  createTriangleFaceDefinition,
  getShapeDefinition
} from '../utils/math';
import { ShapeBuilderPopup } from './ShapeBuilderPopup';
import { SettingsPopup } from './SettingsPopup';
import { ShortcutAction, ShortcutDefinition } from '../utils/shortcuts';

interface ToolbarProps {
  activeShape: ShapeType | null;
  onSelectShape: (type: ShapeType | null) => void;
  onSelectFaceDefinition: (definition: FaceDefinition) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportMesh: () => void;
  onLoad: (e: React.ChangeEvent<HTMLInputElement>) => void;
  loadInputRef?: React.RefObject<HTMLInputElement | null>;

  activeTool: 'select' | 'link' | 'rotate' | 'flip' | 'lasso' | 'magnet' | 'bucket';
  onSelectTool: (tool: 'select' | 'link' | 'rotate' | 'flip' | 'lasso' | 'magnet' | 'bucket') => void;
  magnetMode: MagnetMode;
  onSelectMagnetMode: (mode: MagnetMode) => void;
  onEscapeAction: () => void;

  onImportShape: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPrint: () => void;
  uiTheme: 'light' | 'dark';
  shortcutTitles: Record<ShortcutAction, string>;
  shortcuts: Record<ShortcutAction, ShortcutDefinition>;
  shortcutError: string | null;
  onShortcutChange: (action: ShortcutAction, shortcut: ShortcutDefinition) => boolean;
  themes: {
    ui: 'light' | 'dark';
    canvas2d: 'light' | 'dark' | 'custom';
    view3d: 'light' | 'dark' | 'custom';
    printPaper: 'light' | 'dark' | 'custom';
  };
  onThemeChange: (key: 'ui' | 'canvas2d' | 'view3d' | 'printPaper', value: 'light' | 'dark' | 'custom') => void;
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
}

const DefinitionIcon: React.FC<{ definition: FaceDefinition; className?: string }> = ({ definition, className }) => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  definition.vertices.forEach(vertex => {
    minX = Math.min(minX, vertex.x);
    maxX = Math.max(maxX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxY = Math.max(maxY, vertex.y);
  });

  const pad = 5;
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;
  const points = definition.vertices.map(vertex => `${vertex.x},${vertex.y}`).join(' ');

  return (
    <svg
      viewBox={`${minX - pad} ${minY - pad} ${width} ${height}`}
      className={className}
      fill={definition.color}
      stroke="#334155"
      strokeWidth="2"
      preserveAspectRatio="xMidYMid meet"
    >
      <polygon points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

const PolygonIcon: React.FC<{ type: ShapeType; className?: string }> = ({ type, className }) => (
  <DefinitionIcon definition={getShapeDefinition(type)} className={className} />
);

const NgonIcon: React.FC<{ className?: string }> = ({ className }) => {
  const points = '12,2 19.8,5.8 22,14.5 17,22 7,22 2,14.5 4.2,5.8';
  return (
    <svg viewBox="0 0 24 24" className={className} stroke="#334155" strokeWidth="2">
      <polygon points={points} fill="#cffafe" />
      <text x="12" y="15" textAnchor="middle" fill="#334155" stroke="none" fontSize="10" fontWeight="bold" fontFamily="sans-serif">n</text>
    </svg>
  );
};

const CatalanIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} stroke="#334155" strokeWidth="2">
    <polygon points="12,2 21,12 12,22 3,12" fill="#fcd34d" />
    <text x="12" y="15" textAnchor="middle" fill="#334155" stroke="none" fontSize="10" fontWeight="bold" fontFamily="sans-serif">C</text>
  </svg>
);

const TooltipBubble: React.FC<{ text: string }> = ({ text }) => (
  <span className="pointer-events-none absolute left-full top-1/2 z-[70] ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-none group-hover:opacity-100">
    {text}
  </span>
);

const CustomShapeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} stroke="#334155" strokeWidth="2">
    <path d="M3 10 L12 3 L21 10 V21 H3 Z" fill="#fbcfe8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 17 V9" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 12 L12 9 L15 12" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ShapeButton: React.FC<{
  type: ShapeType;
  active: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  title: string;
  icon?: React.ReactNode;
}> = ({ type, active, onClick, title, icon }) => (
  <button
    onClick={event => {
      event.currentTarget.blur();
      onClick(event);
    }}
    className={`group relative my-0.5 flex h-9 w-9 shrink-0 select-none items-center justify-center rounded border p-1.5 shadow transition-colors ${
      active ? 'bg-blue-100 border-blue-500 text-blue-700' : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-600'
    }`}
    aria-label={title}
  >
    <div className="pointer-events-none flex h-6 w-6 items-center justify-center">
      {icon ? icon : <PolygonIcon type={type} className="h-full w-full" />}
    </div>
    <TooltipBubble text={title} />
  </button>
);

const ToolButton: React.FC<{
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title: string;
}> = ({ icon, active, onClick, title }) => (
  <button
    onClick={event => {
      event.currentTarget.blur();
      onClick();
    }}
    className={`group relative my-0.5 flex h-9 w-9 shrink-0 select-none items-center justify-center rounded border p-1.5 shadow transition-colors ${
      active ? 'bg-purple-100 border-purple-500 text-purple-700' : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-600'
    }`}
    aria-label={title}
  >
    {icon}
    <TooltipBubble text={title} />
  </button>
);

export const Toolbar: React.FC<ToolbarProps> = ({
  activeShape,
  onSelectShape,
  onSelectFaceDefinition,
  onSave,
  onSaveAs,
  onExportMesh,
  onLoad,
  loadInputRef,
  activeTool,
  onSelectTool,
  magnetMode,
  onSelectMagnetMode,
  onEscapeAction,
  onImportShape,
  onPrint,
  uiTheme,
  shortcutTitles,
  shortcuts,
  shortcutError,
  onShortcutChange,
  themes,
  onThemeChange,
  customThemeColors,
  onCustomThemeColorChange,
  otherSettings,
  onOtherSettingChange
}) => {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [showNgonInput, setShowNgonInput] = useState(false);
  const [showCatalanMenu, setShowCatalanMenu] = useState(false);
  const [showMagnetMenu, setShowMagnetMenu] = useState(false);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [ngonValue, setNgonValue] = useState('7');
  const [builderKind, setBuilderKind] = useState<'triangle' | 'kite' | 'trapezoid' | 'parallelogram' | 'pentagon' | null>(null);
  const [builderTop, setBuilderTop] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  const closeMenus = () => {
    setShowNgonInput(false);
    setShowCatalanMenu(false);
    setShowMagnetMenu(false);
    setShowSaveMenu(false);
    setBuilderKind(null);
    setShowSettings(false);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeMenus();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (toolbarRef.current?.contains(event.target as Node)) return;
      closeMenus();
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const previewDefinitions = {
    triangle: createTriangleFaceDefinition(3, 4, 5, '#f59e0b'),
    kite: createKiteFaceDefinition(0.7, 1, 72, '#8b5cf6'),
    trapezoid: createTrapezoidFaceDefinition(0.8, 1.2, 0.8, 0.2, '#fb7185'),
    parallelogram: createParallelogramFaceDefinition(1, 0.8, 65, '#2dd4bf'),
    pentagon: createSymmetricPentagonFaceDefinition(0.8, 1.2, 0.45, 0.6, '#38bdf8')
  };

  const handleNgonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.blur();
    closeMenus();
    setShowNgonInput(true);
  };

  const submitNgon = () => {
    const parsedValue = Number.parseInt(ngonValue, 10);
    if (parsedValue >= 3 && parsedValue <= 50) {
      onSelectShape(`ngon-${parsedValue}`);
      onSelectTool('select');
      closeMenus();
    }
  };

  const handleShapeSelect = (type: ShapeType) => {
    onSelectShape(type);
    onSelectTool('select');
    closeMenus();
  };

  const handleFaceDefinitionSelect = (definition: FaceDefinition | null) => {
    if (!definition) return;
    onSelectFaceDefinition(definition);
    onSelectTool('select');
    closeMenus();
  };

  const withShortcut = (title: string, action?: ShortcutAction) =>
    action ? `${title} (${shortcutTitles[action]})` : title;

  const withFixedShortcut = (title: string, label?: string) =>
    label ? `${title} (${label})` : title;

  const handleToolButtonClick = (tool: 'select' | 'link' | 'rotate' | 'flip' | 'lasso' | 'magnet' | 'bucket') => {
    if (activeTool === tool) {
      closeMenus();
      onEscapeAction();
      return;
    }
    closeMenus();
    onSelectTool(tool);
  };

  const magnetModeOptions: { mode: MagnetMode; title: string; shortcutAction: ShortcutAction }[] = [
    { mode: 'regular', title: 'Regular Magnet', shortcutAction: 'magnetTool' },
    { mode: 'vertex', title: 'Hinges + Vertices', shortcutAction: 'magnetVertexTool' },
    { mode: 'edge', title: 'Hinges + Edges', shortcutAction: 'magnetEdgeTool' }
  ];

  const activeMagnetOption = magnetModeOptions.find(option => option.mode === magnetMode) || magnetModeOptions[0];

  return (
    <>
      <div ref={toolbarRef} className={`relative z-30 flex h-full w-12 shrink-0 select-none flex-col items-center overflow-visible border-r py-2.5 ${uiTheme === 'dark' ? 'ui-theme-dark border-[#3d3d3d] bg-[#242424] text-gray-100' : 'border-gray-200 bg-gray-100'}`}>
        <button
          onClick={event => {
            event.currentTarget.blur();
            if (activeTool === 'select' && !activeShape) {
              onEscapeAction();
              return;
            }
            onSelectShape(null);
            onSelectTool('select');
          }}
          className={`group relative mb-2 rounded p-2 ${activeTool === 'select' && !activeShape ? 'bg-blue-200 text-blue-800' : 'hover:bg-gray-200 text-gray-600'}`}
          aria-label={withShortcut('Select Mode / Cancel', 'cancel')}
        >
          <MousePointer2 size={20} />
          <TooltipBubble text={withShortcut('Select Mode / Cancel', 'cancel')} />
        </button>

        <div className="mb-1.5 w-8 border-b border-gray-300" />

        <ToolButton title={withShortcut('Lasso Select', 'lassoTool')} active={activeTool === 'lasso'} onClick={() => handleToolButtonClick('lasso')} icon={<Lasso size={20} />} />
        <ToolButton title={withShortcut('Link/Glue Nets (Select 2 edges)', 'linkTool')} active={activeTool === 'link'} onClick={() => handleToolButtonClick('link')} icon={<Link size={20} />} />
        <ToolButton title={withShortcut('Rotate Tool (Select face)', 'rotateTool')} active={activeTool === 'rotate'} onClick={() => handleToolButtonClick('rotate')} icon={<RotateCw size={20} />} />
        <ToolButton title={withShortcut('Reflect Selection', 'reflectTool')} active={activeTool === 'flip'} onClick={() => handleToolButtonClick('flip')} icon={<FlipHorizontal size={20} />} />
        <div className="relative">
          <ToolButton title={withShortcut(activeMagnetOption.title, activeMagnetOption.shortcutAction)} active={activeTool === 'magnet'} onClick={() => {
            if (activeTool === 'magnet') {
              closeMenus();
              onEscapeAction();
              return;
            }
            closeMenus();
            onSelectMagnetMode(magnetMode);
          }} icon={<Magnet size={20} />} />
          <button
            type="button"
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.blur();
              const shouldOpen = !showMagnetMenu;
              closeMenus();
              setShowMagnetMenu(shouldOpen);
            }}
            className="absolute bottom-0 right-0 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 shadow-sm hover:bg-gray-100"
            aria-label="Open Magnet Modes"
          >
            <ChevronDown size={9} />
          </button>
          {showMagnetMenu && (
            <div className={`menu-panel thin-scrollbar absolute left-full top-0 z-50 ml-2 w-52 overflow-y-auto rounded-xl border p-2 shadow-2xl ${uiTheme === 'dark' ? 'ui-theme-dark border-[#3d3d3d] bg-[#141414] text-gray-100' : 'border-gray-200 bg-white'}`}>
              <div className="mb-2 px-2 pt-1 text-xs font-semibold text-gray-500">Magnet Modes</div>
              <div className="space-y-1">
                {magnetModeOptions.map(option => (
                  <button
                    key={option.mode}
                    type="button"
                    onClick={() => {
                      onSelectMagnetMode(option.mode);
                      closeMenus();
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      magnetMode === option.mode ? 'bg-blue-100 text-blue-700' : 'menu-hover text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <span>{option.title}</span>
                    <span className="text-[11px] text-gray-500">{shortcutTitles[option.shortcutAction]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <ToolButton title={withShortcut('Color Bucket', 'bucketTool')} active={activeTool === 'bucket'} onClick={() => handleToolButtonClick('bucket')} icon={<PaintBucket size={18} />} />

        <div className="mb-1.5 mt-1.5 w-8 border-b border-gray-300" />

        {!otherSettings.hideRegularPolygonButtons && (
          <>
            <ShapeButton type="triangle" title={withFixedShortcut('Triangle', '3')} active={activeShape === 'triangle'} onClick={() => handleShapeSelect('triangle')} />
            <ShapeButton type="square" title={withFixedShortcut('Square', '4')} active={activeShape === 'square'} onClick={() => handleShapeSelect('square')} />
            <ShapeButton type="pentagon" title={withFixedShortcut('Pentagon', '5')} active={activeShape === 'pentagon'} onClick={() => handleShapeSelect('pentagon')} />
            <ShapeButton type="hexagon" title={withFixedShortcut('Hexagon', '6')} active={activeShape === 'hexagon'} onClick={() => handleShapeSelect('hexagon')} />
          </>
        )}

        <div className="relative">
          <button
            onClick={handleNgonClick}
            className={`group relative my-0.5 flex h-9 w-9 shrink-0 select-none items-center justify-center rounded border p-1.5 shadow transition-colors ${
              activeShape && activeShape.startsWith('ngon') ? 'bg-blue-100 border-blue-500 text-blue-700' : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-600'
            }`}
            aria-label={withFixedShortcut('Custom N-gon', '7-9')}
          >
            <NgonIcon className="h-6 w-6" />
            <TooltipBubble text={withFixedShortcut('Custom N-gon', '7-9')} />
          </button>

          {showNgonInput && (
            <div className={`menu-panel thin-scrollbar absolute left-full top-0 z-50 ml-2 w-48 origin-top-left animate-in rounded-lg border p-3 shadow-xl fade-in zoom-in-95 duration-100 ${uiTheme === 'dark' ? 'ui-theme-dark border-[#3d3d3d] bg-[#141414] text-gray-100' : 'border-gray-200 bg-white'}`}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-700">Sides (3-50)</span>
                <button onClick={() => setShowNgonInput(false)} className="text-gray-400 hover:text-gray-600">
                  <X size={14} />
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={ngonValue}
                  min={3}
                  max={50}
                  onChange={event => setNgonValue(event.target.value)}
                  onBlur={event => {
                    const parsedValue = Number.parseInt(event.target.value, 10);
                    setNgonValue(Number.isFinite(parsedValue) ? String(parsedValue) : '7');
                  }}
                  className={`w-full rounded border px-2 py-1 text-sm outline-none focus:border-blue-500 ${uiTheme === 'dark' ? 'border-[#4a4a4a] bg-[#1b1b1b] text-gray-100' : 'border-gray-300 bg-white text-gray-900'}`}
                  autoFocus
                  onKeyDown={event => event.key === 'Enter' && submitNgon()}
                />
                <button onClick={submitNgon} className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">
                  OK
                </button>
              </div>
            </div>
          )}
        </div>

        {previewDefinitions.triangle && (
          <ShapeButton
            type="triangle-builder"
            title="Arbitrary Triangle"
            active={false}
            onClick={event => {
              closeMenus();
              setBuilderKind('triangle');
              setBuilderTop(event.currentTarget.offsetTop);
            }}
            icon={<DefinitionIcon definition={previewDefinitions.triangle} className="h-full w-full" />}
          />
        )}
        {previewDefinitions.kite && (
          <ShapeButton
            type="kite-builder"
            title="Deltoid / Kite"
            active={false}
            onClick={event => {
              closeMenus();
              setBuilderKind('kite');
              setBuilderTop(event.currentTarget.offsetTop);
            }}
            icon={<DefinitionIcon definition={previewDefinitions.kite} className="h-full w-full" />}
          />
        )}
        {previewDefinitions.trapezoid && (
          <ShapeButton
            type="trapezoid-builder"
            title="Trapezoid"
            active={false}
            onClick={event => {
              closeMenus();
              setBuilderKind('trapezoid');
              setBuilderTop(event.currentTarget.offsetTop);
            }}
            icon={<DefinitionIcon definition={previewDefinitions.trapezoid} className="h-full w-full" />}
          />
        )}
        {previewDefinitions.parallelogram && (
          <ShapeButton
            type="parallelogram-builder"
            title="Parallelogram"
            active={false}
            onClick={event => {
              closeMenus();
              setBuilderKind('parallelogram');
              setBuilderTop(event.currentTarget.offsetTop);
            }}
            icon={<DefinitionIcon definition={previewDefinitions.parallelogram} className="h-full w-full" />}
          />
        )}
        {previewDefinitions.pentagon && (
          <ShapeButton
            type="pentagon-builder"
            title="Symmetric Pentagon"
            active={false}
            onClick={event => {
              closeMenus();
              setBuilderKind('pentagon');
              setBuilderTop(event.currentTarget.offsetTop);
            }}
            icon={<DefinitionIcon definition={previewDefinitions.pentagon} className="h-full w-full" />}
          />
        )}

        <div>
          <button
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.blur();
              const shouldOpen = !showCatalanMenu;
              closeMenus();
              setShowCatalanMenu(shouldOpen);
            }}
            className="group relative my-0.5 flex h-9 w-9 shrink-0 select-none items-center justify-center rounded border border-gray-200 bg-white p-1.5 text-gray-600 shadow transition-colors hover:bg-gray-50"
            aria-label="Catalan Solid Face Presets"
          >
            <CatalanIcon className="h-6 w-6" />
            <TooltipBubble text="Catalan Solid Face Presets" />
          </button>
        </div>

        {showCatalanMenu && (
          <div className={`menu-panel thin-scrollbar absolute bottom-3 left-full z-50 ml-2 max-h-[calc(100%-1.5rem)] w-64 overflow-y-auto rounded-xl border p-3 shadow-2xl ${uiTheme === 'dark' ? 'ui-theme-dark border-[#3d3d3d] bg-[#141414] text-gray-100' : 'border-gray-200 bg-white'}`}>
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-800">Catalan Faces</div>
                <div className="text-[11px] text-gray-500">Preset face polygons for classic Catalan solids.</div>
              </div>
              <button onClick={() => setShowCatalanMenu(false)} className="text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            </div>
            <div className="space-y-1">
              {catalanShapePresets.map(preset => {
                const definition = preset.create();
                if (!definition) return null;
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleFaceDefinitionSelect(definition)}
                    className="menu-hover flex w-full items-center gap-3 rounded-lg border border-gray-200 px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                    title={preset.title}
                  >
                    <div className="h-8 w-8 shrink-0 text-gray-600">
                      <DefinitionIcon definition={definition} className="h-full w-full" />
                    </div>
                    <span className="leading-tight">{preset.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <label className="group relative my-0.5 flex h-9 w-9 shrink-0 cursor-pointer select-none items-center justify-center rounded border border-gray-200 bg-white p-1.5 text-gray-600 shadow transition-colors hover:bg-gray-50" aria-label="Import Custom Shape (CSV/TXT)">
          <div className="flex h-6 w-6 items-center justify-center">
            <CustomShapeIcon className="h-full w-full" />
          </div>
          <input type="file" className="hidden" accept=".csv,.txt,.dat" onChange={onImportShape} />
          <TooltipBubble text="Import Custom Shape (CSV/TXT)" />
        </label>

        <div className="flex-1" />

        <div className="mb-4 w-8 border-b border-gray-300" />

        <button onClick={event => { event.currentTarget.blur(); onPrint(); closeMenus(); }} className="group relative mb-2 rounded p-2 text-gray-600 hover:bg-gray-200" aria-label={withShortcut('Print / Export', 'print')}>
          <Printer size={20} />
          <TooltipBubble text={withShortcut('Print / Export', 'print')} />
        </button>

        <div className="relative mb-2">
          <button onClick={event => { event.currentTarget.blur(); onSave(); closeMenus(); }} className="group relative rounded p-2 text-gray-600 hover:bg-gray-200" aria-label={withShortcut('Save', 'save')}>
            <Download size={20} />
            <TooltipBubble text={withShortcut('Save', 'save')} />
          </button>
          <button
            type="button"
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.blur();
              const shouldOpen = !showSaveMenu;
              closeMenus();
              setShowSaveMenu(shouldOpen);
            }}
            className="absolute bottom-0 right-0 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 shadow-sm hover:bg-gray-100"
            aria-label="Open Save Menu"
          >
            <ChevronDown size={9} />
          </button>
          {showSaveMenu && (
            <div className={`menu-panel thin-scrollbar absolute bottom-0 left-full z-50 ml-2 w-52 overflow-y-auto rounded-xl border p-2 shadow-2xl ${uiTheme === 'dark' ? 'ui-theme-dark border-[#3d3d3d] bg-[#141414] text-gray-100' : 'border-gray-200 bg-white'}`}>
              <div className="mb-2 px-2 pt-1 text-xs font-semibold text-gray-500">Save Options</div>
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    onSave();
                    closeMenus();
                  }}
                  className="menu-hover flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  <span>Save</span>
                  <span className="text-[11px] text-gray-500">{shortcutTitles.save}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSaveAs();
                    closeMenus();
                  }}
                  className="menu-hover flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  <span>Save As</span>
                  <span className="text-[11px] text-gray-500">{shortcutTitles.saveAs}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onExportMesh();
                    closeMenus();
                  }}
                  className="menu-hover flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  <span>Export Mesh</span>
                  <span className="text-[11px] text-gray-500">{shortcutTitles.exportMesh}</span>
                </button>
              </div>
            </div>
          )}
        </div>
        <label className="group relative mb-2 cursor-pointer rounded p-2 text-gray-600 hover:bg-gray-200" aria-label={withShortcut('Open', 'open')}>
          <Upload size={20} />
          <input ref={loadInputRef} type="file" className="hidden" accept=".json" onChange={onLoad} />
          <TooltipBubble text={withShortcut('Open', 'open')} />
        </label>

        <button
          onClick={event => {
            event.currentTarget.blur();
            const shouldOpen = !showSettings;
            closeMenus();
            setShowSettings(shouldOpen);
          }}
          className="group relative mb-2 rounded p-2 text-gray-500 hover:bg-gray-200"
          aria-label="Settings"
        >
          <Settings size={20} />
          <TooltipBubble text="Settings" />
        </button>
        {builderKind && (
          <ShapeBuilderPopup uiTheme={uiTheme} kind={builderKind} top={builderTop} onClose={() => setBuilderKind(null)} onCreate={definition => handleFaceDefinitionSelect(definition)} />
        )}
        {showSettings && (
          <SettingsPopup
            uiTheme={uiTheme}
            shortcuts={shortcuts}
            shortcutError={shortcutError}
            onShortcutChange={onShortcutChange}
            themes={themes}
            onThemeChange={onThemeChange}
              customThemeColors={customThemeColors}
              onCustomThemeColorChange={onCustomThemeColorChange}
              otherSettings={otherSettings}
              onOtherSettingChange={onOtherSettingChange}
              onClose={() => setShowSettings(false)}
            />
          )}
      </div>
    </>
  );
};
