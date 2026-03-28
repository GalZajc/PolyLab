
import { FaceDefinition, Point2D, Point3D, ShapeType, PolyNet, PlacedFace, Connection, MagnetEdge, MagnetVertex } from '../types';

// Constants
export const EPSILON = 1e-4;
export const EDGE_LENGTH_MATCH_EPSILON = 1e-10;
const FACE_MATCH_EPSILON = 1e-6;
const MAGNET_VERTEX_EPSILON = 1e-1;
const MAGNET_LENGTH_EPSILON = 1e-4;
const MAGNET_EDGE_MATCH_EPSILON = 1e-1;
const MAGNET_PARALLEL_EPSILON = 1e-8;
const MAGNET_VERIFY_EPSILON = 1e-1;
const MAGNET_PROBE_ANGLE_DEG = 1;
const MAGNET_ADVANCED_VERIFY_EPSILON = 1e-8;
const MAGNET_ADVANCED_ACCEPT_EPSILON = 1e-10;

// ---------------- Geometry Generators ----------------

export function generateRegularPolygon(sides: number, radius: number = 50): Point2D[] {
  const verts: Point2D[] = [];
  // We want the first edge (v0 -> v1) to be horizontal and at the bottom.
  // Rotation 180 degrees: add Math.PI
  const offset = -Math.PI / 2 - Math.PI / sides + Math.PI;

  for (let i = 0; i < sides; i++) {
    const theta = offset + (i * 2 * Math.PI) / sides;
    verts.push({
      x: radius * Math.cos(theta),
      y: radius * Math.sin(theta),
    });
  }
  return normalizePolygonOrientation(verts);
}

function radiusForRegularPolygonSideLength(sides: number, sideLength: number): number {
  return sideLength / (2 * Math.sin(Math.PI / sides));
}

function centerPolygon(vertices: Point2D[]): Point2D[] {
  if (vertices.length === 0) return [];
  let cx = 0;
  let cy = 0;
  vertices.forEach(vertex => {
    cx += vertex.x;
    cy += vertex.y;
  });
  cx /= vertices.length;
  cy /= vertices.length;
  return vertices.map(vertex => ({ x: vertex.x - cx, y: vertex.y - cy }));
}

function scalePolygon(vertices: Point2D[], scale: number): Point2D[] {
  return vertices.map(vertex => ({ x: vertex.x * scale, y: vertex.y * scale }));
}

export function getEdgeLength(vertices: Point2D[], edgeIndex: number): number {
  if (!vertices.length) return 0;
  const start = vertices[((edgeIndex % vertices.length) + vertices.length) % vertices.length];
  const end = vertices[(edgeIndex + 1 + vertices.length) % vertices.length];
  return Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
}

function getPolygonSignedArea(vertices: Point2D[]): number {
  if (vertices.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function normalizePolygonOrientation(vertices: Point2D[]): Point2D[] {
  return getPolygonSignedArea(vertices) < 0 ? [...vertices].reverse() : vertices;
}

function scaleCustomPolygon(vertices: Point2D[], unitScale: number = 60): Point2D[] {
  return scalePolygon(normalizePolygonOrientation(centerPolygon(vertices)), unitScale);
}

export function edgesHaveMatchingLength(
  verticesA: Point2D[],
  edgeAIndex: number,
  verticesB: Point2D[],
  edgeBIndex: number,
  epsilon: number = EDGE_LENGTH_MATCH_EPSILON
): boolean {
  return Math.abs(getEdgeLength(verticesA, edgeAIndex) - getEdgeLength(verticesB, edgeBIndex)) <= epsilon;
}

function createFaceDefinition(type: ShapeType, vertices: Point2D[], color: string): FaceDefinition {
  return {
    type,
    vertices: scaleCustomPolygon(vertices),
    color
  };
}

export function applyFaceColorOverride(definition: FaceDefinition, overrides?: Record<string, string>): FaceDefinition {
  if (!overrides) return definition;
  const overriddenColor = overrides[definition.type];
  if (!overriddenColor || overriddenColor === definition.color) return definition;
  return { ...definition, color: overriddenColor };
}

function getRegularPolygonColor(sides: number): string {
  const fixedColors: Record<number, string> = {
    3: '#fbbf24',
    4: '#f87171',
    5: '#60a5fa',
    6: '#4ade80'
  };
  if (fixedColors[sides]) return fixedColors[sides];
  const hue = (sides * 47) % 360;
  return hslToHex(hue, 70, 72);
}

function hslToHex(hue: number, saturationPercent: number, lightnessPercent: number): string {
  const saturation = Math.max(0, Math.min(1, saturationPercent / 100));
  const lightness = Math.max(0, Math.min(1, lightnessPercent / 100));
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = ((hue % 360) + 360) % 360 / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (huePrime < 1) {
    r1 = chroma;
    g1 = x;
  } else if (huePrime < 2) {
    r1 = x;
    g1 = chroma;
  } else if (huePrime < 3) {
    g1 = chroma;
    b1 = x;
  } else if (huePrime < 4) {
    g1 = x;
    b1 = chroma;
  } else if (huePrime < 5) {
    r1 = x;
    b1 = chroma;
  } else {
    r1 = chroma;
    b1 = x;
  }

  const match = lightness - chroma / 2;
  const toHex = (value: number) => Math.round((value + match) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

const SQRT2 = Math.sqrt(2);
const SQRT5 = Math.sqrt(5);
const PHI = (1 + SQRT5) / 2;

function tribonacciConstant(): number {
  let value = 1.8;
  for (let i = 0; i < 16; i += 1) {
    const f = value ** 3 - value ** 2 - value - 1;
    const df = 3 * value ** 2 - 2 * value - 1;
    value -= f / df;
  }
  return value;
}

function pentagonalHexecontahedronXi(): number {
  let value = 0.94;
  const phiSquared = PHI * PHI;
  for (let i = 0; i < 16; i += 1) {
    const f = value ** 3 + 2 * value ** 2 - phiSquared;
    const df = 3 * value ** 2 + 4 * value;
    value -= f / df;
  }
  return value;
}

function rotatePoint(point: Point2D, angleRad: number): Point2D {
  const cosine = Math.cos(angleRad);
  const sine = Math.sin(angleRad);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine
  };
}

function constructPolygonFromSidesAndAngles(sideLengths: number[], interiorAnglesDeg: number[]): Point2D[] | null {
  if (sideLengths.length < 3 || sideLengths.length !== interiorAnglesDeg.length) return null;

  const vertices: Point2D[] = [{ x: 0, y: 0 }];
  let heading = 0;

  for (let index = 0; index < sideLengths.length - 1; index += 1) {
    const current = vertices[vertices.length - 1];
    vertices.push({
      x: current.x + sideLengths[index] * Math.cos(heading),
      y: current.y + sideLengths[index] * Math.sin(heading)
    });
    heading += Math.PI - (interiorAnglesDeg[index + 1] * Math.PI) / 180;
  }

  const finalVertex = vertices[vertices.length - 1];
  const expectedStart = {
    x: finalVertex.x + sideLengths[sideLengths.length - 1] * Math.cos(heading),
    y: finalVertex.y + sideLengths[sideLengths.length - 1] * Math.sin(heading)
  };
  if (Math.hypot(expectedStart.x, expectedStart.y) > 1e-5) return null;

  return centerPolygon(vertices);
}

function generateTriangleFromAngles(angleA: number, angleB: number, angleC: number): Point2D[] | null {
  const total = angleA + angleB + angleC;
  if (Math.abs(total - 180) > 1e-6) return null;

  const sideA = Math.sin((angleA * Math.PI) / 180);
  const sideB = Math.sin((angleB * Math.PI) / 180);
  const sideC = Math.sin((angleC * Math.PI) / 180);
  return generateTriangleFromSides(sideA, sideB, sideC);
}

function generateIsoscelesTriangle(equalSideLength: number, baseLength: number): Point2D[] | null {
  return generateTriangleFromSides(equalSideLength, equalSideLength, baseLength);
}

function generateSymmetricPentagonFromLengthsAndAngles(shortEdge: number, longEdge: number, acuteAngleDeg: number, obtuseAngleDeg: number): Point2D[] | null {
  const vertices = constructPolygonFromSidesAndAngles(
    [longEdge, shortEdge, shortEdge, shortEdge, longEdge],
    [acuteAngleDeg, obtuseAngleDeg, obtuseAngleDeg, obtuseAngleDeg, obtuseAngleDeg]
  );
  if (!vertices) return null;

  const topVertex = vertices[0];
  const rotation = -Math.PI / 2 - Math.atan2(topVertex.y, topVertex.x);
  return centerPolygon(vertices.map(point => rotatePoint(point, rotation)));
}

function createRawFaceDefinition(type: ShapeType, vertices: Point2D[], color: string): FaceDefinition {
  return {
    type,
    vertices: normalizePolygonOrientation(centerPolygon(vertices)),
    color
  };
}

function createCatalanPresetDefinition(type: ShapeType, vertices: Point2D[], color: string): FaceDefinition {
  return createRawFaceDefinition(type, scaleCustomPolygon(vertices), color);
}

export function areFaceDefinitionsEquivalent(faceA: FaceDefinition, faceB: FaceDefinition, epsilon: number = FACE_MATCH_EPSILON): boolean {
  if (faceA.vertices.length !== faceB.vertices.length) return false;
  const verticesA = centerPolygon(faceA.vertices);
  const verticesB = centerPolygon(faceB.vertices);
  const vertexCount = verticesA.length;

  for (const reverse of [false, true]) {
    const candidateBase = reverse ? [...verticesB].reverse() : [...verticesB];

    for (let shift = 0; shift < vertexCount; shift += 1) {
      const candidate = candidateBase.map((_, index) => candidateBase[(index + shift) % vertexCount]);
      const vectorA = vecSub(verticesA[1], verticesA[0]);
      const vectorB = vecSub(candidate[1], candidate[0]);
      const lengthA = vecLen(vectorA);
      const lengthB = vecLen(vectorB);
      if (Math.abs(lengthA - lengthB) > epsilon) continue;

      const angleA = Math.atan2(vectorA.y, vectorA.x);
      const angleB = Math.atan2(vectorB.y, vectorB.x);
      const rotatedCandidate = candidate.map(point => rotatePoint(point, angleA - angleB));

      let matches = true;
      for (let index = 0; index < vertexCount; index += 1) {
        if (distanceBetweenPoints(verticesA[index], rotatedCandidate[index]) > epsilon) {
          matches = false;
          break;
        }
      }

      if (matches) return true;
    }
  }

  return false;
}

function distanceBetweenPoints(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function generateRhombus(sideLength: number = 50, acuteAngleDeg: number = 60): Point2D[] {
  // Generate Rhombus with horizontal bottom edge
  const theta = (acuteAngleDeg * Math.PI) / 180;
  const dx = sideLength * Math.cos(theta);
  const dy = sideLength * Math.sin(theta);
  
  // V0: (0,0) -> V1: (L, 0) -> V2: (L+dx, dy) -> V3: (dx, dy)
  const raw = [
    { x: 0, y: 0 },
    { x: sideLength, y: 0 },
    { x: sideLength + dx, y: dy },
    { x: dx, y: dy }
  ];
  
  // Center the shape
  const cx = (sideLength + dx) / 2;
  const cy = dy / 2;
  
  // Rotate 180 degrees: negate coordinates
  return normalizePolygonOrientation(raw.map(p => ({ x: -(p.x - cx), y: -(p.y - cy) })));
}

export function generateTriangleFromSides(a: number, b: number, c: number): Point2D[] | null {
  if (a <= 0 || b <= 0 || c <= 0) return null;
  if (a + b <= c || a + c <= b || b + c <= a) return null;

  const A = { x: 0, y: 0 };
  const B = { x: c, y: 0 };
  const x = (b * b + c * c - a * a) / (2 * c);
  const ySq = b * b - x * x;
  if (ySq < -EPSILON) return null;
  const C = { x, y: -Math.sqrt(Math.max(0, ySq)) };
  return centerPolygon([A, B, C]);
}

export function generateKite(sideA: number, sideB: number, apexAngleDeg: number): Point2D[] | null {
  if (sideA <= 0 || sideB <= 0) return null;
  const halfAngle = (apexAngleDeg * Math.PI) / 360;
  const halfWidth = sideA * Math.sin(halfAngle);
  const topHeight = sideA * Math.cos(halfAngle);
  const bottomHeightSq = sideB * sideB - halfWidth * halfWidth;
  if (bottomHeightSq < -EPSILON) return null;
  const bottomHeight = Math.sqrt(Math.max(0, bottomHeightSq));
  return centerPolygon([
    { x: 0, y: -topHeight },
    { x: halfWidth, y: 0 },
    { x: 0, y: bottomHeight },
    { x: -halfWidth, y: 0 }
  ]);
}

export function generateTrapezoid(topWidth: number, bottomWidth: number, height: number, offset: number): Point2D[] | null {
  if (topWidth <= 0 || bottomWidth <= 0 || height <= 0) return null;
  return centerPolygon([
    { x: 0, y: 0 },
    { x: bottomWidth, y: 0 },
    { x: offset + topWidth, y: -height },
    { x: offset, y: -height }
  ]);
}

export function generateParallelogram(baseWidth: number, sideLength: number, angleDeg: number): Point2D[] | null {
  if (baseWidth <= 0 || sideLength <= 0) return null;
  const angle = (angleDeg * Math.PI) / 180;
  const dx = sideLength * Math.cos(angle);
  const dy = sideLength * Math.sin(angle);
  if (Math.abs(dy) < EPSILON) return null;
  return centerPolygon([
    { x: 0, y: 0 },
    { x: baseWidth, y: 0 },
    { x: baseWidth + dx, y: -dy },
    { x: dx, y: -dy }
  ]);
}

export function generateSymmetricPentagon(baseWidth: number, shoulderWidth: number, wallHeight: number, roofHeight: number): Point2D[] | null {
  if (baseWidth <= 0 || shoulderWidth <= 0 || wallHeight < 0 || roofHeight <= 0) return null;
  return centerPolygon([
    { x: -baseWidth / 2, y: 0 },
    { x: baseWidth / 2, y: 0 },
    { x: shoulderWidth / 2, y: -wallHeight },
    { x: 0, y: -(wallHeight + roofHeight) },
    { x: -shoulderWidth / 2, y: -wallHeight }
  ]);
}

export function createTriangleFaceDefinition(a: number, b: number, c: number, color: string = '#f59e0b'): FaceDefinition | null {
  const vertices = generateTriangleFromSides(a, b, c);
  return vertices ? createFaceDefinition(`triangle-custom-${a}-${b}-${c}`, vertices, color) : null;
}

export function createKiteFaceDefinition(sideA: number, sideB: number, apexAngleDeg: number, color: string = '#a78bfa'): FaceDefinition | null {
  const vertices = generateKite(sideA, sideB, apexAngleDeg);
  return vertices ? createFaceDefinition(`kite-${sideA}-${sideB}-${apexAngleDeg}`, vertices, color) : null;
}

export function createTrapezoidFaceDefinition(topWidth: number, bottomWidth: number, height: number, offset: number, color: string = '#fb7185'): FaceDefinition | null {
  const vertices = generateTrapezoid(topWidth, bottomWidth, height, offset);
  return vertices ? createFaceDefinition(`trapezoid-${topWidth}-${bottomWidth}-${height}-${offset}`, vertices, color) : null;
}

export function createParallelogramFaceDefinition(baseWidth: number, sideLength: number, angleDeg: number, color: string = '#2dd4bf'): FaceDefinition | null {
  const vertices = generateParallelogram(baseWidth, sideLength, angleDeg);
  return vertices ? createFaceDefinition(`parallelogram-${baseWidth}-${sideLength}-${angleDeg}`, vertices, color) : null;
}

export function createSymmetricPentagonFaceDefinition(baseWidth: number, shoulderWidth: number, wallHeight: number, roofHeight: number, color: string = '#38bdf8'): FaceDefinition | null {
  const vertices = generateSymmetricPentagon(baseWidth, shoulderWidth, wallHeight, roofHeight);
  return vertices ? createFaceDefinition(`sym-pentagon-${baseWidth}-${shoulderWidth}-${wallHeight}-${roofHeight}`, vertices, color) : null;
}

export interface ShapePreset {
  id: string;
  title: string;
  color: string;
  create: () => FaceDefinition | null;
}

export const catalanShapePresets: ShapePreset[] = [
  {
    id: 'triakis-tetrahedron',
    title: 'Triakis Tetrahedron',
    color: '#f59e0b',
    create: () => {
      const triangle = generateIsoscelesTriangle(3 / 5, 1);
      return triangle ? createCatalanPresetDefinition('triakis-tetrahedron', triangle, '#f59e0b') : null;
    }
  },
  {
    id: 'tetrakis-hexahedron',
    title: 'Tetrakis Hexahedron',
    color: '#fb923c',
    create: () => {
      const triangle = generateIsoscelesTriangle(3 / 4, 1);
      return triangle ? createCatalanPresetDefinition('tetrakis-hexahedron', triangle, '#fb923c') : null;
    }
  },
  {
    id: 'triakis-octahedron',
    title: 'Triakis Octahedron',
    color: '#f97316',
    create: () => {
      const triangle = generateTriangleFromAngles(
        Math.acos(1 / 4 - SQRT2 / 2) * 180 / Math.PI,
        Math.acos(1 / 2 + SQRT2 / 4) * 180 / Math.PI,
        Math.acos(1 / 2 + SQRT2 / 4) * 180 / Math.PI
      );
      return triangle ? createCatalanPresetDefinition('triakis-octahedron', triangle, '#f97316') : null;
    }
  },
  {
    id: 'disdyakis-dodecahedron',
    title: 'Disdyakis Dodecahedron',
    color: '#fca5a5',
    create: () => {
      const triangle = generateTriangleFromAngles(
        Math.acos(1 / 6 - SQRT2 / 12) * 180 / Math.PI,
        Math.acos(3 / 4 - SQRT2 / 8) * 180 / Math.PI,
        Math.acos(1 / 12 + SQRT2 / 2) * 180 / Math.PI
      );
      return triangle ? createCatalanPresetDefinition('disdyakis-dodecahedron', triangle, '#fca5a5') : null;
    }
  },
  {
    id: 'disdyakis-triacontahedron',
    title: 'Disdyakis Triacontahedron',
    color: '#fb7185',
    create: () => {
      const triangle = generateTriangleFromAngles(
        Math.acos((7 - 4 * PHI) / 30) * 180 / Math.PI,
        Math.acos((17 - 4 * PHI) / 20) * 180 / Math.PI,
        Math.acos((2 + 5 * PHI) / 12) * 180 / Math.PI
      );
      return triangle ? createCatalanPresetDefinition('disdyakis-triacontahedron', triangle, '#fb7185') : null;
    }
  },
  {
    id: 'rhombic-dodecahedron',
    title: 'Rhombic Dodecahedron',
    color: '#c084fc',
    create: () => createCatalanPresetDefinition('rhombic-dodecahedron', generateRhombus(1, Math.acos(1 / 3) * 180 / Math.PI), '#c084fc')
  },
  {
    id: 'rhombic-triacontahedron',
    title: 'Rhombic Triacontahedron',
    color: '#a78bfa',
    create: () => createCatalanPresetDefinition('rhombic-triacontahedron', generateRhombus(1, Math.acos(1 / SQRT5) * 180 / Math.PI), '#a78bfa')
  },
  {
    id: 'triakis-icosahedron',
    title: 'Triakis Icosahedron',
    color: '#6366f1',
    create: () => {
      const triangle = generateTriangleFromAngles(
        Math.acos(-3 * PHI / 10) * 180 / Math.PI,
        Math.acos((PHI + 7) / 10) * 180 / Math.PI,
        Math.acos((PHI + 7) / 10) * 180 / Math.PI
      );
      return triangle ? createCatalanPresetDefinition('triakis-icosahedron', triangle, '#6366f1') : null;
    }
  },
  {
    id: 'pentakis-dodecahedron',
    title: 'Pentakis Dodecahedron',
    color: '#2563eb',
    create: () => {
      const triangle = generateTriangleFromAngles(
        Math.acos((-8 + 9 * PHI) / 18) * 180 / Math.PI,
        Math.acos((5 - PHI) / 6) * 180 / Math.PI,
        Math.acos((5 - PHI) / 6) * 180 / Math.PI
      );
      return triangle ? createCatalanPresetDefinition('pentakis-dodecahedron', triangle, '#2563eb') : null;
    }
  },
  {
    id: 'deltoidal-icositetrahedron',
    title: 'Deltoidal Icositetrahedron',
    color: '#8b5cf6',
    create: () => {
      const kite = generateKite(
        1,
        2 - 1 / SQRT2,
        Math.acos(-1 / 4 - SQRT2 / 8) * 180 / Math.PI
      );
      return kite ? createCatalanPresetDefinition('deltoidal-icositetrahedron', kite, '#8b5cf6') : null;
    }
  },
  {
    id: 'deltoidal-hexecontahedron',
    title: 'Deltoidal Hexecontahedron',
    color: '#7c3aed',
    create: () => {
      const kite = generateKite(
        1,
        (7 + SQRT5) / 6,
        Math.acos((-5 - 2 * SQRT5) / 20) * 180 / Math.PI
      );
      return kite ? createCatalanPresetDefinition('deltoidal-hexecontahedron', kite, '#7c3aed') : null;
    }
  },
  {
    id: 'pentagonal-icositetrahedron',
    title: 'Pentagonal Icositetrahedron',
    color: '#38bdf8',
    create: () => {
      const t = tribonacciConstant();
      const pentagon = generateSymmetricPentagonFromLengthsAndAngles(
        1,
        (t + 1) / 2,
        Math.acos(2 - t) * 180 / Math.PI,
        Math.acos((1 - t) / 2) * 180 / Math.PI
      );
      return pentagon ? createCatalanPresetDefinition('pentagonal-icositetrahedron', pentagon, '#38bdf8') : null;
    }
  },
  {
    id: 'pentagonal-hexecontahedron',
    title: 'Pentagonal Hexecontahedron',
    color: '#0ea5e9',
    create: () => {
      const xi = pentagonalHexecontahedronXi();
      const pentagon = generateSymmetricPentagonFromLengthsAndAngles(
        1,
        (1 + xi) / (2 - xi * xi),
        Math.acos(-PHI * PHI * xi / 2 + PHI) * 180 / Math.PI,
        Math.acos(-xi / 2) * 180 / Math.PI
      );
      return pentagon ? createCatalanPresetDefinition('pentagonal-hexecontahedron', pentagon, '#0ea5e9') : null;
    }
  }
];

export function generateGlueTab(p1: Point2D, p2: Point2D, height: number, angleDeg: number): Point2D[] {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    if (len < EPSILON) return [];

    const ux = dx / len;
    const uy = dy / len;

    // Normal pointing outward (assuming CCW winding for polygon).
    // Vector p1->p2. Outward normal is (dy, -dx).
    const nx = dy / len;
    const ny = -dx / len;

    // Trapezoid geometry
    // Base angles are angleDeg.
    // Inset amount = height / tan(angle)
    const angleRad = angleDeg * Math.PI / 180;
    const inset = height / Math.tan(angleRad);
    
    // If inset is too large, cap it to half length (triangle)
    const actualInset = Math.min(inset, len / 2);
    
    const t1 = {
        x: p1.x + nx * height + ux * actualInset,
        y: p1.y + ny * height + uy * actualInset
    };
    const t2 = {
        x: p2.x + nx * height - ux * actualInset,
        y: p2.y + ny * height - uy * actualInset
    };

    return [p1, t1, t2, p2];
}

export function parseCustomShape(text: string): Point2D[] | null {
  try {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    const points: Point2D[] = [];
    for (const line of lines) {
      const parts = line.trim().split(/[\s,]+/);
      if (parts.length >= 2) {
        const x = parseFloat(parts[0]);
        const y = parseFloat(parts[1]);
        if (!isNaN(x) && !isNaN(y)) {
          points.push({ x, y });
        }
      }
    }
    if (points.length < 3) return null;

    // 1. Calculate Centroid
    let cx = 0, cy = 0;
    points.forEach(p => { cx += p.x; cy += p.y; });
    cx /= points.length;
    cy /= points.length;

    // 2. Center points
    const centered = points.map(p => ({ x: p.x - cx, y: p.y - cy }));

    // 3. Scale normalization logic
    // The user wants to attach to sides of length ~1.
    // Our internal unit for side length is 60.
    // So if the average side length is small (< 10), we scale by 60.
    let totalLen = 0;
    for(let i=0; i<centered.length; i++) {
        const p1 = centered[i];
        const p2 = centered[(i+1)%centered.length];
        totalLen += Math.sqrt((p1.x-p2.x)**2 + (p1.y-p2.y)**2);
    }
    const avgLen = totalLen / centered.length;
    
    let scale = 1;
    if (avgLen < 10) {
       scale = 60; 
    }

    // Rotate 180 to match app convention (y-up vs y-down preference)
    return normalizePolygonOrientation(centered.map(p => ({ x: -p.x * scale, y: -p.y * scale })));

  } catch (e) {
    console.error("Parse error", e);
    return null;
  }
}

export function getShapeDefinition(type: ShapeType): FaceDefinition {
  const side = 60;
  
  // Parse n-gon
  if (type.startsWith('ngon-')) {
    const parts = type.split('-');
    const n = parseInt(parts[1], 10);
    if (!isNaN(n) && n >= 3) {
        const r = radiusForRegularPolygonSideLength(n, side);
        return { type, vertices: generateRegularPolygon(n, r), color: getRegularPolygonColor(n) };
    }
  }

  switch (type) {
    case 'triangle': return { type, vertices: generateRegularPolygon(3, radiusForRegularPolygonSideLength(3, side)), color: getRegularPolygonColor(3) }; 
    case 'square': return { type, vertices: generateRegularPolygon(4, radiusForRegularPolygonSideLength(4, side)), color: getRegularPolygonColor(4) }; 
    case 'pentagon': return { type, vertices: generateRegularPolygon(5, radiusForRegularPolygonSideLength(5, side)), color: getRegularPolygonColor(5) }; 
    case 'hexagon': return { type, vertices: generateRegularPolygon(6, radiusForRegularPolygonSideLength(6, side)), color: getRegularPolygonColor(6) }; 
    case 'rhombus': return { type, vertices: generateRhombus(side, 63.434949), color: '#a78bfa' }; 
    case 'custom': return { type, vertices: [], color: '#d946ef' }; // Placeholder
    default: return { type: 'square', vertices: generateRegularPolygon(4, radiusForRegularPolygonSideLength(4, side)), color: '#ccc' };
  }
}

// ---------------- Linear Algebra 2D ----------------

export function vecSub(a: Point2D, b: Point2D): Point2D {
  if (!a || !b) return { x: 0, y: 0 };
  const ax = typeof a.x === 'number' ? a.x : 0;
  const ay = typeof a.y === 'number' ? a.y : 0;
  const bx = typeof b.x === 'number' ? b.x : 0;
  const by = typeof b.y === 'number' ? b.y : 0;
  return { x: ax - bx, y: ay - by };
}

export function vecAdd(a: Point2D, b: Point2D): Point2D {
  if (!a || !b) return { x: 0, y: 0 };
  const ax = typeof a.x === 'number' ? a.x : 0;
  const ay = typeof a.y === 'number' ? a.y : 0;
  const bx = typeof b.x === 'number' ? b.x : 0;
  const by = typeof b.y === 'number' ? b.y : 0;
  return { x: ax + bx, y: ay + by };
}

export function vecLen(v: Point2D): number {
  if (!v) return 0;
  const vx = typeof v.x === 'number' ? v.x : 0;
  const vy = typeof v.y === 'number' ? v.y : 0;
  return Math.sqrt(vx * vx + vy * vy);
}

export function distPointToSegment(p: Point2D, a: Point2D, b: Point2D): number {
  if (!p || !a || !b) return Infinity;
  if (typeof a.x !== 'number' || typeof b.x !== 'number') return Infinity;
  
  const l2 = (a.x - b.x)**2 + (a.y - b.y)**2;
  if (l2 === 0) return vecLen(vecSub(p, a));
  
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  
  const proj = {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y)
  };
  return vecLen(vecSub(p, proj));
}

export type Mat3 = [number, number, number, number, number, number, number, number, number];

export function identity3(): Mat3 {
  return [1,0,0, 0,1,0, 0,0,1];
}

export function createTransform2D(x: number, y: number, rotation: number): Mat3 {
  const c = Math.cos(rotation || 0);
  const s = Math.sin(rotation || 0);
  return [c, -s, x || 0, s, c, y || 0, 0, 0, 1];
}

export function matMul3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9) as any;
  if (!a || !b) return identity3();
  for(let r=0; r<3; r++) {
    for(let c=0; c<3; c++) {
      out[r*3+c] = a[r*3+0]*b[0+c] + a[r*3+1]*b[3+c] + a[r*3+2]*b[6+c];
    }
  }
  return out;
}

export function invert3(m: Mat3): Mat3 {
  if (!m) return identity3();
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) -
              m[1] * (m[3] * m[8] - m[5] * m[6]) +
              m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (Math.abs(det) < EPSILON) return identity3();
  const invDet = 1.0 / det;
  const out = [] as any;
  out[0] = (m[4] * m[8] - m[5] * m[7]) * invDet;
  out[1] = (m[2] * m[7] - m[1] * m[8]) * invDet;
  out[2] = (m[1] * m[5] - m[2] * m[4]) * invDet;
  out[3] = (m[5] * m[6] - m[3] * m[8]) * invDet;
  out[4] = (m[0] * m[8] - m[2] * m[6]) * invDet;
  out[5] = (m[2] * m[3] - m[0] * m[5]) * invDet;
  out[6] = (m[3] * m[7] - m[4] * m[6]) * invDet;
  out[7] = (m[1] * m[6] - m[0] * m[7]) * invDet;
  out[8] = (m[0] * m[4] - m[1] * m[3]) * invDet;
  return out;
}

export function applyTransform2D(m: Mat3, p: Point2D): Point2D {
  if (!p || !m) return { x: 0, y: 0 };
  const px = typeof p.x === 'number' ? p.x : 0;
  const py = typeof p.y === 'number' ? p.y : 0;
  return {
    x: m[0] * px + m[1] * py + m[2],
    y: m[3] * px + m[4] * py + m[5]
  };
}

// ---------------- 3D Linear Algebra ----------------

export type Mat4 = number[];

export function identity4(): Mat4 {
  return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
}

export function matMul4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0);
  if (!a || !b) return identity4();
  for(let r=0; r<4; r++) {
    for(let c=0; c<4; c++) {
      for(let k=0; k<4; k++) {
        out[r*4+c] += a[r*4+k] * b[k*4+c];
      }
    }
  }
  return out;
}

export function from2DTo3D(x: number, y: number, rot: number): Mat4 {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [
    c, -s, 0, x,
    s,  c, 0, y,
    0,  0, 1, 0,
    0,  0, 0, 1
  ];
}

export function invert2DIn3D(m: Mat4): Mat4 {
  const c = m[0]; 
  const s = m[4]; 
  const x = m[3];
  const y = m[7];
  const tx = -(c * x + s * y);
  const ty = -(-s * x + c * y);
  return [
    c,  s, 0, tx,
    -s, c, 0, ty,
     0, 0, 1, 0,
     0, 0, 0, 1
  ];
}

export function normalize3(v: Point3D): Point3D {
  const l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (l < 1e-9) return { x: 0, y: 0, z: 0 };
  return { x: v.x/l, y: v.y/l, z: v.z/l };
}

export function sub3(a: Point3D, b: Point3D): Point3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add3(a: Point3D, b: Point3D): Point3D {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function dot3(a: Point3D, b: Point3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross3(a: Point3D, b: Point3D): Point3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

export function scale3(v: Point3D, s: number): Point3D {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function length3(v: Point3D): number {
  return Math.sqrt(dot3(v, v));
}

export function distance3(a: Point3D, b: Point3D): number {
  return length3(sub3(a, b));
}

export function applyMatrix4(p: Point3D, m: Mat4): Point3D {
  const x = m[0]*p.x + m[1]*p.y + m[2]*p.z + m[3];
  const y = m[4]*p.x + m[5]*p.y + m[6]*p.z + m[7];
  const z = m[8]*p.x + m[9]*p.y + m[10]*p.z + m[11];
  return { x, y, z };
}

export function createRotationAroundAxis(point: Point3D, direction: Point3D, angleRad: number): Mat4 {
  const u = normalize3(direction);
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const C = 1 - c;
  const {x, y, z} = u;
  
  const R = [
    c + x*x*C,     x*y*C - z*s,   x*z*C + y*s, 0,
    y*x*C + z*s,   c + y*y*C,     y*z*C - x*s, 0,
    z*x*C - y*s,   z*y*C + x*s,   c + z*z*C,   0,
    0,             0,             0,           1
  ];
  
  const T_inv = [1, 0, 0, -point.x, 0, 1, 0, -point.y, 0, 0, 1, -point.z, 0, 0, 0, 1];
  const T = [1, 0, 0, point.x, 0, 1, 0, point.y, 0, 0, 1, point.z, 0, 0, 0, 1];
  
  const mRot = [
      R[0], R[1], R[2], R[3],
      R[4], R[5], R[6], R[7],
      R[8], R[9], R[10], R[11],
      R[12], R[13], R[14], R[15]
  ];

  return matMul4(T, matMul4(mRot, T_inv));
}

// ---------------- 3D Layout ----------------

export function compute3DLayout(net: PolyNet, rootId?: string): { items: { face: PlacedFace, matrix: Mat4 }[], matrices: Record<string, Mat4> } {
  const faces = Object.values(net.faces);
  if (faces.length === 0) return { items: [], matrices: {} };

  let root = faces[0];
  if (rootId && net.faces[rootId]) {
    root = net.faces[rootId];
  }
  
  const adj: Record<string, Array<{ neighborId: string, connId: string }>> = {};
  faces.forEach(f => adj[f.id] = []);
  
  net.connections.forEach(c => {
    if (adj[c.faceAId]) adj[c.faceAId].push({ neighborId: c.faceBId, connId: c.id });
    if (adj[c.faceBId]) adj[c.faceBId].push({ neighborId: c.faceAId, connId: c.id });
  });

  const worldMatrices: Record<string, Mat4> = {};
  const visited = new Set<string>();
  const queue = [root.id];
  
  if (rootId) {
    worldMatrices[root.id] = identity4();
  } else {
    worldMatrices[root.id] = from2DTo3D(root.transform.x, root.transform.y, root.transform.rotation);
  }
  visited.add(root.id);

  const result: { face: PlacedFace, matrix: Mat4 }[] = [];
  result.push({ face: root, matrix: worldMatrices[root.id] });

  while (queue.length > 0) {
    const pid = queue.shift()!;
    const pFace = net.faces[pid];
    const pMatrix = worldMatrices[pid];

    const neighbors = adj[pid] || [];
    for (const item of neighbors) {
      const cid = item.neighborId;
      if (visited.has(cid)) continue;

      const cFace = net.faces[cid];
      if (!cFace) continue;

      const Mp_2d = from2DTo3D(pFace.transform.x, pFace.transform.y, pFace.transform.rotation);
      const Mc_2d = from2DTo3D(cFace.transform.x, cFace.transform.y, cFace.transform.rotation);
      
      // Relative transform in 2D
      const H_flat = matMul4(invert2DIn3D(Mp_2d), Mc_2d);

      const conn = net.connections.find(c => c.id === item.connId);
      if (!conn) continue;

      const pEdgeIdx = (conn.faceAId === pid) ? conn.edgeAIndex : conn.edgeBIndex;
      
      const v1 = pFace.def.vertices[pEdgeIdx];
      const v2 = pFace.def.vertices[(pEdgeIdx + 1) % pFace.def.vertices.length];
      
      const axisPt: Point3D = { x: v1.x, y: v1.y, z: 0 };
      const axisDir: Point3D = { x: v2.x - v1.x, y: v2.y - v1.y, z: 0 };

      const theta = (conn.foldAngle || 0) * (Math.PI / 180);
      const R_fold = createRotationAroundAxis(axisPt, axisDir, theta);

      const W_child = matMul4(pMatrix, matMul4(R_fold, H_flat));

      worldMatrices[cid] = W_child;
      visited.add(cid);
      queue.push(cid);
      result.push({ face: cFace, matrix: W_child });
    }
  }

  return { items: result, matrices: worldMatrices };
}

// ---------------- Solver ----------------

export function solveSphericalIntersection(
  center: Point3D,
  axis1: Point3D, p1: Point3D,
  axis2: Point3D, p2: Point3D
): [Point3D, Point3D] | null {
  // 1. Shift everything to origin relative to center
  const u1 = normalize3(axis1);
  const u2 = normalize3(axis2);
  const v1 = sub3(p1, center);
  const v2 = sub3(p2, center);
  
  // Radius check
  const r1 = length3(v1);
  const r2 = length3(v2);
  if (Math.abs(r1 - r2) > MAGNET_EDGE_MATCH_EPSILON) return null;
  const R = (r1 + r2) / 2;
  
  // Plane equations: u_i . x = d_i
  const d1 = dot3(u1, v1);
  const d2 = dot3(u2, v2);
  
  // Intersection of two planes is a line: L(t) = L0 + t * Ldir
  const Ldir = cross3(u1, u2);
  const sinAngle = dot3(Ldir, Ldir); // length squared
  
  // If parallel axes
  if (sinAngle < 1e-6) {
    return null; 
  }
  
  // Solve for L0 (point on line closest to origin)
  const cosAlpha = dot3(u1, u2);
  const det = 1 - cosAlpha * cosAlpha;
  const c1 = (d1 - d2 * cosAlpha) / det;
  const c2 = (d2 - d1 * cosAlpha) / det;
  
  const L0 = add3(scale3(u1, c1), scale3(u2, c2));
  
  // Intersection of line with Sphere radius R
  // |L0 + t*Ldir|^2 = R^2
  const distSq = dot3(L0, L0);
  if (distSq > (R + MAGNET_EDGE_MATCH_EPSILON) * (R + MAGNET_EDGE_MATCH_EPSILON)) return null; // Line outside sphere
  
  const tSq = Math.max(0, (R * R - distSq) / dot3(Ldir, Ldir));
  const t = Math.sqrt(tSq);
  
  const sol1 = add3(L0, scale3(Ldir, t));
  const sol2 = add3(L0, scale3(Ldir, -t));
  
  return [add3(sol1, center), add3(sol2, center)];
}

export interface MagnetSolveResult {
  updates: { connId: string; delta: number }[];
}

interface FaceEdgeRef {
  faceId: string;
  edgeIndex: number;
}

interface MagnetSelection3DInfo {
  connId: string;
  axis: Point3D;
  motionScale: number;
  axisOrigin: Point3D;
  currentTip: Point3D;
  circleCenter: Point3D;
  radius: number;
}

interface VertexCoincidenceGroup {
  id: string;
  point: Point3D;
  members: { faceId: string; vertexIndex: number; point: Point3D }[];
}

interface FaceEdge3DInfo {
  faceId: string;
  edgeIndex: number;
  startGroupId: string;
  endGroupId: string;
  startPoint: Point3D;
  endPoint: Point3D;
}

export interface CoincidenceGraph3D {
  matrices: Record<string, Mat4>;
  vertexGroupsById: Record<string, VertexCoincidenceGroup>;
  edgeInfoByRefKey: Record<string, FaceEdge3DInfo>;
  edgeGroupsByRefKey: Record<string, FaceEdgeRef[]>;
}

interface MagnetSolveCandidate {
  updates: { connId: string; delta: number }[];
  totalDelta: number;
  orientation: number;
  points?: Point3D[];
}

export function faceEdgeRefKey(faceId: string, edgeIndex: number): string {
  return `${faceId}:${edgeIndex}`;
}

function getFaceVertex3D(face: PlacedFace, matrix: Mat4, vertexIndex: number): Point3D {
  const vertex = face.def.vertices[((vertexIndex % face.def.vertices.length) + face.def.vertices.length) % face.def.vertices.length];
  return applyMatrix4({ x: vertex.x, y: vertex.y, z: 0 }, matrix);
}

function getConnectionForFaceEdge(net: PolyNet, faceId: string, edgeIndex: number): Connection | null {
  return net.connections.find(c =>
    (c.faceAId === faceId && c.edgeAIndex === edgeIndex) ||
    (c.faceBId === faceId && c.edgeBIndex === edgeIndex)
  ) || null;
}

function getOtherFaceId(conn: Connection, faceId: string): string {
  return conn.faceAId === faceId ? conn.faceBId : conn.faceAId;
}

function getSelectedEdgeVertexIndices(face: PlacedFace, selectedEdgeIndex: number, sharedAtStart: boolean) {
  const vertexCount = face.def.vertices.length;
  return {
    sharedVertexIndex: sharedAtStart ? selectedEdgeIndex : (selectedEdgeIndex + 1) % vertexCount,
    tipVertexIndex: sharedAtStart ? (selectedEdgeIndex + 1) % vertexCount : selectedEdgeIndex
  };
}

export function build3DCoincidenceGraph(net: PolyNet, rootId?: string): CoincidenceGraph3D {
  const matrices: Record<string, Mat4> = {};
  const componentKeyByFaceId: Record<string, string> = {};
  const orderedFaceIds = Object.keys(net.faces);
  const seedFaceIds = rootId && net.faces[rootId]
    ? [rootId, ...orderedFaceIds.filter(faceId => faceId !== rootId)]
    : orderedFaceIds;

  seedFaceIds.forEach(faceId => {
    if (matrices[faceId] || !net.faces[faceId]) return;
    const componentFaceIds = Array.from(getConnectedComponent(net, faceId));
    const layout = compute3DLayout(net, faceId);
    componentFaceIds.forEach(componentFaceId => {
      const matrix = layout.matrices[componentFaceId];
      if (matrix) {
        matrices[componentFaceId] = matrix;
        componentKeyByFaceId[componentFaceId] = faceId;
      }
    });
  });

  const vertexGroups: VertexCoincidenceGroup[] = [];
  const vertexGroupByMemberKey: Record<string, string> = {};

  Object.values(net.faces).forEach(face => {
    const matrix = matrices[face.id];
    if (!matrix) return;
    const componentKey = componentKeyByFaceId[face.id] || face.id;

    face.def.vertices.forEach((_, vertexIndex) => {
      const point = getFaceVertex3D(face, matrix, vertexIndex);
      let group = vertexGroups.find(candidate =>
        candidate.id.startsWith(`vg-${componentKey}-`) &&
        distance3(candidate.point, point) <= MAGNET_VERTEX_EPSILON
      );

      if (!group) {
        group = {
          id: `vg-${componentKey}-${vertexGroups.length}`,
          point,
          members: []
        };
        vertexGroups.push(group);
      }

      group.members.push({ faceId: face.id, vertexIndex, point });
      const count = group.members.length;
      group.point = scale3(
        add3(scale3(group.point, count - 1), point),
        1 / count
      );
      vertexGroupByMemberKey[faceEdgeRefKey(face.id, vertexIndex)] = group.id;
    });
  });

  const vertexGroupsById: Record<string, VertexCoincidenceGroup> = {};
  vertexGroups.forEach(group => {
    vertexGroupsById[group.id] = group;
  });

  const edgeInfoByRefKey: Record<string, FaceEdge3DInfo> = {};
  const edgeGroups = new Map<string, FaceEdgeRef[]>();

  Object.values(net.faces).forEach(face => {
    const matrix = matrices[face.id];
    if (!matrix) return;

    face.def.vertices.forEach((_, edgeIndex) => {
      const nextVertexIndex = (edgeIndex + 1) % face.def.vertices.length;
      const startGroupId = vertexGroupByMemberKey[faceEdgeRefKey(face.id, edgeIndex)];
      const endGroupId = vertexGroupByMemberKey[faceEdgeRefKey(face.id, nextVertexIndex)];
      if (!startGroupId || !endGroupId) return;

      const ref: FaceEdgeRef = { faceId: face.id, edgeIndex };
      const refKey = faceEdgeRefKey(ref.faceId, ref.edgeIndex);
      const info: FaceEdge3DInfo = {
        faceId: face.id,
        edgeIndex,
        startGroupId,
        endGroupId,
        startPoint: getFaceVertex3D(face, matrix, edgeIndex),
        endPoint: getFaceVertex3D(face, matrix, edgeIndex + 1)
      };
      edgeInfoByRefKey[refKey] = info;

      const edgeGroupKey = [startGroupId, endGroupId].sort().join('|');
      const group = edgeGroups.get(edgeGroupKey) || [];
      group.push(ref);
      edgeGroups.set(edgeGroupKey, group);
    });
  });

  const edgeGroupsByRefKey: Record<string, FaceEdgeRef[]> = {};
  edgeGroups.forEach(group => {
    group.forEach(ref => {
      edgeGroupsByRefKey[faceEdgeRefKey(ref.faceId, ref.edgeIndex)] = group;
    });
  });

  return {
    matrices,
    vertexGroupsById,
    edgeInfoByRefKey,
    edgeGroupsByRefKey
  };
}

export function get3DEdgeCoincidenceKey(net: PolyNet, faceId: string, edgeIndex: number, rootId?: string): string {
  const graph = build3DCoincidenceGraph(net, rootId);
  const info = graph.edgeInfoByRefKey[faceEdgeRefKey(faceId, edgeIndex)];
  if (!info) {
    return faceEdgeRefKey(faceId, edgeIndex);
  }
  return [info.startGroupId, info.endGroupId].sort().join('|');
}

function expandMagnetSelectionCandidates(graph: CoincidenceGraph3D, selection: MagnetEdge): FaceEdgeRef[] {
  return graph.edgeGroupsByRefKey[faceEdgeRefKey(selection.faceId, selection.edgeIndex)] || [selection];
}

function buildMagnetSelection3DInfo(
  net: PolyNet,
  face: PlacedFace,
  currentMatrix: Mat4,
  selectedEdgeIndex: number,
  sharedAtStart: boolean
): MagnetSelection3DInfo | null {
  const vertexCount = face.def.vertices.length;
  const hingeEdgeIndex = sharedAtStart
    ? (selectedEdgeIndex - 1 + vertexCount) % vertexCount
    : (selectedEdgeIndex + 1) % vertexCount;

  const conn = getConnectionForFaceEdge(net, face.id, hingeEdgeIndex);
  if (!conn) return null;

  const { sharedVertexIndex, tipVertexIndex } = getSelectedEdgeVertexIndices(face, selectedEdgeIndex, sharedAtStart);
  const currentHingeStart = getFaceVertex3D(face, currentMatrix, hingeEdgeIndex);
  const currentHingeEnd = getFaceVertex3D(face, currentMatrix, hingeEdgeIndex + 1);
  const currentAxis = normalize3(sub3(currentHingeStart, currentHingeEnd));
  if (length3(currentAxis) < MAGNET_PARALLEL_EPSILON) return null;

  const rootId = getOtherFaceId(conn, face.id);
  const baseMatrices = compute3DLayout(net, rootId).matrices;
  const baseMatrix = baseMatrices[face.id];
  if (!baseMatrix) return null;

  const baseSharedPoint = getFaceVertex3D(face, baseMatrix, sharedVertexIndex);
  const baseTipPoint = getFaceVertex3D(face, baseMatrix, tipVertexIndex);
  const baseHingeStart = getFaceVertex3D(face, baseMatrix, hingeEdgeIndex);
  const baseHingeEnd = getFaceVertex3D(face, baseMatrix, hingeEdgeIndex + 1);
  const baseAxis = normalize3(sub3(baseHingeStart, baseHingeEnd));
  if (length3(baseAxis) < MAGNET_PARALLEL_EPSILON) return null;

  const probedNet: PolyNet = {
    ...net,
    connections: net.connections.map(item =>
      item.id === conn.id
        ? { ...item, foldAngle: (item.foldAngle || 0) + MAGNET_PROBE_ANGLE_DEG }
        : item
    )
  };
  const probedMatrices = compute3DLayout(probedNet, rootId).matrices;
  const probedMatrix = probedMatrices[face.id];
  if (!probedMatrix) return null;

  const probedTipPoint = getFaceVertex3D(face, probedMatrix, tipVertexIndex);
  const motionAngle = signedAngleAroundAxis(baseSharedPoint, baseTipPoint, probedTipPoint, baseAxis);
  if (Math.abs(motionAngle) < MAGNET_LENGTH_EPSILON) return null;

  const motionScale = motionAngle / MAGNET_PROBE_ANGLE_DEG;
  if (Math.abs(motionScale) < MAGNET_PARALLEL_EPSILON) return null;

  if (distance3(baseSharedPoint, baseTipPoint) < MAGNET_LENGTH_EPSILON) {
    return null;
  }

  const currentTip = getFaceVertex3D(face, currentMatrix, tipVertexIndex);
  const circleCenter = projectPointOntoAxis(currentHingeStart, currentAxis, currentTip);

  return {
    connId: conn.id,
    axis: currentAxis,
    motionScale,
    axisOrigin: currentHingeStart,
    currentTip,
    circleCenter,
    radius: distance3(circleCenter, currentTip)
  };
}

function getFaceEdgeEndpoints3D(face: PlacedFace, matrix: Mat4, edgeIndex: number): { start: Point3D; end: Point3D } {
  return {
    start: getFaceVertex3D(face, matrix, edgeIndex),
    end: getFaceVertex3D(face, matrix, edgeIndex + 1)
  };
}

function getMagnetComponentRootId(net: PolyNet, preferredRootId: string | undefined, faceId: string): string {
  const component = getConnectedComponent(net, faceId);
  if (preferredRootId && component.has(preferredRootId)) {
    return preferredRootId;
  }
  return faceId;
}

function applyMagnetConnectionDeltas(
  net: PolyNet,
  deltaByConnId: Record<string, number>
): PolyNet {
  return {
    ...net,
    connections: net.connections.map(connection => {
      const delta = deltaByConnId[connection.id];
      return typeof delta === 'number'
        ? { ...connection, foldAngle: (connection.foldAngle || 0) + delta }
        : connection;
    })
  };
}

function evaluateMagnetConfiguration(
  net: PolyNet,
  preferredRootId: string | undefined,
  selectionA: FaceEdgeRef,
  selectionB: FaceEdgeRef,
  shared1AtStart: boolean,
  shared2AtStart: boolean,
  deltaByConnId: Record<string, number>,
  orientationReference: Point3D
) {
  const updatedNet = applyMagnetConnectionDeltas(net, deltaByConnId);
  const rootId = getMagnetComponentRootId(updatedNet, preferredRootId, selectionA.faceId);
  const layout = compute3DLayout(updatedNet, rootId);
  const face1 = updatedNet.faces[selectionA.faceId];
  const face2 = updatedNet.faces[selectionB.faceId];
  const matrix1 = layout.matrices[selectionA.faceId];
  const matrix2 = layout.matrices[selectionB.faceId];

  if (!face1 || !face2 || !matrix1 || !matrix2) {
    return null;
  }

  const indices1 = getSelectedEdgeVertexIndices(face1, selectionA.edgeIndex, shared1AtStart);
  const indices2 = getSelectedEdgeVertexIndices(face2, selectionB.edgeIndex, shared2AtStart);

  const shared1 = getFaceVertex3D(face1, matrix1, indices1.sharedVertexIndex);
  const tip1 = getFaceVertex3D(face1, matrix1, indices1.tipVertexIndex);
  const shared2 = getFaceVertex3D(face2, matrix2, indices2.sharedVertexIndex);
  const tip2 = getFaceVertex3D(face2, matrix2, indices2.tipVertexIndex);

  const sharedDistance = distance3(shared1, shared2);
  const tipDistance = distance3(tip1, tip2);
  const averagedShared = scale3(add3(shared1, shared2), 0.5);
  const averagedTip = scale3(add3(tip1, tip2), 0.5);

  return {
    sharedDistance,
    tipDistance,
    totalDistance: sharedDistance + tipDistance,
    orientation: dot3(sub3(averagedTip, averagedShared), orientationReference)
  };
}

function getMovableConnectionsForFace(net: PolyNet, faceId: string): Connection[] {
  return net.connections.filter(connection => connection.faceAId === faceId || connection.faceBId === faceId);
}

function refineMagnetDelta1D(
  evaluator: (delta: number) => number,
  seed: number
): { delta: number; score: number } {
  let bestDelta = seed;
  let bestScore = evaluator(seed);
  const spans = [180, 60, 20, 5, 1, 0.2, 0.05, 0.01, 0.002, 0.0005, 0.0001];

  spans.forEach(span => {
    for (let offset = -2; offset <= 2; offset += 1) {
      const candidateDelta = Math.max(-360, Math.min(360, bestDelta + offset * span));
      const candidateScore = evaluator(candidateDelta);
      if (candidateScore < bestScore) {
        bestScore = candidateScore;
        bestDelta = candidateDelta;
      }
    }
  });

  return { delta: bestDelta, score: bestScore };
}

function solveMagnetFoldNumericallyForPair(
  net: PolyNet,
  selectionA: FaceEdgeRef,
  selectionB: FaceEdgeRef,
  preferredRootId: string | undefined,
  edgeInfo1: FaceEdge3DInfo,
  edgeInfo2: FaceEdge3DInfo,
  sharedGroupIds: string[]
): MagnetSolveCandidate | null {
  const movableConnectionsA = getMovableConnectionsForFace(net, selectionA.faceId);
  const movableConnectionsB = getMovableConnectionsForFace(net, selectionB.faceId);
  if (movableConnectionsA.length === 0 && movableConnectionsB.length === 0) {
    return null;
  }

  let bestCandidate: MagnetSolveCandidate | null = null;

  sharedGroupIds.forEach(sharedGroupId => {
    const shared1AtStart = edgeInfo1.startGroupId === sharedGroupId;
    const shared2AtStart = edgeInfo2.startGroupId === sharedGroupId;
    const vector1 = sub3(shared1AtStart ? edgeInfo1.endPoint : edgeInfo1.startPoint, shared1AtStart ? edgeInfo1.startPoint : edgeInfo1.endPoint);
    const vector2 = sub3(shared2AtStart ? edgeInfo2.endPoint : edgeInfo2.startPoint, shared2AtStart ? edgeInfo2.startPoint : edgeInfo2.endPoint);
    const orientationReference = cross3(vector1, vector2);
    const hasOrientationPreference = length3(orientationReference) >= MAGNET_PARALLEL_EPSILON;

    const considerCandidate = (updates: { connId: string; delta: number }[]) => {
      const deltaByConnId = updates.reduce<Record<string, number>>((acc, update) => {
        acc[update.connId] = update.delta;
        return acc;
      }, {});

      const evaluation = evaluateMagnetConfiguration(
        net,
        preferredRootId,
        selectionA,
        selectionB,
        shared1AtStart,
        shared2AtStart,
        deltaByConnId,
        orientationReference
      );

      if (!evaluation) return;
      if (evaluation.sharedDistance > MAGNET_VERIFY_EPSILON || evaluation.tipDistance > MAGNET_VERIFY_EPSILON) return;

      const totalDelta = updates.reduce((sum, update) => sum + Math.abs(update.delta), 0);
      const candidate: MagnetSolveCandidate = {
        updates,
        totalDelta,
        orientation: evaluation.orientation
      };

      const isBetter =
        !bestCandidate ||
        (
          hasOrientationPreference &&
          bestCandidate.orientation <= 0 &&
          candidate.orientation > 0
        ) ||
        (
          (!hasOrientationPreference || Math.sign(candidate.orientation) === Math.sign(bestCandidate.orientation)) &&
          candidate.totalDelta < bestCandidate.totalDelta
        );

      if (isBetter) {
        bestCandidate = candidate;
      }
    };

    [...movableConnectionsA, ...movableConnectionsB].forEach(connection => {
      const optimized = refineMagnetDelta1D(delta => {
        const evaluation = evaluateMagnetConfiguration(
          net,
          preferredRootId,
          selectionA,
          selectionB,
          shared1AtStart,
          shared2AtStart,
          { [connection.id]: delta },
          orientationReference
        );
        return evaluation ? evaluation.totalDistance : Infinity;
      }, 0);

      considerCandidate([{ connId: connection.id, delta: optimized.delta }]);
    });

    movableConnectionsA.forEach(connectionA => {
      movableConnectionsB.forEach(connectionB => {
        if (connectionA.id === connectionB.id) return;

        const seeds = [-180, 0, 180];
        seeds.forEach(seedA => {
          seeds.forEach(seedB => {
            let currentA = seedA;
            let currentB = seedB;

            for (let iteration = 0; iteration < 4; iteration += 1) {
              currentA = refineMagnetDelta1D(delta => {
                const evaluation = evaluateMagnetConfiguration(
                  net,
                  preferredRootId,
                  selectionA,
                  selectionB,
                  shared1AtStart,
                  shared2AtStart,
                  { [connectionA.id]: delta, [connectionB.id]: currentB },
                  orientationReference
                );
                return evaluation ? evaluation.totalDistance : Infinity;
              }, currentA).delta;

              currentB = refineMagnetDelta1D(delta => {
                const evaluation = evaluateMagnetConfiguration(
                  net,
                  preferredRootId,
                  selectionA,
                  selectionB,
                  shared1AtStart,
                  shared2AtStart,
                  { [connectionA.id]: currentA, [connectionB.id]: delta },
                  orientationReference
                );
                return evaluation ? evaluation.totalDistance : Infinity;
              }, currentB).delta;
            }

            considerCandidate([
              { connId: connectionA.id, delta: currentA },
              { connId: connectionB.id, delta: currentB }
            ]);
          });
        });
      });
    });
  });

  return bestCandidate;
}

function getSharedVertexGroupIds(edgeInfoA: FaceEdge3DInfo, edgeInfoB: FaceEdge3DInfo): string[] {
  const shared = new Set<string>();
  if (edgeInfoA.startGroupId === edgeInfoB.startGroupId || edgeInfoA.startGroupId === edgeInfoB.endGroupId) {
    shared.add(edgeInfoA.startGroupId);
  }
  if (edgeInfoA.endGroupId === edgeInfoB.startGroupId || edgeInfoA.endGroupId === edgeInfoB.endGroupId) {
    shared.add(edgeInfoA.endGroupId);
  }
  return Array.from(shared);
}

function chooseSharedVertex(
  e1Start: Point3D,
  e1End: Point3D,
  e2Start: Point3D,
  e2End: Point3D
): {
  sharedPoint: Point3D;
  tip1: Point3D;
  tip2: Point3D;
  shared1AtStart: boolean;
  shared2AtStart: boolean;
} | null {
  const candidates = [
    {
      distance: distance3(e1Start, e2Start),
      sharedPoint: scale3(add3(e1Start, e2Start), 0.5),
      tip1: e1End,
      tip2: e2End,
      shared1AtStart: true,
      shared2AtStart: true,
    },
    {
      distance: distance3(e1Start, e2End),
      sharedPoint: scale3(add3(e1Start, e2End), 0.5),
      tip1: e1End,
      tip2: e2Start,
      shared1AtStart: true,
      shared2AtStart: false,
    },
    {
      distance: distance3(e1End, e2Start),
      sharedPoint: scale3(add3(e1End, e2Start), 0.5),
      tip1: e1Start,
      tip2: e2End,
      shared1AtStart: false,
      shared2AtStart: true,
    },
    {
      distance: distance3(e1End, e2End),
      sharedPoint: scale3(add3(e1End, e2End), 0.5),
      tip1: e1Start,
      tip2: e2Start,
      shared1AtStart: false,
      shared2AtStart: false,
    }
  ].sort((a, b) => a.distance - b.distance);

  if (candidates[0].distance > MAGNET_VERTEX_EPSILON) return null;
  return candidates[0];
}

function signedAngleAroundAxis(origin: Point3D, current: Point3D, target: Point3D, axis: Point3D): number {
  const currentRelative = sub3(current, origin);
  const targetRelative = sub3(target, origin);
  const currentProjected = sub3(currentRelative, scale3(axis, dot3(currentRelative, axis)));
  const targetProjected = sub3(targetRelative, scale3(axis, dot3(targetRelative, axis)));

  if (
    length3(currentProjected) < MAGNET_LENGTH_EPSILON ||
    length3(targetProjected) < MAGNET_LENGTH_EPSILON
  ) {
    return 0;
  }

  const y = dot3(cross3(currentProjected, targetProjected), axis);
  const x = dot3(currentProjected, targetProjected);
  return Math.atan2(y, x) * (180 / Math.PI);
}

function rotateAroundAxis(point: Point3D, origin: Point3D, axis: Point3D, angleDeg: number): Point3D {
  const matrix = createRotationAroundAxis(origin, axis, angleDeg * Math.PI / 180);
  return applyMatrix4(point, matrix);
}

function solveMagnetFoldForPair(
  net: PolyNet,
  selectionA: FaceEdgeRef,
  selectionB: FaceEdgeRef,
  graph: CoincidenceGraph3D,
  preferredRootId?: string
): MagnetSolveCandidate | null {
  if (selectionA.faceId === selectionB.faceId) return null;

  const face1 = net.faces[selectionA.faceId];
  const face2 = net.faces[selectionB.faceId];
  if (!face1 || !face2) return null;

  const edgeInfo1 = graph.edgeInfoByRefKey[faceEdgeRefKey(selectionA.faceId, selectionA.edgeIndex)];
  const edgeInfo2 = graph.edgeInfoByRefKey[faceEdgeRefKey(selectionB.faceId, selectionB.edgeIndex)];
  if (!edgeInfo1 || !edgeInfo2) return null;

  const sharedGroupIds = getSharedVertexGroupIds(edgeInfo1, edgeInfo2);
  if (sharedGroupIds.length === 0) return null;

  let bestCandidate: MagnetSolveCandidate | null = null;

  for (const sharedGroupId of sharedGroupIds) {
    const sharedGroup = graph.vertexGroupsById[sharedGroupId];
    if (!sharedGroup) continue;

    const sharedPoint = sharedGroup.point;
    const shared1AtStart = edgeInfo1.startGroupId === sharedGroupId;
    const shared2AtStart = edgeInfo2.startGroupId === sharedGroupId;
    const tip1 = shared1AtStart ? edgeInfo1.endPoint : edgeInfo1.startPoint;
    const tip2 = shared2AtStart ? edgeInfo2.endPoint : edgeInfo2.startPoint;

    const info1 = buildMagnetSelection3DInfo(
      net,
      face1,
      graph.matrices[face1.id],
      selectionA.edgeIndex,
      shared1AtStart
    );
    const info2 = buildMagnetSelection3DInfo(
      net,
      face2,
      graph.matrices[face2.id],
      selectionB.edgeIndex,
      shared2AtStart
    );
    if (!info1 && !info2) continue;
    if (info1 && info2 && info1.connId === info2.connId) continue;

    const vector1 = sub3(tip1, sharedPoint);
    const vector2 = sub3(tip2, sharedPoint);
    if (Math.abs(length3(vector1) - length3(vector2)) > MAGNET_EDGE_MATCH_EPSILON) continue;

    const orientationReference = cross3(vector1, vector2);
    const hasOrientationPreference = length3(orientationReference) >= MAGNET_PARALLEL_EPSILON;

    if (!info1 || !info2) {
      const movingInfo = info1 || info2;
      const movingTip = info1 ? tip1 : tip2;
      const fixedTip = info1 ? tip2 : tip1;
      if (!movingInfo) continue;

      const faceAngle = signedAngleAroundAxis(sharedPoint, movingTip, fixedTip, movingInfo.axis);
      const delta = faceAngle / movingInfo.motionScale;
      if (!Number.isFinite(delta)) continue;

      const rotatedTip = rotateAroundAxis(movingTip, sharedPoint, movingInfo.axis, faceAngle);
      if (distance3(rotatedTip, fixedTip) > MAGNET_VERIFY_EPSILON) continue;

      const candidate: MagnetSolveCandidate = {
        updates: [{ connId: movingInfo.connId, delta }],
        totalDelta: Math.abs(delta),
        orientation: dot3(sub3(fixedTip, sharedPoint), orientationReference),
        points: [fixedTip]
      };

      const isBetter =
        !bestCandidate ||
        (
          hasOrientationPreference &&
          bestCandidate.orientation <= 0 &&
          candidate.orientation > 0
        ) ||
        (
          (!hasOrientationPreference || Math.sign(candidate.orientation) === Math.sign(bestCandidate.orientation)) &&
          candidate.totalDelta < bestCandidate.totalDelta
        );

      if (isBetter) {
        bestCandidate = candidate;
      }
      continue;
    }

    const axisCross = cross3(info1.axis, info2.axis);
    const candidateTips: Point3D[] = [];

    if (length3(axisCross) < MAGNET_PARALLEL_EPSILON) {
      if (Math.abs(dot3(info1.axis, vector1) - dot3(info2.axis, vector2)) > MAGNET_EDGE_MATCH_EPSILON) {
        continue;
      }
      candidateTips.push(tip1);
      if (distance3(tip1, tip2) > MAGNET_LENGTH_EPSILON) {
        candidateTips.push(tip2);
      }
    } else {
      const solutions = solveSphericalIntersection(
        sharedPoint,
        info1.axis,
        tip1,
        info2.axis,
        tip2
      );
      if (!solutions) continue;
      candidateTips.push(solutions[0]);
      if (distance3(solutions[0], solutions[1]) > MAGNET_LENGTH_EPSILON) {
        candidateTips.push(solutions[1]);
      }
    }

    for (const targetTip of candidateTips) {
      const faceAngle1 = signedAngleAroundAxis(sharedPoint, tip1, targetTip, info1.axis);
      const faceAngle2 = signedAngleAroundAxis(sharedPoint, tip2, targetTip, info2.axis);
      const delta1 = faceAngle1 / info1.motionScale;
      const delta2 = faceAngle2 / info2.motionScale;

      if (!Number.isFinite(delta1) || !Number.isFinite(delta2)) continue;

      const rotated1 = rotateAroundAxis(tip1, sharedPoint, info1.axis, faceAngle1);
      const rotated2 = rotateAroundAxis(tip2, sharedPoint, info2.axis, faceAngle2);
      if (
        distance3(rotated1, targetTip) > MAGNET_VERIFY_EPSILON ||
        distance3(rotated2, targetTip) > MAGNET_VERIFY_EPSILON
      ) {
        continue;
      }

      const candidate: MagnetSolveCandidate = {
        updates: [
          { connId: info1.connId, delta: delta1 },
          { connId: info2.connId, delta: delta2 }
        ],
        totalDelta: Math.abs(delta1) + Math.abs(delta2),
        orientation: dot3(sub3(targetTip, sharedPoint), orientationReference),
        points: [targetTip]
      };

      const isBetter =
        !bestCandidate ||
        (
          hasOrientationPreference &&
          bestCandidate.orientation <= 0 &&
          candidate.orientation > 0
        ) ||
        (
          (!hasOrientationPreference || Math.sign(candidate.orientation) === Math.sign(bestCandidate.orientation)) &&
          candidate.totalDelta < bestCandidate.totalDelta
        );

      if (isBetter) {
        bestCandidate = candidate;
      }
    }
  }

  return bestCandidate;
}

export function solveMagnetFold(
  net: PolyNet,
  selectionA: MagnetEdge,
  selectionB: MagnetEdge,
  rootId?: string
): MagnetSolveResult | null {
  const graph = build3DCoincidenceGraph(net, rootId);
  const selectionCandidatesA = expandMagnetSelectionCandidates(graph, selectionA);
  const selectionCandidatesB = expandMagnetSelectionCandidates(graph, selectionB);

  let bestCandidate: MagnetSolveCandidate | null = null;

  for (const candidateA of selectionCandidatesA) {
    for (const candidateB of selectionCandidatesB) {
      const candidate = solveMagnetFoldForPair(net, candidateA, candidateB, graph, rootId);
      if (!candidate) continue;

      if (
        !bestCandidate ||
        (bestCandidate.orientation <= 0 && candidate.orientation > 0) ||
        (
          Math.sign(bestCandidate.orientation) === Math.sign(candidate.orientation) &&
          candidate.totalDelta < bestCandidate.totalDelta
        )
      ) {
        bestCandidate = candidate;
      }
    }
  }

  return bestCandidate ? { updates: bestCandidate.updates } : null;
}

function getVertexPointFromGraph(
  net: PolyNet,
  graph: CoincidenceGraph3D,
  selection: MagnetVertex
): Point3D | null {
  const face = net.faces[selection.faceId];
  const matrix = graph.matrices[selection.faceId];
  if (!face || !matrix) return null;
  return getFaceVertex3D(face, matrix, selection.vertexIndex);
}

function getEdgePointsFromGraph(
  net: PolyNet,
  graph: CoincidenceGraph3D,
  selection: MagnetEdge
): { start: Point3D; end: Point3D } | null {
  const face = net.faces[selection.faceId];
  const matrix = graph.matrices[selection.faceId];
  if (!face || !matrix) return null;
  return getFaceEdgeEndpoints3D(face, matrix, selection.edgeIndex);
}

function getVertexPointFromMatrices(
  net: PolyNet,
  matrices: Record<string, Mat4>,
  selection: MagnetVertex
): Point3D | null {
  const face = net.faces[selection.faceId];
  const matrix = matrices[selection.faceId];
  if (!face || !matrix) return null;
  return getFaceVertex3D(face, matrix, selection.vertexIndex);
}

function getEdgePointsFromMatrices(
  net: PolyNet,
  matrices: Record<string, Mat4>,
  selection: MagnetEdge
): { start: Point3D; end: Point3D } | null {
  const face = net.faces[selection.faceId];
  const matrix = matrices[selection.faceId];
  if (!face || !matrix) return null;
  return getFaceEdgeEndpoints3D(face, matrix, selection.edgeIndex);
}

interface AdvancedMagnetPointInfo {
  connId: string;
  axisOrigin: Point3D;
  axisDirection: Point3D;
  currentPoint: Point3D;
  circleCenter: Point3D;
  radius: number;
  motionScale: number;
  isFixed: boolean;
}

function projectPointOntoAxis(origin: Point3D, axisDirection: Point3D, point: Point3D): Point3D {
  return add3(origin, scale3(axisDirection, dot3(sub3(point, origin), axisDirection)));
}

function buildAdvancedMagnetPointInfo(
  net: PolyNet,
  hinge: MagnetEdge,
  target: MagnetVertex,
  rootId: string
): AdvancedMagnetPointInfo | null {
  const hingeFace = net.faces[hinge.faceId];
  const targetFace = net.faces[target.faceId];
  const conn = getConnectionForFaceEdge(net, hinge.faceId, hinge.edgeIndex);
  if (!hingeFace || !targetFace || !conn) return null;

  const currentMatrices = compute3DLayout(net, rootId).matrices;
  const hingeMatrix = currentMatrices[hinge.faceId];
  const targetMatrix = currentMatrices[target.faceId];
  if (!hingeMatrix || !targetMatrix) return null;

  const axisOrigin = getFaceVertex3D(hingeFace, hingeMatrix, hinge.edgeIndex);
  const axisEnd = getFaceVertex3D(hingeFace, hingeMatrix, hinge.edgeIndex + 1);
  const axisDirection = normalize3(sub3(axisEnd, axisOrigin));
  if (length3(axisDirection) < MAGNET_PARALLEL_EPSILON) return null;

  const currentPoint = getFaceVertex3D(targetFace, targetMatrix, target.vertexIndex);

  const probedNet: PolyNet = {
    ...net,
    connections: net.connections.map(connection =>
      connection.id === conn.id
        ? { ...connection, foldAngle: (connection.foldAngle || 0) + MAGNET_PROBE_ANGLE_DEG }
        : connection
    )
  };
  const probedMatrices = compute3DLayout(probedNet, rootId).matrices;
  const probedMatrix = probedMatrices[target.faceId];
  if (!probedMatrix) return null;
  const probedPoint = getFaceVertex3D(targetFace, probedMatrix, target.vertexIndex);
  const motionAngle = signedAngleAroundAxis(axisOrigin, currentPoint, probedPoint, axisDirection);
  const motionScale = Math.abs(motionAngle) < MAGNET_ADVANCED_VERIFY_EPSILON ? 0 : motionAngle / MAGNET_PROBE_ANGLE_DEG;

  if (Math.abs(motionScale) < MAGNET_ADVANCED_VERIFY_EPSILON) {
    return {
      connId: conn.id,
      axisOrigin,
      axisDirection,
      currentPoint,
      circleCenter: currentPoint,
      radius: 0,
      motionScale: 0,
      isFixed: true
    };
  }

  const circleCenter = projectPointOntoAxis(axisOrigin, axisDirection, currentPoint);
  return {
    connId: conn.id,
    axisOrigin,
    axisDirection,
    currentPoint,
    circleCenter,
    radius: distance3(circleCenter, currentPoint),
    motionScale,
    isFixed: false
  };
}

function intersectCircles3D(circleA: AdvancedMagnetPointInfo, circleB: AdvancedMagnetPointInfo): Point3D[] {
  const candidates: Point3D[] = [];
  const normalA = circleA.isFixed ? normalize3(sub3(circleB.circleCenter, circleA.circleCenter)) : circleA.axisDirection;
  const normalB = circleB.isFixed ? normalize3(sub3(circleA.circleCenter, circleB.circleCenter)) : circleB.axisDirection;
  const planeNormalA = length3(normalA) < MAGNET_PARALLEL_EPSILON ? circleA.axisDirection : normalA;
  let planeNormalB = length3(normalB) < MAGNET_PARALLEL_EPSILON ? circleB.axisDirection : normalB;
  const planeConstantA = dot3(planeNormalA, circleA.circleCenter);
  let planeConstantB = dot3(planeNormalB, circleB.circleCenter);
  if (dot3(planeNormalA, planeNormalB) < 0) {
    planeNormalB = scale3(planeNormalB, -1);
    planeConstantB *= -1;
  }
  const lineDirection = cross3(planeNormalA, planeNormalB);

  if (length3(lineDirection) >= MAGNET_PARALLEL_EPSILON) {
    const cosAngle = dot3(planeNormalA, planeNormalB);
    const det = 1 - cosAngle * cosAngle;
    if (Math.abs(det) < MAGNET_PARALLEL_EPSILON) {
      return candidates;
    }

    const pointOnLine = add3(
      scale3(planeNormalA, (planeConstantA - planeConstantB * cosAngle) / det),
      scale3(planeNormalB, (planeConstantB - planeConstantA * cosAngle) / det)
    );
    const relative = sub3(pointOnLine, circleA.circleCenter);
    const a = dot3(lineDirection, lineDirection);
    const b = 2 * dot3(relative, lineDirection);
    const c = dot3(relative, relative) - circleA.radius * circleA.radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < -MAGNET_ADVANCED_VERIFY_EPSILON) {
      return candidates;
    }

    const sqrtDiscriminant = Math.sqrt(Math.max(0, discriminant));
    const tValues = discriminant <= MAGNET_ADVANCED_VERIFY_EPSILON
      ? [(-b) / (2 * a)]
      : [(-b + sqrtDiscriminant) / (2 * a), (-b - sqrtDiscriminant) / (2 * a)];

    tValues.forEach(t => {
      const candidate = add3(pointOnLine, scale3(lineDirection, t));
      if (Math.abs(distance3(candidate, circleB.circleCenter) - circleB.radius) <= 1e-6) {
        candidates.push(candidate);
      }
    });

    return candidates;
  }

  if (Math.abs(planeConstantA - planeConstantB) > 1e-6) {
    return candidates;
  }

  const centerOffset = sub3(circleB.circleCenter, circleA.circleCenter);
  const centerDistance = length3(centerOffset);
  if (centerDistance < MAGNET_PARALLEL_EPSILON) {
    if (Math.abs(circleA.radius - circleB.radius) <= 1e-6) {
      candidates.push(circleA.currentPoint);
    }
    return candidates;
  }

  if (
    centerDistance > circleA.radius + circleB.radius + 1e-6 ||
    centerDistance < Math.abs(circleA.radius - circleB.radius) - 1e-6
  ) {
    return candidates;
  }

  const basisX = normalize3(centerOffset);
  const basisY = normalize3(cross3(planeNormalA, basisX));
  const alongX = (circleA.radius * circleA.radius - circleB.radius * circleB.radius + centerDistance * centerDistance) / (2 * centerDistance);
  const heightSquared = circleA.radius * circleA.radius - alongX * alongX;
  if (heightSquared < -MAGNET_ADVANCED_VERIFY_EPSILON) {
    return candidates;
  }

  const basePoint = add3(circleA.circleCenter, scale3(basisX, alongX));
  const height = Math.sqrt(Math.max(0, heightSquared));
  candidates.push(add3(basePoint, scale3(basisY, height)));
  if (height > 1e-6) {
    candidates.push(add3(basePoint, scale3(basisY, -height)));
  }

  return candidates;
}

function getAdvancedMagnetOrientationReference(circleA: AdvancedMagnetPointInfo, circleB: AdvancedMagnetPointInfo): Point3D {
  const axisCross = cross3(circleA.axisDirection, circleB.axisDirection);
  if (length3(axisCross) >= MAGNET_PARALLEL_EPSILON) {
    return axisCross;
  }
  const centerOffset = sub3(circleB.circleCenter, circleA.circleCenter);
  const fallback = cross3(circleA.axisDirection, centerOffset);
  if (length3(fallback) >= MAGNET_PARALLEL_EPSILON) {
    return fallback;
  }
  return centerOffset;
}

function normalizeMagnetUpdates(updates: { connId: string; delta: number }[]): { connId: string; delta: number }[] {
  const byConnId = updates.reduce<Record<string, number>>((acc, update) => {
    acc[update.connId] = (acc[update.connId] || 0) + update.delta;
    return acc;
  }, {});

  return Object.entries(byConnId)
    .map(([connId, delta]) => ({ connId, delta }))
    .sort((a, b) => a.connId.localeCompare(b.connId));
}

function solveAdvancedMagnetPointPairCandidates(
  net: PolyNet,
  hingeA: MagnetEdge,
  hingeB: MagnetEdge,
  targetA: MagnetVertex,
  targetB: MagnetVertex,
  rootId: string
): MagnetSolveCandidate[] {
  const pointA = buildAdvancedMagnetPointInfo(net, hingeA, targetA, rootId);
  const pointB = buildAdvancedMagnetPointInfo(net, hingeB, targetB, rootId);
  if (!pointA || !pointB) return [];

  const orientationReference = getAdvancedMagnetOrientationReference(pointA, pointB);
  const orientationOrigin = scale3(add3(pointA.circleCenter, pointB.circleCenter), 0.5);
  const candidates = intersectCircles3D(pointA, pointB).flatMap(intersectionPoint => {
    const deltaA = pointA.isFixed ? 0 : signedAngleAroundAxis(pointA.axisOrigin, pointA.currentPoint, intersectionPoint, pointA.axisDirection) / pointA.motionScale;
    const deltaB = pointB.isFixed ? 0 : signedAngleAroundAxis(pointB.axisOrigin, pointB.currentPoint, intersectionPoint, pointB.axisDirection) / pointB.motionScale;
    if (!Number.isFinite(deltaA) || !Number.isFinite(deltaB)) {
      return [];
    }

    const rotatedA = pointA.isFixed ? pointA.currentPoint : rotateAroundAxis(pointA.currentPoint, pointA.axisOrigin, pointA.axisDirection, deltaA * pointA.motionScale);
    const rotatedB = pointB.isFixed ? pointB.currentPoint : rotateAroundAxis(pointB.currentPoint, pointB.axisOrigin, pointB.axisDirection, deltaB * pointB.motionScale);
    if (
      distance3(rotatedA, intersectionPoint) > 1e-6 ||
      distance3(rotatedB, intersectionPoint) > 1e-6 ||
      distance3(rotatedA, rotatedB) > 1e-6
    ) {
      return [];
    }

    return [{
      updates: normalizeMagnetUpdates([
        { connId: pointA.connId, delta: deltaA },
        { connId: pointB.connId, delta: deltaB }
      ]),
      totalDelta: Math.abs(deltaA) + Math.abs(deltaB),
      orientation: dot3(sub3(intersectionPoint, orientationOrigin), orientationReference),
      points: [intersectionPoint]
    }];
  });

  return candidates.filter((candidate, index, allCandidates) => (
    allCandidates.findIndex(other => (
      candidate.updates.length === other.updates.length &&
      candidate.updates.every((update, updateIndex) =>
        other.updates[updateIndex]?.connId === update.connId &&
        Math.abs(other.updates[updateIndex].delta - update.delta) <= 1e-10
      )
    )) === index
  ));
}

function chooseBestAdvancedMagnetCandidate(candidates: MagnetSolveCandidate[]): MagnetSolveCandidate | null {
  if (candidates.length === 0) return null;

  return candidates.reduce<MagnetSolveCandidate | null>((bestCandidate, candidate) => {
    if (!bestCandidate) return candidate;
    if (bestCandidate.orientation <= 0 && candidate.orientation > 0) return candidate;
    if (Math.sign(bestCandidate.orientation) === Math.sign(candidate.orientation) && candidate.totalDelta < bestCandidate.totalDelta) {
      return candidate;
    }
    return bestCandidate;
  }, null);
}

function edgeToVertexSelections(net: PolyNet, edge: MagnetEdge): [MagnetVertex, MagnetVertex] | null {
  const face = net.faces[edge.faceId];
  if (!face) return null;
  const nextVertexIndex = (edge.edgeIndex + 1) % face.def.vertices.length;
  return [
    { faceId: edge.faceId, vertexIndex: edge.edgeIndex },
    { faceId: edge.faceId, vertexIndex: nextVertexIndex }
  ];
}

function magnetVertexKey(vertex: MagnetVertex): string {
  return `${vertex.faceId}:${vertex.vertexIndex}`;
}

function hasFiniteCircleRadius(pointInfo: AdvancedMagnetPointInfo): boolean {
  return pointInfo.radius > MAGNET_ADVANCED_ACCEPT_EPSILON;
}

function updatesMatchWithinTolerance(
  first: { connId: string; delta: number }[],
  second: { connId: string; delta: number }[]
): boolean {
  if (first.length !== second.length) return false;
  return first.every((update, index) => (
    second[index]?.connId === update.connId &&
    Math.abs(second[index].delta - update.delta) <= 1e-10
  ));
}

function getConnectedComponentExcludingConnections(net: PolyNet, startFaceId: string, removedConnIds: Set<string>): Set<string> {
  const visited = new Set<string>();
  const queue = [startFaceId];
  visited.add(startFaceId);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const connections = (net.connections || []).filter(connection =>
      !removedConnIds.has(connection.id) &&
      (connection.faceAId === currentId || connection.faceBId === currentId)
    );

    for (const connection of connections) {
      const neighborId = connection.faceAId === currentId ? connection.faceBId : connection.faceAId;
      if (!visited.has(neighborId) && net.faces[neighborId]) {
        visited.add(neighborId);
        queue.push(neighborId);
      }
    }
  }

  return visited;
}

function getAllComponentsExcludingConnections(net: PolyNet, removedConnIds: Set<string>): Set<string>[] {
  const remainingFaceIds = new Set(Object.keys(net.faces));
  const components: Set<string>[] = [];

  while (remainingFaceIds.size > 0) {
    const nextFaceId = remainingFaceIds.values().next().value as string | undefined;
    if (!nextFaceId) break;
    const component = getConnectedComponentExcludingConnections(net, nextFaceId, removedConnIds);
    component.forEach(faceId => remainingFaceIds.delete(faceId));
    components.push(component);
  }

  return components;
}

function canonicalizeHingeForBranch(connection: Connection, branch: Set<string>): MagnetEdge | null {
  if (branch.has(connection.faceAId)) {
    return { faceId: connection.faceAId, edgeIndex: connection.edgeAIndex };
  }
  if (branch.has(connection.faceBId)) {
    return { faceId: connection.faceBId, edgeIndex: connection.edgeBIndex };
  }
  return null;
}

function normalizeTargetsByBranches<T extends { faceId: string }>(
  targets: [T, T],
  branchA: Set<string>,
  branchB: Set<string>
): [T, T] | null {
  const [firstTarget, secondTarget] = targets;
  const firstInA = branchA.has(firstTarget.faceId);
  const firstInB = branchB.has(firstTarget.faceId);
  const secondInA = branchA.has(secondTarget.faceId);
  const secondInB = branchB.has(secondTarget.faceId);

  if (firstInA && secondInB) return targets;
  if (firstInB && secondInA) return [secondTarget, firstTarget];
  return null;
}

function getAdvancedMagnetNormalizedVertexContext(
  net: PolyNet,
  hingeA: MagnetEdge,
  hingeB: MagnetEdge,
  vertexA: MagnetVertex,
  vertexB: MagnetVertex,
  preferredRootId?: string
): {
  solveRootId: string;
  hingeA: MagnetEdge;
  hingeB: MagnetEdge;
  vertexA: MagnetVertex;
  vertexB: MagnetVertex;
} | null {
  const connA = getConnectionForFaceEdge(net, hingeA.faceId, hingeA.edgeIndex);
  const connB = getConnectionForFaceEdge(net, hingeB.faceId, hingeB.edgeIndex);
  if (!connA || !connB) return null;

  const removedConnIds = new Set<string>([connA.id, connB.id]);
  const components = getAllComponentsExcludingConnections(net, removedConnIds);
  const touchesHingeA = (component: Set<string>) => component.has(connA.faceAId) || component.has(connA.faceBId);
  const touchesHingeB = (component: Set<string>) => component.has(connB.faceAId) || component.has(connB.faceBId);
  const branchA = components.find(component => touchesHingeA(component) && !touchesHingeB(component));
  const branchB = components.find(component => touchesHingeB(component) && !touchesHingeA(component));
  if (!branchA || !branchB) return null;

  const normalizedHingeA = canonicalizeHingeForBranch(connA, branchA);
  const normalizedHingeB = canonicalizeHingeForBranch(connB, branchB);
  const normalizedTargets = normalizeTargetsByBranches([vertexA, vertexB], branchA, branchB);
  if (!normalizedHingeA || !normalizedHingeB || !normalizedTargets) return null;

  const solveRootId =
    (preferredRootId && net.faces[preferredRootId] && !branchA.has(preferredRootId) && !branchB.has(preferredRootId)
      ? preferredRootId
      : Object.keys(net.faces).find(faceId => !branchA.has(faceId) && !branchB.has(faceId))) || null;
  if (!solveRootId) return null;

  return {
    solveRootId,
    hingeA: normalizedHingeA,
    hingeB: normalizedHingeB,
    vertexA: normalizedTargets[0],
    vertexB: normalizedTargets[1]
  };
}

function getAdvancedMagnetNormalizedEdgeContext(
  net: PolyNet,
  hingeA: MagnetEdge,
  hingeB: MagnetEdge,
  targetA: MagnetEdge,
  targetB: MagnetEdge,
  preferredRootId?: string
): {
  solveRootId: string;
  hingeA: MagnetEdge;
  hingeB: MagnetEdge;
  targetA: MagnetEdge;
  targetB: MagnetEdge;
} | null {
  const connA = getConnectionForFaceEdge(net, hingeA.faceId, hingeA.edgeIndex);
  const connB = getConnectionForFaceEdge(net, hingeB.faceId, hingeB.edgeIndex);
  if (!connA || !connB) return null;

  const removedConnIds = new Set<string>([connA.id, connB.id]);
  const components = getAllComponentsExcludingConnections(net, removedConnIds);
  const touchesHingeA = (component: Set<string>) => component.has(connA.faceAId) || component.has(connA.faceBId);
  const touchesHingeB = (component: Set<string>) => component.has(connB.faceAId) || component.has(connB.faceBId);
  const branchA = components.find(component => touchesHingeA(component) && !touchesHingeB(component));
  const branchB = components.find(component => touchesHingeB(component) && !touchesHingeA(component));
  if (!branchA || !branchB) return null;

  const normalizedHingeA = canonicalizeHingeForBranch(connA, branchA);
  const normalizedHingeB = canonicalizeHingeForBranch(connB, branchB);
  const normalizedTargets = normalizeTargetsByBranches([targetA, targetB], branchA, branchB);
  if (!normalizedHingeA || !normalizedHingeB || !normalizedTargets) return null;

  const solveRootId =
    (preferredRootId && net.faces[preferredRootId] && !branchA.has(preferredRootId) && !branchB.has(preferredRootId)
      ? preferredRootId
      : Object.keys(net.faces).find(faceId => !branchA.has(faceId) && !branchB.has(faceId))) || null;
  if (!solveRootId) return null;

  return {
    solveRootId,
    hingeA: normalizedHingeA,
    hingeB: normalizedHingeB,
    targetA: normalizedTargets[0],
    targetB: normalizedTargets[1]
  };
}

function getAdvancedMagnetRestRootId(
  net: PolyNet,
  hingeA: MagnetEdge,
  hingeB: MagnetEdge,
  branchSeedFaceA: string,
  branchSeedFaceB: string,
  preferredRootId?: string
): string | null {
  const connA = getConnectionForFaceEdge(net, hingeA.faceId, hingeA.edgeIndex);
  const connB = getConnectionForFaceEdge(net, hingeB.faceId, hingeB.edgeIndex);
  if (!connA || !connB) return null;

  const removedConnIds = new Set<string>([connA.id, connB.id]);
  const branchA = getConnectedComponentExcludingConnections(net, branchSeedFaceA, removedConnIds);
  const branchB = getConnectedComponentExcludingConnections(net, branchSeedFaceB, removedConnIds);
  const overlap = Array.from(branchA).some(faceId => branchB.has(faceId));
  if (overlap) return null;

  if (preferredRootId && net.faces[preferredRootId] && !branchA.has(preferredRootId) && !branchB.has(preferredRootId)) {
    return preferredRootId;
  }

  return Object.keys(net.faces).find(faceId => !branchA.has(faceId) && !branchB.has(faceId)) || null;
}

function evaluateAdvancedVertexMatchDistance(
  net: PolyNet,
  rootId: string,
  updates: { connId: string; delta: number }[],
  vertexA: MagnetVertex,
  vertexB: MagnetVertex
): number | null {
  const updatedNet = applyMagnetConnectionDeltas(
    net,
    updates.reduce<Record<string, number>>((acc, update) => {
      acc[update.connId] = update.delta;
      return acc;
    }, {})
  );
  const matrices = compute3DLayout(updatedNet, rootId).matrices;
  const pointA = getVertexPointFromMatrices(updatedNet, matrices, vertexA);
  const pointB = getVertexPointFromMatrices(updatedNet, matrices, vertexB);
  if (!pointA || !pointB) return null;
  return distance3(pointA, pointB);
}

function evaluateAdvancedEdgeMatchDistance(
  net: PolyNet,
  rootId: string,
  updates: { connId: string; delta: number }[],
  targetA: MagnetEdge,
  targetB: MagnetEdge
): number | null {
  const updatedNet = applyMagnetConnectionDeltas(
    net,
    updates.reduce<Record<string, number>>((acc, update) => {
      acc[update.connId] = update.delta;
      return acc;
    }, {})
  );
  const matrices = compute3DLayout(updatedNet, rootId).matrices;
  const edgeA = getEdgePointsFromMatrices(updatedNet, matrices, targetA);
  const edgeB = getEdgePointsFromMatrices(updatedNet, matrices, targetB);
  if (!edgeA || !edgeB) return null;

  const forward = distance3(edgeA.start, edgeB.start) + distance3(edgeA.end, edgeB.end);
  const reversed = distance3(edgeA.start, edgeB.end) + distance3(edgeA.end, edgeB.start);
  return Math.min(forward, reversed);
}

function getAdvancedMagnetSolveRootId(net: PolyNet, preferredRootId: string | undefined, fallbackFaceId: string): string {
  if (preferredRootId && net.faces[preferredRootId]) return preferredRootId;
  if (net.faces[fallbackFaceId]) return fallbackFaceId;
  return Object.keys(net.faces)[0] || fallbackFaceId;
}

function getHingeAxisDirectionFromMatrices(
  net: PolyNet,
  matrices: Record<string, Mat4>,
  hinge: MagnetEdge
): Point3D | null {
  const face = net.faces[hinge.faceId];
  const matrix = matrices[hinge.faceId];
  if (!face || !matrix) return null;
  const start = getFaceVertex3D(face, matrix, hinge.edgeIndex);
  const end = getFaceVertex3D(face, matrix, hinge.edgeIndex + 1);
  const direction = normalize3(sub3(end, start));
  return length3(direction) < MAGNET_PARALLEL_EPSILON ? null : direction;
}

function buildAdvancedOrientationFrame(
  net: PolyNet,
  rootId: string,
  hingeA: MagnetEdge,
  hingeB: MagnetEdge,
  representativePointA: Point3D,
  representativePointB: Point3D
): { origin: Point3D; reference: Point3D } {
  const matrices = compute3DLayout(net, rootId).matrices;
  const axisA = getHingeAxisDirectionFromMatrices(net, matrices, hingeA);
  const axisB = getHingeAxisDirectionFromMatrices(net, matrices, hingeB);
  const pointOffset = sub3(representativePointB, representativePointA);

  let reference = axisA && axisB ? cross3(axisA, axisB) : { x: 0, y: 0, z: 0 };
  if (length3(reference) < MAGNET_PARALLEL_EPSILON && axisA) {
    reference = cross3(axisA, pointOffset);
  }
  if (length3(reference) < MAGNET_PARALLEL_EPSILON && axisB) {
    reference = cross3(axisB, pointOffset);
  }
  if (length3(reference) < MAGNET_PARALLEL_EPSILON) {
    reference = pointOffset;
  }
  if (length3(reference) < MAGNET_PARALLEL_EPSILON) {
    reference = { x: 0, y: 0, z: 1 };
  }

  return {
    origin: scale3(add3(representativePointA, representativePointB), 0.5),
    reference: normalize3(reference)
  };
}

function collectAdvancedNumericCandidates(
  connIdA: string,
  connIdB: string,
  evaluate: (deltaA: number, deltaB: number) => { score: number; orientation: number } | null
): MagnetSolveCandidate[] {
  const candidates: MagnetSolveCandidate[] = [];
  const seen = new Set<string>();
  const addCandidate = (updates: { connId: string; delta: number }[], score: number, orientation: number) => {
    if (!Number.isFinite(score) || score > MAGNET_VERIFY_EPSILON) return;
    const normalized = normalizeMagnetUpdates(updates);
    const key = normalized.map(update => `${update.connId}:${update.delta.toFixed(8)}`).join('|');
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      updates: normalized,
      totalDelta: normalized.reduce((sum, update) => sum + Math.abs(update.delta), 0),
      orientation
    });
  };

  if (connIdA === connIdB) {
    const seeds = [-180, -120, -60, 0, 60, 120, 180];
    seeds.forEach(seed => {
      const optimized = refineMagnetDelta1D(delta => {
        const evaluation = evaluate(delta, delta);
        return evaluation ? evaluation.score : Infinity;
      }, seed);
      const evaluation = evaluate(optimized.delta, optimized.delta);
      if (!evaluation) return;
      addCandidate([{ connId: connIdA, delta: optimized.delta }], evaluation.score, evaluation.orientation);
    });
    return candidates;
  }

  const seeds = [-180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180];
  seeds.forEach(seedA => {
    seeds.forEach(seedB => {
      let currentA = seedA;
      let currentB = seedB;

      for (let iteration = 0; iteration < 8; iteration += 1) {
        currentA = refineMagnetDelta1D(delta => {
          const evaluation = evaluate(delta, currentB);
          return evaluation ? evaluation.score : Infinity;
        }, currentA).delta;

        currentB = refineMagnetDelta1D(delta => {
          const evaluation = evaluate(currentA, delta);
          return evaluation ? evaluation.score : Infinity;
        }, currentB).delta;
      }

      const evaluation = evaluate(currentA, currentB);
      if (!evaluation) return;
      addCandidate([
        { connId: connIdA, delta: currentA },
        { connId: connIdB, delta: currentB }
      ], evaluation.score, evaluation.orientation);
    });
  });

  return candidates;
}

function evaluateAdvancedVertexCandidate(
  net: PolyNet,
  rootId: string,
  updates: { connId: string; delta: number }[],
  vertexA: MagnetVertex,
  vertexB: MagnetVertex,
  orientationFrame: { origin: Point3D; reference: Point3D }
): { score: number; orientation: number } | null {
  const updatedNet = applyMagnetConnectionDeltas(
    net,
    updates.reduce<Record<string, number>>((acc, update) => {
      acc[update.connId] = update.delta;
      return acc;
    }, {})
  );
  const matrices = compute3DLayout(updatedNet, rootId).matrices;
  const pointA = getVertexPointFromMatrices(updatedNet, matrices, vertexA);
  const pointB = getVertexPointFromMatrices(updatedNet, matrices, vertexB);
  if (!pointA || !pointB) return null;

  const midpoint = scale3(add3(pointA, pointB), 0.5);
  return {
    score: distance3(pointA, pointB),
    orientation: dot3(sub3(midpoint, orientationFrame.origin), orientationFrame.reference)
  };
}

function evaluateAdvancedEdgeCandidate(
  net: PolyNet,
  rootId: string,
  updates: { connId: string; delta: number }[],
  targetA: MagnetEdge,
  targetB: MagnetEdge,
  orientationFrame: { origin: Point3D; reference: Point3D }
): { score: number; orientation: number } | null {
  const updatedNet = applyMagnetConnectionDeltas(
    net,
    updates.reduce<Record<string, number>>((acc, update) => {
      acc[update.connId] = update.delta;
      return acc;
    }, {})
  );
  const matrices = compute3DLayout(updatedNet, rootId).matrices;
  const edgeA = getEdgePointsFromMatrices(updatedNet, matrices, targetA);
  const edgeB = getEdgePointsFromMatrices(updatedNet, matrices, targetB);
  if (!edgeA || !edgeB) return null;

  const forward = distance3(edgeA.start, edgeB.start) + distance3(edgeA.end, edgeB.end);
  const reversed = distance3(edgeA.start, edgeB.end) + distance3(edgeA.end, edgeB.start);
  const midpointA = scale3(add3(edgeA.start, edgeA.end), 0.5);
  const midpointB = scale3(add3(edgeB.start, edgeB.end), 0.5);
  const midpoint = scale3(add3(midpointA, midpointB), 0.5);

  return {
    score: Math.min(forward, reversed),
    orientation: dot3(sub3(midpoint, orientationFrame.origin), orientationFrame.reference)
  };
}

function solveAdvancedMagnetVerticesNumerically(
  net: PolyNet,
  hingeA: MagnetEdge,
  hingeB: MagnetEdge,
  vertexA: MagnetVertex,
  vertexB: MagnetVertex,
  rootId?: string
): MagnetSolveCandidate | null {
  const connA = getConnectionForFaceEdge(net, hingeA.faceId, hingeA.edgeIndex);
  const connB = getConnectionForFaceEdge(net, hingeB.faceId, hingeB.edgeIndex);
  if (!connA || !connB) return null;

  const solveRootId = getAdvancedMagnetSolveRootId(net, rootId, hingeA.faceId);
  const baseMatrices = compute3DLayout(net, solveRootId).matrices;
  const pointA = getVertexPointFromMatrices(net, baseMatrices, vertexA);
  const pointB = getVertexPointFromMatrices(net, baseMatrices, vertexB);
  if (!pointA || !pointB) return null;

  const orientationFrame = buildAdvancedOrientationFrame(net, solveRootId, hingeA, hingeB, pointA, pointB);
  return chooseBestAdvancedMagnetCandidate(
    collectAdvancedNumericCandidates(connA.id, connB.id, (deltaA, deltaB) => (
      evaluateAdvancedVertexCandidate(
        net,
        solveRootId,
        [
          { connId: connA.id, delta: deltaA },
          { connId: connB.id, delta: deltaB }
        ],
        vertexA,
        vertexB,
        orientationFrame
      )
    ))
  );
}

function solveAdvancedMagnetEdgesNumerically(
  net: PolyNet,
  hingeA: MagnetEdge,
  hingeB: MagnetEdge,
  targetA: MagnetEdge,
  targetB: MagnetEdge,
  rootId?: string
): MagnetSolveCandidate | null {
  const connA = getConnectionForFaceEdge(net, hingeA.faceId, hingeA.edgeIndex);
  const connB = getConnectionForFaceEdge(net, hingeB.faceId, hingeB.edgeIndex);
  if (!connA || !connB) return null;

  const solveRootId = getAdvancedMagnetSolveRootId(net, rootId, hingeA.faceId);
  const baseMatrices = compute3DLayout(net, solveRootId).matrices;
  const edgeA = getEdgePointsFromMatrices(net, baseMatrices, targetA);
  const edgeB = getEdgePointsFromMatrices(net, baseMatrices, targetB);
  if (!edgeA || !edgeB) return null;

  const midpointA = scale3(add3(edgeA.start, edgeA.end), 0.5);
  const midpointB = scale3(add3(edgeB.start, edgeB.end), 0.5);
  const orientationFrame = buildAdvancedOrientationFrame(net, solveRootId, hingeA, hingeB, midpointA, midpointB);
  return chooseBestAdvancedMagnetCandidate(
    collectAdvancedNumericCandidates(connA.id, connB.id, (deltaA, deltaB) => (
      evaluateAdvancedEdgeCandidate(
        net,
        solveRootId,
        [
          { connId: connA.id, delta: deltaA },
          { connId: connB.id, delta: deltaB }
        ],
        targetA,
        targetB,
        orientationFrame
      )
    ))
  );
}

export function solveMagnetFoldByHingesAndVertices(
  net: PolyNet,
  hingeA: MagnetEdge,
  hingeB: MagnetEdge,
  vertexA: MagnetVertex,
  vertexB: MagnetVertex,
  rootId?: string
): MagnetSolveResult | null {
  const normalized = getAdvancedMagnetNormalizedVertexContext(net, hingeA, hingeB, vertexA, vertexB, rootId);
  if (!normalized) return null;

  const exactCandidates = solveAdvancedMagnetPointPairCandidates(
    net,
    normalized.hingeA,
    normalized.hingeB,
    normalized.vertexA,
    normalized.vertexB,
    normalized.solveRootId
  )
    .filter(candidate => {
      const distance = evaluateAdvancedVertexMatchDistance(net, normalized.solveRootId, candidate.updates, normalized.vertexA, normalized.vertexB);
      return distance !== null && distance <= MAGNET_ADVANCED_ACCEPT_EPSILON;
    });

  const bestCandidate = chooseBestAdvancedMagnetCandidate(exactCandidates);
  return bestCandidate ? { updates: bestCandidate.updates } : null;
}

export function solveMagnetFoldByHingesAndEdges(
  net: PolyNet,
  hingeA: MagnetEdge,
  hingeB: MagnetEdge,
  targetA: MagnetEdge,
  targetB: MagnetEdge,
  rootId?: string
): MagnetSolveResult | null {
  const normalized = getAdvancedMagnetNormalizedEdgeContext(net, hingeA, hingeB, targetA, targetB, rootId);
  if (!normalized) return null;
  const targetVerticesA = edgeToVertexSelections(net, normalized.targetA);
  const targetVerticesB = edgeToVertexSelections(net, normalized.targetB);
  if (!targetVerticesA || !targetVerticesB) return null;

  const pointInfos = [
    buildAdvancedMagnetPointInfo(net, normalized.hingeA, targetVerticesA[0], normalized.solveRootId),
    buildAdvancedMagnetPointInfo(net, normalized.hingeA, targetVerticesA[1], normalized.solveRootId),
    buildAdvancedMagnetPointInfo(net, normalized.hingeB, targetVerticesB[0], normalized.solveRootId),
    buildAdvancedMagnetPointInfo(net, normalized.hingeB, targetVerticesB[1], normalized.solveRootId)
  ];
  if (pointInfos.some(info => !info)) return null;
  const pointInfoByVertexKey = new Map<string, AdvancedMagnetPointInfo>([
    [magnetVertexKey(targetVerticesA[0]), pointInfos[0] as AdvancedMagnetPointInfo],
    [magnetVertexKey(targetVerticesA[1]), pointInfos[1] as AdvancedMagnetPointInfo],
    [magnetVertexKey(targetVerticesB[0]), pointInfos[2] as AdvancedMagnetPointInfo],
    [magnetVertexKey(targetVerticesB[1]), pointInfos[3] as AdvancedMagnetPointInfo]
  ]);

  const combinations: [[MagnetVertex, MagnetVertex], [MagnetVertex, MagnetVertex]][] = [
    [[targetVerticesA[0], targetVerticesB[0]], [targetVerticesA[1], targetVerticesB[1]]],
    [[targetVerticesA[0], targetVerticesB[1]], [targetVerticesA[1], targetVerticesB[0]]],
    [[targetVerticesA[1], targetVerticesB[0]], [targetVerticesA[0], targetVerticesB[1]]],
    [[targetVerticesA[1], targetVerticesB[1]], [targetVerticesA[0], targetVerticesB[0]]]
  ];

  const exactCandidates = combinations.flatMap(([firstPair, secondPair]) => {
    const firstPairFinite =
      hasFiniteCircleRadius(pointInfoByVertexKey.get(magnetVertexKey(firstPair[0]))!) &&
      hasFiniteCircleRadius(pointInfoByVertexKey.get(magnetVertexKey(firstPair[1]))!);
    const secondPairFinite =
      hasFiniteCircleRadius(pointInfoByVertexKey.get(magnetVertexKey(secondPair[0]))!) &&
      hasFiniteCircleRadius(pointInfoByVertexKey.get(magnetVertexKey(secondPair[1]))!);
    const firstCandidates = solveAdvancedMagnetPointPairCandidates(net, normalized.hingeA, normalized.hingeB, firstPair[0], firstPair[1], normalized.solveRootId);
    const secondCandidates = solveAdvancedMagnetPointPairCandidates(net, normalized.hingeA, normalized.hingeB, secondPair[0], secondPair[1], normalized.solveRootId);

    if (!firstPairFinite && !secondPairFinite) {
      return [];
    }

    if (!firstPairFinite || !secondPairFinite) {
      const fallbackCandidates = firstPairFinite ? firstCandidates : secondCandidates;
      return fallbackCandidates.map(candidate => ({
        updates: candidate.updates,
        totalDelta: candidate.totalDelta,
        orientation: candidate.orientation
      }));
    }

    return firstCandidates.flatMap(firstCandidate => {
      const matchingSecond = secondCandidates.find(secondCandidate => updatesMatchWithinTolerance(firstCandidate.updates, secondCandidate.updates));
      if (!matchingSecond) return [];
      return [{
        updates: firstCandidate.updates,
        totalDelta: firstCandidate.totalDelta,
        orientation: firstCandidate.orientation + matchingSecond.orientation
      }];
    });
  }).filter(candidate => {
    const distance = evaluateAdvancedEdgeMatchDistance(net, normalized.solveRootId, candidate.updates, normalized.targetA, normalized.targetB);
    return distance !== null && distance <= MAGNET_ADVANCED_ACCEPT_EPSILON;
  });

  const bestCandidate = chooseBestAdvancedMagnetCandidate(exactCandidates);
  return bestCandidate ? { updates: bestCandidate.updates } : null;
}

export interface MagnetGuideCircle3D {
  center: Point3D;
  axisDirection: Point3D;
  radius: number;
  currentPoint: Point3D;
  isValid: boolean;
}

export interface MagnetGuideCandidate3D {
  updates: { connId: string; delta: number }[];
  points: Point3D[];
}

export interface MagnetGuidePreview3D {
  rootId?: string;
  circles: MagnetGuideCircle3D[];
  candidates: MagnetGuideCandidate3D[];
}

function getRegularMagnetGuidePreviewForPair(
  net: PolyNet,
  selectionA: FaceEdgeRef,
  selectionB: FaceEdgeRef,
  graph: CoincidenceGraph3D
): MagnetGuidePreview3D | null {
  if (selectionA.faceId === selectionB.faceId) return null;

  const face1 = net.faces[selectionA.faceId];
  const face2 = net.faces[selectionB.faceId];
  if (!face1 || !face2) return null;

  const edgeInfo1 = graph.edgeInfoByRefKey[faceEdgeRefKey(selectionA.faceId, selectionA.edgeIndex)];
  const edgeInfo2 = graph.edgeInfoByRefKey[faceEdgeRefKey(selectionB.faceId, selectionB.edgeIndex)];
  if (!edgeInfo1 || !edgeInfo2) return null;

  const sharedGroupIds = getSharedVertexGroupIds(edgeInfo1, edgeInfo2);
  if (sharedGroupIds.length === 0) return null;

  let bestPreview: MagnetGuidePreview3D | null = null;

  for (const sharedGroupId of sharedGroupIds) {
    const sharedGroup = graph.vertexGroupsById[sharedGroupId];
    if (!sharedGroup) continue;

    const sharedPoint = sharedGroup.point;
    const shared1AtStart = edgeInfo1.startGroupId === sharedGroupId;
    const shared2AtStart = edgeInfo2.startGroupId === sharedGroupId;
    const tip1 = shared1AtStart ? edgeInfo1.endPoint : edgeInfo1.startPoint;
    const tip2 = shared2AtStart ? edgeInfo2.endPoint : edgeInfo2.startPoint;

    const info1 = buildMagnetSelection3DInfo(net, face1, graph.matrices[face1.id], selectionA.edgeIndex, shared1AtStart);
    const info2 = buildMagnetSelection3DInfo(net, face2, graph.matrices[face2.id], selectionB.edgeIndex, shared2AtStart);
    if (!info1 && !info2) continue;
    if (info1 && info2 && info1.connId === info2.connId) continue;
    if (Math.abs(length3(sub3(tip1, sharedPoint)) - length3(sub3(tip2, sharedPoint))) > MAGNET_EDGE_MATCH_EPSILON) continue;

    const circles: MagnetGuideCircle3D[] = [
      info1
        ? { center: info1.circleCenter, axisDirection: info1.axis, radius: info1.radius, currentPoint: info1.currentTip, isValid: false }
        : { center: tip1, axisDirection: { x: 0, y: 0, z: 1 }, radius: 0, currentPoint: tip1, isValid: false },
      info2
        ? { center: info2.circleCenter, axisDirection: info2.axis, radius: info2.radius, currentPoint: info2.currentTip, isValid: false }
        : { center: tip2, axisDirection: { x: 0, y: 0, z: 1 }, radius: 0, currentPoint: tip2, isValid: false }
    ];

    const candidates: MagnetGuideCandidate3D[] = [];
    const candidateTips: Point3D[] = [];

    if (!info1 || !info2) {
      const movingInfo = info1 || info2;
      const movingTip = info1 ? tip1 : tip2;
      const fixedTip = info1 ? tip2 : tip1;
      if (movingInfo) {
        const faceAngle = signedAngleAroundAxis(sharedPoint, movingTip, fixedTip, movingInfo.axis);
        const delta = faceAngle / movingInfo.motionScale;
        if (Number.isFinite(delta)) {
          const rotatedTip = rotateAroundAxis(movingTip, sharedPoint, movingInfo.axis, faceAngle);
          if (distance3(rotatedTip, fixedTip) <= MAGNET_VERIFY_EPSILON) {
            candidateTips.push(fixedTip);
            candidates.push({ updates: [{ connId: movingInfo.connId, delta }], points: [fixedTip] });
          }
        }
      }
    } else {
      const axisCross = cross3(info1.axis, info2.axis);
      if (length3(axisCross) < MAGNET_PARALLEL_EPSILON) {
        if (Math.abs(dot3(info1.axis, sub3(tip1, sharedPoint)) - dot3(info2.axis, sub3(tip2, sharedPoint))) <= MAGNET_EDGE_MATCH_EPSILON) {
          candidateTips.push(tip1);
          if (distance3(tip1, tip2) > MAGNET_LENGTH_EPSILON) {
            candidateTips.push(tip2);
          }
        }
      } else {
        const solutions = solveSphericalIntersection(sharedPoint, info1.axis, tip1, info2.axis, tip2);
        if (solutions) {
          candidateTips.push(solutions[0]);
          if (distance3(solutions[0], solutions[1]) > MAGNET_LENGTH_EPSILON) {
            candidateTips.push(solutions[1]);
          }
        }
      }

      candidateTips.forEach(targetTip => {
        const faceAngle1 = signedAngleAroundAxis(sharedPoint, tip1, targetTip, info1.axis);
        const faceAngle2 = signedAngleAroundAxis(sharedPoint, tip2, targetTip, info2.axis);
        const delta1 = faceAngle1 / info1.motionScale;
        const delta2 = faceAngle2 / info2.motionScale;
        if (!Number.isFinite(delta1) || !Number.isFinite(delta2)) return;
        candidates.push({
          updates: normalizeMagnetUpdates([
            { connId: info1.connId, delta: delta1 },
            { connId: info2.connId, delta: delta2 }
          ]),
          points: [targetTip]
        });
      });
    }

    const uniqueCandidates = candidates.filter((candidate, index, allCandidates) => (
      allCandidates.findIndex(other => updatesMatchWithinTolerance(candidate.updates, other.updates)) === index
    ));
    const hasCandidate = uniqueCandidates.length > 0;
    const preview = {
      circles: circles.map(circle => ({ ...circle, isValid: hasCandidate })),
      candidates: uniqueCandidates
    };

    if (!bestPreview || preview.candidates.length > bestPreview.candidates.length) {
      bestPreview = preview;
    }
  }

  return bestPreview;
}

export function getRegularMagnetGuidePreview(
  net: PolyNet,
  selectionA: MagnetEdge,
  selectionB: MagnetEdge,
  rootId?: string
): MagnetGuidePreview3D | null {
  const graph = build3DCoincidenceGraph(net, rootId);
  const selectionCandidatesA = expandMagnetSelectionCandidates(graph, selectionA);
  const selectionCandidatesB = expandMagnetSelectionCandidates(graph, selectionB);

  let bestPreview: MagnetGuidePreview3D | null = null;
  for (const candidateA of selectionCandidatesA) {
    for (const candidateB of selectionCandidatesB) {
      const preview = getRegularMagnetGuidePreviewForPair(net, candidateA, candidateB, graph);
      if (!preview) continue;
      if (!bestPreview || preview.candidates.length > bestPreview.candidates.length) {
        bestPreview = preview;
      }
    }
  }

  return bestPreview;
}

export function getVertexMagnetGuidePreview(
  net: PolyNet,
  hingeA: MagnetEdge,
  hingeB: MagnetEdge,
  vertexA: MagnetVertex,
  vertexB: MagnetVertex,
  rootId?: string
): MagnetGuidePreview3D | null {
  const normalized = getAdvancedMagnetNormalizedVertexContext(net, hingeA, hingeB, vertexA, vertexB, rootId);
  if (!normalized) return null;
  const pointA = buildAdvancedMagnetPointInfo(net, normalized.hingeA, normalized.vertexA, normalized.solveRootId);
  const pointB = buildAdvancedMagnetPointInfo(net, normalized.hingeB, normalized.vertexB, normalized.solveRootId);
  if (!pointA || !pointB) return null;

  const candidates = solveAdvancedMagnetPointPairCandidates(net, normalized.hingeA, normalized.hingeB, normalized.vertexA, normalized.vertexB, normalized.solveRootId)
    .filter(candidate => {
      const distance = evaluateAdvancedVertexMatchDistance(net, normalized.solveRootId, candidate.updates, normalized.vertexA, normalized.vertexB);
      return distance !== null && distance <= MAGNET_ADVANCED_ACCEPT_EPSILON;
    })
    .map(candidate => ({ updates: candidate.updates, points: candidate.points || [] }));

  return {
    rootId: normalized.solveRootId,
    circles: [
      { center: pointA.circleCenter, axisDirection: pointA.axisDirection, radius: pointA.radius, currentPoint: pointA.currentPoint, isValid: candidates.length > 0 },
      { center: pointB.circleCenter, axisDirection: pointB.axisDirection, radius: pointB.radius, currentPoint: pointB.currentPoint, isValid: candidates.length > 0 }
    ],
    candidates
  };
}

export function getEdgeMagnetGuidePreview(
  net: PolyNet,
  hingeA: MagnetEdge,
  hingeB: MagnetEdge,
  targetA: MagnetEdge,
  targetB: MagnetEdge,
  rootId?: string
): MagnetGuidePreview3D | null {
  const normalized = getAdvancedMagnetNormalizedEdgeContext(net, hingeA, hingeB, targetA, targetB, rootId);
  if (!normalized) return null;
  const targetVerticesA = edgeToVertexSelections(net, normalized.targetA);
  const targetVerticesB = edgeToVertexSelections(net, normalized.targetB);
  if (!targetVerticesA || !targetVerticesB) return null;

  const pointInfos = [
    buildAdvancedMagnetPointInfo(net, normalized.hingeA, targetVerticesA[0], normalized.solveRootId),
    buildAdvancedMagnetPointInfo(net, normalized.hingeA, targetVerticesA[1], normalized.solveRootId),
    buildAdvancedMagnetPointInfo(net, normalized.hingeB, targetVerticesB[0], normalized.solveRootId),
    buildAdvancedMagnetPointInfo(net, normalized.hingeB, targetVerticesB[1], normalized.solveRootId)
  ];
  if (pointInfos.some(info => !info)) return null;
  const [pointA0, pointA1, pointB0, pointB1] = pointInfos as AdvancedMagnetPointInfo[];
  const pointInfoByVertexKey = new Map<string, AdvancedMagnetPointInfo>([
    [magnetVertexKey(targetVerticesA[0]), pointA0],
    [magnetVertexKey(targetVerticesA[1]), pointA1],
    [magnetVertexKey(targetVerticesB[0]), pointB0],
    [magnetVertexKey(targetVerticesB[1]), pointB1]
  ]);

  const combinations: [[MagnetVertex, MagnetVertex], [MagnetVertex, MagnetVertex]][] = [
    [[targetVerticesA[0], targetVerticesB[0]], [targetVerticesA[1], targetVerticesB[1]]],
    [[targetVerticesA[0], targetVerticesB[1]], [targetVerticesA[1], targetVerticesB[0]]],
    [[targetVerticesA[1], targetVerticesB[0]], [targetVerticesA[0], targetVerticesB[1]]],
    [[targetVerticesA[1], targetVerticesB[1]], [targetVerticesA[0], targetVerticesB[0]]]
  ];

  const candidates = combinations.flatMap(([firstPair, secondPair]) => {
    const firstPairFinite =
      hasFiniteCircleRadius(pointInfoByVertexKey.get(magnetVertexKey(firstPair[0]))!) &&
      hasFiniteCircleRadius(pointInfoByVertexKey.get(magnetVertexKey(firstPair[1]))!);
    const secondPairFinite =
      hasFiniteCircleRadius(pointInfoByVertexKey.get(magnetVertexKey(secondPair[0]))!) &&
      hasFiniteCircleRadius(pointInfoByVertexKey.get(magnetVertexKey(secondPair[1]))!);
    const firstCandidates = solveAdvancedMagnetPointPairCandidates(net, normalized.hingeA, normalized.hingeB, firstPair[0], firstPair[1], normalized.solveRootId);
    const secondCandidates = solveAdvancedMagnetPointPairCandidates(net, normalized.hingeA, normalized.hingeB, secondPair[0], secondPair[1], normalized.solveRootId);
    if (!firstPairFinite && !secondPairFinite) {
      return [];
    }

    if (!firstPairFinite || !secondPairFinite) {
      const fallbackCandidates = firstPairFinite ? firstCandidates : secondCandidates;
      return fallbackCandidates.flatMap(candidate => {
        const distance = evaluateAdvancedEdgeMatchDistance(net, normalized.solveRootId, candidate.updates, normalized.targetA, normalized.targetB);
        if (distance === null || distance > MAGNET_ADVANCED_ACCEPT_EPSILON) return [];
        return [{
          updates: candidate.updates,
          points: candidate.points || []
        }];
      });
    }

    return firstCandidates.flatMap(firstCandidate => {
      const matchingSecond = secondCandidates.find(secondCandidate => updatesMatchWithinTolerance(firstCandidate.updates, secondCandidate.updates));
      if (!matchingSecond) return [];
      const distance = evaluateAdvancedEdgeMatchDistance(net, normalized.solveRootId, firstCandidate.updates, normalized.targetA, normalized.targetB);
      if (distance === null || distance > MAGNET_ADVANCED_ACCEPT_EPSILON) return [];
      return [{
        updates: firstCandidate.updates,
        points: [...(firstCandidate.points || []), ...(matchingSecond.points || [])]
      }];
    });
  }).filter((candidate, index, allCandidates) => (
    allCandidates.findIndex(other => updatesMatchWithinTolerance(candidate.updates, other.updates)) === index
  ));

  return {
    rootId: normalized.solveRootId,
    circles: [
      { center: pointA0.circleCenter, axisDirection: pointA0.axisDirection, radius: pointA0.radius, currentPoint: pointA0.currentPoint, isValid: candidates.length > 0 },
      { center: pointA1.circleCenter, axisDirection: pointA1.axisDirection, radius: pointA1.radius, currentPoint: pointA1.currentPoint, isValid: candidates.length > 0 },
      { center: pointB0.circleCenter, axisDirection: pointB0.axisDirection, radius: pointB0.radius, currentPoint: pointB0.currentPoint, isValid: candidates.length > 0 },
      { center: pointB1.circleCenter, axisDirection: pointB1.axisDirection, radius: pointB1.radius, currentPoint: pointB1.currentPoint, isValid: candidates.length > 0 }
    ],
    candidates
  };
}

// ---------------- Common Utils ----------------

export function getEdgeWorldPoints(faceVerts: Point2D[], transform: Mat3, edgeIndex: number): [Point2D, Point2D] {
  if (!faceVerts || !Array.isArray(faceVerts) || edgeIndex < 0 || edgeIndex >= faceVerts.length) {
    return [{x:0,y:0}, {x:0,y:0}];
  }
  const i1 = edgeIndex;
  const i2 = (edgeIndex + 1) % faceVerts.length;
  
  let p1 = applyTransform2D(transform, faceVerts[i1]);
  let p2 = applyTransform2D(transform, faceVerts[i2]);
  
  return [p1, p2];
}

export function calculateSnap(
  parentVerts: Point2D[], 
  parentTx: Mat3, 
  parentEdgeIdx: number,
  childVerts: Point2D[],
  childEdgeIdx: number
): { x: number, y: number, rotation: number } {
  
  const [P0, P1] = getEdgeWorldPoints(parentVerts, parentTx, parentEdgeIdx);
  const C0 = childVerts[childEdgeIdx];
  const C1 = childVerts[(childEdgeIdx + 1) % childVerts.length];
  
  const dP = vecSub(P1, P0);
  const angleP = Math.atan2(dP.y, dP.x);
  
  const dC = vecSub(C1, C0);
  const angleC = Math.atan2(dC.y, dC.x);

  // Faces with matching winding should meet along the edge with opposite edge
  // directions. Mixed winding needs same edge direction to keep interiors apart.
  const sameWinding = getPolygonSignedArea(parentVerts) * getPolygonSignedArea(childVerts) >= 0;
  const anchorPoint = sameWinding ? P1 : P0;
  const rotation = angleP - angleC + (sameWinding ? Math.PI : 0);
  
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  
  const C0_rot_x = C0.x * c - C0.y * s;
  const C0_rot_y = C0.x * s + C0.y * c;
  
  const tx = anchorPoint.x - C0_rot_x;
  const ty = anchorPoint.y - C0_rot_y;
  
  return { x: tx, y: ty, rotation };
}

export function getFaceCentroid(face: PlacedFace): Point2D {
  const tx = createTransform2D(face.transform.x, face.transform.y, face.transform.rotation);
  let sumX = 0, sumY = 0;
  face.def.vertices.forEach(v => {
     const p = applyTransform2D(tx, v);
     sumX += p.x;
     sumY += p.y;
  });
  const n = face.def.vertices.length;
  return { x: sumX / n, y: sumY / n };
}

export function getConnectedComponent(net: PolyNet, startFaceId: string): Set<string> {
  const visited = new Set<string>();
  const queue = [startFaceId];
  visited.add(startFaceId);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const connections = (net.connections || []).filter(c => c.faceAId === currentId || c.faceBId === currentId);
    for (const conn of connections) {
      const neighborId = conn.faceAId === currentId ? conn.faceBId : conn.faceAId;
      if (neighborId && !visited.has(neighborId) && net.faces[neighborId]) {
        visited.add(neighborId);
        queue.push(neighborId);
      }
    }
  }
  return visited;
}

export function getAlignTransform(
  sourceFace: PlacedFace, sourceEdgeIdx: number, 
  targetFace: PlacedFace, targetEdgeIdx: number
): { x: number, y: number, rotation: number } {
  
  const sTx = createTransform2D(sourceFace.transform.x, sourceFace.transform.y, sourceFace.transform.rotation);
  const tTx = createTransform2D(targetFace.transform.x, targetFace.transform.y, targetFace.transform.rotation);
  return calculateSnap(targetFace.def.vertices, tTx, targetEdgeIdx, sourceFace.def.vertices, sourceEdgeIdx);
}

export function mirrorPolyNet(net: PolyNet, faceIds: string[]) {
  if (faceIds.length === 0) return net;
  let cx = 0, cy = 0;
  faceIds.forEach(id => {
    const c = getFaceCentroid(net.faces[id]);
    cx += c.x; cy += c.y;
  });
  cx /= faceIds.length; cy /= faceIds.length;

  const newFaces = { ...net.faces };
  faceIds.forEach(id => {
    const f = newFaces[id];
    const newVerts = f.def.vertices.map(v => ({ x: -v.x, y: v.y })).reverse(); 
    newFaces[id] = {
      ...f,
      def: { ...f.def, vertices: newVerts },
      transform: { x: cx - (f.transform.x - cx), y: f.transform.y, rotation: -f.transform.rotation }
    };
  });
  return { ...net, faces: newFaces };
}

export function isPointInRect(p: Point2D, r1: Point2D, r2: Point2D) {
  const minX = Math.min(r1.x, r2.x); const maxX = Math.max(r1.x, r2.x);
  const minY = Math.min(r1.y, r2.y); const maxY = Math.max(r1.y, r2.y);
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

export function isPointInPolygon(p: Point2D, vertices: Point2D[]): boolean {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const xi = vertices[i].x, yi = vertices[i].y;
        const xj = vertices[j].x, yj = vertices[j].y;
        const intersect = ((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}
