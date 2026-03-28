
export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export type ShapeType = 'triangle' | 'square' | 'pentagon' | 'hexagon' | 'rhombus' | string;

export interface FaceDefinition {
  type: ShapeType;
  vertices: Point2D[]; // Local coordinates centered at (0,0)
  color: string;
}

// A face placed in the 2D net
export interface PlacedFace {
  id: string;
  def: FaceDefinition;
  // Transformation in the 2D Net coordinate system
  transform: {
    x: number;
    y: number;
    rotation: number; // radians
  };
  // Tree structure for folding
  parentId: string | null;
  parentEdgeIndex: number | null;
  myEdgeIndex: number | null; // The edge of this face that connects to parent
}

export interface Connection {
  id: string;
  faceAId: string;
  edgeAIndex: number;
  faceBId: string;
  edgeBIndex: number;
  foldAngle: number; // degrees
}

export interface PolyNet {
  faces: Record<string, PlacedFace>;
  connections: Connection[];
}

export interface Face3D {
  faceId: string;
  vertices: Point3D[];
  normal: Point3D;
  center: Point3D;
  transformMatrix: number[]; // 4x4 flattened
}

export interface ClipboardItem {
  faces: PlacedFace[];
  connections: Connection[];
  timestamp: number;
}

export interface MagnetEdge {
  faceId: string;
  edgeIndex: number;
}

export interface MagnetVertex {
  faceId: string;
  vertexIndex: number;
}

export type MagnetMode = 'regular' | 'vertex' | 'edge';
