
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { TrackballControls } from '@react-three/drei';
import * as THREE from 'three';
import { PolyNet, PlacedFace, MagnetEdge, MagnetMode, MagnetVertex } from '../types';
import { compute3DLayout, applyMatrix4, Mat4, MagnetGuidePreview3D } from '../utils/math';
import { ShortcutDefinition, shortcutFromMouseEvent } from '../utils/shortcuts';

// Fix for missing Intrinsic elements in JSX (Three.js + HTML)
declare global {
  namespace JSX {
    interface IntrinsicElements {
      group: any;
      mesh: any;
      meshStandardMaterial: any;
      lineSegments: any;
      edgesGeometry: any;
      lineBasicMaterial: any;
      tubeGeometry: any;
      sphereGeometry: any;
      meshBasicMaterial: any;
      color: any;
      ambientLight: any;
      directionalLight: any;
      pointLight: any;
      [elemName: string]: any;
    }
  }
}

interface Viewer3DProps {
  net: PolyNet;
  selectedConnIds: Set<string>;
  selectedFaceIds: Set<string>;
  onSelectConnection: (id: string | null, multi: boolean) => void;
  onSelectFace: (id: string, multi: boolean) => void;
  onClearSelection?: () => void;
  rootId?: string;
  activeTool: 'select' | 'link' | 'rotate' | 'flip' | 'lasso' | 'magnet' | 'bucket';
  selectedMagnetEdges?: MagnetEdge[];
  selectedMagnetVertices?: MagnetVertex[];
  magnetMode?: MagnetMode;
  magnetEdgeTargetsConfirmed?: boolean;
  onMagnetSelect?: (faceId: string, edgeIdx: number) => void;
  onMagnetSelectVertex?: (faceId: string, vertexIdx: number) => void;
  onEmptyShortcut?: (shortcut: ShortcutDefinition) => void;
  onRequestPivotFace?: (faceId: string) => void;
  pivotRequest?: { faceId: string; nonce: number } | null;
  magnetGuidePreview?: MagnetGuidePreview3D | null;
  selectedMagnetGuideIndex?: number;
  onSelectMagnetGuideIndex?: (index: number) => void;

  // Shared Hover State
  hoveredFaceId?: string | null;
  setHoveredFaceId?: (id: string | null) => void;
  hoveredEdge?: { faceId: string, edgeIndex: number } | null;
  setHoveredEdge?: (edge: { faceId: string, edgeIndex: number } | null) => void;
  backgroundTheme?: 'light' | 'dark' | 'custom';
  customBackgroundColor?: string;
}

function normalizeFaceColor(color: string): { color: string; opacity: number; transparent: boolean; depthWrite: boolean } {
  if (typeof document === 'undefined') {
    return { color, opacity: 1, transparent: false, depthWrite: true };
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    return { color, opacity: 1, transparent: false, depthWrite: true };
  }

  context.fillStyle = '#ffffff';
  context.fillStyle = color;
  const normalized = context.fillStyle;
  const rgbaMatch = normalized.match(/rgba?\(([^)]+)\)/i);
  if (!rgbaMatch) {
    return { color: normalized || color, opacity: 1, transparent: false, depthWrite: true };
  }

  const [r = 255, g = 255, b = 255, a = 1] = rgbaMatch[1].split(',').map(value => Number.parseFloat(value.trim()));
  const opacity = Math.max(0, Math.min(1, Number.isFinite(a) ? a : 1));
  const isActuallyTransparent = opacity < 0.999;
  return {
    color: `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`,
    opacity,
    transparent: isActuallyTransparent,
    depthWrite: !isActuallyTransparent
  };
}

const FaceMesh: React.FC<{ 
    face: PlacedFace, 
    worldMatrix: Mat4, 
    isSelected: boolean,
    isDimmed: boolean,
    isHovered: boolean, 
    onHover: (id: string | null) => void,
    onSelect?: (id: string, multi: boolean) => void,
    onMiddleClick?: (id: string) => void
}> = ({ face, worldMatrix, isSelected, isDimmed, isHovered, onHover, onSelect, onMiddleClick }) => {
  const pointerStateRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    const v = face.def.vertices;
    if (v.length > 0) {
      shape.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) shape.lineTo(v[i].x, v[i].y);
      shape.closePath();
    }
    return new THREE.ShapeGeometry(shape);
  }, [face.def.vertices]);

  const matrix = useMemo(() => {
    const tm = new THREE.Matrix4();
    tm.set(
      worldMatrix[0], worldMatrix[1], worldMatrix[2], worldMatrix[3],
      worldMatrix[4], worldMatrix[5], worldMatrix[6], worldMatrix[7],
      worldMatrix[8], worldMatrix[9], worldMatrix[10], worldMatrix[11],
      worldMatrix[12], worldMatrix[13], worldMatrix[14], worldMatrix[15]
    );
    return tm;
  }, [worldMatrix]);

  const materialProps = useMemo(() => normalizeFaceColor(face.def.color), [face.def.color]);

  return (
    <group matrixAutoUpdate={false} matrix={matrix}>
      <mesh 
        geometry={geometry}
        renderOrder={1}
        onPointerOver={(e: any) => { e.stopPropagation(); onHover(face.id); }}
        onPointerDown={(e: any) => {
          if (e.nativeEvent.button !== 0 && e.nativeEvent.button !== 1) return;
          pointerStateRef.current = {
            x: e.nativeEvent.clientX,
            y: e.nativeEvent.clientY,
            moved: false
          };
        }}
        onPointerMove={(e: any) => {
          const pointerState = pointerStateRef.current;
          if (!pointerState) return;
          const dx = e.nativeEvent.clientX - pointerState.x;
          const dy = e.nativeEvent.clientY - pointerState.y;
          if (dx * dx + dy * dy > 16) {
            pointerState.moved = true;
          }
        }}
        onPointerUp={(e: any) => {
          if (e.nativeEvent.button === 1 && !pointerStateRef.current?.moved) {
            e.stopPropagation();
            onMiddleClick?.(face.id);
          }
          pointerStateRef.current = null;
        }}
        onPointerOut={() => { onHover(null); }}
        onClick={(e: any) => {
          if (e.nativeEvent.button !== 0) return;
          e.stopPropagation();
          if (pointerStateRef.current?.moved) {
            pointerStateRef.current = null;
            return;
          }
          const isMulti = e.nativeEvent.ctrlKey || e.nativeEvent.shiftKey;
          onSelect?.(face.id, isMulti);
          pointerStateRef.current = null;
        }}
      >
        <meshStandardMaterial 
            color={materialProps.color}
            opacity={isDimmed ? Math.max(materialProps.opacity * 0.18, 0.08) : materialProps.opacity}
            transparent={materialProps.transparent || isDimmed}
            depthWrite={isDimmed ? false : materialProps.depthWrite}
            side={THREE.DoubleSide} 
            polygonOffset={!materialProps.transparent}
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
            emissive={isSelected ? "#5b5b5b" : isHovered ? "#3a3a3a" : "#000000"} 
            emissiveIntensity={1}
        />
      </mesh>
      <lineSegments renderOrder={2}>
        <edgesGeometry args={[geometry]} />
        <lineBasicMaterial color="black" linewidth={2} depthWrite={false} transparent opacity={isDimmed ? 0.18 : 1} />
      </lineSegments>
    </group>
  );
};

const EdgeMesh: React.FC<{ 
  start: {x:number,y:number,z:number}, 
  end: {x:number,y:number,z:number}, 
  isSelected: boolean,
  isHovered: boolean,
  onClick: (e: any) => void,
  onHover: (hovering: boolean) => void,
  interactive?: boolean,
  color?: string,
  selectedColor?: string
}> = ({ start, end, isSelected, isHovered, onClick, onHover, interactive = true, color, selectedColor = "#dc2626" }) => {
  const pointerStateRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const curve = useMemo(() => new THREE.LineCurve3(new THREE.Vector3(start.x, start.y, start.z), new THREE.Vector3(end.x, end.y, end.z)), [start, end]);
  
  // Determine color: Custom override > Selected (Red) > Hovered (Orange) > Default (Black/Invisible)
  let finalColor = color;
  if (!finalColor) {
      if (isSelected) finalColor = selectedColor;
      else if (isHovered) finalColor = "#f59e0b"; // Orange
      else finalColor = "black";
  }
  
  // Keep edges interactive even when transparent so users can still pick them.
  const isVisible = isSelected || isHovered || !!color;

  return (
    <mesh 
        renderOrder={4}
        onPointerDown={interactive ? ((e: any) => {
            if (e.nativeEvent.button !== 0) return;
            pointerStateRef.current = {
                x: e.nativeEvent.clientX,
                y: e.nativeEvent.clientY,
                moved: false
            };
        }) : undefined}
        onPointerMove={interactive ? ((e: any) => {
            const pointerState = pointerStateRef.current;
            if (!pointerState) return;
            const dx = e.nativeEvent.clientX - pointerState.x;
            const dy = e.nativeEvent.clientY - pointerState.y;
            if (dx * dx + dy * dy > 16) {
                pointerState.moved = true;
            }
        }) : undefined}
        onPointerUp={interactive ? ((e: any) => {
            if (e.nativeEvent.button === 0) {
                pointerStateRef.current = null;
            }
        }) : undefined}
        onClick={interactive ? ((e: any) => {
            if (e.nativeEvent.button !== 0) return;
            if (pointerStateRef.current?.moved) {
                pointerStateRef.current = null;
                return;
            }
            onClick(e);
            pointerStateRef.current = null;
        }) : undefined}
        onPointerOver={interactive ? ((e: any) => { 
            e.stopPropagation(); 
            document.body.style.cursor='pointer'; 
            onHover(true); 
        }) : undefined}
        onPointerOut={interactive ? ((e: any) => { 
            document.body.style.cursor='auto'; 
            onHover(false); 
        }) : undefined}
    >
       <tubeGeometry args={[curve, 1, 3, 8, false]} />
       <meshBasicMaterial color={finalColor} transparent opacity={isVisible ? 0.8 : 0} depthWrite={false} depthTest={false} />
    </mesh>
  );
};

const VertexMesh: React.FC<{
  position: { x: number; y: number; z: number };
  isSelected: boolean;
  isHovered: boolean;
  renderOrder?: number;
  onHover: (hovering: boolean) => void;
  onClick: () => void;
}> = ({ position, isSelected, isHovered, renderOrder = 5, onHover, onClick }) => {
  const pointerStateRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  return (
    <mesh
      position={[position.x, position.y, position.z]}
      renderOrder={renderOrder}
      onPointerOver={(e: any) => {
        e.stopPropagation();
        onHover(true);
      }}
      onPointerOut={() => onHover(false)}
      onPointerDown={(e: any) => {
        if (e.nativeEvent.button !== 0) return;
        pointerStateRef.current = {
          x: e.nativeEvent.clientX,
          y: e.nativeEvent.clientY,
          moved: false
        };
      }}
      onPointerMove={(e: any) => {
        const pointerState = pointerStateRef.current;
        if (!pointerState) return;
        const dx = e.nativeEvent.clientX - pointerState.x;
        const dy = e.nativeEvent.clientY - pointerState.y;
        if (dx * dx + dy * dy > 16) {
          pointerState.moved = true;
        }
      }}
      onClick={(e: any) => {
        if (e.nativeEvent.button !== 0) return;
        e.stopPropagation();
        if (pointerStateRef.current?.moved) {
          pointerStateRef.current = null;
          return;
        }
        onClick();
        pointerStateRef.current = null;
      }}
    >
      <sphereGeometry args={[5, 14, 14]} />
      <meshBasicMaterial color={isSelected ? '#0ea5e9' : isHovered ? '#f59e0b' : '#ffffff'} depthWrite={false} depthTest={false} />
    </mesh>
  );
};

const AxisTube: React.FC<{ start: THREE.Vector3; end: THREE.Vector3; color: string }> = ({ start, end, color }) => {
  const curve = useMemo(() => new THREE.LineCurve3(start.clone(), end.clone()), [end, start]);
  return (
    <mesh renderOrder={6}>
      <tubeGeometry args={[curve, 1, 0.8, 6, false]} />
      <meshBasicMaterial color={color} transparent opacity={0.95} depthWrite={false} />
    </mesh>
  );
};

const CircleGuide: React.FC<{
  center: { x: number; y: number; z: number };
  axisDirection: { x: number; y: number; z: number };
  radius: number;
  color: string;
}> = ({ center, axisDirection, radius, color }) => {
  const curve = useMemo(() => {
    const axis = new THREE.Vector3(axisDirection.x, axisDirection.y, axisDirection.z).normalize();
    const fallback = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const basisX = new THREE.Vector3().crossVectors(axis, fallback).normalize();
    const basisY = new THREE.Vector3().crossVectors(axis, basisX).normalize();
    const circleRadius = Math.max(radius, 0.0001);
    const points = Array.from({ length: 65 }, (_, index) => {
      const angle = (index / 64) * Math.PI * 2;
      return new THREE.Vector3(center.x, center.y, center.z)
        .addScaledVector(basisX, Math.cos(angle) * circleRadius)
        .addScaledVector(basisY, Math.sin(angle) * circleRadius);
    });
    return new THREE.CatmullRomCurve3(points, true);
  }, [axisDirection.x, axisDirection.y, axisDirection.z, center.x, center.y, center.z, radius]);

  return (
    <mesh renderOrder={7}>
      <tubeGeometry args={[curve, 96, 0.35, 6, true]} />
      <meshBasicMaterial color={color} transparent opacity={0.8} depthWrite={false} />
    </mesh>
  );
};

const MagnetCandidatePoint: React.FC<{
  position: { x: number; y: number; z: number };
  color: string;
  isHovered?: boolean;
  onHover?: (hovering: boolean) => void;
  onClick?: () => void;
}> = ({ position, color, isHovered = false, onHover, onClick }) => (
  <mesh
    position={[position.x, position.y, position.z]}
    renderOrder={8}
    onPointerOver={(event: any) => {
      event.stopPropagation();
      onHover?.(true);
    }}
    onPointerOut={(event: any) => {
      event.stopPropagation();
      onHover?.(false);
    }}
    onClick={(event: any) => {
      event.stopPropagation();
      onClick?.();
    }}
  >
    <sphereGeometry args={[isHovered ? 4.8 : 3.2, 14, 14]} />
    <meshBasicMaterial color={color} depthWrite={false} />
  </mesh>
);

const PivotOverlay: React.FC<{
  controlsRef: React.RefObject<any>;
  active: boolean;
}> = ({ controlsRef, active }) => {
  const [target, setTarget] = React.useState(() => new THREE.Vector3());

  useFrame(() => {
    if (!active || !controlsRef.current) return;
    const nextTarget = controlsRef.current.target as THREE.Vector3;
    if (!nextTarget) return;
    setTarget(previous => {
      if (previous.distanceToSquared(nextTarget) < 0.01) return previous;
      return nextTarget.clone();
    });
  });

  if (!active) return null;

  const axisLength = 80;
  return (
    <group>
      <AxisTube start={new THREE.Vector3(target.x - axisLength, target.y, target.z)} end={new THREE.Vector3(target.x + axisLength, target.y, target.z)} color="#ef4444" />
      <AxisTube start={new THREE.Vector3(target.x, target.y - axisLength, target.z)} end={new THREE.Vector3(target.x, target.y + axisLength, target.z)} color="#22c55e" />
      <AxisTube start={new THREE.Vector3(target.x, target.y, target.z - axisLength)} end={new THREE.Vector3(target.x, target.y, target.z + axisLength)} color="#3b82f6" />
    </group>
  );
};

export const Viewer3D: React.FC<Viewer3DProps> = ({ 
  net, rootId, selectedConnIds, selectedFaceIds, onSelectConnection, onSelectFace,
  onClearSelection,
  activeTool, selectedMagnetEdges, selectedMagnetVertices, magnetMode = 'regular', magnetEdgeTargetsConfirmed = false, onMagnetSelect, onMagnetSelectVertex, onEmptyShortcut, onRequestPivotFace, pivotRequest,
  magnetGuidePreview, selectedMagnetGuideIndex = 0, onSelectMagnetGuideIndex,
  hoveredFaceId, setHoveredFaceId, hoveredEdge, setHoveredEdge,
  backgroundTheme = 'dark', customBackgroundColor
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<any>(null);
  const pivotTargetsByRootRef = useRef<Record<string, THREE.Vector3>>({});
  const lastStoredTargetRef = useRef<THREE.Vector3 | null>(null);
  const lastEmptyClickTimeRef = useRef(0);
  const middlePointerStateRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [isPanning, setIsPanning] = React.useState(false);
  const [hoveredMagnetVertex, setHoveredMagnetVertex] = React.useState<{ faceId: string; vertexIndex: number } | null>(null);
  const [hoveredMagnetGuideIndex, setHoveredMagnetGuideIndex] = React.useState<number | null>(null);
  const layout = useMemo(() => compute3DLayout(net, rootId), [net, rootId]);
  const faceCenters = useMemo(() => Object.fromEntries(
    layout.items
      .filter(item => !!item.face)
      .map(item => {
        const vertices = item.face!.def.vertices.map(vertex => applyMatrix4({ x: vertex.x, y: vertex.y, z: 0 }, item.matrix));
        const center = vertices.reduce((acc, vertex) => ({
          x: acc.x + vertex.x,
          y: acc.y + vertex.y,
          z: acc.z + vertex.z
        }), { x: 0, y: 0, z: 0 });
        return [
          item.face!.id,
          {
            x: center.x / vertices.length,
            y: center.y / vertices.length,
            z: center.z / vertices.length
          }
        ];
      })
  ) as Record<string, { x: number; y: number; z: number }>, [layout.items]);
  const defaultPivotTarget = useMemo(() => {
    const centers = Object.values(faceCenters);
    if (centers.length === 0) {
      return new THREE.Vector3(0, 0, 0);
    }
    const sum = centers.reduce((acc, center) => ({
      x: acc.x + center.x,
      y: acc.y + center.y,
      z: acc.z + center.z
    }), { x: 0, y: 0, z: 0 });
    return new THREE.Vector3(sum.x / centers.length, sum.y / centers.length, sum.z / centers.length);
  }, [faceCenters]);

  useEffect(() => {
    if (!controlsRef.current || !rootId) return;
    const savedTarget = pivotTargetsByRootRef.current[rootId] || defaultPivotTarget;
    controlsRef.current.target.copy(savedTarget);
    if (controlsRef.current.target0?.copy) {
      controlsRef.current.target0.copy(savedTarget);
    }
    controlsRef.current.update?.();
    lastStoredTargetRef.current = savedTarget.clone();
    pivotTargetsByRootRef.current[rootId] = savedTarget.clone();
  }, [defaultPivotTarget, rootId]);

  useEffect(() => {
    if (!pivotRequest || pivotRequest.faceId === '' || !controlsRef.current) return;
    const center = faceCenters[pivotRequest.faceId];
    if (!center) return;
    controlsRef.current.target.set(center.x, center.y, center.z);
    if (controlsRef.current.target0?.copy) {
      controlsRef.current.target0.copy(controlsRef.current.target);
    }
    controlsRef.current.update?.();
    if (rootId) {
      pivotTargetsByRootRef.current[rootId] = controlsRef.current.target.clone();
      lastStoredTargetRef.current = controlsRef.current.target.clone();
    }
  }, [faceCenters, pivotRequest, rootId]);
  const patchedControlsRef = useRef<any>(null);
  const restoreControlsRef = useRef<(() => void) | null>(null);

  const patchControls = useCallback((controls: any) => {
    if (!controls || patchedControlsRef.current === controls) return;

    restoreControlsRef.current?.();

    const originalOnMouseDown = controls.onMouseDown.bind(controls);
    controls.onMouseDown = (event: PointerEvent) => {
      if (event.button === 2) {
        event.preventDefault();
        return;
      }

      if (event.button === 1) {
        if (!controls.domElement || controls.enabled === false) return;
        if (controls._state !== controls.STATE.NONE) return;

        controls._state = controls.STATE.PAN;
        controls._panStart.copy(controls.getMouseOnScreen(event.pageX, event.pageY));
        controls._panEnd.copy(controls._panStart);
        controls.domElement.ownerDocument.addEventListener('pointermove', controls.onPointerMove);
        controls.domElement.ownerDocument.addEventListener('pointerup', controls.onPointerUp);
        controls.dispatchEvent(controls.startEvent);
        return;
      }

      originalOnMouseDown(event);
    };

    restoreControlsRef.current = () => {
      controls.onMouseDown = originalOnMouseDown;
      if (patchedControlsRef.current === controls) {
        patchedControlsRef.current = null;
      }
    };
    patchedControlsRef.current = controls;
  }, []);

  useEffect(() => () => restoreControlsRef.current?.(), []);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const handleChange = () => {
      if (!rootId || !controls.target) return;
      const nextTarget = (controls.target as THREE.Vector3).clone();
      if (lastStoredTargetRef.current && lastStoredTargetRef.current.distanceToSquared(nextTarget) < 1e-8) {
        return;
      }
      pivotTargetsByRootRef.current[rootId] = nextTarget;
      lastStoredTargetRef.current = nextTarget;
    };

    controls.addEventListener('change', handleChange);
    return () => {
      controls.removeEventListener('change', handleChange);
    };
  }, [rootId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const preventAuxMouseDefaults = (event: MouseEvent) => {
      if (event.button === 1 || event.button === 2) {
        event.preventDefault();
      }
    };

    const preventContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 1) return;
      middlePointerStateRef.current = {
        x: event.clientX,
        y: event.clientY,
        moved: false
      };
      setIsPanning(false);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const pointerState = middlePointerStateRef.current;
      if (!pointerState) return;
      const dx = event.clientX - pointerState.x;
      const dy = event.clientY - pointerState.y;
      if (dx * dx + dy * dy > 9) {
        pointerState.moved = true;
        setIsPanning(true);
      }
    };

    const handlePointerUp = () => {
      middlePointerStateRef.current = null;
      setIsPanning(false);
    };

    container.addEventListener('pointerdown', preventAuxMouseDefaults, true);
    container.addEventListener('pointerup', preventAuxMouseDefaults, true);
    container.addEventListener('pointerdown', handlePointerDown, true);
    container.addEventListener('pointermove', handlePointerMove, true);
    container.addEventListener('pointerup', handlePointerUp, true);
    container.addEventListener('mousedown', preventAuxMouseDefaults, true);
    container.addEventListener('mouseup', preventAuxMouseDefaults, true);
    container.addEventListener('auxclick', preventAuxMouseDefaults, true);
    container.addEventListener('contextmenu', preventContextMenu, true);

    return () => {
      container.removeEventListener('pointerdown', preventAuxMouseDefaults, true);
      container.removeEventListener('pointerup', preventAuxMouseDefaults, true);
      container.removeEventListener('pointerdown', handlePointerDown, true);
      container.removeEventListener('pointermove', handlePointerMove, true);
      container.removeEventListener('pointerup', handlePointerUp, true);
      container.removeEventListener('mousedown', preventAuxMouseDefaults, true);
      container.removeEventListener('mouseup', preventAuxMouseDefaults, true);
      container.removeEventListener('auxclick', preventAuxMouseDefaults, true);
      container.removeEventListener('contextmenu', preventContextMenu, true);
    };
  }, []);

  const interactiveEdges = useMemo(() => {
     const edges: { id: string, faceId: string, edgeIdx: number, start: {x:number,y:number,z:number}, end: {x:number,y:number,z:number}, isConnection: boolean, connId?: string }[] = [];
     const { matrices } = layout;
     const processedConnIds = new Set<string>();

     // Helper to avoid duplicate edges (A->B vs B->A)
     // We only add edge if it hasn't been added via a connection
     
     // First, map all connections to their visual endpoints to handle shared edges as single entities
     const connMap = new Map<string, string>(); // "faceId:edgeIdx" -> connId
     
     net.connections.forEach(c => {
         connMap.set(`${c.faceAId}:${c.edgeAIndex}`, c.id);
         connMap.set(`${c.faceBId}:${c.edgeBIndex}`, c.id);
     });

     // Iterate all faces in layout
     layout.items.forEach(item => {
         if (!item.face) return;
         const f = item.face;
         const mat = item.matrix;
         
         f.def.vertices.forEach((v, i) => {
             const nextV = f.def.vertices[(i + 1) % f.def.vertices.length];
             const start = applyMatrix4({x: v.x, y: v.y, z: 0}, mat);
             const end = applyMatrix4({x: nextV.x, y: nextV.y, z: 0}, mat);
             
             const key = `${f.id}:${i}`;
             const connId = connMap.get(key);
             
             if (connId) {
                 if (!processedConnIds.has(connId)) {
                     processedConnIds.add(connId);
                     edges.push({
                         id: connId, // Use connection ID for shared edges
                         faceId: f.id,
                         edgeIdx: i,
                         start, end,
                         isConnection: true,
                         connId: connId
                     });
                 }
             } else {
                 // Boundary edge
                 edges.push({
                     id: key,
                     faceId: f.id,
                     edgeIdx: i,
                     start, end,
                     isConnection: false
                 });
             }
         });
     });

     return edges;
  }, [net, layout]);

  const isEdgeSelected = (id: string, isConn: boolean) => {
      if (activeTool === 'magnet' && selectedMagnetEdges) {
          // Magnet edge IDs are faceId:edgeIdx
          // If this is a shared edge (isConn=true), 'id' is the connId.
          // We need to check if *any* face/edge pair associated with this conn is in magnet selection.
          if (isConn) {
             const conn = net.connections.find(c => c.id === id);
             if (conn) {
                 return selectedMagnetEdges.some(e => 
                     (e.faceId === conn.faceAId && e.edgeIndex === conn.edgeAIndex) ||
                     (e.faceId === conn.faceBId && e.edgeIndex === conn.edgeBIndex)
                 );
             }
          }
          return selectedMagnetEdges.some(e => `${e.faceId}:${e.edgeIndex}` === id);
      }
      return isConn && selectedConnIds.has(id);
  };

  const isEdgeHovered = (id: string, faceId: string, edgeIdx: number, isConn: boolean) => {
      if (showMagnetVertices || hoveredMagnetVertex) return false;
      // Hover logic matches by faceId/edgeIdx. 
      // If it's a shared edge, hover on *either* side should highlight it.
      if (!hoveredEdge) return false;
      
      if (isConn) {
          const conn = net.connections.find(c => c.id === id);
          if (conn) {
              return (hoveredEdge.faceId === conn.faceAId && hoveredEdge.edgeIndex === conn.edgeAIndex) ||
                     (hoveredEdge.faceId === conn.faceBId && hoveredEdge.edgeIndex === conn.edgeBIndex);
          }
      }
      return hoveredEdge.faceId === faceId && hoveredEdge.edgeIndex === edgeIdx;
  };

  const showMagnetVertices = activeTool === 'magnet' && magnetMode === 'vertex' && selectedMagnetEdges && selectedMagnetEdges.length === 2;
  const magnetVertexEntries = useMemo(() => {
    if (!showMagnetVertices) return [];
    return layout.items.flatMap(item => {
      if (!item.face) return [];
      return item.face.def.vertices.map((_, vertexIndex) => {
        const isSelected = !!selectedMagnetVertices?.some(vertex => vertex.faceId === item.face!.id && vertex.vertexIndex === vertexIndex);
        const isHovered = hoveredMagnetVertex?.faceId === item.face!.id && hoveredMagnetVertex.vertexIndex === vertexIndex;
        return {
          key: `${item.face!.id}:vertex:${vertexIndex}`,
          faceId: item.face!.id,
          vertexIndex,
          position: applyMatrix4({ x: item.face!.def.vertices[vertexIndex].x, y: item.face!.def.vertices[vertexIndex].y, z: 0 }, item.matrix),
          isSelected,
          isHovered
        };
      });
    }).sort((firstVertex, secondVertex) => {
      const firstPriority = firstVertex.isSelected ? 2 : firstVertex.isHovered ? 1 : 0;
      const secondPriority = secondVertex.isSelected ? 2 : secondVertex.isHovered ? 1 : 0;
      return firstPriority - secondPriority;
    });
  }, [hoveredMagnetVertex, layout.items, selectedMagnetVertices, showMagnetVertices]);
  const backgroundColor = backgroundTheme === 'custom'
    ? (customBackgroundColor || '#111827')
    : backgroundTheme === 'dark'
      ? '#111827'
      : '#e5e7eb';

  useEffect(() => {
    if (!showMagnetVertices) {
      setHoveredMagnetVertex(null);
    }
  }, [showMagnetVertices]);

  useEffect(() => {
    if (activeTool !== 'magnet') {
      setHoveredMagnetGuideIndex(null);
    }
  }, [activeTool]);

  const handleEmptyPointerMissed = (event: any) => {
    if (event?.button !== 0) return;
    const now = performance.now();
    if (now - lastEmptyClickTimeRef.current <= 320) {
      lastEmptyClickTimeRef.current = 0;
      const shortcut = shortcutFromMouseEvent(event.nativeEvent || event, 2);
      if (shortcut) {
        onEmptyShortcut?.(shortcut);
      }
      return;
    }
    lastEmptyClickTimeRef.current = now;
    const shortcut = shortcutFromMouseEvent(event.nativeEvent || event, 1);
    if (shortcut) {
      onEmptyShortcut?.(shortcut);
    }
    onClearSelection?.();
  };

  return (
    <div ref={containerRef} className={`flex-1 relative h-full ${backgroundTheme === 'dark' ? 'bg-gray-900' : backgroundTheme === 'light' ? 'bg-gray-100' : ''}`} style={backgroundTheme === 'custom' ? { backgroundColor } : undefined} onContextMenu={e => e.preventDefault()}>
      <Canvas shadows camera={{ position: [0, 0, 500], fov: 45, near: 1, far: 20000 }} onPointerMissed={handleEmptyPointerMissed}>
        <color attach="background" args={[backgroundColor]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[100, 200, 100]} intensity={0.8} />
        <directionalLight position={[-100, -200, -100]} intensity={0.5} />
        <pointLight position={[200, 200, 200]} intensity={1} />
        <pointLight position={[-200, -200, 100]} intensity={0.5} />
        <TrackballControls
          ref={instance => {
            controlsRef.current = instance;
            if (instance) {
              patchControls(instance);
            } else {
              restoreControlsRef.current?.();
            }
          }}
          makeDefault
          staticMoving
          rotateSpeed={4}
          zoomSpeed={1.3}
          panSpeed={1.1}
        />
        <PivotOverlay controlsRef={controlsRef} active={isPanning} />
        <group>
            {layout.items.map(item => {
               if (!item.face) return null;
               return (
                 <FaceMesh 
                   key={item.face.id} 
                   face={item.face} 
                    worldMatrix={item.matrix} 
                    isSelected={selectedFaceIds.has(item.face.id)}
                   isDimmed={isPanning}
                   isHovered={hoveredFaceId === item.face.id}
                   onHover={(id) => setHoveredFaceId && setHoveredFaceId(id)}
                   onSelect={(faceId, multi) => {
                     if (activeTool === 'select' || activeTool === 'rotate' || activeTool === 'flip' || activeTool === 'bucket' || activeTool === 'link' || activeTool === 'lasso' || activeTool === 'magnet') {
                       onSelectFace(faceId, multi);
                     }
                   }}
                   onMiddleClick={faceId => onRequestPivotFace?.(faceId)}
                 />
               );
            })}
            {interactiveEdges.map(e => (
              <EdgeMesh 
                key={e.id} 
                start={e.start} 
                end={e.end} 
                isSelected={isEdgeSelected(e.id, e.isConnection)}
                isHovered={isEdgeHovered(e.id, e.faceId, e.edgeIdx, e.isConnection)}
                interactive={!showMagnetVertices}
                onHover={(hovering) => {
                  if (!setHoveredEdge || showMagnetVertices) return;
                  setHoveredEdge(hovering ? { faceId: e.faceId, edgeIndex: e.edgeIdx } : null);
                }}
                onClick={(ev) => { 
                    if (showMagnetVertices) return;
                    ev.stopPropagation(); 
                    if (activeTool === 'magnet' && onMagnetSelect) {
                        onMagnetSelect(e.faceId, e.edgeIdx);
                    } else if (activeTool === 'select' && e.isConnection) {
                        const isMulti = ev.nativeEvent.ctrlKey || ev.nativeEvent.shiftKey;
                        onSelectConnection(e.id, isMulti);
                    }
                }}
                selectedColor={activeTool === 'magnet' ? '#0ea5e9' : '#dc2626'}
              />
            ))}
            {showMagnetVertices && magnetVertexEntries.map(vertex => (
              <VertexMesh
                key={vertex.key}
                position={vertex.position}
                isSelected={vertex.isSelected}
                isHovered={vertex.isHovered}
                renderOrder={vertex.isSelected ? 7 : vertex.isHovered ? 6 : 5}
                onHover={hovering => {
                  setHoveredMagnetVertex(hovering ? { faceId: vertex.faceId, vertexIndex: vertex.vertexIndex } : null);
                  if (hovering) {
                    setHoveredEdge?.(null);
                  }
                }}
                onClick={() => onMagnetSelectVertex?.(vertex.faceId, vertex.vertexIndex)}
              />
            ))}
            {activeTool === 'magnet' && magnetGuidePreview?.circles.map((circle, index) => (
              <CircleGuide
                key={`magnet-circle-${index}`}
                center={circle.center}
                axisDirection={circle.axisDirection}
                radius={circle.radius}
                color={circle.isValid ? '#22c55e' : '#ef4444'}
              />
            ))}
            {activeTool === 'magnet' && magnetGuidePreview?.candidates.map((candidate, candidateIndex) => (
              <group key={`magnet-candidate-${candidateIndex}`}>
                {candidate.points.map((point, pointIndex) => (
                  <MagnetCandidatePoint
                    key={`magnet-point-${candidateIndex}-${pointIndex}`}
                    position={point}
                    color={
                      candidateIndex === selectedMagnetGuideIndex
                        ? (hoveredMagnetGuideIndex === candidateIndex ? '#16a34a' : '#22c55e')
                        : (hoveredMagnetGuideIndex === candidateIndex ? '#f59e0b' : '#ef4444')
                    }
                    isHovered={hoveredMagnetGuideIndex === candidateIndex}
                    onHover={hovering => setHoveredMagnetGuideIndex(hovering ? candidateIndex : null)}
                    onClick={candidateIndex === selectedMagnetGuideIndex ? undefined : () => onSelectMagnetGuideIndex?.(candidateIndex)}
                  />
                ))}
              </group>
            ))}
        </group>
      </Canvas>
    </div>
  );
};
