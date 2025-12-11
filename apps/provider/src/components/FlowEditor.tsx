'use client';

import React, { useCallback } from 'react';
import {
  ReactFlow,
  addEdge,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Connection,
  Node,
  Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

interface FlowNode {
  id: string;
  type: string;
  config?: any;
  position?: { x: number; y: number };
}

interface FlowEditorProps {
  flowId: string;
  tenantSlug: string;
  initialNodes: FlowNode[];
  onSave?: (nodes: FlowNode[], edges: any[]) => void;
}

const nodeTypeColors: Record<string, string> = {
  begin: '#4F46E5',
  read_signals: '#7C3AED',
  check_captcha: '#EC4899',
  prompt_ui: '#06B6D4',
  metadata_write: '#10B981',
  require_reauth: '#F59E0B',
  branch: '#8B5CF6',
  webhook: '#3B82F6',
  api_request: '#14B8A6',
  finish: '#6366F1',
};

export function FlowEditor({
  flowId,
  tenantSlug,
  initialNodes,
  onSave,
}: FlowEditorProps) {
  // Convert Flow nodes to ReactFlow nodes
  const rfInitialNodes: Node[] = initialNodes.map((node, idx) => ({
    id: node.id,
    data: {
      label: `${node.type}\n(${node.id.slice(0, 8)})`,
    },
    position: node.position || { x: (idx % 3) * 300, y: Math.floor(idx / 3) * 200 },
    style: {
      background: nodeTypeColors[node.type] || '#999',
      color: '#fff',
      border: '2px solid #ddd',
      borderRadius: '8px',
      padding: '10px',
      fontSize: '12px',
      fontWeight: 'bold',
      textAlign: 'center' as const,
      minWidth: '120px',
    },
  }));

  const [nodes, setNodes, onNodesChange] = useNodesState(rfInitialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const newEdge: Edge = {
        ...connection,
        id: `${connection.source}-${connection.target}`,
        animated: true,
      };
      setEdges((eds: any) => addEdge(newEdge, eds));
    },
    [setEdges]
  );

  const handleSave = async () => {
    // Convert ReactFlow nodes back to Flow nodes
    const flowNodes: FlowNode[] = nodes.map((node) => ({
      id: node.id,
      type: (node.data as any)?.label?.split('\n')[0] || node.type || 'begin',
      position: node.position,
      config: {},
    }));

    try {
      const response = await fetch(`/api/flows/${flowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: flowNodes,
          edges: (edges as any).map((e: any) => ({
            source: e.source,
            target: e.target,
            id: e.id,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to save: ${response.status}`);
      }

      onSave?.(flowNodes, edges as any[]);
      alert('Flow saved successfully!');
    } catch (error) {
      alert(`Error saving flow: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  return (
    <div className="w-full border border-gray-200 rounded-lg overflow-hidden flex flex-col" style={{ height: '600px' }}>
      <div style={{ height: '100%', flex: 1 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges as any[]}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <MiniMap />
          <Controls />
          <Background />
        </ReactFlow>
      </div>
      <div className="p-4 bg-gray-50 border-t border-gray-200">
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          Save Flow
        </button>
      </div>
    </div>
  );
}
