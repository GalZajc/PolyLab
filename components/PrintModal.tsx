
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { X, Printer, FileDown, Maximize, RotateCw } from 'lucide-react';
import { PolyNet, Point2D, PlacedFace } from '../types';
import { applyTransform2D, build3DCoincidenceGraph, createTransform2D, faceEdgeRefKey, generateGlueTab, getEdgeWorldPoints, isPointInPolygon } from '../utils/math';

interface PrintModalProps {
  net: PolyNet;
  selectedFaceIds: Set<string>;
  uiTheme: 'light' | 'dark';
  paperTheme: 'light' | 'dark' | 'custom';
  customPaperColor?: string;
  onClose: () => void;
}

// Paper dimensions in mm
const PAPER_SIZES = {
    'A4': { width: 210, height: 297 },
    'A3': { width: 297, height: 420 },
    'Letter': { width: 215.9, height: 279.4 }
};

function segmentsIntersect(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D): boolean {
  const cross = (p: Point2D, q: Point2D, r: Point2D) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSegment = (p: Point2D, q: Point2D, r: Point2D) =>
    Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x) &&
    Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);

  const d1 = cross(a1, a2, b1);
  const d2 = cross(a1, a2, b2);
  const d3 = cross(b1, b2, a1);
  const d4 = cross(b1, b2, a2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  if (d1 === 0 && onSegment(a1, b1, a2)) return true;
  if (d2 === 0 && onSegment(a1, b2, a2)) return true;
  if (d3 === 0 && onSegment(b1, a1, b2)) return true;
  if (d4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
}

function polygonIntersectsPolygon(a: Point2D[], b: Point2D[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (segmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }

  return isPointInPolygon(a[0], b) || isPointInPolygon(b[0], a);
}

export const PrintModal: React.FC<PrintModalProps> = ({ net, selectedFaceIds, uiTheme, paperTheme, customPaperColor, onClose }) => {
  const [paperSize, setPaperSize] = useState<'A4' | 'A3' | 'Letter'>('A4');
  const [unit, setUnit] = useState<'cm' | 'in'>('cm');
  const [edgeLength, setEdgeLength] = useState(3.0); // default 3 cm
  const [edgeLengthInput, setEdgeLengthInput] = useState('3');
  const [style, setStyle] = useState<'color' | 'outline'>('outline');
  const [showTabs, setShowTabs] = useState(true);
  const [tabStrategy, setTabStrategy] = useState<'all' | 'shared3d'>('shared3d');
  const [tabHeightCm, setTabHeightCm] = useState(0.4);
  const [tabAngle, setTabAngle] = useState(40);
  const [margin, setMargin] = useState(10); // mm
  const [lineWidth, setLineWidth] = useState(0.2); // mm - Thicker default
  const [rotationOffset, setRotationOffset] = useState(0); // degrees

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  const paper = PAPER_SIZES[paperSize];

  // Auto-fit preview to container
  useEffect(() => {
    const updateScale = () => {
        if (containerRef.current) {
            const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
            const availableW = cw - 40; 
            const availableH = ch - 40;
            const scale = Math.min(availableW / paper.width, availableH / paper.height);
            setPreviewScale(scale * 0.95);
        }
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [paper]);

  useEffect(() => {
    setViewZoom(1);
    setViewPan({ x: 0, y: 0 });
  }, [paperSize]);

  useEffect(() => {
    setEdgeLengthInput(edgeLength.toString());
  }, [edgeLength]);

  const facesToPrint = useMemo(() => {
      if (selectedFaceIds.size > 0) {
          return Object.values(net.faces).filter((f: PlacedFace) => selectedFaceIds.has(f.id));
      }
      return Object.values(net.faces) as PlacedFace[];
  }, [net, selectedFaceIds]);

  // Calculate Raw Geometry in Internal Units, Centered
  const geometry = useMemo(() => {
      if (facesToPrint.length === 0) return { faces: [], tabs: [], bounds: null };

      const printedFaceIds = new Set(facesToPrint.map((f: PlacedFace) => f.id));
      const rawFaces: { points: Point2D[], color: string }[] = [];
      const rawTabs: { points: Point2D[] }[] = [];
      const facePolygonsById: Record<string, Point2D[]> = {};

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      
      const updateBounds = (p: Point2D) => {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      };

      facesToPrint.forEach((f: PlacedFace) => {
          if (!f || !f.transform) return; 

          const tx = createTransform2D(f.transform.x, f.transform.y, f.transform.rotation);
          // Face Points
          const worldVerts = f.def.vertices.map(v => applyTransform2D(tx, v));
          facePolygonsById[f.id] = worldVerts;
          rawFaces.push({ points: worldVerts, color: f.def.color });
          worldVerts.forEach(updateBounds);
      });

      if (showTabs) {
        const rootId = facesToPrint[0]?.id;
        const graph = tabStrategy === 'shared3d' && rootId ? build3DCoincidenceGraph(net, rootId) : null;
        const candidateGroups = new Map<string, Array<{ points: Point2D[] }>>();

        facesToPrint.forEach((face: PlacedFace) => {
          const tx = createTransform2D(face.transform.x, face.transform.y, face.transform.rotation);

          face.def.vertices.forEach((_, edgeIndex) => {
            const conn = net.connections.find(connection =>
              (connection.faceAId === face.id && connection.edgeAIndex === edgeIndex) ||
              (connection.faceBId === face.id && connection.edgeBIndex === edgeIndex)
            );

            if (conn) {
              const neighborId = conn.faceAId === face.id ? conn.faceBId : conn.faceAId;
              if (printedFaceIds.has(neighborId)) {
                return;
              }
            }

            const [p1, p2] = getEdgeWorldPoints(face.def.vertices, tx, edgeIndex);
            const edgeWorldLength = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
            if (edgeWorldLength <= 1) return;

            const tabHeightInternal = (tabHeightCm * 60) / edgeLength;
            const tabPoly = generateGlueTab(p1, p2, tabHeightInternal, tabAngle);
            if (tabPoly.length === 0) return;

            let groupKey = `${face.id}:${edgeIndex}`;
            if (graph) {
              const info = graph.edgeInfoByRefKey[faceEdgeRefKey(face.id, edgeIndex)];
              if (info) {
                groupKey = [info.startGroupId, info.endGroupId].sort().join('|');
              }
            }

            const group = candidateGroups.get(groupKey) || [];
            group.push({ points: tabPoly });
            candidateGroups.set(groupKey, group);
          });
        });

        const selectedTabs: Point2D[][] = [];

        candidateGroups.forEach(group => {
          if (tabStrategy === 'all') {
            group.forEach(candidate => {
              rawTabs.push({ points: candidate.points });
              selectedTabs.push(candidate.points);
              candidate.points.forEach(updateBounds);
            });
            return;
          }

          let bestCandidate: Point2D[] | null = null;
          let bestScore = Infinity;

          group.forEach(candidate => {
            let score = 0;

            Object.values(facePolygonsById).forEach(facePolygon => {
              if (polygonIntersectsPolygon(candidate.points, facePolygon)) {
                score += 100;
              }
            });

            selectedTabs.forEach(existingTab => {
              if (polygonIntersectsPolygon(candidate.points, existingTab)) {
                score += 25;
              }
            });

            const inwardPoints = candidate.points.slice(1, candidate.points.length - 1);
            inwardPoints.forEach(point => {
              Object.values(facePolygonsById).forEach(facePolygon => {
                if (isPointInPolygon(point, facePolygon)) {
                  score += 10;
                }
              });
            });

            if (score < bestScore) {
              bestScore = score;
              bestCandidate = candidate.points;
            }
          });

          if (bestCandidate) {
            rawTabs.push({ points: bestCandidate });
            selectedTabs.push(bestCandidate);
            bestCandidate.forEach(updateBounds);
          }
        });
      }
      
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      // Return Centered Geometry
      return {
          faces: rawFaces.map(f => ({ ...f, points: f.points.map(p => ({ x: p.x - cx, y: p.y - cy })) })),
          tabs: rawTabs.map(t => ({ points: t.points.map(p => ({ x: p.x - cx, y: p.y - cy })) })),
          // Bounds of centered geometry (0-centered)
          bounds: { minX: minX - cx, maxX: maxX - cx, minY: minY - cy, maxY: maxY - cy }
      };
  }, [facesToPrint, net, showTabs, tabAngle, tabHeightCm, tabStrategy]);

  // Calculate metrics of the rotated shape (bounds and center shift)
  // This is crucial for properly centering the rotated shape on the page
  const rotatedMetrics = useMemo(() => {
     if (!geometry.bounds) return { w: 1, h: 1, cx: 0, cy: 0 };
     
     const rad = rotationOffset * Math.PI / 180;
     const c = Math.cos(rad);
     const s = Math.sin(rad);
     
     let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
     
     const process = (pts: Point2D[]) => {
         pts.forEach(p => {
             const nx = p.x * c - p.y * s;
             const ny = p.x * s + p.y * c;
             minX = Math.min(minX, nx); maxX = Math.max(maxX, nx);
             minY = Math.min(minY, ny); maxY = Math.max(maxY, ny);
         });
     };
     
     geometry.faces.forEach(f => process(f.points));
     geometry.tabs.forEach(t => process(t.points));
     
     if (minX === Infinity) return { w: 1, h: 1, cx: 0, cy: 0 };

     return { 
        w: maxX - minX, 
        h: maxY - minY,
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2
     };
  }, [geometry, rotationOffset]);

  // 1 unit (internal 60) = edgeLength cm.
  // scaleK maps internal unit -> mm
  const scaleK = (edgeLength * 10) / 60;

  const handleAutoRotate = () => {
      if (!geometry.bounds) return;
      const safeW = paper.width - margin * 2;
      const safeH = paper.height - margin * 2;
      
      let bestAngle = 0;
      let maxScale = 0;
      
      const allPoints: Point2D[] = [];
      geometry.faces.forEach(f => allPoints.push(...f.points));
      geometry.tabs.forEach(t => allPoints.push(...t.points));
      
      for (let ang = 0; ang < 180; ang += 1) {
          const rad = ang * Math.PI / 180;
          const c = Math.cos(rad);
          const s = Math.sin(rad);
          
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const p of allPoints) {
             const nx = p.x * c - p.y * s;
             const ny = p.x * s + p.y * c;
             if (nx < minX) minX = nx; if (nx > maxX) maxX = nx;
             if (ny < minY) minY = ny; if (ny > maxY) maxY = ny;
          }
          
          const w = maxX - minX;
          const h = maxY - minY;
          if (w < 0.001 || h < 0.001) continue;

          const s1 = Math.min(safeW / w, safeH / h);
          if (s1 > maxScale) {
              maxScale = s1;
              bestAngle = ang;
          }
      }
      
      setRotationOffset(bestAngle);
      // Internal unit (60) -> edgeLength (mm = maxScale * 60). 
      // edgeLength in state is in cm. So: maxScale * 60 / 10 = maxScale * 6
      // Floor to 3 decimals to be safe inside margins
      setEdgeLength(Math.floor(maxScale * 6 * 1000) / 1000);
  };

  const handleFitToPage = () => {
      const safeW = paper.width - margin * 2;
      const safeH = paper.height - margin * 2;
      const scaleNeeded = Math.min(safeW / rotatedMetrics.w, safeH / rotatedMetrics.h);
      setEdgeLength(Math.floor(scaleNeeded * 6 * 1000) / 1000);
  };

  // We apply rotation, then recenter (translate by -cx, -cy), then scale, then move to page center.
  // In SVG transform order (right-to-left application):
  // translate(pageCenter) scale(k) translate(-cx, -cy) rotate(angle)
  const transformStr = `translate(${paper.width/2}, ${paper.height/2}) scale(${scaleK}) translate(${-rotatedMetrics.cx}, ${-rotatedMetrics.cy}) rotate(${rotationOffset})`;
  
  const strokeWidth = lineWidth / scaleK; 

  const getSvgString = () => {
      if (!svgRef.current) return '';
      const svg = svgRef.current.cloneNode(true) as SVGSVGElement;
      svg.setAttribute('width', unit === 'cm' ? `${paper.width/10}cm` : `${paper.width/25.4}in`);
      svg.setAttribute('height', unit === 'cm' ? `${paper.height/10}cm` : `${paper.height/25.4}in`);

      // Remove helpers
      const marginRect = svg.getElementById('print-margin-rect');
      if (marginRect) marginRect.remove();

      return new XMLSerializer().serializeToString(svg);
  };

  const handlePrint = () => {
      const svgContent = getSvgString();
      const win = window.open('', '', 'width=800,height=600');
      if (win) {
          win.document.write(`
            <html>
              <head><title>Print PolyNet</title></head>
              <body style="margin:0; display:flex; justify-content:center; align-items:center;">
                ${svgContent}
                <script>setTimeout(() => { window.print(); window.close(); }, 500);</script>
              </body>
            </html>
          `);
          win.document.close();
      }
  };

  const handleExportSVG = () => {
     const svgContent = getSvgString();
     const blob = new Blob([svgContent], { type: 'image/svg+xml' });
     const url = URL.createObjectURL(blob);
     const a = document.createElement('a');
     a.href = url;
     a.download = 'polynet_export.svg';
     a.click();
  };

  const handlePreviewWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const pointerOffsetX = event.clientX - centerX;
    const pointerOffsetY = event.clientY - centerY;
    const nextZoom = Math.max(1, Math.min(6, viewZoom * (event.deltaY > 0 ? 0.9 : 1.1)));
    const currentScale = previewScale * viewZoom;
    const nextScale = previewScale * nextZoom;
    const localX = (pointerOffsetX - viewPan.x) / currentScale;
    const localY = (pointerOffsetY - viewPan.y) / currentScale;

    setViewZoom(nextZoom);
    setViewPan({
      x: pointerOffsetX - localX * nextScale,
      y: pointerOffsetY - localY * nextScale
    });
  };

  const handlePreviewMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setDragStart({ x: event.clientX - viewPan.x, y: event.clientY - viewPan.y });
  };

  const handlePreviewMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    setViewPan({
      x: event.clientX - dragStart.x,
      y: event.clientY - dragStart.y
    });
  };

  const handlePreviewMouseUp = () => {
    setDragStart(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onMouseDown={onClose}>
       <div className={`menu-panel bg-white shadow-2xl w-screen h-screen flex flex-col overflow-hidden ${uiTheme === 'dark' ? 'ui-theme-dark' : ''}`} onMouseDown={e => e.stopPropagation()}>
          
          {/* Header */}
          <div className="menu-subtle bg-gray-50 px-4 py-2 border-b flex justify-between items-center shrink-0">
             <div className="flex items-center gap-2 font-bold text-gray-800">
               <Printer size={20} className="text-blue-600"/> Print / Export
             </div>
             <button onClick={onClose}><X className="text-gray-400 hover:text-gray-700"/></button>
          </div>

          <div className="flex flex-1 overflow-hidden">
             {/* Settings Panel */}
             <div className="menu-subtle w-80 bg-gray-50 border-r border-gray-200 p-5 overflow-y-auto space-y-6 shrink-0 text-sm">
                
                <section>
                   <label className="block font-semibold text-gray-700 mb-2">Layout</label>
                   <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                         <span className="text-xs text-gray-500 block mb-1">Paper</span>
                         <select value={paperSize} onChange={e => setPaperSize(e.target.value as any)} className="w-full border border-gray-300 bg-white text-gray-900 rounded p-1.5">
                            <option value="A4">A4</option>
                            <option value="A3">A3</option>
                            <option value="Letter">Letter</option>
                         </select>
                      </div>
                      <div>
                         <span className="text-xs text-gray-500 block mb-1">Unit</span>
                         <select value={unit} onChange={e => setUnit(e.target.value as any)} className="w-full border border-gray-300 bg-white text-gray-900 rounded p-1.5">
                            <option value="cm">cm</option>
                            <option value="in">inch</option>
                         </select>
                      </div>
                   </div>
                   
                   <div className="mb-3">
                      <div className="flex justify-between items-center mb-1">
                         <span className="text-xs text-gray-500">Margins ({margin}mm)</span>
                      </div>
                      <input 
                         type="range" min="0" max="50" step="1" 
                         value={margin} onChange={e => setMargin(parseFloat(e.target.value))} 
                         className="w-full accent-blue-600"
                      />
                   </div>

                   <div className="mb-3">
                      <div className="flex justify-between items-center mb-1">
                         <span className="text-xs text-gray-500">Line Thickness ({lineWidth}mm)</span>
                      </div>
                      <input 
                         type="range" min="0.05" max="1.0" step="0.05" 
                         value={lineWidth} onChange={e => setLineWidth(parseFloat(e.target.value))} 
                         className="w-full accent-blue-600"
                      />
                   </div>

                   <div>
                      <span className="text-xs text-gray-500 block mb-1">Edge Length ({unit})</span>
                      <div className="flex gap-2 mb-2">
                        <input 
                            type="number" step="0.1" min="0.1"
                            value={edgeLengthInput} 
                            onChange={e => {
                              const nextValue = e.target.value;
                              setEdgeLengthInput(nextValue);
                              const parsedValue = Number.parseFloat(nextValue);
                              if (Number.isFinite(parsedValue) && parsedValue > 0) {
                                setEdgeLength(parsedValue);
                              }
                            }}
                            onBlur={() => {
                              const parsedValue = Number.parseFloat(edgeLengthInput);
                              setEdgeLengthInput(Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue.toString() : edgeLength.toString());
                            }}
                            className="w-full border border-gray-300 bg-white text-gray-900 rounded p-1.5"
                        />
                      </div>
                      <div className="flex gap-2">
                         <button 
                             onClick={handleFitToPage}
                             className="flex-1 py-1.5 bg-blue-100 text-blue-700 rounded border border-blue-200 hover:bg-blue-200 flex items-center justify-center gap-1 text-xs font-medium"
                             title="Maximize scale within margins"
                         >
                             <Maximize size={14} /> Fit
                         </button>
                         <button 
                             onClick={handleAutoRotate}
                             className="flex-1 py-1.5 bg-blue-100 text-blue-700 rounded border border-blue-200 hover:bg-blue-200 flex items-center justify-center gap-1 text-xs font-medium"
                             title="Rotate to maximize size"
                         >
                             <RotateCw size={14} /> Optimize
                         </button>
                      </div>
                   </div>
                </section>

                <section>
                   <label className="block font-semibold text-gray-700 mb-2">Appearance</label>
                   <div className="flex gap-2 bg-white rounded border p-1 mb-3">
                      <button onClick={() => setStyle('outline')} className={`flex-1 py-1 rounded text-xs ${style==='outline' ? 'bg-blue-100 text-blue-700 font-bold' : 'text-gray-600'}`}>Outline</button>
                      <button onClick={() => setStyle('color')} className={`flex-1 py-1 rounded text-xs ${style==='color' ? 'bg-blue-100 text-blue-700 font-bold' : 'text-gray-600'}`}>Color</button>
                   </div>
                </section>

                <section>
                   <div className="flex items-center justify-between mb-2">
                      <label className="font-semibold text-gray-700">Glue Tabs</label>
                      <input type="checkbox" checked={showTabs} onChange={e => setShowTabs(e.target.checked)} className="accent-blue-600 w-4 h-4" />
                   </div>
                   {showTabs && (
                      <div className="space-y-3 pl-2 border-l-2 border-gray-200 mt-2">
                         <div>
                             <div className="mb-1 text-xs text-gray-500">Tab layout</div>
                             <div className="flex gap-2 rounded border border-gray-200 bg-white p-1">
                                <button
                                  onClick={() => setTabStrategy('all')}
                                  className={`flex-1 rounded px-2 py-1 text-xs ${tabStrategy === 'all' ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-gray-600'}`}
                                >
                                  All tabs
                                </button>
                                <button
                                  onClick={() => setTabStrategy('shared3d')}
                                  className={`flex-1 rounded px-2 py-1 text-xs ${tabStrategy === 'shared3d' ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-gray-600'}`}
                                >
                                  Shared 3D
                                </button>
                             </div>
                             <div className="mt-1 text-[11px] text-gray-400">
                                Shared 3D keeps one tab per coincident folded side and greedily avoids overlaps.
                             </div>
                         </div>
                         <div>
                             <div className="flex justify-between text-xs text-gray-500 mb-1">
                                <span>Height</span>
                                <span>{tabHeightCm.toFixed(2)} cm</span>
                             </div>
                             <input type="range" min="0" max="1" step="0.05" value={tabHeightCm} onChange={e => setTabHeightCm(parseFloat(e.target.value))} className="w-full accent-blue-600"/>
                         </div>
                         <div>
                             <div className="flex justify-between text-xs text-gray-500 mb-1">
                                <span>Angle</span>
                                <span>{tabAngle}°</span>
                             </div>
                             <input type="range" min="10" max="80" step="5" value={tabAngle} onChange={e => setTabAngle(parseFloat(e.target.value))} className="w-full accent-blue-600"/>
                         </div>
                      </div>
                   )}
                </section>

                <div className="pt-6 border-t space-y-3">
                   <button onClick={handlePrint} className="w-full py-2.5 bg-blue-600 text-white rounded font-bold shadow hover:bg-blue-700 flex items-center justify-center gap-2 transition-colors">
                      <Printer size={18}/> Print
                   </button>
                   <button onClick={handleExportSVG} className="w-full py-2.5 bg-white border border-gray-300 text-gray-700 rounded font-bold shadow-sm hover:bg-gray-50 flex items-center justify-center gap-2 transition-colors">
                      <FileDown size={18}/> Export SVG
                   </button>
                </div>
             </div>

             {/* Preview Panel */}
             <div
                className={`flex-1 bg-gray-200 flex items-center justify-center overflow-hidden relative ${dragStart ? 'cursor-grabbing' : 'cursor-grab'}`}
                ref={containerRef}
                onWheel={handlePreviewWheel}
                onMouseDown={handlePreviewMouseDown}
                onMouseMove={handlePreviewMouseMove}
                onMouseUp={handlePreviewMouseUp}
                onMouseLeave={handlePreviewMouseUp}
             >
                {/* Paper Sheet Simulation */}
                <div 
                   className={`shadow-[0_0_20px_rgba(0,0,0,0.2)] border relative transition-transform duration-200 origin-center ${paperTheme === 'dark' ? 'bg-slate-900 border-slate-700' : paperTheme === 'light' ? 'bg-white border-gray-400' : 'border-gray-400'}`} 
                   style={{ 
                       width: `${paper.width}px`,
                       height: `${paper.height}px`,
                       transform: `translate(${viewPan.x}px, ${viewPan.y}px) scale(${previewScale * viewZoom})`,
                       ...(paperTheme === 'custom' ? { backgroundColor: customPaperColor || '#ffffff' } : {})
                   }}
                >
                    <svg 
                       ref={svgRef}
                       viewBox={`0 0 ${paper.width} ${paper.height}`}
                       className="w-full h-full overflow-hidden"
                    >
                       {/* Margin Indicator */}
                       <rect 
                           id="print-margin-rect"
                           x={margin} y={margin} 
                           width={Math.max(0, paper.width - margin*2)} 
                           height={Math.max(0, paper.height - margin*2)} 
                           fill="none" stroke="#ef4444" strokeWidth="0.5" strokeDasharray="4 2" opacity="0.5"
                       />

                       <g transform={transformStr}>
                          {/* Tabs */}
                          {geometry.tabs.map((t, i) => (
                              <polygon 
                                  key={`tab-${i}`} 
                                  points={t.points.map(p => `${p.x},${p.y}`).join(' ')} 
                                  fill="none" 
                                  stroke="#94a3b8" 
                                  strokeWidth={strokeWidth}
                              />
                          ))}
                          
                          {/* Faces */}
                          {geometry.faces.map((face, i) => (
                              <polygon 
                                 key={`face-${i}`}
                                 points={face.points.map(p => `${p.x},${p.y}`).join(' ')} 
                                 fill={style === 'color' ? face.color : 'white'}
                                 stroke="black"
                                 strokeWidth={strokeWidth}
                              />
                          ))}
                       </g>
                    </svg>
                </div>
                {/* Indicators */}
                <div className="absolute bottom-4 right-4 flex flex-col gap-1 items-end pointer-events-none">
                    <div className="bg-black/60 text-white px-2 py-1 rounded text-xs">
                         Scale: {Math.round(previewScale * viewZoom * 100)}%
                    </div>
                </div>
             </div>
          </div>
       </div>
    </div>
  );
};
