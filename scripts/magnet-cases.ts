import { PlacedFace, PolyNet, FaceDefinition, MagnetEdge, MagnetVertex } from '../types.js';
import {
  compute3DLayout,
  distance3,
  getAlignTransform,
  getShapeDefinition,
  solveMagnetFoldByHingesAndEdges,
  solveMagnetFoldByHingesAndVertices
} from '../utils/math.js';

function makeFace(id: string, def: FaceDefinition): PlacedFace {
  return {
    id,
    def,
    transform: { x: 0, y: 0, rotation: 0 },
    parentId: null,
    parentEdgeIndex: null,
    myEdgeIndex: null
  };
}

function attachFace(
  parent: PlacedFace,
  parentEdgeIndex: number,
  child: PlacedFace,
  childEdgeIndex: number
): PlacedFace {
  const transform = getAlignTransform(child, childEdgeIndex, parent, parentEdgeIndex);
  return {
    ...child,
    transform,
    parentId: parent.id,
    parentEdgeIndex,
    myEdgeIndex: childEdgeIndex
  };
}

function applyUpdates(net: PolyNet, updates: { connId: string; delta: number }[]): PolyNet {
  return {
    ...net,
    connections: net.connections.map(connection => {
      const update = updates.find(item => item.connId === connection.id);
      return update
        ? { ...connection, foldAngle: (connection.foldAngle || 0) + update.delta }
        : connection;
    })
  };
}

function getConnectionIdForEdge(net: PolyNet, edge: MagnetEdge): string | null {
  const connection = net.connections.find(item =>
    (item.faceAId === edge.faceId && item.edgeAIndex === edge.edgeIndex) ||
    (item.faceBId === edge.faceId && item.edgeBIndex === edge.edgeIndex)
  );
  return connection?.id || null;
}

function getVertexPoint(net: PolyNet, rootId: string, selection: MagnetVertex) {
  const layout = compute3DLayout(net, rootId);
  const face = net.faces[selection.faceId];
  const matrix = layout.matrices[selection.faceId];
  if (!face || !matrix) return null;
  const vertex = face.def.vertices[selection.vertexIndex];
  return {
    x: matrix[0] * vertex.x + matrix[1] * vertex.y + matrix[3],
    y: matrix[4] * vertex.x + matrix[5] * vertex.y + matrix[7],
    z: matrix[8] * vertex.x + matrix[9] * vertex.y + matrix[11]
  };
}

function getEdgePoints(net: PolyNet, rootId: string, selection: MagnetEdge) {
  const layout = compute3DLayout(net, rootId);
  const face = net.faces[selection.faceId];
  const matrix = layout.matrices[selection.faceId];
  if (!face || !matrix) return null;
  const start = face.def.vertices[selection.edgeIndex];
  const end = face.def.vertices[(selection.edgeIndex + 1) % face.def.vertices.length];
  return {
    start: {
      x: matrix[0] * start.x + matrix[1] * start.y + matrix[3],
      y: matrix[4] * start.x + matrix[5] * start.y + matrix[7],
      z: matrix[8] * start.x + matrix[9] * start.y + matrix[11]
    },
    end: {
      x: matrix[0] * end.x + matrix[1] * end.y + matrix[3],
      y: matrix[4] * end.x + matrix[5] * end.y + matrix[7],
      z: matrix[8] * end.x + matrix[9] * end.y + matrix[11]
    }
  };
}

function bruteForceBestVertexCase(
  net: PolyNet,
  rootId: string,
  hingeA: MagnetEdge,
  hingeB: MagnetEdge,
  vertexA: MagnetVertex,
  vertexB: MagnetVertex
) {
  const connIdA = getConnectionIdForEdge(net, hingeA);
  const connIdB = getConnectionIdForEdge(net, hingeB);
  if (!connIdA || !connIdB) return null;

  let bestDistance = Infinity;
  let bestAngles: [number, number] = [0, 0];
  for (let angleA = -180; angleA <= 180; angleA += 1) {
    for (let angleB = -180; angleB <= 180; angleB += 1) {
      const sampled = applyUpdates(net, [
        { connId: connIdA, delta: angleA },
        { connId: connIdB, delta: angleB }
      ]);
      const pointA = getVertexPoint(sampled, rootId, vertexA);
      const pointB = getVertexPoint(sampled, rootId, vertexB);
      if (!pointA || !pointB) continue;
      const score = distance3(pointA, pointB);
      if (score < bestDistance) {
        bestDistance = score;
        bestAngles = [angleA, angleB];
      }
    }
  }

  return { bestDistance, bestAngles };
}

function bruteForceBestEdgeCase(
  net: PolyNet,
  rootId: string,
  hingeA: MagnetEdge,
  hingeB: MagnetEdge,
  targetA: MagnetEdge,
  targetB: MagnetEdge
) {
  const connIdA = getConnectionIdForEdge(net, hingeA);
  const connIdB = getConnectionIdForEdge(net, hingeB);
  if (!connIdA || !connIdB) return null;

  let bestDistance = Infinity;
  let bestAngles: [number, number] = [0, 0];
  for (let angleA = -180; angleA <= 180; angleA += 1) {
    for (let angleB = -180; angleB <= 180; angleB += 1) {
      const sampled = applyUpdates(net, [
        { connId: connIdA, delta: angleA },
        { connId: connIdB, delta: angleB }
      ]);
      const edgeA = getEdgePoints(sampled, rootId, targetA);
      const edgeB = getEdgePoints(sampled, rootId, targetB);
      if (!edgeA || !edgeB) continue;
      const forward = distance3(edgeA.start, edgeB.start) + distance3(edgeA.end, edgeB.end);
      const reversed = distance3(edgeA.start, edgeB.end) + distance3(edgeA.end, edgeB.start);
      const score = Math.min(forward, reversed);
      if (score < bestDistance) {
        bestDistance = score;
        bestAngles = [angleA, angleB];
      }
    }
  }

  return { bestDistance, bestAngles };
}

function logVertexCase(
  name: string,
  net: PolyNet,
  rootId: string,
  hingeA: MagnetEdge,
  hingeB: MagnetEdge,
  vertexA: MagnetVertex,
  vertexB: MagnetVertex
) {
  const result = solveMagnetFoldByHingesAndVertices(net, hingeA, hingeB, vertexA, vertexB, rootId);
  const brute = bruteForceBestVertexCase(net, rootId, hingeA, hingeB, vertexA, vertexB);

  console.log(`\n${name}`);
  console.log('solver', result);
  console.log('brute', brute);
  if (!result) return;

  const folded = applyUpdates(net, result.updates);
  const pointA = getVertexPoint(folded, rootId, vertexA);
  const pointB = getVertexPoint(folded, rootId, vertexB);
  console.log('solverDistance', pointA && pointB ? distance3(pointA, pointB) : null);
}

function logEdgeCase(
  name: string,
  net: PolyNet,
  rootId: string,
  hingeA: MagnetEdge,
  hingeB: MagnetEdge,
  targetA: MagnetEdge,
  targetB: MagnetEdge
) {
  const result = solveMagnetFoldByHingesAndEdges(net, hingeA, hingeB, targetA, targetB, rootId);
  const brute = bruteForceBestEdgeCase(net, rootId, hingeA, hingeB, targetA, targetB);

  console.log(`\n${name}`);
  console.log('solver', result);
  console.log('brute', brute);
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

section('Case 1: Square With Opposite Triangles');
const square = makeFace('square', getShapeDefinition('square'));
const triA = attachFace(square, 0, makeFace('triA', getShapeDefinition('triangle')), 0);
const triB = attachFace(square, 2, makeFace('triB', getShapeDefinition('triangle')), 0);
const net1: PolyNet = {
  faces: {
    [square.id]: square,
    [triA.id]: triA,
    [triB.id]: triB
  },
  connections: [
    { id: 'c1', faceAId: square.id, edgeAIndex: 0, faceBId: triA.id, edgeBIndex: 0, foldAngle: 0 },
    { id: 'c2', faceAId: square.id, edgeAIndex: 2, faceBId: triB.id, edgeBIndex: 0, foldAngle: 0 }
  ]
};
logVertexCase(
  'case1 vertex',
  net1,
  square.id,
  { faceId: 'triA', edgeIndex: 0 },
  { faceId: 'triB', edgeIndex: 0 },
  { faceId: 'triA', vertexIndex: 2 },
  { faceId: 'triB', vertexIndex: 2 }
);

section('Case 2: Pentagon With Two Squares');
const pentagon = makeFace('pentagon', getShapeDefinition('pentagon'));
const sqA = attachFace(pentagon, 0, makeFace('sqA', getShapeDefinition('square')), 0);
const sqB = attachFace(pentagon, 2, makeFace('sqB', getShapeDefinition('square')), 0);
const net2: PolyNet = {
  faces: {
    [pentagon.id]: pentagon,
    [sqA.id]: sqA,
    [sqB.id]: sqB
  },
  connections: [
    { id: 'c3', faceAId: pentagon.id, edgeAIndex: 0, faceBId: sqA.id, edgeBIndex: 0, foldAngle: 0 },
    { id: 'c4', faceAId: pentagon.id, edgeAIndex: 2, faceBId: sqB.id, edgeBIndex: 0, foldAngle: 0 }
  ]
};
for (const vertexPair of [
  [{ faceId: 'sqA', vertexIndex: 2 }, { faceId: 'sqB', vertexIndex: 2 }],
  [{ faceId: 'sqA', vertexIndex: 2 }, { faceId: 'sqB', vertexIndex: 3 }],
  [{ faceId: 'sqA', vertexIndex: 3 }, { faceId: 'sqB', vertexIndex: 2 }],
  [{ faceId: 'sqA', vertexIndex: 3 }, { faceId: 'sqB', vertexIndex: 3 }]
] as [MagnetVertex, MagnetVertex][]) {
  logVertexCase(
    `case2 vertices ${vertexPair[0].vertexIndex}-${vertexPair[1].vertexIndex}`,
    net2,
    pentagon.id,
    { faceId: 'sqA', edgeIndex: 0 },
    { faceId: 'sqB', edgeIndex: 0 },
    vertexPair[0],
    vertexPair[1]
  );
}

section('Case 3: Square With Opposite Hexagons');
const square2 = makeFace('square2', getShapeDefinition('square'));
const hexA = attachFace(square2, 0, makeFace('hexA', getShapeDefinition('hexagon')), 0);
const hexB = attachFace(square2, 2, makeFace('hexB', getShapeDefinition('hexagon')), 0);
const net3: PolyNet = {
  faces: {
    [square2.id]: square2,
    [hexA.id]: hexA,
    [hexB.id]: hexB
  },
  connections: [
    { id: 'c5', faceAId: square2.id, edgeAIndex: 0, faceBId: hexA.id, edgeBIndex: 0, foldAngle: 0 },
    { id: 'c6', faceAId: square2.id, edgeAIndex: 2, faceBId: hexB.id, edgeBIndex: 0, foldAngle: 0 }
  ]
};
logEdgeCase(
  'case3 opposite edges',
  net3,
  square2.id,
  { faceId: 'hexA', edgeIndex: 0 },
  { faceId: 'hexB', edgeIndex: 0 },
  { faceId: 'hexA', edgeIndex: 3 },
  { faceId: 'hexB', edgeIndex: 3 }
);

section('Case 4: Three Squares In A Line');
const squareMid = makeFace('squareMid', getShapeDefinition('square'));
const squareLeft = attachFace(squareMid, 3, makeFace('squareLeft', getShapeDefinition('square')), 1);
const squareRight = attachFace(squareMid, 1, makeFace('squareRight', getShapeDefinition('square')), 3);
const net4: PolyNet = {
  faces: {
    [squareMid.id]: squareMid,
    [squareLeft.id]: squareLeft,
    [squareRight.id]: squareRight
  },
  connections: [
    { id: 'c7', faceAId: squareMid.id, edgeAIndex: 3, faceBId: squareLeft.id, edgeBIndex: 1, foldAngle: 0 },
    { id: 'c8', faceAId: squareMid.id, edgeAIndex: 1, faceBId: squareRight.id, edgeBIndex: 3, foldAngle: 0 }
  ]
};
for (const vertexPair of [
  [{ faceId: 'squareLeft', vertexIndex: 3 }, { faceId: 'squareRight', vertexIndex: 1 }],
  [{ faceId: 'squareLeft', vertexIndex: 3 }, { faceId: 'squareRight', vertexIndex: 2 }],
  [{ faceId: 'squareLeft', vertexIndex: 0 }, { faceId: 'squareRight', vertexIndex: 1 }],
  [{ faceId: 'squareLeft', vertexIndex: 0 }, { faceId: 'squareRight', vertexIndex: 2 }]
] as [MagnetVertex, MagnetVertex][]) {
  logVertexCase(
    `case4 vertices ${vertexPair[0].vertexIndex}-${vertexPair[1].vertexIndex}`,
    net4,
    squareMid.id,
    { faceId: 'squareLeft', edgeIndex: 1 },
    { faceId: 'squareRight', edgeIndex: 3 },
    vertexPair[0],
    vertexPair[1]
  );
}
logEdgeCase(
  'case4 opposite edges',
  net4,
  squareMid.id,
  { faceId: 'squareLeft', edgeIndex: 1 },
  { faceId: 'squareRight', edgeIndex: 3 },
  { faceId: 'squareLeft', edgeIndex: 3 },
  { faceId: 'squareRight', edgeIndex: 1 }
);

section('Case 5: Center Hexagon With Hexagons On Sides 1 And 3');
const hexCenter = makeFace('hexCenter', getShapeDefinition('hexagon'));
const hexSide1 = attachFace(hexCenter, 1, makeFace('hexSide1', getShapeDefinition('hexagon')), 0);
const hexSide3 = attachFace(hexCenter, 3, makeFace('hexSide3', getShapeDefinition('hexagon')), 0);
const net5: PolyNet = {
  faces: {
    [hexCenter.id]: hexCenter,
    [hexSide1.id]: hexSide1,
    [hexSide3.id]: hexSide3
  },
  connections: [
    { id: 'c9', faceAId: hexCenter.id, edgeAIndex: 1, faceBId: hexSide1.id, edgeBIndex: 0, foldAngle: 0 },
    { id: 'c10', faceAId: hexCenter.id, edgeAIndex: 3, faceBId: hexSide3.id, edgeBIndex: 0, foldAngle: 0 }
  ]
};
for (const vertexPair of [
  [{ faceId: 'hexSide1', vertexIndex: 3 }, { faceId: 'hexSide3', vertexIndex: 3 }],
  [{ faceId: 'hexSide1', vertexIndex: 3 }, { faceId: 'hexSide3', vertexIndex: 4 }],
  [{ faceId: 'hexSide1', vertexIndex: 4 }, { faceId: 'hexSide3', vertexIndex: 3 }],
  [{ faceId: 'hexSide1', vertexIndex: 4 }, { faceId: 'hexSide3', vertexIndex: 4 }]
] as [MagnetVertex, MagnetVertex][]) {
  logVertexCase(
    `case5 vertices ${vertexPair[0].vertexIndex}-${vertexPair[1].vertexIndex}`,
    net5,
    hexCenter.id,
    { faceId: 'hexSide1', edgeIndex: 0 },
    { faceId: 'hexSide3', edgeIndex: 0 },
    vertexPair[0],
    vertexPair[1]
  );
}

section('Case 6: Hex Hex Square Square Hex Hex');
const hexOuterLeft = makeFace('hexOuterLeft', getShapeDefinition('hexagon'));
const hexInnerLeft = attachFace(hexOuterLeft, 2, makeFace('hexInnerLeft', getShapeDefinition('hexagon')), 5);
const squareLeft2 = attachFace(hexInnerLeft, 2, makeFace('squareLeft2', getShapeDefinition('square')), 3);
const squareRight2 = attachFace(squareLeft2, 1, makeFace('squareRight2', getShapeDefinition('square')), 3);
const hexInnerRight = attachFace(squareRight2, 1, makeFace('hexInnerRight', getShapeDefinition('hexagon')), 5);
const hexOuterRight = attachFace(hexInnerRight, 2, makeFace('hexOuterRight', getShapeDefinition('hexagon')), 5);
const net6: PolyNet = {
  faces: {
    [hexOuterLeft.id]: hexOuterLeft,
    [hexInnerLeft.id]: hexInnerLeft,
    [squareLeft2.id]: squareLeft2,
    [squareRight2.id]: squareRight2,
    [hexInnerRight.id]: hexInnerRight,
    [hexOuterRight.id]: hexOuterRight
  },
  connections: [
    { id: 'c11', faceAId: hexOuterLeft.id, edgeAIndex: 2, faceBId: hexInnerLeft.id, edgeBIndex: 5, foldAngle: 0 },
    { id: 'c12', faceAId: hexInnerLeft.id, edgeAIndex: 2, faceBId: squareLeft2.id, edgeBIndex: 3, foldAngle: 0 },
    { id: 'c13', faceAId: squareLeft2.id, edgeAIndex: 1, faceBId: squareRight2.id, edgeBIndex: 3, foldAngle: 0 },
    { id: 'c14', faceAId: squareRight2.id, edgeAIndex: 1, faceBId: hexInnerRight.id, edgeBIndex: 5, foldAngle: 0 },
    { id: 'c15', faceAId: hexInnerRight.id, edgeAIndex: 2, faceBId: hexOuterRight.id, edgeBIndex: 5, foldAngle: 0 }
  ]
};
for (const vertexPair of [
  [{ faceId: 'hexInnerLeft', vertexIndex: 5 }, { faceId: 'hexInnerRight', vertexIndex: 2 }],
  [{ faceId: 'hexInnerLeft', vertexIndex: 5 }, { faceId: 'hexInnerRight', vertexIndex: 3 }],
  [{ faceId: 'hexInnerLeft', vertexIndex: 0 }, { faceId: 'hexInnerRight', vertexIndex: 2 }],
  [{ faceId: 'hexInnerLeft', vertexIndex: 0 }, { faceId: 'hexInnerRight', vertexIndex: 3 }]
] as [MagnetVertex, MagnetVertex][]) {
  logVertexCase(
    `case6 vertices ${vertexPair[0].vertexIndex}-${vertexPair[1].vertexIndex}`,
    net6,
    hexOuterLeft.id,
    { faceId: 'hexInnerLeft', edgeIndex: 2 },
    { faceId: 'hexInnerRight', edgeIndex: 5 },
    vertexPair[0],
    vertexPair[1]
  );
}
logEdgeCase(
  'case6 opposite edges on inner hexagons',
  net6,
  hexOuterLeft.id,
  { faceId: 'hexInnerLeft', edgeIndex: 2 },
  { faceId: 'hexInnerRight', edgeIndex: 5 },
  { faceId: 'hexInnerLeft', edgeIndex: 5 },
  { faceId: 'hexInnerRight', edgeIndex: 2 }
);
