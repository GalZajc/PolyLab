import React, { useState } from 'react';
import { Download, X } from 'lucide-react';

interface ExportMeshModalProps {
  uiTheme: 'light' | 'dark';
  selectedFaceCount: number;
  totalFaceCount: number;
  onClose: () => void;
  onExportVertices: (options: { deduplicateVertices: boolean; triangulate: boolean }) => void;
  onExportIndices: (options: { deduplicateVertices: boolean; triangulate: boolean }) => void;
}

export const ExportMeshModal: React.FC<ExportMeshModalProps> = ({
  uiTheme,
  selectedFaceCount,
  totalFaceCount,
  onClose,
  onExportVertices,
  onExportIndices
}) => {
  const [deduplicateVertices, setDeduplicateVertices] = useState(false);
  const [triangulate, setTriangulate] = useState(false);
  const exportCount = selectedFaceCount > 0 ? selectedFaceCount : totalFaceCount;

  return (
    <div className={`absolute inset-0 z-[80] flex items-center justify-center bg-black/30 ${uiTheme === 'dark' ? 'ui-theme-dark' : ''}`}>
      <div className="menu-panel w-[26rem] rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="menu-subtle flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <div className="text-base font-semibold text-gray-800">Export Mesh</div>
            <div className="text-xs text-gray-500">
              Exporting {exportCount} face{exportCount === 1 ? '' : 's'} to `vertices.csv` and `indices.csv`.
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close Export Mesh">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <label className="menu-surface flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            <span>Remove duplicated vertices</span>
            <input
              type="checkbox"
              checked={deduplicateVertices}
              onChange={event => setDeduplicateVertices(event.target.checked)}
            />
          </label>
          <label className="menu-surface flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            <span>Triangulize</span>
            <input
              type="checkbox"
              checked={triangulate}
              onChange={event => setTriangulate(event.target.checked)}
            />
          </label>
          <div className="text-xs text-gray-500">
            If nothing is selected, the whole net is exported.
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button type="button" onClick={onClose} className="menu-hover rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onExportVertices({ deduplicateVertices, triangulate })}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Download size={16} />
            Vertices CSV
          </button>
          <button
            type="button"
            onClick={() => onExportIndices({ deduplicateVertices, triangulate })}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Download size={16} />
            Indices CSV
          </button>
        </div>
      </div>
    </div>
  );
};
