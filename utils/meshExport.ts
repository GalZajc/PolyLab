import * as THREE from 'three';
import { PlacedFace, Point3D, PolyNet } from '../types';
import { applyMatrix4, applyTransform2D, compute3DLayout, createTransform2D, getConnectedComponent } from './math';

export interface MeshExportOptions {
  exportMode: '2d' | '3d';
  deduplicateVertices: boolean;
  triangulate: boolean;
  tolerance?: number;
}

export interface MeshExportData {
  verticesCsv: string;
  indicesCsv: string;
  vertexCount: number;
  primitiveCount: number;
}

const DEFAULT_VERTEX_TOLERANCE = 1e-10;

function formatCsvNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toPrecision(17);
}

function samePointWithinTolerance(a: Point3D, b: Point3D, tolerance: number): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.z - b.z) <= tolerance
  );
}

function getFaceMatrices(net: PolyNet, faceIds: string[]): Record<string, number[]> {
  const matrices: Record<string, number[]> = {};
  const remainingFaceIds = new Set(faceIds.filter(faceId => !!net.faces[faceId]));

  while (remainingFaceIds.size > 0) {
    const rootId = remainingFaceIds.values().next().value as string | undefined;
    if (!rootId) break;
    const component = getConnectedComponent(net, rootId);
    const layout = compute3DLayout(net, rootId);
    component.forEach(faceId => {
      if (!remainingFaceIds.has(faceId)) return;
      const matrix = layout.matrices[faceId];
      if (matrix) {
        matrices[faceId] = matrix;
      }
      remainingFaceIds.delete(faceId);
    });
  }

  return matrices;
}

function triangulateFace(face: PlacedFace): number[][] {
  const contour = face.def.vertices.map(vertex => new THREE.Vector2(vertex.x, vertex.y));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  return triangles.map(triangle => [triangle[0], triangle[1], triangle[2]]);
}

function get2DWorldVertices(face: PlacedFace): Point3D[] {
  const transform = createTransform2D(face.transform.x, face.transform.y, face.transform.rotation);
  return face.def.vertices.map(vertex => {
    const point = applyTransform2D(transform, vertex);
    return { x: point.x, y: point.y, z: 0 };
  });
}

export function buildMeshExportData(
  net: PolyNet,
  selectedFaceIds: string[],
  options: MeshExportOptions
): MeshExportData {
  const tolerance = options.tolerance ?? DEFAULT_VERTEX_TOLERANCE;
  const faceIds = selectedFaceIds.length > 0 ? selectedFaceIds : Object.keys(net.faces);
  const orderedFaceIds = faceIds.filter(faceId => !!net.faces[faceId]);
  const matrices = getFaceMatrices(net, orderedFaceIds);

  const vertices: Point3D[] = [];
  const indexRows: number[][] = [];

  const registerVertex = (point: Point3D) => {
    if (options.deduplicateVertices) {
      const existingIndex = vertices.findIndex(existingPoint => samePointWithinTolerance(existingPoint, point, tolerance));
      if (existingIndex >= 0) {
        return existingIndex;
      }
    }
    vertices.push(point);
    return vertices.length - 1;
  };

  orderedFaceIds.forEach(faceId => {
    const face = net.faces[faceId];
    if (!face) return;

    const worldVertices = options.exportMode === '2d'
      ? get2DWorldVertices(face)
      : (() => {
          const matrix = matrices[faceId];
          if (!matrix) return null;
          return face.def.vertices.map(vertex => applyMatrix4({ x: vertex.x, y: vertex.y, z: 0 }, matrix));
        })();
    if (!worldVertices) return;
    const vertexIndices = worldVertices.map(registerVertex);

    if (options.triangulate) {
      triangulateFace(face).forEach(triangle => {
        indexRows.push(triangle.map(localIndex => vertexIndices[localIndex]));
      });
      return;
    }

    indexRows.push(vertexIndices);
  });

  return {
    verticesCsv: vertices.map(vertex => (
      options.exportMode === '2d'
        ? `${formatCsvNumber(vertex.x)},${formatCsvNumber(vertex.y)}`
        : `${formatCsvNumber(vertex.x)},${formatCsvNumber(vertex.y)},${formatCsvNumber(vertex.z)}`
    )).join('\n'),
    indicesCsv: indexRows.map(row => row.join(',')).join('\n'),
    vertexCount: vertices.length,
    primitiveCount: indexRows.length
  };
}
