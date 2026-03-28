
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PolyNet, PlacedFace, ShapeType, Connection, Point2D, MagnetEdge, MagnetMode, MagnetVertex } from './types';
import { Toolbar } from './components/Toolbar';
import { Canvas2D } from './components/Canvas2D';
import { Viewer3D } from './components/Viewer3D';
import { MathInput } from './components/MathInput';
import { CalculatorPopup } from './components/CalculatorPopup';
import { PrintModal } from './components/PrintModal';
import { ColorBucketPopup } from './components/ColorBucketPopup';
import { ExportMeshModal } from './components/ExportMeshModal';
import { 
  vecAdd, getConnectedComponent, getAlignTransform, mirrorPolyNet, 
  compute3DLayout, parseCustomShape, solveMagnetFold, solveMagnetFoldByHingesAndVertices, solveMagnetFoldByHingesAndEdges, edgesHaveMatchingLength, areFaceDefinitionsEquivalent,
  getRegularMagnetGuidePreview, getVertexMagnetGuidePreview, getEdgeMagnetGuidePreview, MagnetGuidePreview3D
} from './utils/math';
import { DEFAULT_SHORTCUTS, SHORTCUT_LABELS, ShortcutAction, ShortcutDefinition, formatShortcut, matchesShortcut, shortcutToId } from './utils/shortcuts';
import { buildMeshExportData } from './utils/meshExport';
import { Cuboid, Calculator } from 'lucide-react';

// Helper type for History
interface HistoryItem {
  net: PolyNet;
  selFaces: Set<string>;
  selConns: Set<string>;
}

type ThemeMode = 'light' | 'dark';
type ToolName = 'select' | 'link' | 'rotate' | 'flip' | 'lasso' | 'magnet' | 'bucket';
type SurfaceThemeMode = 'light' | 'dark' | 'custom';
type ThemeSettings = {
  ui: ThemeMode;
  canvas2d: SurfaceThemeMode;
  view3d: SurfaceThemeMode;
  printPaper: SurfaceThemeMode;
};
type CustomThemeColors = {
  canvas2d: string;
  view3d: string;
  printPaper: string;
};
type OtherSettings = {
  showMagnetGuides: boolean;
  backgroundClickExitsTool: boolean;
  hideRegularPolygonButtons: boolean;
};

interface MagnetSolveRequest {
  mode: MagnetMode;
  hingeEdges: [MagnetEdge, MagnetEdge];
  targetVertices?: [MagnetVertex, MagnetVertex];
  targetEdges?: [MagnetEdge, MagnetEdge];
}

interface LastMagnetAction {
  baseNet: PolyNet;
  primaryUpdates: { connId: string; delta: number }[];
  alternateUpdates?: { connId: string; delta: number }[];
}

interface PivotRequest {
  faceId: string;
  nonce: number;
}

interface MagnetPreviewState {
  request: MagnetSolveRequest;
  preview: MagnetGuidePreview3D;
  validationError?: string | null;
}

const TWO_PI = Math.PI * 2;
const REGULAR_POLYGON_EPSILON = 1e-3;
const SETTINGS_STORAGE_KEY = 'polylab-settings-v1';

const mod = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;

const normalizeAngle = (angle: number) => {
  const normalized = mod(angle + Math.PI, TWO_PI) - Math.PI;
  return normalized <= -Math.PI ? normalized + TWO_PI : normalized;
};

const getEdgeAlignmentTargets = (face: PlacedFace) => {
  const vertices = face.def.vertices;
  return vertices.map((vertex, index) => {
    const nextVertex = vertices[(index + 1) % vertices.length];
    return -Math.atan2(nextVertex.y - vertex.y, nextVertex.x - vertex.x);
  });
};

const isRegularPolygonFace = (face: PlacedFace) => {
  const vertices = face.def.vertices;
  if (vertices.length < 3) return false;

  const edgeAngles = vertices.map((vertex, index) => {
    const nextVertex = vertices[(index + 1) % vertices.length];
    return Math.atan2(nextVertex.y - vertex.y, nextVertex.x - vertex.x);
  });

  const edgeLengths = vertices.map((vertex, index) => {
    const nextVertex = vertices[(index + 1) % vertices.length];
    return Math.hypot(nextVertex.x - vertex.x, nextVertex.y - vertex.y);
  });

  const referenceLength = edgeLengths[0];
  if (referenceLength <= 0) return false;

  const referenceTurn = mod(edgeAngles[1] - edgeAngles[0], TWO_PI);
  return edgeLengths.every(length => Math.abs(length - referenceLength) <= REGULAR_POLYGON_EPSILON) &&
    edgeAngles.every((angle, index) => {
      const nextAngle = edgeAngles[(index + 1) % edgeAngles.length];
      return Math.abs(mod(nextAngle - angle, TWO_PI) - referenceTurn) <= REGULAR_POLYGON_EPSILON;
    });
};

const getNextEdgeAlignedDelta = (face: PlacedFace, direction: 1 | -1) => {
  const targets = getEdgeAlignmentTargets(face);
  if (targets.length === 0) return null;

  let currentIndex = 0;
  let currentDistance = Infinity;
  targets.forEach((target, index) => {
    const distance = Math.abs(normalizeAngle(target - face.transform.rotation));
    if (distance < currentDistance) {
      currentDistance = distance;
      currentIndex = index;
    }
  });

  const nextIndex = mod(currentIndex + direction, targets.length);
  let delta = normalizeAngle(targets[nextIndex] - face.transform.rotation);

  if (direction > 0 && delta > 0) delta -= TWO_PI;
  if (direction < 0 && delta < 0) delta += TWO_PI;

  return delta;
};

const loadStoredSettings = (): Partial<{
  show3D: boolean;
  shortcuts: Record<ShortcutAction, ShortcutDefinition>;
  themes: ThemeSettings;
  customThemeColors: CustomThemeColors;
  magnetMode: MagnetMode;
  otherSettings: OtherSettings;
}> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
};

const storedSettings = loadStoredSettings();
const defaultThemes: ThemeSettings = {
  ui: 'light',
  canvas2d: 'light',
  view3d: 'dark',
  printPaper: 'light'
};
const defaultCustomThemeColors: CustomThemeColors = {
  canvas2d: '#111827',
  view3d: '#111827',
  printPaper: '#ffffff'
};
const defaultOtherSettings: OtherSettings = {
  showMagnetGuides: true,
  backgroundClickExitsTool: false,
  hideRegularPolygonButtons: false
};

const sanitizeShortcuts = (value: unknown): Record<ShortcutAction, ShortcutDefinition> => {
  const merged = { ...DEFAULT_SHORTCUTS };
  if (!value || typeof value !== 'object') return merged;
  (Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]).forEach(action => {
    const candidate = (value as Record<string, ShortcutDefinition | undefined>)[action];
    if (!candidate) return;
    if (candidate.trigger === 'mouse' || typeof candidate.mouseButton === 'number') {
      if (candidate.mouseButton !== 0 && candidate.mouseButton !== 1 && candidate.mouseButton !== 2) return;
      merged[action] = {
        trigger: 'mouse',
        mouseButton: candidate.mouseButton,
        clickCount: candidate.clickCount === 2 ? 2 : 1,
        ctrlOrMeta: candidate.ctrlOrMeta || undefined,
        shift: candidate.shift || undefined,
        alt: candidate.alt || undefined
      };
      return;
    }
    if (typeof candidate.key !== 'string') return;
    merged[action] = {
      trigger: 'keyboard',
      key: candidate.key,
      ctrlOrMeta: candidate.ctrlOrMeta || undefined,
      shift: candidate.shift || undefined,
      alt: candidate.alt || undefined
    };
  });
  return merged;
};

const sanitizeThemes = (value: unknown): ThemeSettings => {
  const merged = { ...defaultThemes };
  if (!value || typeof value !== 'object') return merged;
  (Object.keys(defaultThemes) as (keyof ThemeSettings)[]).forEach(key => {
    const candidate = (value as Record<string, SurfaceThemeMode | ThemeMode | undefined>)[key];
    if (key === 'ui') {
      if (candidate === 'light' || candidate === 'dark') {
        merged.ui = candidate;
      }
      return;
    }
    if (candidate === 'light' || candidate === 'dark' || candidate === 'custom') {
      merged[key] = candidate;
    }
  });
  return merged;
};

const sanitizeCustomThemeColors = (value: unknown): CustomThemeColors => {
  const merged = { ...defaultCustomThemeColors };
  if (!value || typeof value !== 'object') return merged;
  (Object.keys(defaultCustomThemeColors) as (keyof CustomThemeColors)[]).forEach(key => {
    const candidate = (value as Record<string, string | undefined>)[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      merged[key] = candidate;
    }
  });
  return merged;
};

const sanitizeOtherSettings = (value: unknown): OtherSettings => {
  const merged = { ...defaultOtherSettings };
  if (!value || typeof value !== 'object') return merged;
  const source = value as Record<string, unknown>;
  if (typeof source.showMagnetGuides === 'boolean') {
    merged.showMagnetGuides = source.showMagnetGuides;
  }
  if (typeof source.backgroundClickExitsTool === 'boolean') {
    merged.backgroundClickExitsTool = source.backgroundClickExitsTool;
  }
  if (typeof source.hideRegularPolygonButtons === 'boolean') {
    merged.hideRegularPolygonButtons = source.hideRegularPolygonButtons;
  }
  return merged;
};

const App: React.FC = () => {
  // State
  const [net, setNet] = useState<PolyNet>({ faces: {}, connections: [] });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  // Multi-selection state for connections
  const [selectedConnIds, setSelectedConnIds] = useState<Set<string>>(new Set());
  const [selectedFaceIds, setSelectedFaceIds] = useState<Set<string>>(new Set());
  
  // Magnet Tool State
  const [selectedMagnetEdges, setSelectedMagnetEdges] = useState<MagnetEdge[]>([]);
  const [selectedMagnetVertices, setSelectedMagnetVertices] = useState<MagnetVertex[]>([]);
  const [selectedMagnetTargetEdges, setSelectedMagnetTargetEdges] = useState<MagnetEdge[]>([]);
  const [magnetMode, setMagnetMode] = useState<MagnetMode>(() => storedSettings.magnetMode === 'vertex' || storedSettings.magnetMode === 'edge' ? storedSettings.magnetMode : 'regular');
  const [magnetEdgeTargetsConfirmed, setMagnetEdgeTargetsConfirmed] = useState(false);
  const [lastMagnetAction, setLastMagnetAction] = useState<LastMagnetAction | null>(null);
  
  const [activeShape, setActiveShape] = useState<ShapeType | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<{ faces: PlacedFace[], connections: Connection[] } | null>(null);
  
  // Tools
  const [activeTool, setActiveTool] = useState<ToolName>('select');
  const [bucketTargetFaceId, setBucketTargetFaceId] = useState<string | null>(null);
  const [faceColorOverrides, setFaceColorOverrides] = useState<Record<string, string>>({});
  const [useEdgeAlignedRotation, setUseEdgeAlignedRotation] = useState(false);
  
  const [show3D, setShow3D] = useState(() => storedSettings.show3D ?? false);
  const [shortcuts, setShortcuts] = useState<Record<ShortcutAction, ShortcutDefinition>>(() => sanitizeShortcuts(storedSettings.shortcuts));
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [themes, setThemes] = useState<ThemeSettings>(() => sanitizeThemes(storedSettings.themes));
  const [customThemeColors, setCustomThemeColors] = useState<CustomThemeColors>(() => sanitizeCustomThemeColors(storedSettings.customThemeColors));
  const [otherSettings, setOtherSettings] = useState<OtherSettings>(() => sanitizeOtherSettings(storedSettings.otherSettings));
  const [selectedMagnetPreviewIndex, setSelectedMagnetPreviewIndex] = useState(0);
  
  // Modals
  const [showCalculator, setShowCalculator] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showExportMeshModal, setShowExportMeshModal] = useState(false);
  const saveFileHandleRef = useRef<any | null>(null);
  const loadFileInputRef = useRef<HTMLInputElement | null>(null);

  // Persistent 3D Root
  const [active3DNetRoot, setActive3DNetRoot] = useState<string | null>(null);
  const [pivotRequest, setPivotRequest] = useState<PivotRequest | null>(null);

  // View Layout
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Shared Hover State
  const [hoveredFaceId, setHoveredFaceId] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<{ faceId: string, edgeIndex: number } | null>(null);
  const shortcutTitles = useMemo(() => {
    return Object.fromEntries(
      (Object.entries(shortcuts) as [ShortcutAction, ShortcutDefinition][])
        .map(([action, shortcut]) => [action, formatShortcut(shortcut)])
    ) as Record<ShortcutAction, string>;
  }, [shortcuts]);

  const clearMagnetSelection = useCallback(() => {
    setSelectedMagnetEdges([]);
    setSelectedMagnetVertices([]);
    setSelectedMagnetTargetEdges([]);
    setMagnetEdgeTargetsConfirmed(false);
  }, []);

  const requestPivotFace = useCallback((faceId: string) => {
    if (!net.faces[faceId]) return;
    setActive3DNetRoot(faceId);
    setPivotRequest(prev => ({ faceId, nonce: (prev?.nonce || 0) + 1 }));
  }, [net.faces]);

  const focus3DNetOnFace = useCallback((faceId: string | null | undefined, candidateNet: PolyNet = net) => {
    if (!faceId || !candidateNet.faces[faceId]) return;
    const currentRootId =
      (active3DNetRoot && candidateNet.faces[active3DNetRoot] ? active3DNetRoot : null) ||
      Object.keys(candidateNet.faces)[0] ||
      null;
    if (!currentRootId || !candidateNet.faces[currentRootId]) {
      setActive3DNetRoot(faceId);
      return;
    }
    if (getConnectedComponent(candidateNet, currentRootId).has(faceId)) {
      return;
    }
    setActive3DNetRoot(faceId);
  }, [active3DNetRoot, net]);

  // --- Split View Logic ---
  const handleSplitMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleSplitMouseMove = (e: MouseEvent) => {
      if (isResizing && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const newRatio = (e.clientX - rect.left) / rect.width;
        setSplitRatio(Math.max(0.1, Math.min(0.9, newRatio)));
      }
    };

    const handleSplitMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleSplitMouseMove);
      window.addEventListener('mouseup', handleSplitMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleSplitMouseMove);
      window.removeEventListener('mouseup', handleSplitMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
        show3D,
        shortcuts,
        themes,
        customThemeColors,
        magnetMode,
        otherSettings
      }));
    } catch {
      // Ignore persistence failures and keep the in-memory settings usable.
    }
  }, [customThemeColors, magnetMode, otherSettings, shortcuts, show3D, themes]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.style.backgroundColor = themes.ui === 'dark' ? '#141414' : '#ffffff';
    document.body.style.colorScheme = themes.ui === 'dark' ? 'dark' : 'light';
  }, [themes.ui]);

  useEffect(() => {
    if (activeTool !== 'magnet') {
      clearMagnetSelection();
    }
  }, [activeTool, clearMagnetSelection]);

  // --- History Management (Enhanced for Selection) ---

  const pushHistory = useCallback((newNet: PolyNet, newSelFaces?: Set<string>, newSelConns?: Set<string>) => {
    const facesToSave = newSelFaces || selectedFaceIds;
    const connsToSave = newSelConns || selectedConnIds;
    
    const newItem: HistoryItem = {
      net: newNet,
      selFaces: new Set(facesToSave),
      selConns: new Set(connsToSave)
    };

    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newItem);
    if (newHistory.length > 30) newHistory.shift(); // Increased history limit
    
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    
    // Update current state
    setNet(newNet);
    if (newSelFaces) setSelectedFaceIds(newSelFaces);
    if (newSelConns) setSelectedConnIds(newSelConns);
  }, [history, historyIndex, selectedFaceIds, selectedConnIds]);

  // Initial History
  useEffect(() => {
    if (history.length === 0) {
       const initial: HistoryItem = { 
         net: { faces: {}, connections: [] }, 
         selFaces: new Set(), 
         selConns: new Set() 
       };
       setHistory([initial]);
       setHistoryIndex(0);
    }
  }, []);

  const undo = () => {
    if (historyIndex > 0) {
      const prevItem = history[historyIndex - 1];
      setHistoryIndex(prev => prev - 1);
      setNet(prevItem.net);
      setSelectedFaceIds(prevItem.selFaces);
      setSelectedConnIds(prevItem.selConns);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const nextItem = history[historyIndex + 1];
      setHistoryIndex(prev => prev + 1);
      setNet(nextItem.net);
      setSelectedFaceIds(nextItem.selFaces);
      setSelectedConnIds(nextItem.selConns);
    }
  };

  // --- Selection Handlers (With History) ---

  const handleSelectConnection = (id: string | null, multi: boolean) => {
     setLastMagnetAction(null);
     let newSet: Set<string>;
     if (id === null) { 
        if (!multi) newSet = new Set(); 
        else newSet = new Set(selectedConnIds);
     } else {
        newSet = new Set(multi ? selectedConnIds : []);
        if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
     }
     
     // Calculate new face set (if not multi, faces are cleared)
     const newFaceSet = !multi ? new Set<string>() : selectedFaceIds;

     if (id) {
       const connection = net.connections.find(conn => conn.id === id);
       if (connection) {
         focus3DNetOnFace(connection.faceAId);
       }
     }

     // Push to history explicitly to allow "Undo Selection"
     pushHistory(net, newFaceSet, newSet);
  };

  const handleSelectionChange = (ids: Set<string>) => {
     setLastMagnetAction(null);
     const firstFaceId = Array.from(ids)[0];
     if (firstFaceId) {
       focus3DNetOnFace(firstFaceId);
     }
     // Implicitly clears connections if not careful, but usually we keep them unless exclusive
     // In this app, clicking faces usually clears connection selection
     const newConnSet = new Set<string>(); // Clear connections when selecting faces
     pushHistory(net, ids, newConnSet);
  };

  const handleSelectFaceNormally = useCallback((faceId: string, multi: boolean, forceSelectTool: boolean = false) => {
    setLastMagnetAction(null);
    if (forceSelectTool) {
      setActiveTool('select');
      clearMagnetSelection();
      setBucketTargetFaceId(null);
    }

    if (multi) {
      const newSet = new Set(selectedFaceIds);
      if (newSet.has(faceId)) newSet.delete(faceId);
      else newSet.add(faceId);
      pushHistory(net, newSet, new Set());
      return;
    }

    pushHistory(net, new Set([faceId]), new Set());
  }, [clearMagnetSelection, net, pushHistory, selectedFaceIds]);

  const handle3DFaceSelection = useCallback((faceId: string, multi: boolean) => {
    if (activeTool === 'bucket') {
      setBucketTargetFaceId(faceId);
      return;
    }

    if (activeTool === 'flip') {
      const idsToFlip = selectedFaceIds.size > 0 ? selectedFaceIds : new Set([faceId]);
      const allIds = new Set<string>();
      idsToFlip.forEach(id => {
        const component = getConnectedComponent(net, id);
        component.forEach(componentId => allIds.add(componentId));
      });
      if (allIds.size > 0) {
        pushHistory(mirrorPolyNet(net, Array.from(allIds)));
      }
      return;
    }

    if (activeTool === 'rotate') {
      pushHistory(net, new Set([faceId]), new Set());
      return;
    }

    if (activeTool === 'link' || activeTool === 'lasso' || activeTool === 'magnet') {
      handleSelectFaceNormally(faceId, multi, true);
      return;
    }

    if (activeTool === 'select') {
      handleSelectFaceNormally(faceId, multi);
    }
  }, [activeTool, handleSelectFaceNormally, net, pushHistory, selectedFaceIds]);

  const handle3DBackgroundClick = useCallback(() => {
    if (!otherSettings.backgroundClickExitsTool) {
      if ((activeTool === 'select' || activeTool === 'rotate') && (selectedFaceIds.size > 0 || selectedConnIds.size > 0)) {
        pushHistory(net, new Set(), new Set());
      }
      return;
    }
    if (activeTool === 'magnet' && magnetMode !== 'regular') {
      setActiveTool('select');
      clearMagnetSelection();
      return;
    }
    if ((activeTool === 'select' || activeTool === 'rotate') && (selectedFaceIds.size > 0 || selectedConnIds.size > 0)) {
      pushHistory(net, new Set(), new Set());
    }
  }, [activeTool, clearMagnetSelection, magnetMode, net, otherSettings.backgroundClickExitsTool, pushHistory, selectedConnIds.size, selectedFaceIds.size]);

  // --- Actions ---

  const handleImportShape = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const r = new FileReader();
          r.onload = (ev) => {
             const text = ev.target?.result as string;
             const verts = parseCustomShape(text);
             if (verts) {
                 // Set as active template with a single face
                 const face: PlacedFace = {
                     id: 'custom',
                     def: { type: 'custom', vertices: verts, color: '#d946ef' }, // Fuchsia color for custom
                     transform: { x: 0, y: 0, rotation: 0 },
                     parentId: null, parentEdgeIndex: null, myEdgeIndex: null
                 };
                 setActiveTemplate({ faces: [face], connections: [] });
                 setActiveShape(null);
                 setActiveTool('select');
                 // Reset input
                 e.target.value = '';
             } else {
                 alert("Could not parse valid vertices from file. Format: X Y per line.");
             }
          };
          r.readAsText(file);
      }
  };

  const handleAddFaces = (faces: PlacedFace[], conns: Connection[]) => {
    const newFaces = { ...net.faces };
    faces.forEach(f => newFaces[f.id] = f);
    const newConns = [...net.connections, ...conns];
    if (faces[0]) {
      setActive3DNetRoot(faces[0].id);
    }
    pushHistory({ ...net, faces: newFaces, connections: newConns }, selectedFaceIds, selectedConnIds);
  };

  const activateShapePlacement = useCallback((shape: ShapeType) => {
    setActiveShape(shape);
    setActiveTemplate(null);
    setSelectedFaceIds(new Set());
    setSelectedConnIds(new Set());
    setActiveTool('select');
  }, []);

  const activateTool = useCallback((tool: ToolName) => {
    setLastMagnetAction(null);
    setActiveTool(tool);
    if (tool !== 'select') setActiveShape(null);
    if (tool !== 'magnet') clearMagnetSelection();
    if (tool !== 'bucket') setBucketTargetFaceId(null);
  }, [clearMagnetSelection]);

  const activateMagnetTool = useCallback((mode: MagnetMode) => {
    setMagnetMode(mode);
    setLastMagnetAction(null);
    setActiveTool('magnet');
    setActiveShape(null);
    setBucketTargetFaceId(null);
    clearMagnetSelection();
  }, [clearMagnetSelection]);

  const handleThemeChange = useCallback((key: 'ui' | 'canvas2d' | 'view3d' | 'printPaper', value: ThemeMode | SurfaceThemeMode) => {
    setThemes(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleCustomThemeColorChange = useCallback((key: keyof CustomThemeColors, value: string) => {
    setCustomThemeColors(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleOtherSettingChange = useCallback((key: keyof OtherSettings, value: boolean) => {
    setOtherSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleEscapeAction = useCallback(() => {
    const hasSelection = selectedFaceIds.size > 0 || selectedConnIds.size > 0;
    setLastMagnetAction(null);
    setActiveShape(null);
    setActiveTemplate(null);
    clearMagnetSelection();
    setBucketTargetFaceId(null);
    setShowCalculator(false);
    setShowPrintModal(false);
    setShowExportMeshModal(false);
    setActiveTool('select');
    if (hasSelection) {
      pushHistory(net, new Set(), new Set());
      return;
    }
    setSelectedFaceIds(new Set());
    setSelectedConnIds(new Set());
  }, [clearMagnetSelection, net, pushHistory, selectedConnIds, selectedFaceIds]);

  const selectFaceDefinition = useCallback((definition: PlacedFace['def']) => {
    const face: PlacedFace = {
      id: 'custom-template',
      def: definition,
      transform: { x: 0, y: 0, rotation: 0 },
      parentId: null,
      parentEdgeIndex: null,
      myEdgeIndex: null
    };
    setActiveTemplate({ faces: [face], connections: [] });
    setActiveShape(null);
    setSelectedFaceIds(new Set());
    setSelectedConnIds(new Set());
    setActiveTool('select');
  }, []);

  const downloadNetJson = useCallback((filename: string = 'poly_net.json') => {
    const blob = new Blob([JSON.stringify(net, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [net]);

  const downloadTextFile = useCallback((filename: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, []);

  const saveTextFile = useCallback(async (filename: string, content: string, mimeType: string) => {
    const picker = (window as any).showSaveFilePicker;
    if (!picker) {
      downloadTextFile(filename, content, mimeType);
      return;
    }

    try {
      const handle = await picker({
        suggestedName: filename,
        types: [
          {
            description: 'CSV File',
            accept: { [mimeType]: ['.csv'] }
          }
        ]
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.error(error);
        downloadTextFile(filename, content, mimeType);
      }
    }
  }, [downloadTextFile]);

  const saveNetJson = useCallback(async (saveAs: boolean = false) => {
    const picker = (window as any).showSaveFilePicker;
    if (!picker) {
      downloadNetJson();
      return;
    }

    try {
      let handle = saveAs ? null : saveFileHandleRef.current;
      if (!handle) {
        handle = await picker({
          suggestedName: 'poly_net.json',
          types: [
            {
              description: 'PolyLab JSON',
              accept: { 'application/json': ['.json'] }
            }
          ]
        });
        saveFileHandleRef.current = handle;
      }

      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(net, null, 2));
      await writable.close();
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.error(error);
        downloadNetJson();
      }
    }
  }, [downloadNetJson, net]);

  const getMeshExportData = useCallback((options: { deduplicateVertices: boolean; triangulate: boolean }) => (
    buildMeshExportData(net, Array.from(selectedFaceIds), options)
  ), [net, selectedFaceIds]);

  const exportMeshVerticesCsv = useCallback((options: { deduplicateVertices: boolean; triangulate: boolean }) => {
    const data = getMeshExportData(options);
    void saveTextFile('mesh_vertices.csv', data.verticesCsv, 'text/csv');
  }, [getMeshExportData, saveTextFile]);

  const exportMeshIndicesCsv = useCallback((options: { deduplicateVertices: boolean; triangulate: boolean }) => {
    const data = getMeshExportData(options);
    void saveTextFile('mesh_indices.csv', data.indicesCsv, 'text/csv');
  }, [getMeshExportData, saveTextFile]);

  const handleDelete = () => {
    setLastMagnetAction(null);
    if (selectedFaceIds.size === 0 && selectedConnIds.size === 0) return;
    let newFaces = { ...net.faces } as Record<string, PlacedFace>;
    let newConns = [...net.connections];

    // Delete Connections
    if (selectedConnIds.size > 0) {
      newConns = newConns.filter(c => {
        if (selectedConnIds.has(c.id)) {
          // Detach logic
          const faceA = newFaces[c.faceAId] as PlacedFace | undefined;
          const faceB = newFaces[c.faceBId] as PlacedFace | undefined;
          if (faceB && faceB.parentId === c.faceAId) {
             newFaces[c.faceBId] = { ...faceB, parentId: null, parentEdgeIndex: null, myEdgeIndex: null };
          } else if (faceA && faceA.parentId === c.faceBId) {
             newFaces[c.faceAId] = { ...faceA, parentId: null, parentEdgeIndex: null, myEdgeIndex: null };
          }
          return false; 
        }
        return true;
      });
    }

    // Delete Faces
    if (selectedFaceIds.size > 0) {
      selectedFaceIds.forEach(fid => {
        delete newFaces[fid];
        newConns = newConns.filter(c => c.faceAId !== fid && c.faceBId !== fid);
        Object.values(newFaces).forEach((f: PlacedFace) => {
          if (f.parentId === fid) {
            newFaces[f.id] = { ...f, parentId: null, parentEdgeIndex: null, myEdgeIndex: null };
          }
        });
      });
      // Clear tools that might hold references to deleted faces
      setActiveTool('select'); 
      clearMagnetSelection();
    }
    
    pushHistory({ faces: newFaces, connections: newConns }, new Set(), new Set());
  };

  const handleCopy = () => {
    setLastMagnetAction(null);
    if (selectedFaceIds.size === 0) return;
    const copiedFaces: PlacedFace[] = [];
    let minX = Infinity, minY = Infinity;
    
    selectedFaceIds.forEach(fid => {
      const f = net.faces[fid];
      if (f) {
        copiedFaces.push(f);
        minX = Math.min(minX, f.transform.x);
        minY = Math.min(minY, f.transform.y);
      }
    });

    const normalizedFaces = copiedFaces.map(f => ({
      ...f,
      transform: { ...f.transform, x: f.transform.x - minX, y: f.transform.y - minY }
    }));
    
    const copiedConnections = net.connections.filter(c => 
        selectedFaceIds.has(c.faceAId) && selectedFaceIds.has(c.faceBId)
    );

    setActiveTemplate({ faces: normalizedFaces, connections: copiedConnections });
    setActiveShape(null);
    pushHistory(net, new Set(), selectedConnIds); // Clear face selection after copy? Or keep it. Keeping it is better.
    setActiveTool('select');
  };

  const handleCut = () => {
    setLastMagnetAction(null);
    if (selectedFaceIds.size > 0) {
      handleCopy();
    }
    handleDelete();
  };

  const handleShortcutChange = useCallback((action: ShortcutAction, shortcut: ShortcutDefinition) => {
    const shortcutId = shortcutToId(shortcut);
    const duplicate = (Object.entries(shortcuts) as [ShortcutAction, ShortcutDefinition][])
      .find(([otherAction, otherShortcut]) => otherAction !== action && shortcutToId(otherShortcut) === shortcutId);

    if (duplicate) {
      setShortcutError(`${SHORTCUT_LABELS[duplicate[0]]} already uses ${formatShortcut(shortcut)}.`);
      return false;
    }

    setShortcutError(null);
    setShortcuts(prev => ({ ...prev, [action]: shortcut }));
    return true;
  }, [shortcuts]);

  const handleToggle3D = useCallback(() => {
    setShow3D(prev => !prev);
  }, []);

  const handleMoveFaces = (ids: string[], delta: Point2D) => {
    setLastMagnetAction(null);
    if (ids[0]) {
      focus3DNetOnFace(ids[0]);
    }
    const newFaces = { ...net.faces };
    const idsToMove = new Set<string>();
    ids.forEach(id => {
       getConnectedComponent(net, id).forEach(componentId => idsToMove.add(componentId));
    });

    idsToMove.forEach(id => {
       if (newFaces[id]) {
         const pos = vecAdd(newFaces[id].transform, delta);
         newFaces[id] = { ...newFaces[id], transform: { ...pos, rotation: newFaces[id].transform.rotation } };
       }
    });
    setNet({ ...net, faces: newFaces }); 
  };

  const handleRotateFaces = (ids: string[], angle: number, commit: boolean = true) => {
     if (commit) setLastMagnetAction(null);
     if (ids[0]) {
       focus3DNetOnFace(ids[0]);
     }
     const newFaces = { ...net.faces };
     let cx = 0, cy = 0, count = 0;
     ids.forEach(id => { if (newFaces[id]) { cx += newFaces[id].transform.x; cy += newFaces[id].transform.y; count++; } });
     if (count === 0) return;
     cx /= count; cy /= count;
     const c = Math.cos(angle); const s = Math.sin(angle);

     ids.forEach(id => {
       const f = newFaces[id];
       const dx = f.transform.x - cx; const dy = f.transform.y - cy;
       newFaces[id] = { ...f, transform: { x: dx * c - dy * s + cx, y: dx * s + dy * c + cy, rotation: f.transform.rotation + angle } };
     });
     const nextNet = { ...net, faces: newFaces };
     commit ? pushHistory(nextNet) : setNet(nextNet);
  };

  // Called by Slider/Input
  const handleRotateAbs = (valDeg: number) => {
      if (selectedFaceIds.size === 0) return;
      
      // Rotate connected component
      const allIds = new Set<string>();
      selectedFaceIds.forEach(id => {
          const comp = getConnectedComponent(net, id);
          comp.forEach(cid => allIds.add(cid));
      });
      const ids = Array.from(allIds);
      
      // Determine delta based on the primary selected face (root)
      const rootId = Array.from(selectedFaceIds)[0];
      const root = net.faces[rootId];
      if (!root) return;

      const currentRot = root.transform.rotation;
      const targetRot = valDeg * Math.PI / 180;
      const delta = targetRot - currentRot;
      
      handleRotateFaces(ids, delta, false);
  };

  const handleCommitRotation = () => pushHistory(net);

  const handleFoldChange = (val: number) => {
    setLastMagnetAction(null);
    if (selectedConnIds.size === 0) return;
    const newConns = net.connections.map(c => 
      selectedConnIds.has(c.id) ? { ...c, foldAngle: val } : c
    );
    setNet({ ...net, connections: newConns });
  };

  const handleFoldCommit = () => pushHistory(net);
  
  const handleLinkEdges = (faceAId: string, edgeAIdx: number, faceBId: string, edgeBIdx: number) => {
     setLastMagnetAction(null);
     if (!net.faces[faceAId] || !net.faces[faceBId]) return;
     if (!edgesHaveMatchingLength(net.faces[faceAId].def.vertices, edgeAIdx, net.faces[faceBId].def.vertices, edgeBIdx)) {
       alert('Only equal-length edges can glue together.');
       return;
     }
     const sourceComp = getConnectedComponent(net, faceAId);
     if (sourceComp.has(faceBId)) { alert("Already connected!"); return; }
     const sourceFace = net.faces[faceAId];
     const targetFace = net.faces[faceBId];
     const transform = getAlignTransform(sourceFace, edgeAIdx, targetFace, edgeBIdx);
     const dRot = transform.rotation - sourceFace.transform.rotation;
     const newFaces = { ...net.faces };
     const pivot = { x: sourceFace.transform.x, y: sourceFace.transform.y };
     const c = Math.cos(dRot); const s = Math.sin(dRot);
     const transX = transform.x - pivot.x; const transY = transform.y - pivot.y;

     sourceComp.forEach(fid => {
        const f = newFaces[fid];
        const rx = f.transform.x - pivot.x; const ry = f.transform.y - pivot.y;
        newFaces[fid] = { ...f, transform: { x: rx * c - ry * s + pivot.x + transX, y: rx * s + ry * c + pivot.y + transY, rotation: f.transform.rotation + dRot } };
     });

     const newConn: Connection = {
        id: Math.random().toString(36).substr(2,9),
        faceAId: faceBId, edgeAIndex: edgeBIdx,
        faceBId: faceAId, edgeBIndex: edgeAIdx, foldAngle: 0
     };
     newFaces[faceAId] = { ...newFaces[faceAId], parentId: faceBId, parentEdgeIndex: edgeBIdx, myEdgeIndex: edgeAIdx };
     setActive3DNetRoot(faceAId);
     pushHistory({ faces: newFaces, connections: [...net.connections, newConn] });
  };
  
  const handleFlipSelection = (ids: Set<string>) => {
     setLastMagnetAction(null);
     const firstFaceId = Array.from(ids)[0];
     if (firstFaceId) {
       focus3DNetOnFace(firstFaceId);
     }
     const allIds = new Set<string>();
     ids.forEach(id => {
         const comp = getConnectedComponent(net, id);
         comp.forEach(cid => allIds.add(cid));
     });
     if (allIds.size > 0) {
        pushHistory(mirrorPolyNet(net, Array.from(allIds)));
     }
  };

  const applyBucketColor = useCallback((color: string) => {
    setLastMagnetAction(null);
    if (!bucketTargetFaceId || !net.faces[bucketTargetFaceId]) return;

    const targetDefinition = net.faces[bucketTargetFaceId].def;
    const updatedFaces: Record<string, PlacedFace> = {};

    Object.values(net.faces).forEach(face => {
      updatedFaces[face.id] = areFaceDefinitionsEquivalent(face.def, targetDefinition)
        ? { ...face, def: { ...face.def, color } }
        : face;
    });

    setFaceColorOverrides(prev => ({ ...prev, [targetDefinition.type]: color }));
    pushHistory({ ...net, faces: updatedFaces }, selectedFaceIds, selectedConnIds);
  }, [bucketTargetFaceId, net, pushHistory, selectedConnIds, selectedFaceIds]);

  const selectedRootId = useMemo(() => selectedFaceIds.size > 0 ? Array.from(selectedFaceIds)[0] : undefined, [selectedFaceIds]);
  const isHingeEdge = useCallback((edge: MagnetEdge) => (
    net.connections.some(conn =>
      (conn.faceAId === edge.faceId && conn.edgeAIndex === edge.edgeIndex) ||
      (conn.faceBId === edge.faceId && conn.edgeBIndex === edge.edgeIndex)
    )
  ), [net.connections]);

  const get3DRootId = useCallback((candidateNet: PolyNet = net) => {
    if (active3DNetRoot && candidateNet.faces[active3DNetRoot]) return active3DNetRoot;
    const firstFaceId = Object.keys(candidateNet.faces)[0];
    return firstFaceId;
  }, [active3DNetRoot, net]);

  const getConnectedComponentExcludingConnections = useCallback((candidateNet: PolyNet, startFaceId: string, removedConnIds: Set<string>) => {
    const visited = new Set<string>();
    const queue = [startFaceId];
    visited.add(startFaceId);

    while (queue.length > 0) {
      const currentFaceId = queue.shift()!;
      candidateNet.connections.forEach(connection => {
        if (removedConnIds.has(connection.id)) return;
        if (connection.faceAId !== currentFaceId && connection.faceBId !== currentFaceId) return;
        const neighborFaceId = connection.faceAId === currentFaceId ? connection.faceBId : connection.faceAId;
        if (!candidateNet.faces[neighborFaceId] || visited.has(neighborFaceId)) return;
        visited.add(neighborFaceId);
        queue.push(neighborFaceId);
      });
    }

    return visited;
  }, []);

  const getAllComponentsExcludingConnections = useCallback((candidateNet: PolyNet, removedConnIds: Set<string>) => {
    const remainingFaceIds = new Set(Object.keys(candidateNet.faces));
    const components: Set<string>[] = [];

    while (remainingFaceIds.size > 0) {
      const nextFaceId = remainingFaceIds.values().next().value as string | undefined;
      if (!nextFaceId) break;
      const component = getConnectedComponentExcludingConnections(candidateNet, nextFaceId, removedConnIds);
      component.forEach(faceId => remainingFaceIds.delete(faceId));
      components.push(component);
    }

    return components;
  }, [getConnectedComponentExcludingConnections]);

  const normalizeMagnetRequest = useCallback((candidateNet: PolyNet, request: MagnetSolveRequest): { request: MagnetSolveRequest | null; validationError: string | null } => {
    if (request.mode === 'regular') {
      return { request, validationError: null };
    }

    const [hingeA, hingeB] = request.hingeEdges;
    const connA = candidateNet.connections.find(conn =>
      (conn.faceAId === hingeA.faceId && conn.edgeAIndex === hingeA.edgeIndex) ||
      (conn.faceBId === hingeA.faceId && conn.edgeBIndex === hingeA.edgeIndex)
    );
    const connB = candidateNet.connections.find(conn =>
      (conn.faceAId === hingeB.faceId && conn.edgeAIndex === hingeB.edgeIndex) ||
      (conn.faceBId === hingeB.faceId && conn.edgeBIndex === hingeB.edgeIndex)
    );
    if (!connA || !connB) {
      return { request: null, validationError: 'Select two valid hinge edges before choosing targets.' };
    }
    return { request, validationError: null };
  }, []);

  const applyMagnetUpdates = useCallback((baseNet: PolyNet, updates: { connId: string; delta: number }[]) => {
    const updateByConnId = updates.reduce<Record<string, number>>((acc, update) => {
      acc[update.connId] = update.delta;
      return acc;
    }, {});
    return {
      ...baseNet,
      connections: baseNet.connections.map(conn => (
        typeof updateByConnId[conn.id] === 'number'
          ? { ...conn, foldAngle: (conn.foldAngle || 0) + updateByConnId[conn.id] }
          : conn
      ))
    };
  }, []);

  const buildReversedMagnetRequest = useCallback((request: MagnetSolveRequest): MagnetSolveRequest => ({
    mode: request.mode,
    hingeEdges: [request.hingeEdges[1], request.hingeEdges[0]],
    targetVertices: request.targetVertices ? [request.targetVertices[1], request.targetVertices[0]] : undefined,
    targetEdges: request.targetEdges ? [request.targetEdges[1], request.targetEdges[0]] : undefined
  }), []);

  const solveMagnetRequest = useCallback((baseNet: PolyNet, request: MagnetSolveRequest, rootId?: string) => {
    if (request.mode === 'regular') {
      return solveMagnetFold(baseNet, request.hingeEdges[0], request.hingeEdges[1], rootId);
    }
    if (request.mode === 'vertex' && request.targetVertices) {
      return solveMagnetFoldByHingesAndVertices(baseNet, request.hingeEdges[0], request.hingeEdges[1], request.targetVertices[0], request.targetVertices[1], rootId);
    }
    if (request.mode === 'edge' && request.targetEdges) {
      return solveMagnetFoldByHingesAndEdges(baseNet, request.hingeEdges[0], request.hingeEdges[1], request.targetEdges[0], request.targetEdges[1], rootId);
    }
    return null;
  }, []);

  const buildMagnetPreview = useCallback((baseNet: PolyNet, request: MagnetSolveRequest, rootId?: string): MagnetGuidePreview3D | null => {
    if (request.mode === 'regular') {
      return getRegularMagnetGuidePreview(baseNet, request.hingeEdges[0], request.hingeEdges[1], rootId);
    }
    if (request.mode === 'vertex' && request.targetVertices) {
      return getVertexMagnetGuidePreview(baseNet, request.hingeEdges[0], request.hingeEdges[1], request.targetVertices[0], request.targetVertices[1], rootId);
    }
    if (request.mode === 'edge' && request.targetEdges) {
      return getEdgeMagnetGuidePreview(baseNet, request.hingeEdges[0], request.hingeEdges[1], request.targetEdges[0], request.targetEdges[1], rootId);
    }
    return null;
  }, []);

  const getCurrentMagnetRequestState = useCallback((): { request: MagnetSolveRequest | null; validationError: string | null } => {
    if (activeTool !== 'magnet' || selectedMagnetEdges.length !== 2) {
      return { request: null, validationError: null };
    }
    let rawRequest: MagnetSolveRequest | null = null;
    if (magnetMode === 'regular') {
      rawRequest = {
        mode: 'regular',
        hingeEdges: [selectedMagnetEdges[0], selectedMagnetEdges[1]]
      };
      return { request: rawRequest, validationError: null };
    }
    if (magnetMode === 'vertex' && selectedMagnetVertices.length === 2) {
      rawRequest = {
        mode: 'vertex',
        hingeEdges: [selectedMagnetEdges[0], selectedMagnetEdges[1]],
        targetVertices: [selectedMagnetVertices[0], selectedMagnetVertices[1]]
      };
      return normalizeMagnetRequest(net, rawRequest);
    }
    if (magnetMode === 'edge' && magnetEdgeTargetsConfirmed && selectedMagnetTargetEdges.length === 2) {
      rawRequest = {
        mode: 'edge',
        hingeEdges: [selectedMagnetEdges[0], selectedMagnetEdges[1]],
        targetEdges: [selectedMagnetTargetEdges[0], selectedMagnetTargetEdges[1]]
      };
      return normalizeMagnetRequest(net, rawRequest);
    }
    return { request: null, validationError: null };
  }, [activeTool, magnetEdgeTargetsConfirmed, magnetMode, net, normalizeMagnetRequest, selectedMagnetEdges, selectedMagnetTargetEdges, selectedMagnetVertices]);

  const currentMagnetRequestState = useMemo(() => getCurrentMagnetRequestState(), [getCurrentMagnetRequestState]);

  const magnetPreviewState = useMemo<MagnetPreviewState | null>(() => {
    if (!currentMagnetRequestState.request) return null;
    const rootId = get3DRootId();
    const preview = buildMagnetPreview(net, currentMagnetRequestState.request, rootId);
    return preview ? { request: currentMagnetRequestState.request, preview, validationError: currentMagnetRequestState.validationError } : null;
  }, [buildMagnetPreview, currentMagnetRequestState, get3DRootId, net]);
  const previewRootId = magnetPreviewState?.preview.rootId || get3DRootId();
  const magnetRequiresEnter = otherSettings.showMagnetGuides;

  useEffect(() => {
    setSelectedMagnetPreviewIndex(0);
  }, [
    magnetPreviewState?.request.mode,
    magnetPreviewState?.request.hingeEdges[0]?.faceId,
    magnetPreviewState?.request.hingeEdges[0]?.edgeIndex,
    magnetPreviewState?.request.hingeEdges[1]?.faceId,
    magnetPreviewState?.request.hingeEdges[1]?.edgeIndex,
    magnetPreviewState?.preview.candidates.length
  ]);

  const getMagnetResultSignature = useCallback((updates: { connId: string; delta: number }[] | undefined) => (
    (updates || [])
      .slice()
      .sort((a, b) => a.connId.localeCompare(b.connId))
      .map(update => `${update.connId}:${update.delta.toFixed(10)}`)
      .join('|')
  ), []);

  const commitMagnetRequest = useCallback((request: MagnetSolveRequest, baseNet: PolyNet = net, baseRootId?: string, previewOverride?: MagnetGuidePreview3D | null, preferredCandidateIndex?: number) => {
    const normalizedRequestState = normalizeMagnetRequest(baseNet, request);
    if (!normalizedRequestState.request) {
      alert(normalizedRequestState.validationError || 'That magnet setup is invalid.');
      return false;
    }
    const normalizedRequest = normalizedRequestState.request;
    const rootId = baseRootId ?? get3DRootId(baseNet);
    const preview = previewOverride ?? buildMagnetPreview(baseNet, normalizedRequest, rootId);
    const candidateIndex = typeof preferredCandidateIndex === 'number' ? preferredCandidateIndex : selectedMagnetPreviewIndex;
    const selectedCandidate = preview?.candidates[candidateIndex] || preview?.candidates[0];
    const result = selectedCandidate
      ? { updates: selectedCandidate.updates }
      : solveMagnetRequest(baseNet, normalizedRequest, rootId);
    if (!result) {
      alert(
        normalizedRequest.mode === 'regular'
          ? 'Magnet needs two edges that meet at one live 3D vertex, and at least one adjacent connected hinge that can rotate them together.'
          : normalizedRequestState.validationError || 'That magnet setup has no valid fold for the chosen hinges and targets.'
      );
      return false;
    }

    const nextNet = applyMagnetUpdates(baseNet, result.updates);
    const alternateCandidate = preview?.candidates.find(candidate => getMagnetResultSignature(candidate.updates) !== getMagnetResultSignature(result.updates));

    pushHistory(nextNet, new Set(), new Set());
    clearMagnetSelection();
    setLastMagnetAction(alternateCandidate ? {
      baseNet,
      primaryUpdates: result.updates,
      alternateUpdates: alternateCandidate.updates
    } : null);
    return true;
  }, [applyMagnetUpdates, buildMagnetPreview, clearMagnetSelection, get3DRootId, getMagnetResultSignature, net, normalizeMagnetRequest, pushHistory, selectedMagnetPreviewIndex, solveMagnetRequest]);

  const handleReverseLastMagnet = useCallback(() => {
    if (!lastMagnetAction?.alternateUpdates) return;
    const nextNet = applyMagnetUpdates(lastMagnetAction.baseNet, lastMagnetAction.alternateUpdates);
    pushHistory(nextNet, new Set(), new Set());
    if (!lastMagnetAction.primaryUpdates) {
      setLastMagnetAction(null);
      return;
    }
    setLastMagnetAction({
      baseNet: lastMagnetAction.baseNet,
      primaryUpdates: lastMagnetAction.alternateUpdates,
      alternateUpdates: lastMagnetAction.primaryUpdates
    });
  }, [applyMagnetUpdates, lastMagnetAction, pushHistory]);

  const handleEmptySpaceShortcut = useCallback((shortcut: ShortcutDefinition) => {
    if (shortcutToId(shortcut) === shortcutToId(shortcuts.reverseLastMagnet)) {
      handleReverseLastMagnet();
    }
  }, [handleReverseLastMagnet, shortcuts.reverseLastMagnet]);

  // ---------------- MAGNET TOOL LOGIC ----------------
  const handleMagnetSelect = useCallback((faceId: string, edgeIdx: number) => {
    setLastMagnetAction(null);
    focus3DNetOnFace(faceId);
    const clickedEdge = { faceId, edgeIndex: edgeIdx };
    const selectingHinges = magnetMode !== 'regular' && !(magnetMode === 'edge' && magnetEdgeTargetsConfirmed && selectedMagnetEdges.length === 2);

    if (selectingHinges && !isHingeEdge(clickedEdge)) {
      return;
    }

    if (magnetMode === 'edge' && magnetEdgeTargetsConfirmed && selectedMagnetEdges.length === 2) {
      const existsIdx = selectedMagnetTargetEdges.findIndex(edge => edge.faceId === faceId && edge.edgeIndex === edgeIdx);
      if (existsIdx >= 0) {
        setSelectedMagnetTargetEdges(selectedMagnetTargetEdges.filter((_, index) => index !== existsIdx));
        return;
      }

      const nextTargets = selectedMagnetTargetEdges.length === 0 ? [clickedEdge] : [selectedMagnetTargetEdges[0], clickedEdge];
      setSelectedMagnetTargetEdges(nextTargets);
      if (nextTargets.length === 2 && !magnetRequiresEnter) {
        void commitMagnetRequest({
          mode: 'edge',
          hingeEdges: [selectedMagnetEdges[0], selectedMagnetEdges[1]],
          targetEdges: [nextTargets[0], nextTargets[1]]
        });
      }
      return;
    }

    const existsIdx = selectedMagnetEdges.findIndex(edge => edge.faceId === faceId && edge.edgeIndex === edgeIdx);
    if (existsIdx >= 0) {
      const nextHinges = selectedMagnetEdges.filter((_, index) => index !== existsIdx);
      setSelectedMagnetEdges(nextHinges);
      setSelectedMagnetVertices([]);
      setSelectedMagnetTargetEdges([]);
      if (magnetMode === 'edge' && nextHinges.length < 2) {
        setMagnetEdgeTargetsConfirmed(false);
      }
      return;
    }

    const nextHinges = selectedMagnetEdges.length === 0 ? [clickedEdge] : [selectedMagnetEdges[0], clickedEdge];
    setSelectedMagnetEdges(nextHinges);
    setSelectedMagnetVertices([]);
    setSelectedMagnetTargetEdges([]);
    if (magnetMode === 'edge') {
      setMagnetEdgeTargetsConfirmed(false);
    }

    if (magnetMode === 'regular' && nextHinges.length === 2 && !magnetRequiresEnter) {
      void commitMagnetRequest({
        mode: 'regular',
        hingeEdges: [nextHinges[0], nextHinges[1]]
      });
    }
  }, [commitMagnetRequest, focus3DNetOnFace, isHingeEdge, magnetEdgeTargetsConfirmed, magnetMode, magnetRequiresEnter, selectedMagnetEdges, selectedMagnetTargetEdges]);

  const handleMagnetSelectVertex = useCallback((faceId: string, vertexIdx: number) => {
    if (magnetMode !== 'vertex' || selectedMagnetEdges.length !== 2) return;
    setLastMagnetAction(null);
    focus3DNetOnFace(faceId);
    const clickedVertex = { faceId, vertexIndex: vertexIdx };
    const existsIdx = selectedMagnetVertices.findIndex(vertex => vertex.faceId === faceId && vertex.vertexIndex === vertexIdx);
    if (existsIdx >= 0) {
      setSelectedMagnetVertices(selectedMagnetVertices.filter((_, index) => index !== existsIdx));
      return;
    }

    const nextVertices = selectedMagnetVertices.length === 0 ? [clickedVertex] : [selectedMagnetVertices[0], clickedVertex];
    setSelectedMagnetVertices(nextVertices);
    if (nextVertices.length === 2 && !magnetRequiresEnter) {
      void commitMagnetRequest({
        mode: 'vertex',
        hingeEdges: [selectedMagnetEdges[0], selectedMagnetEdges[1]],
        targetVertices: [nextVertices[0], nextVertices[1]]
      });
    }
  }, [commitMagnetRequest, focus3DNetOnFace, magnetMode, magnetRequiresEnter, selectedMagnetEdges, selectedMagnetVertices]);

  const visibleNet = useMemo(() => {
      if (!show3D) return { faces: {}, connections: [] };
      
      // Determine which component to show
      let startId = get3DRootId();

      if (!startId || !net.faces[startId]) return { faces: {}, connections: [] };
      
      const connectedIds = getConnectedComponent(net, startId);
      const newFaces: Record<string, PlacedFace> = {};
      connectedIds.forEach(id => { if (net.faces[id]) newFaces[id] = net.faces[id]; });
      const newConns = net.connections.filter(c => connectedIds.has(c.faceAId) && connectedIds.has(c.faceBId));
      return { faces: newFaces, connections: newConns };
  }, [get3DRootId, net, show3D]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }
      if (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') {
        return;
      }
      
      if (matchesShortcut(e, shortcuts.cancel)) {
        e.preventDefault();
        handleEscapeAction();
        return;
      }
      if (matchesShortcut(e, shortcuts.deleteSelection)) {
        e.preventDefault();
        handleDelete();
        return;
      }
      if (matchesShortcut(e, shortcuts.reverseLastMagnet)) {
        e.preventDefault();
        handleReverseLastMagnet();
        return;
      }
      if (matchesShortcut(e, shortcuts.undo)) {
        e.preventDefault();
        undo();
        return;
      }
      if (matchesShortcut(e, shortcuts.redo)) {
        e.preventDefault();
        redo();
        return;
      }
      if (matchesShortcut(e, shortcuts.copy)) {
        e.preventDefault();
        handleCopy();
        return;
      }
      if (matchesShortcut(e, shortcuts.cut)) {
        e.preventDefault();
        handleCut();
        return;
      }
      if (matchesShortcut(e, shortcuts.print)) {
        e.preventDefault();
        setShowPrintModal(true);
        return;
      }
      if (matchesShortcut(e, shortcuts.open)) {
        e.preventDefault();
        loadFileInputRef.current?.click();
        return;
      }
      if (matchesShortcut(e, shortcuts.lassoTool)) {
        e.preventDefault();
        activateTool('lasso');
        return;
      }
      if (matchesShortcut(e, shortcuts.reflectTool)) {
        e.preventDefault();
        activateTool('flip');
        return;
      }
      if (matchesShortcut(e, shortcuts.saveAs)) {
        e.preventDefault();
        void saveNetJson(true);
        return;
      }
      if (matchesShortcut(e, shortcuts.exportMesh)) {
        e.preventDefault();
        setShowExportMeshModal(true);
        return;
      }
      if (matchesShortcut(e, shortcuts.save)) {
        e.preventDefault();
        void saveNetJson(false);
        return;
      }
      if (matchesShortcut(e, shortcuts.rotateTool)) {
        e.preventDefault();
        activateTool('rotate');
        return;
      }
      if (matchesShortcut(e, shortcuts.linkTool)) {
        e.preventDefault();
        activateTool('link');
        return;
      }
      if (matchesShortcut(e, shortcuts.magnetTool)) {
        e.preventDefault();
        activateMagnetTool('regular');
        return;
      }
      if (matchesShortcut(e, shortcuts.magnetVertexTool)) {
        e.preventDefault();
        activateMagnetTool('vertex');
        return;
      }
      if (matchesShortcut(e, shortcuts.magnetEdgeTool)) {
        e.preventDefault();
        activateMagnetTool('edge');
        return;
      }
      if (matchesShortcut(e, shortcuts.bucketTool)) {
        e.preventDefault();
        activateTool('bucket');
        return;
      }
      if (matchesShortcut(e, shortcuts.toggle3D)) {
        e.preventDefault();
        handleToggle3D();
        return;
      }
      if (activeTool === 'magnet' && magnetMode === 'edge' && selectedMagnetEdges.length === 2 && !magnetEdgeTargetsConfirmed && e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setMagnetEdgeTargetsConfirmed(true);
        return;
      }
      if (activeTool === 'magnet' && magnetRequiresEnter && e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const magnetRequestToApply = magnetPreviewState
          ? { request: magnetPreviewState.request, validationError: magnetPreviewState.validationError || null }
          : currentMagnetRequestState;
        if (magnetRequestToApply.request) {
          e.preventDefault();
          void commitMagnetRequest(
            magnetRequestToApply.request,
            net,
            get3DRootId(net),
            magnetPreviewState?.preview ?? null,
            selectedMagnetPreviewIndex
          );
          return;
        }
      }
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key >= '3' && e.key <= '9') {
          e.preventDefault();
          const polygonSides = Number.parseInt(e.key, 10);
          if (polygonSides === 3) activateShapePlacement('triangle');
          else if (polygonSides === 4) activateShapePlacement('square');
          else if (polygonSides === 5) activateShapePlacement('pentagon');
          else if (polygonSides === 6) activateShapePlacement('hexagon');
          else activateShapePlacement(`ngon-${polygonSides}`);
        }
      }
      
      if (activeTool === 'rotate') {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
             if (selectedFaceIds.size > 0) {
                 const root = net.faces[Array.from(selectedFaceIds)[0]];
                 if (root) {
                    e.preventDefault();
                    const comp = getConnectedComponent(net, root.id);
                    const dir: 1 | -1 = e.key === 'ArrowRight' ? 1 : -1;
                    const delta = useEdgeAlignedRotation && !isRegularPolygonFace(root)
                      ? getNextEdgeAlignedDelta(root, dir)
                      : (() => {
                          const step = TWO_PI / root.def.vertices.length;
                          const k = Math.round(root.transform.rotation / step);
                          const targetRot = (k + dir) * step;
                          return targetRot - root.transform.rotation;
                        })();

                    if (delta !== null) {
                      handleRotateFaces(Array.from(comp), delta, true);
                    }
                 }
             }
          }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeTool,
    activateShapePlacement,
    activateTool,
    commitMagnetRequest,
    handleCopy,
    handleCut,
    handleDelete,
    handleEscapeAction,
    handleReverseLastMagnet,
    historyIndex,
    magnetEdgeTargetsConfirmed,
    magnetMode,
    magnetPreviewState,
    currentMagnetRequestState,
    handleToggle3D,
    net,
    magnetRequiresEnter,
    saveNetJson,
    setShowExportMeshModal,
    selectedConnIds,
    selectedFaceIds,
    selectedMagnetEdges,
    selectedMagnetPreviewIndex,
    shortcuts,
    useEdgeAlignedRotation,
    activateMagnetTool,
    get3DRootId
  ]);

  let displayFoldAngle = 0;
  if (selectedConnIds.size > 0) {
      const c = net.connections.find(conn => conn.id === Array.from(selectedConnIds)[0]);
      if (c) displayFoldAngle = c.foldAngle;
  }
  const firstSelectedFace = selectedRootId ? net.faces[selectedRootId] : null;
  const currentRotationDeg = firstSelectedFace ? (firstSelectedFace.transform.rotation * 180 / Math.PI) : 0;
  const selectedFaceIsIrregular = useMemo(() => {
    if (!firstSelectedFace) return false;
    return !isRegularPolygonFace(firstSelectedFace);
  }, [firstSelectedFace]);

  useEffect(() => {
    if (!selectedFaceIsIrregular) {
      setUseEdgeAlignedRotation(false);
    }
  }, [selectedFaceIsIrregular]);

  const displayedMagnetEdges = useMemo(() => [...selectedMagnetEdges, ...selectedMagnetTargetEdges], [selectedMagnetEdges, selectedMagnetTargetEdges]);
  const magnetInstruction = useMemo(() => {
    const confirmSuffix = magnetRequiresEnter ? ' Press Enter to apply.' : '';
    const validationError = currentMagnetRequestState.validationError;
    if (magnetMode === 'regular') {
      if (selectedMagnetEdges.length < 2) {
        return `Regular magnet: select 2 edges sharing a live 3D vertex (${selectedMagnetEdges.length}/2)`;
      }
      return `Regular magnet: choose the intersection in 3D (green = selected, red = alternate)${confirmSuffix}`;
    }
    if (magnetMode === 'vertex') {
      if (selectedMagnetEdges.length < 2) {
        return `Magnet hinges + vertices: select 2 hinge edges (${selectedMagnetEdges.length}/2)`;
      }
      if (selectedMagnetVertices.length < 2) {
        return `Magnet hinges + vertices: select 2 vertices to glue (${selectedMagnetVertices.length}/2)`;
      }
      if (validationError) {
        return `Magnet hinges + vertices: ${validationError}`;
      }
      return `Magnet hinges + vertices: choose the intersection in 3D (green = selected, red = alternate)${confirmSuffix}`;
    }
    if (selectedMagnetEdges.length < 2) {
      return `Magnet hinges + edges: select 2 hinge edges (${selectedMagnetEdges.length}/2)`;
    }
    if (!magnetEdgeTargetsConfirmed) {
      return 'Magnet hinges + edges: press Enter to confirm the hinge edges';
    }
    if (selectedMagnetTargetEdges.length < 2) {
      return `Magnet hinges + edges: select 2 edges to glue (${selectedMagnetTargetEdges.length}/2)`;
    }
    if (validationError) {
      return `Magnet hinges + edges: ${validationError}`;
    }
    return `Magnet hinges + edges: choose the intersection in 3D (green = selected, red = alternate)${confirmSuffix}`;
  }, [currentMagnetRequestState.validationError, magnetEdgeTargetsConfirmed, magnetMode, magnetRequiresEnter, selectedMagnetEdges.length, selectedMagnetTargetEdges.length, selectedMagnetVertices.length]);
  const showBottomBar = (selectedConnIds.size > 0 && activeTool === 'select') || (selectedFaceIds.size > 0 && activeTool === 'rotate');

  return (
    <div className={`flex h-screen w-screen overflow-hidden font-sans ${themes.ui === 'dark' ? 'ui-theme-dark bg-[#141414] text-gray-100' : 'bg-white text-gray-800'}`}>
      <Toolbar 
        activeShape={activeShape}
        onSelectShape={(t) => {
          if (t) {
            activateShapePlacement(t);
          } else {
            setActiveShape(null);
            setActiveTemplate(null);
            setSelectedFaceIds(new Set());
            setSelectedConnIds(new Set());
            setActiveTool('select');
          }
        }}
        onSelectFaceDefinition={selectFaceDefinition}
        onSave={() => {
            void saveNetJson(false);
        }} 
        onSaveAs={() => {
            void saveNetJson(true);
        }}
        onExportMesh={() => setShowExportMeshModal(true)}
        onLoad={(e) => {
              const file = e.target.files?.[0];
             if (file) {
               saveFileHandleRef.current = null;
               const r = new FileReader();
               r.onload = (ev) => {
                 try { 
                     const data = JSON.parse(ev.target?.result as string);
                     setNet({ faces: data.faces || {}, connections: data.connections || [] }); 
                     setHistory([{ net: { faces: data.faces || {}, connections: data.connections || [] }, selFaces: new Set(), selConns: new Set() }]); 
                     setHistoryIndex(0);
                     setFaceColorOverrides({});
                     setActive3DNetRoot(Object.keys(data.faces || {})[0] || null);
                 } catch(e){ console.error(e); alert("Invalid JSON"); }
               };
               r.readAsText(file);
             }
        }}
        loadInputRef={loadFileInputRef}
        activeTool={activeTool}
        onSelectTool={activateTool}
        magnetMode={magnetMode}
        onSelectMagnetMode={activateMagnetTool}
        onEscapeAction={handleEscapeAction}
        onImportShape={handleImportShape}
        onPrint={() => setShowPrintModal(true)}
        uiTheme={themes.ui}
        shortcutTitles={shortcutTitles}
        shortcuts={shortcuts}
        shortcutError={shortcutError}
        onShortcutChange={handleShortcutChange}
        themes={themes}
        onThemeChange={handleThemeChange}
        customThemeColors={customThemeColors}
        onCustomThemeColorChange={handleCustomThemeColorChange}
        otherSettings={otherSettings}
        onOtherSettingChange={handleOtherSettingChange}
      />
      
      <div className="flex-1 flex flex-col relative">
        <div className={`absolute top-4 right-4 z-20 flex gap-2 ${themes.ui === 'dark' ? 'ui-theme-dark' : ''}`}>
             <button onClick={(e) => { (e.currentTarget as HTMLButtonElement).blur(); handleToggle3D(); }}
               className={`flex items-center gap-2 px-3 py-2 rounded shadow-sm border text-sm font-medium transition-colors ${
                 show3D
                   ? 'bg-blue-600 text-white border-blue-700'
                   : themes.ui === 'dark'
                     ? 'bg-[#141414] text-gray-100 border-[#3d3d3d] hover:bg-[#242424]'
                     : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
               }`}>
               <Cuboid size={16} /> {show3D ? 'Hide 3D' : 'Show 3D'}
             </button>
        </div>

        {activeTool !== 'select' && (
          <div className="absolute top-4 left-4 z-20 bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg text-sm font-medium pointer-events-none">
             {activeTool === 'link' && "Select Source Edge, then Target Edge"}
             {activeTool === 'rotate' && "Click a face to select, then use slider or arrow keys"}
             {activeTool === 'flip' && "Click a face to reflect its component"}
             {activeTool === 'lasso' && "Draw around faces to select"}
             {activeTool === 'magnet' && magnetInstruction}
             {activeTool === 'bucket' && "Click a face to recolor all congruent faces"}
          </div>
        )}

        <div className="flex-1 flex flex-row relative min-h-0" ref={containerRef}>
          <div style={{ width: show3D ? `${splitRatio * 100}%` : '100%' }} className="relative h-full transition-[width] duration-75 ease-linear">
            <Canvas2D 
              net={net} onAddFaces={handleAddFaces}
              onSelectConnection={handleSelectConnection} selectedConnectionIds={selectedConnIds}
              activeShape={activeShape} activeTemplate={activeTemplate} faceColorOverrides={faceColorOverrides}
              selectedFaceIds={selectedFaceIds} onSelectionChange={handleSelectionChange}
              onMoveFaces={handleMoveFaces} onRotateFaces={handleRotateFaces}
              activeTool={activeTool} onLinkEdges={handleLinkEdges} onFlipSelection={handleFlipSelection}
              onBucketPickFace={(faceId) => { setBucketTargetFaceId(faceId); focus3DNetOnFace(faceId); }}
              onMagnetSelect={handleMagnetSelect}
              onMagnetSelectVertex={handleMagnetSelectVertex}
              onRequestSelectTool={() => activateTool('select')}
              onRequestPivotFace={requestPivotFace}
              selectedMagnetEdges={displayedMagnetEdges}
              selectedMagnetVertices={selectedMagnetVertices}
              magnetMode={magnetMode}
              magnetEdgeTargetsConfirmed={magnetEdgeTargetsConfirmed}
              backgroundClickExitsTool={otherSettings.backgroundClickExitsTool}
              onEmptyShortcut={handleEmptySpaceShortcut}
              hoveredFaceId={hoveredFaceId} setHoveredFaceId={setHoveredFaceId}
              hoveredEdge={hoveredEdge} setHoveredEdge={setHoveredEdge}
              theme={themes.canvas2d}
              customBackgroundColor={customThemeColors.canvas2d}
            />
          </div>
          
          {show3D && (
            <>
              <div 
                className={`w-1 cursor-col-resize z-30 relative transition-colors flex items-center justify-center group ${themes.ui === 'dark' ? 'bg-slate-600 hover:bg-slate-400' : 'bg-gray-200 hover:bg-blue-400'}`}
                onMouseDown={handleSplitMouseDown}
              >
                  <div className={`w-0.5 h-4 rounded transition-colors ${themes.ui === 'dark' ? 'bg-slate-300 group-hover:bg-white' : 'bg-gray-400 group-hover:bg-white'}`} />
              </div>
              <div style={{ flex: 1 }} className="relative h-full min-w-0">
                  <Viewer3D 
                    net={visibleNet}
                    selectedConnIds={selectedConnIds}
                    selectedFaceIds={selectedFaceIds}
                    onSelectConnection={handleSelectConnection}
                    onSelectFace={handle3DFaceSelection}
                    onClearSelection={handle3DBackgroundClick}
                    rootId={previewRootId} activeTool={activeTool}
                    selectedMagnetEdges={displayedMagnetEdges}
                    selectedMagnetVertices={selectedMagnetVertices}
                    magnetMode={magnetMode}
                    magnetEdgeTargetsConfirmed={magnetEdgeTargetsConfirmed}
                    onMagnetSelect={handleMagnetSelect}
                    onMagnetSelectVertex={handleMagnetSelectVertex}
                    onEmptyShortcut={handleEmptySpaceShortcut}
                    onRequestPivotFace={requestPivotFace}
                    pivotRequest={pivotRequest}
                    magnetGuidePreview={otherSettings.showMagnetGuides ? magnetPreviewState?.preview || null : null}
                    selectedMagnetGuideIndex={selectedMagnetPreviewIndex}
                    onSelectMagnetGuideIndex={index => setSelectedMagnetPreviewIndex(index)}
                    hoveredFaceId={hoveredFaceId} setHoveredFaceId={setHoveredFaceId}
                    hoveredEdge={hoveredEdge} setHoveredEdge={setHoveredEdge}
                    backgroundTheme={themes.view3d}
                    customBackgroundColor={customThemeColors.view3d}
                  />
              </div>
            </>
          )}
        </div>

        {showBottomBar && (
          <div className={`h-14 border-t flex items-center px-4 shadow-[0_-2px_10px_rgba(0,0,0,0.05)] z-20 justify-between shrink-0 ${themes.ui === 'dark' ? 'ui-theme-dark bg-[#141414] border-[#3d3d3d] text-gray-100' : 'bg-white border-gray-200'}`}>
            <div className="flex items-center gap-6">
              {selectedConnIds.size > 0 && activeTool === 'select' ? (
                <>
                   <span className="text-sm font-bold text-gray-600">Fold Angle {selectedConnIds.size > 1 && `(${selectedConnIds.size})`}</span>
                   <div className="flex items-center gap-2">
                      <input 
                        type="range" 
                        min="-180" max="180" step="any"
                        value={displayFoldAngle} 
                        onPointerUp={handleFoldCommit} 
                        onChange={(e) => handleFoldChange(parseFloat(e.target.value))} 
                        className="w-48 accent-blue-600"
                      />
                     <div className={`flex items-center rounded px-2 py-1 border ${themes.ui === 'dark' ? 'bg-[#242424] border-[#3d3d3d]' : 'bg-gray-100 border-gray-200'}`}>
                          <MathInput 
                            value={displayFoldAngle}
                            onChange={handleFoldChange}
                            onCommit={handleFoldCommit}
                            className="w-52 bg-transparent text-right font-mono text-sm"
                          />
                          <span className="text-xs text-gray-500 ml-1 mr-2">deg</span>
                          <button 
                              className="p-1 text-gray-400 hover:text-blue-600 border-l border-gray-200"
                              onClick={() => setShowCalculator(true)}
                              title="Open Calculator"
                          >
                            <Calculator size={14} />
                          </button>
                      </div>
                   </div>
                </>
              ) : selectedFaceIds.size > 0 && activeTool === 'rotate' ? (
                <>
                   <span className="text-sm font-bold text-purple-600">Rotation</span>
                   <div className="flex items-center gap-2">
                      <input 
                        type="range" 
                        min="-180" max="180" step="any"
                        value={currentRotationDeg % 360} 
                        onPointerUp={handleCommitRotation} 
                        onChange={(e) => handleRotateAbs(parseFloat(e.target.value))} 
                        className="w-48 accent-purple-600"
                      />
                      <div className={`flex items-center rounded px-2 py-1 border ${themes.ui === 'dark' ? 'bg-[#242424] border-[#3d3d3d]' : 'bg-gray-100 border-gray-200'}`}>
                         <MathInput
                            value={currentRotationDeg}
                            onChange={handleRotateAbs}
                            onCommit={handleCommitRotation}
                            className="w-28 bg-transparent text-right font-mono text-sm"
                         />
                         <span className="text-xs text-gray-500 ml-1">deg</span>
                      </div>
                   </div>
                   <div className="text-xs text-gray-400 border-l border-gray-300 pl-4 ml-2">
                     {useEdgeAlignedRotation && selectedFaceIsIrregular ? 'Arrow Keys align the next edge horizontally' : 'Use Arrow Keys for precision'}
                   </div>
                   {selectedFaceIsIrregular && (
                     <label className="flex items-center gap-2 border-l border-gray-300 pl-4 ml-2 text-xs text-gray-500">
                       <input
                         type="checkbox"
                         checked={useEdgeAlignedRotation}
                         onChange={event => {
                           setUseEdgeAlignedRotation(event.target.checked);
                           event.currentTarget.blur();
                         }}
                         className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                       />
                       <span>Align arrows to edges</span>
                     </label>
                   )}
                </>
              ) : null}
            </div>
            <div className="text-xs text-gray-400 flex gap-4">
               <span>{Object.keys(net.faces || {}).length} Faces</span>
               <span>{net.connections?.length || 0} Connections</span>
            </div>
          </div>
        )}
      </div>

      {showCalculator && (
        <CalculatorPopup 
           initialValue={displayFoldAngle}
           uiTheme={themes.ui}
           onClose={() => setShowCalculator(false)}
           onApply={(val) => { 
             if (selectedConnIds.size === 0) return;
             const newConns = net.connections.map(c => 
               selectedConnIds.has(c.id) ? { ...c, foldAngle: val } : c
             );
             // Directly push history with new state to avoid race condition with state updates
             pushHistory({ ...net, connections: newConns });
           }}
        />
      )}

      {activeTool === 'bucket' && (
        <div className="absolute left-12 top-[8.5rem] z-40">
          <ColorBucketPopup
            targetFace={bucketTargetFaceId ? net.faces[bucketTargetFaceId]?.def || null : null}
            uiTheme={themes.ui}
            onClose={() => { setActiveTool('select'); setBucketTargetFaceId(null); }}
            onApply={applyBucketColor}
          />
        </div>
      )}
      
      {showPrintModal && (
         <PrintModal 
            net={net}
            selectedFaceIds={selectedFaceIds}
            uiTheme={themes.ui}
            paperTheme={themes.printPaper}
            customPaperColor={customThemeColors.printPaper}
            onClose={() => setShowPrintModal(false)}
         />
      )}

      {showExportMeshModal && (
        <ExportMeshModal
          uiTheme={themes.ui}
          selectedFaceCount={selectedFaceIds.size}
          totalFaceCount={Object.keys(net.faces).length}
          onClose={() => setShowExportMeshModal(false)}
          onExportVertices={exportMeshVerticesCsv}
          onExportIndices={exportMeshIndicesCsv}
        />
      )}
    </div>
  );
};

export default App;
