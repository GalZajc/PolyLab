
import React, { useRef, useState, useEffect } from 'react';
import { PolyNet, FaceDefinition, Point2D, ShapeType, PlacedFace, Connection, MagnetEdge, MagnetMode, MagnetVertex } from '../types';
import { 
  getShapeDefinition, createTransform2D, applyTransform2D, 
  getEdgeWorldPoints, calculateSnap, vecLen, vecSub, getFaceCentroid, isPointInRect, isPointInPolygon,
  vecAdd, distPointToSegment, matMul3, invert3, edgesHaveMatchingLength, applyFaceColorOverride
} from '../utils/math';
import { ShortcutDefinition, shortcutFromMouseEvent } from '../utils/shortcuts';

interface Canvas2DProps {
  net: PolyNet;
  onAddFaces: (faces: PlacedFace[], connections: Connection[]) => void;
  onSelectConnection: (connId: string | null, multi: boolean) => void;
  selectedConnectionIds: Set<string>;
  activeShape: ShapeType | null;
  activeTemplate: { faces: PlacedFace[], connections: Connection[] } | null;
  faceColorOverrides?: Record<string, string>;
  selectedFaceIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onMoveFaces: (ids: string[], delta: Point2D) => void;
  onRotateFaces: (ids: string[], angle: number, commit?: boolean) => void;
  
  activeTool: 'select' | 'link' | 'rotate' | 'flip' | 'lasso' | 'magnet' | 'bucket';
  onLinkEdges: (faceA: string, edgeA: number, faceB: string, edgeB: number) => void;
  onFlipSelection: (ids: Set<string>) => void;
  onBucketPickFace?: (faceId: string) => void;
  onMagnetSelect?: (faceId: string, edgeIdx: number) => void;
  onMagnetSelectVertex?: (faceId: string, vertexIdx: number) => void;
  onRequestSelectTool?: () => void;
  onRequestPivotFace?: (faceId: string) => void;
  selectedMagnetEdges?: MagnetEdge[];
  selectedMagnetVertices?: MagnetVertex[];
  magnetMode?: MagnetMode;
  magnetEdgeTargetsConfirmed?: boolean;
  backgroundClickExitsTool?: boolean;
  onEmptyShortcut?: (shortcut: ShortcutDefinition) => void;

  // Shared Hover State
  hoveredFaceId?: string | null;
  setHoveredFaceId?: (id: string | null) => void;
  hoveredEdge?: { faceId: string, edgeIndex: number } | null;
  setHoveredEdge?: (edge: { faceId: string, edgeIndex: number } | null) => void;
  theme?: 'light' | 'dark' | 'custom';
  customBackgroundColor?: string;
}

const SNAP_THRESHOLD = 20;
const generateId = () => Math.random().toString(36).substring(2, 9);

const playPlaceSound = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {
    console.error("Audio context failed", e);
  }
};

export const Canvas2D: React.FC<Canvas2DProps> = ({ 
  net, onAddFaces, onSelectConnection, selectedConnectionIds, 
  activeShape, activeTemplate, faceColorOverrides, selectedFaceIds, onSelectionChange, onMoveFaces, onRotateFaces,
  activeTool, onLinkEdges, onFlipSelection, onBucketPickFace, onMagnetSelect, onMagnetSelectVertex, onRequestSelectTool, onRequestPivotFace, selectedMagnetEdges, selectedMagnetVertices,
  magnetMode = 'regular', magnetEdgeTargetsConfirmed = false, backgroundClickExitsTool = false, onEmptyShortcut,
  hoveredEdge, setHoveredEdge, hoveredFaceId, setHoveredFaceId,
  theme = 'light', customBackgroundColor
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [pan, setPan] = useState({ x: 400, y: 300 });
  const [zoom, setZoom] = useState(1);
  const [mousePos, setMousePos] = useState<Point2D>({ x: 0, y: 0 });
  
  const [preview, setPreview] = useState<{
    transform: { x: number, y: number, rotation: number };
    parentId: string;
    parentEdgeIdx: number;
    childEdgeIdx: number;
    templateFaceIdx: number; // Which face in the template is being snapped
  } | null>(null);

  const [interactionMode, setInteractionMode] = useState<'none' | 'panning' | 'selecting' | 'moving' | 'lasso'>('none');
  const dragStartRef = useRef<{x:number, y:number} | null>(null);
  const [hoveredMagnetVertex, setHoveredMagnetVertex] = useState<{ faceId: string; vertexIndex: number } | null>(null);
  
  // Lasso State
  const [lassoPath, setLassoPath] = useState<Point2D[]>([]);
  
  // State for Link Tool
  const [linkSource, setLinkSource] = useState<{ faceId: string, edgeIndex: number } | null>(null);

  useEffect(() => {
    if (activeTool !== 'link') {
      setLinkSource(null);
    }
  }, [activeTool]);

  useEffect(() => {
    if (activeTool !== 'magnet' || magnetMode !== 'vertex' || !selectedMagnetEdges || selectedMagnetEdges.length !== 2) {
      setHoveredMagnetVertex(null);
    }
  }, [activeTool, magnetMode, selectedMagnetEdges]);
  
  // Derived active faces from template or shape
  const activeFaces = activeTemplate
    ? activeTemplate.faces.map(face => ({ ...face, def: applyFaceColorOverride(face.def, faceColorOverrides) }))
    : (activeShape ? [{
        id: 'ghost',
        def: applyFaceColorOverride(getShapeDefinition(activeShape), faceColorOverrides),
        transform: { x: 0, y: 0, rotation: 0 },
        parentId: null, parentEdgeIndex: null, myEdgeIndex: null
      } as PlacedFace] : []);
  
  const isPlacing = activeFaces.length > 0;

  const toWorld = (clientX: number, clientY: number) => {
    if (!svgRef.current) return {x:0, y:0};
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom
    };
  };

  const isPointInFace = (pt: Point2D, face: PlacedFace) => {
    if (!face || !face.transform) return false;
    const tx = createTransform2D(face.transform.x, face.transform.y, face.transform.rotation);
    const worldVerts = face.def.vertices.map(v => applyTransform2D(tx, v));
    return isPointInPolygon(pt, worldVerts);
  };

  const getClickedFaceId = (worldPos: Point2D) => {
    const faces = Object.values(net.faces) as PlacedFace[];
    for (let i = faces.length - 1; i >= 0; i--) {
      if (isPointInFace(worldPos, faces[i])) {
        return faces[i].id;
      }
    }
    return null;
  };

  const getClickedConnectionId = (worldPos: Point2D) => {
    const clickTolerance = 5 / zoom;
    for (const conn of net.connections) {
      const face = net.faces[conn.faceAId];
      if (!face) continue;
      const [p1, p2] = getEdgeWorldPoints(
        face.def.vertices,
        createTransform2D(face.transform.x, face.transform.y, face.transform.rotation),
        conn.edgeAIndex
      );
      if (distPointToSegment(worldPos, p1, p2) < clickTolerance) {
        return conn.id;
      }
    }
    return null;
  };

  const getClickedVertex = (worldPos: Point2D) => {
    const clickTolerance = Math.max(6, 14 / zoom);
    const faces = Object.values(net.faces) as PlacedFace[];
    for (let faceIndex = faces.length - 1; faceIndex >= 0; faceIndex -= 1) {
      const face = faces[faceIndex];
      const tx = createTransform2D(face.transform.x, face.transform.y, face.transform.rotation);
      for (let vertexIndex = 0; vertexIndex < face.def.vertices.length; vertexIndex += 1) {
        const worldVertex = applyTransform2D(tx, face.def.vertices[vertexIndex]);
        if (Math.hypot(worldVertex.x - worldPos.x, worldVertex.y - worldPos.y) <= clickTolerance) {
          return { faceId: face.id, vertexIndex };
        }
      }
    }
    return null;
  };

  const handleSelectMouseDown = (worldPos: Point2D, isMulti: boolean) => {
    const clickedEdgeConnId = getClickedConnectionId(worldPos);
    if (clickedEdgeConnId) {
      onSelectConnection(clickedEdgeConnId, isMulti);
      return;
    }

    const clickedFaceId = getClickedFaceId(worldPos);

    if (clickedFaceId) {
      if (isMulti) {
        const newSet = new Set(selectedFaceIds);
        if (newSet.has(clickedFaceId)) newSet.delete(clickedFaceId);
        else newSet.add(clickedFaceId);
        onSelectionChange(newSet);
      } else if (!selectedFaceIds.has(clickedFaceId)) {
        onSelectionChange(new Set([clickedFaceId]));
      }
      setInteractionMode('moving');
      dragStartRef.current = { x: worldPos.x, y: worldPos.y };
      return;
    }

    onSelectionChange(new Set());
    setInteractionMode('selecting');
    dragStartRef.current = { x: worldPos.x, y: worldPos.y };
    setLassoPath([worldPos]);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const worldPos = toWorld(e.clientX, e.clientY);
    const isMulti = e.ctrlKey || e.shiftKey;
    
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      setInteractionMode('panning');
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    // --- Placement Logic (Paste / Add Shape) ---
    if (isPlacing && e.button === 0) {
      const facesToAdd: PlacedFace[] = [];
      const connsToAdd: Connection[] = [];
      const idMap = new Map<string, string>();
      
      // 1. Generate new IDs
      activeFaces.forEach((f: PlacedFace) => idMap.set(f.id, generateId()));

      // 2. Determine Transformation for the Group
      let anchorIdx = 0;
      let targetTransform = { x: worldPos.x, y: worldPos.y, rotation: activeFaces[0].transform.rotation };
      
      if (preview) {
        anchorIdx = preview.templateFaceIdx;
        targetTransform = preview.transform;
      } else {
        targetTransform = {
           x: worldPos.x,
           y: worldPos.y,
           rotation: activeFaces[0].transform.rotation
        };
      }

      const anchorFace = activeFaces[anchorIdx];
      const tAnchorOriginal = createTransform2D(anchorFace.transform.x, anchorFace.transform.y, anchorFace.transform.rotation);
      const tTarget = createTransform2D(targetTransform.x, targetTransform.y, targetTransform.rotation);
      const tAnchorInv = invert3(tAnchorOriginal);
      const groupMatrix = matMul3(tTarget, tAnchorInv);

      // 3. Create new faces with updated transforms and IDs
      activeFaces.forEach((f: PlacedFace, idx: number) => {
         const oldTx = createTransform2D(f.transform.x, f.transform.y, f.transform.rotation);
         const newTx = matMul3(groupMatrix, oldTx);
         
         const x = newTx[2];
         const y = newTx[5];
         const rot = Math.atan2(newTx[3], newTx[0]);

         const newId = idMap.get(f.id)!;
         
         let newParentId = null;
         let newParentEdgeIndex = null;
         let newMyEdgeIndex = null;

         if (f.parentId && idMap.has(f.parentId)) {
            newParentId = idMap.get(f.parentId)!;
            newParentEdgeIndex = f.parentEdgeIndex;
            newMyEdgeIndex = f.myEdgeIndex;
         }

         if (preview && idx === anchorIdx) {
            newParentId = preview.parentId;
            newParentEdgeIndex = preview.parentEdgeIdx;
            newMyEdgeIndex = preview.childEdgeIdx;
            
            connsToAdd.push({
               id: generateId(),
               faceAId: preview.parentId,
               edgeAIndex: preview.parentEdgeIdx,
               faceBId: newId,
               edgeBIndex: preview.childEdgeIdx,
               foldAngle: 0
            });
         }

         facesToAdd.push({
            ...f,
            id: newId,
            parentId: newParentId,
            parentEdgeIndex: newParentEdgeIndex,
            myEdgeIndex: newMyEdgeIndex,
            transform: { x, y, rotation: rot }
         });
      });

      // 4. Restore Internal Connections
      if (activeTemplate && activeTemplate.connections) {
         activeTemplate.connections.forEach(c => {
             if (idMap.has(c.faceAId) && idMap.has(c.faceBId)) {
                 connsToAdd.push({
                    id: generateId(),
                    faceAId: idMap.get(c.faceAId)!,
                    edgeAIndex: c.edgeAIndex,
                    faceBId: idMap.get(c.faceBId)!,
                    edgeBIndex: c.edgeBIndex,
                    foldAngle: c.foldAngle
                 });
             }
         });
      }
      
      onAddFaces(facesToAdd, connsToAdd);
      playPlaceSound();
      return;
    }

    // --- Lasso Tool ---
    if (activeTool === 'lasso') {
       if (e.button === 0) {
          const clickedFaceId = getClickedFaceId(worldPos);
          if (clickedFaceId && backgroundClickExitsTool) {
            onRequestSelectTool?.();
            handleSelectMouseDown(worldPos, isMulti);
            return;
          }
          setInteractionMode('lasso');
          setLassoPath([worldPos]);
          onSelectionChange(new Set());
       }
       return;
    }

    // --- Link Tool ---
    if (activeTool === 'link') {
       if (e.button === 0 && hoveredEdge) {
          if (!linkSource) {
             setLinkSource(hoveredEdge);
          } else {
             if (linkSource.faceId !== hoveredEdge.faceId) {
                onLinkEdges(linkSource.faceId, linkSource.edgeIndex, hoveredEdge.faceId, hoveredEdge.edgeIndex);
             }
             setLinkSource(null);
          }
       } else if (e.button === 2) {
          setLinkSource(null);
       } else if (e.button === 0) {
          const clickedFaceId = getClickedFaceId(worldPos);
          if (clickedFaceId && backgroundClickExitsTool) {
            setLinkSource(null);
            onRequestSelectTool?.();
            handleSelectMouseDown(worldPos, isMulti);
          }
       }
       return;
    }

    if (activeTool === 'magnet') {
      if (e.button === 0 && magnetMode === 'vertex' && selectedMagnetEdges && selectedMagnetEdges.length === 2) {
        const clickedVertex = getClickedVertex(worldPos);
        if (clickedVertex) {
          onMagnetSelectVertex?.(clickedVertex.faceId, clickedVertex.vertexIndex);
          return;
        }
      }
      if (e.button === 0 && hoveredEdge) {
        onMagnetSelect?.(hoveredEdge.faceId, hoveredEdge.edgeIndex);
        return;
      }
      if (e.button === 0) {
        if (backgroundClickExitsTool) {
          onRequestSelectTool?.();
          handleSelectMouseDown(worldPos, isMulti);
        }
      }
      return;
    }

    // --- Rotate Tool ---
    if (activeTool === 'rotate') {
      if (e.button === 0) {
         let clickedFaceId: string | null = null;
         const faces = Object.values(net.faces) as PlacedFace[];
         for (let i = faces.length - 1; i >= 0; i--) {
            if (isPointInFace(worldPos, faces[i])) {
               clickedFaceId = faces[i].id;
               break;
            }
         }
         onSelectionChange(clickedFaceId ? new Set([clickedFaceId]) : new Set());
      }
      return;
    }
    
    // --- Flip Tool ---
    if (activeTool === 'flip') {
       if (e.button === 0) {
         if (selectedFaceIds.size > 0) {
             onFlipSelection(selectedFaceIds);
         } else {
            let clickedFaceId: string | null = null;
            const faces = Object.values(net.faces) as PlacedFace[];
            for (let i = faces.length - 1; i >= 0; i--) {
               if (isPointInFace(worldPos, faces[i])) {
                  clickedFaceId = faces[i].id;
                  break;
               }
            }
            if (clickedFaceId) onFlipSelection(new Set([clickedFaceId]));
         }
       }
       return;
    }

    // --- Bucket Tool ---
    if (activeTool === 'bucket') {
      if (e.button === 0) {
        const faces = Object.values(net.faces) as PlacedFace[];
        for (let i = faces.length - 1; i >= 0; i -= 1) {
          if (isPointInFace(worldPos, faces[i])) {
            onBucketPickFace?.(faces[i].id);
            return;
          }
        }
      }
      return;
    }

    // --- Default Select/Move ---
    if (activeTool === 'select') {
       if (!getClickedConnectionId(worldPos) && !getClickedFaceId(worldPos)) {
         const shortcut = shortcutFromMouseEvent(e.nativeEvent, 1);
         if (shortcut) {
           onEmptyShortcut?.(shortcut);
         }
       }
       handleSelectMouseDown(worldPos, isMulti);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const worldPos = toWorld(e.clientX, e.clientY);
    setMousePos(worldPos);

    // Hover Logic
    if (setHoveredEdge && setHoveredFaceId) {
        const hoveredVertex = magnetMode === 'vertex' && selectedMagnetEdges && selectedMagnetEdges.length === 2
          ? getClickedVertex(worldPos)
          : null;
        setHoveredMagnetVertex(hoveredVertex);

        // Edge Detection
        const HOVER_DIST = 10 / zoom;
        let closestEdge = null;
        let minD = HOVER_DIST;

        if (!hoveredVertex) {
          Object.values(net.faces).forEach((f: PlacedFace) => {
              if (!f || !f.transform) return;
              const tx = createTransform2D(f.transform.x, f.transform.y, f.transform.rotation);
              f.def.vertices.forEach((_, idx) => {
                  const [p1, p2] = getEdgeWorldPoints(f.def.vertices, tx, idx);
                  const d = distPointToSegment(worldPos, p1, p2);
                  if (d < minD) {
                      minD = d;
                      closestEdge = { faceId: f.id, edgeIndex: idx };
                  }
              });
          });
        }
        setHoveredEdge(closestEdge);

        // Face Detection
        let foundFaceId: string | null = null;
        // Reverse iterate to find top-most face
        const faces = Object.values(net.faces) as PlacedFace[];
        for (let i = faces.length - 1; i >= 0; i--) {
            if (isPointInFace(worldPos, faces[i])) {
                foundFaceId = faces[i].id;
                break;
            }
        }
        setHoveredFaceId(foundFaceId);
    }

    if (interactionMode === 'panning' && dragStartRef.current) {
       const dx = e.clientX - dragStartRef.current.x;
       const dy = e.clientY - dragStartRef.current.y;
       
       setPan(prev => ({
         x: prev.x + dx,
         y: prev.y + dy
       }));
       dragStartRef.current = { x: e.clientX, y: e.clientY };
       return;
    }

    if (interactionMode === 'moving' && dragStartRef.current && selectedFaceIds.size > 0) {
       const delta = vecSub(worldPos, dragStartRef.current);
       onMoveFaces(Array.from(selectedFaceIds), delta);
       dragStartRef.current = worldPos;
       return;
    }
    
    if (interactionMode === 'lasso' || interactionMode === 'selecting') {
       setLassoPath(prev => [...prev, worldPos]);
       return;
    }

    if (isPlacing) {
       let bestDist = SNAP_THRESHOLD / zoom;
       let bestSnap = null;
       
       activeFaces.forEach((tmplFace: PlacedFace, tmplIdx: number) => {
          const offset = vecSub(worldPos, activeFaces[0].transform);
          const approxFacePos = vecAdd(tmplFace.transform, offset);
          
          const tmplTx = createTransform2D(approxFacePos.x, approxFacePos.y, tmplFace.transform.rotation);
          
          Object.values(net.faces).forEach((boardFace: PlacedFace) => {
             const boardTx = createTransform2D(boardFace.transform.x, boardFace.transform.y, boardFace.transform.rotation);
             
             boardFace.def.vertices.forEach((_, bEdgeIdx) => {
                const [bp1, bp2] = getEdgeWorldPoints(boardFace.def.vertices, boardTx, bEdgeIdx);
                const boardMid = { x: (bp1.x+bp2.x)/2, y: (bp1.y+bp2.y)/2 };

                tmplFace.def.vertices.forEach((_, tEdgeIdx) => {
                   if (!edgesHaveMatchingLength(boardFace.def.vertices, bEdgeIdx, tmplFace.def.vertices, tEdgeIdx)) {
                      return;
                   }
                   const [tp1, tp2] = getEdgeWorldPoints(tmplFace.def.vertices, tmplTx, tEdgeIdx);
                   const tmplMid = { x: (tp1.x+tp2.x)/2, y: (tp1.y+tp2.y)/2 };
                   
                   const d = vecLen(vecSub(boardMid, tmplMid));
                   if (d < bestDist) {
                      const snap = calculateSnap(
                         boardFace.def.vertices, boardTx, bEdgeIdx,
                         tmplFace.def.vertices, tEdgeIdx
                      );
                      bestDist = d;
                      bestSnap = {
                         transform: snap,
                         parentId: boardFace.id,
                         parentEdgeIdx: bEdgeIdx,
                         childEdgeIdx: tEdgeIdx,
                         templateFaceIdx: tmplIdx
                      };
                   }
                });
             });
          });
       });
       
       setPreview(bestSnap);
       return;
    }
  };

  const handleMouseUp = () => {
    if (interactionMode === 'lasso') {
       const ids = new Set<string>();
       Object.values(net.faces).forEach((f: PlacedFace) => {
          const c = getFaceCentroid(f);
          if (isPointInPolygon(c, lassoPath)) {
             ids.add(f.id);
          }
       });
       onSelectionChange(ids);
    } else if (interactionMode === 'selecting') {
       if (lassoPath.length > 0) {
         const start = lassoPath[0];
         const end = lassoPath[lassoPath.length-1];
         const ids = new Set<string>();
         Object.values(net.faces).forEach((f: PlacedFace) => {
            const c = getFaceCentroid(f);
            if (isPointInRect(c, start, end)) {
               ids.add(f.id);
            }
         });
         onSelectionChange(ids);
       }
    }
    
    setInteractionMode('none');
    setLassoPath([]);
    dragStartRef.current = null;
  };
  
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const worldBefore = {
      x: (e.clientX - rect.left - pan.x) / zoom,
      y: (e.clientY - rect.top - pan.y) / zoom
    };
    const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;

    setZoom(prevZoom => {
      const nextZoom = Math.max(0.1, Math.min(5, prevZoom * scaleFactor));
      setPan({
        x: e.clientX - rect.left - worldBefore.x * nextZoom,
        y: e.clientY - rect.top - worldBefore.y * nextZoom
      });
      return nextZoom;
    });
  };

  const getGhostTransform = (face: PlacedFace, index: number) => {
      if (preview && preview.templateFaceIdx < activeFaces.length) {
         const anchorFace = activeFaces[preview.templateFaceIdx];
         if (!anchorFace) return `translate(0,0)`;
         const tAnchorOld = createTransform2D(anchorFace.transform.x, anchorFace.transform.y, anchorFace.transform.rotation);
         const tTarget = createTransform2D(preview.transform.x, preview.transform.y, preview.transform.rotation);
         const tAnchorInv = invert3(tAnchorOld);
         const mGroup = matMul3(tTarget, tAnchorInv);
         
         const tFaceOld = createTransform2D(face.transform.x, face.transform.y, face.transform.rotation);
         const tFaceNew = matMul3(mGroup, tFaceOld);
         
         const rot = Math.atan2(tFaceNew[3], tFaceNew[0]);
         return `translate(${tFaceNew[2]}, ${tFaceNew[5]}) rotate(${rot * 180 / Math.PI})`;
      } else {
         const anchorFace = activeFaces[0];
         if (!anchorFace) return `translate(0,0)`;
         const dx = mousePos.x - anchorFace.transform.x;
         const dy = mousePos.y - anchorFace.transform.y;
         return `translate(${face.transform.x + dx}, ${face.transform.y + dy}) rotate(${face.transform.rotation * 180 / Math.PI})`;
      }
  };

  return (
    <div
      className={`w-full h-full overflow-hidden select-none relative ${theme === 'dark' ? 'bg-slate-900' : theme === 'light' ? 'bg-gray-50' : ''} ${isPlacing ? 'cursor-default' : 'cursor-crosshair'}`}
      style={theme === 'custom' ? { backgroundColor: customBackgroundColor } : undefined}
    >
      <svg 
        ref={svgRef}
        className="w-full h-full block touch-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onAuxClick={e => {
          if (e.button !== 1) return;
          e.preventDefault();
          const worldPos = toWorld(e.clientX, e.clientY);
          const clickedFaceId = getClickedFaceId(worldPos);
          if (clickedFaceId) {
            onRequestPivotFace?.(clickedFaceId);
          }
        }}
        onDoubleClick={e => {
          const worldPos = toWorld(e.clientX, e.clientY);
          if (getClickedFaceId(worldPos) || getClickedConnectionId(worldPos) || getClickedVertex(worldPos)) return;
          const shortcut = shortcutFromMouseEvent(e.nativeEvent, 2);
          if (shortcut) {
            onEmptyShortcut?.(shortcut);
          }
        }}
        onContextMenu={e => e.preventDefault()}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          
          {(Object.values(net.faces) as PlacedFace[]).map(face => {
            if (!face) return null;
            const isSelected = selectedFaceIds.has(face.id);
            const isHovered = hoveredFaceId === face.id;
            const overlayOpacity = isSelected ? 0.28 : isHovered ? 0.16 : 0;
            const stroke = '#334155';
            const strokeWidth = isSelected ? 1.5 : 1;
            const pts = face.def.vertices.map(v => `${v.x},${v.y}`).join(' ');
            
            return (
              <g 
                key={face.id} 
                transform={`translate(${face.transform.x}, ${face.transform.y}) rotate(${face.transform.rotation * 180 / Math.PI})`}
                className="transition-transform duration-75"
              >
                <polygon 
                  points={pts} 
                  fill={face.def.color} 
                  stroke={stroke} 
                  strokeWidth={strokeWidth}
                />
                {overlayOpacity > 0 && (
                    <polygon 
                        points={pts} 
                        fill="white" 
                        fillOpacity={overlayOpacity}
                        pointerEvents="none"
                    />
                )}
                
                {face.def.vertices.map((v, idx) => {
                   const nextV = face.def.vertices[(idx + 1) % face.def.vertices.length];
                   let edgeColor = null;
                   let edgeWidth = 2;
                   
                   const conn = net.connections.find(c => 
                     (c.faceAId === face.id && c.edgeAIndex === idx) || 
                     (c.faceBId === face.id && c.edgeBIndex === idx)
                   );
                   
                   if (conn && selectedConnectionIds.has(conn.id)) {
                      edgeColor = '#dc2626'; // Red
                      edgeWidth = 4;
                   } else if (selectedMagnetEdges?.some(edge => edge.faceId === face.id && edge.edgeIndex === idx)) {
                      edgeColor = '#0ea5e9'; // Cyan
                      edgeWidth = 4;
                   } else if (hoveredEdge && hoveredEdge.faceId === face.id && hoveredEdge.edgeIndex === idx) {
                      edgeColor = '#f59e0b'; // Orange
                      edgeWidth = 3;
                   } else if (linkSource && linkSource.faceId === face.id && linkSource.edgeIndex === idx) {
                      edgeColor = '#9333ea'; // Purple
                      edgeWidth = 4;
                   }
                   
                  if (edgeColor) {
                      return (
                        <line 
                           key={idx} 
                           x1={v.x} y1={v.y} x2={nextV.x} y2={nextV.y} 
                           stroke={edgeColor} strokeWidth={edgeWidth} strokeLinecap="round"
                        />
                      );
                   }
                   return null;
                })}

                {activeTool === 'magnet' && magnetMode === 'vertex' && selectedMagnetEdges && selectedMagnetEdges.length === 2 && face.def.vertices.map((vertex, idx) => {
                  const isSelectedVertex = selectedMagnetVertices?.some(selected => selected.faceId === face.id && selected.vertexIndex === idx);
                  const isHoveredVertex = hoveredMagnetVertex?.faceId === face.id && hoveredMagnetVertex.vertexIndex === idx;
                  return (
                    <circle
                      key={`vertex-${idx}`}
                      cx={vertex.x}
                      cy={vertex.y}
                      r={isSelectedVertex ? 5.6 : isHoveredVertex ? 5 : 3.2}
                      fill={isSelectedVertex ? '#0ea5e9' : isHoveredVertex ? '#f59e0b' : '#ffffff'}
                      stroke={isHoveredVertex ? '#7c2d12' : '#0f172a'}
                      strokeWidth={isHoveredVertex ? 1.1 : 0.8}
                    />
                  );
                })}
              </g>
            );
          })}
          
          {isPlacing && activeFaces.map((face: PlacedFace, idx: number) => {
             const pts = face.def.vertices.map(v => `${v.x},${v.y}`).join(' ');
             const transformStr = getGhostTransform(face, idx);
             
             return (
                <g key={`ghost-${idx}`} transform={transformStr} className="pointer-events-none opacity-60">
                   <polygon 
                      points={pts} 
                      fill={face.def.color} 
                      stroke="#2563eb" 
                      strokeDasharray="4 2"
                   />
                </g>
             );
          })}

          {interactionMode === 'lasso' && lassoPath.length > 0 && (
             <polygon 
                points={lassoPath.map(p => `${p.x},${p.y}`).join(' ')} 
                fill="rgba(37, 99, 235, 0.1)" 
                stroke="#2563eb" 
                strokeWidth="1" 
                strokeDasharray="4 2"
             />
          )}
          
          {interactionMode === 'selecting' && lassoPath.length > 0 && (
             <rect
                x={Math.min(lassoPath[0].x, lassoPath[lassoPath.length-1].x)}
                y={Math.min(lassoPath[0].y, lassoPath[lassoPath.length-1].y)}
                width={Math.abs(lassoPath[0].x - lassoPath[lassoPath.length-1].x)}
                height={Math.abs(lassoPath[0].y - lassoPath[lassoPath.length-1].y)}
                fill="rgba(37, 99, 235, 0.1)" 
                stroke="#2563eb" 
                strokeWidth="1" 
                strokeDasharray="4 2"
             />
          )}

        </g>
      </svg>
    </div>
  );
};
