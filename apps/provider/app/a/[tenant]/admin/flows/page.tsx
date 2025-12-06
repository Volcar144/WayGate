'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type {
  FlowDashboardResponse,
  FlowDto,
  FlowNodeDto,
  FlowNodeType,
  FlowTrigger,
  UiPromptDto,
} from '@/types/flows';

const defaultPromptSchema = JSON.stringify(
  {
    fields: [
      {
        id: 'confirmation',
        label: 'Type YES to confirm',
        type: 'text',
        required: true,
        placeholder: 'YES',
      },
    ],
    submitLabel: 'Confirm',
    cancelLabel: 'Cancel',
  },
  null,
  2,
);

const defaultNodeConfig = JSON.stringify({
  notes: 'Add configuration here',
});

export default function FlowsPage() {
  const params = useParams<{ tenant: string }>();
  const tenant = params?.tenant;
  const [dashboard, setDashboard] = useState<FlowDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [newFlow, setNewFlow] = useState({ name: '', trigger: 'signin' as FlowTrigger });
  const [creatingFlow, setCreatingFlow] = useState(false);
  const [nodeForm, setNodeForm] = useState({ type: 'read_signals' as FlowNodeType, config: defaultNodeConfig, uiPromptId: '' });
  const [promptForm, setPromptForm] = useState({ title: '', description: '', schema: defaultPromptSchema, timeoutSec: 120 });
  const [savingMessage, setSavingMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant) return;
    fetchDashboard();
  }, [tenant]);

  async function fetchDashboard() {
    if (!tenant) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/a/${tenant}/admin/api/flows`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load flows');
      const data: FlowDashboardResponse = await res.json();
      setDashboard(data);
      if (!selectedFlowId && data.flows.length > 0) {
        setSelectedFlowId(data.flows[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load flows');
    } finally {
      setLoading(false);
    }
  }

  const selectedFlow = useMemo(() => {
    return dashboard?.flows.find((flow) => flow.id === selectedFlowId) || null;
  }, [dashboard, selectedFlowId]);

  async function handleCreateFlow(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant) return;
    setCreatingFlow(true);
    try {
      const res = await fetch(`/a/${tenant}/admin/api/flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newFlow),
      });
      if (!res.ok) throw new Error('Failed to create flow');
      setNewFlow({ name: '', trigger: 'signin' });
      await fetchDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create flow');
    } finally {
      setCreatingFlow(false);
    }
  }

  async function toggleFlowStatus(flow: FlowDto) {
    if (!tenant) return;
    try {
      const res = await fetch(`/a/${tenant}/admin/api/flows/${flow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: flow.status === 'enabled' ? 'disabled' : 'enabled' }),
      });
      if (!res.ok) throw new Error('Failed to update flow');
      await fetchDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update flow');
    }
  }

  async function deleteFlow(flowId: string) {
    if (!tenant) return;
    if (!confirm('Delete this flow?')) return;
    try {
      const res = await fetch(`/a/${tenant}/admin/api/flows/${flowId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete flow');
      if (selectedFlowId === flowId) {
        setSelectedFlowId(null);
      }
      await fetchDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete flow');
    }
  }

  async function handleAddNode(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant || !selectedFlow) return;
    try {
      const config = nodeForm.config ? JSON.parse(nodeForm.config) : {};
      const res = await fetch(`/a/${tenant}/admin/api/flows/${selectedFlow.id}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: nodeForm.type,
          config,
          uiPromptId: nodeForm.uiPromptId || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to add node');
      setNodeForm({ type: 'read_signals', config: defaultNodeConfig, uiPromptId: '' });
      await fetchDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add node (ensure config is valid JSON)');
    }
  }

  async function updateNode(flowId: string, node: FlowNodeDto, updates: { order?: number; config?: string; uiPromptId?: string | null }) {
    if (!tenant) return;
    try {
      const body: Record<string, any> = {};
      if (typeof updates.order === 'number') body.order = updates.order;
      if (updates.config !== undefined) {
        body.config = updates.config ? JSON.parse(updates.config) : {};
      }
      if (updates.uiPromptId !== undefined) {
        body.uiPromptId = updates.uiPromptId;
      }
      const res = await fetch(`/a/${tenant}/admin/api/flows/${flowId}/nodes/${node.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to update node');
      await fetchDashboard();
      setSavingMessage('Node updated');
      setTimeout(() => setSavingMessage(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update node');
    }
  }

  async function removeNode(flowId: string, nodeId: string) {
    if (!tenant) return;
    if (!confirm('Delete this node?')) return;
    try {
      const res = await fetch(`/a/${tenant}/admin/api/flows/${flowId}/nodes/${nodeId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete node');
      await fetchDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete node');
    }
  }

  async function handleCreatePrompt(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant) return;
    try {
      const schema = promptForm.schema ? JSON.parse(promptForm.schema) : {};
      const res = await fetch(`/a/${tenant}/admin/api/flows/prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: promptForm.title,
          description: promptForm.description || undefined,
          schema,
          timeoutSec: promptForm.timeoutSec,
        }),
      });
      if (!res.ok) throw new Error('Failed to create prompt');
      setPromptForm({ title: '', description: '', schema: defaultPromptSchema, timeoutSec: 120 });
      await fetchDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create prompt (ensure schema is valid JSON)');
    }
  }

  async function deletePrompt(promptId: string) {
    if (!tenant) return;
    if (!confirm('Delete this prompt?')) return;
    try {
      const res = await fetch(`/a/${tenant}/admin/api/flows/prompts/${promptId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete prompt');
      await fetchDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete prompt');
    }
  }

  const flows = dashboard?.flows ?? [];
  const prompts = dashboard?.prompts ?? [];
  const runs = dashboard?.runs ?? [];

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <nav className="flex text-sm text-gray-600 gap-2 mb-4">
            <Link href={`/a/${tenant}/admin`}>Dashboard</Link>
            <span>/</span>
            <span>Flows</span>
          </nav>
          <h1 className="text-2xl font-bold text-gray-900">Auth Flows</h1>
          <p className="text-gray-600">Compose tenant-specific authentication flows with prompts, branching and risk signals.</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded border border-red-200 bg-red-50 text-red-700">{error}</div>
      )}

      {savingMessage && (
        <div className="mb-4 p-3 rounded border border-green-200 bg-green-50 text-green-700">{savingMessage}</div>
      )}

      {loading && <div className="p-6 text-gray-500">Loading flows…</div>}

      {!loading && dashboard && (
        <div className="space-y-10">
          <StatsRow stats={dashboard.stats} />

          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Flows</h2>
                <button
                  onClick={fetchDashboard}
                  className="text-sm text-indigo-600 hover:text-indigo-800"
                >
                  Refresh
                </button>
              </div>
              <div className="space-y-3">
                {flows.length === 0 && <p className="text-sm text-gray-500">No flows yet. Create one below.</p>}
                {flows.map((flow) => (
                  <div
                    key={flow.id}
                    className={`border rounded-lg p-3 cursor-pointer ${selectedFlowId === flow.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}
                    onClick={() => setSelectedFlowId(flow.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold">{flow.name}</p>
                        <p className="text-xs text-gray-500 uppercase">{flow.trigger}</p>
                      </div>
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${flow.status === 'enabled' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'}`}
                      >
                        {flow.status}
                      </span>
                    </div>
                    <div className="flex mt-2 gap-2 text-xs">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFlowStatus(flow);
                        }}
                        className="text-indigo-600 hover:underline"
                      >
                        {flow.status === 'enabled' ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteFlow(flow.id);
                        }}
                        className="text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <form onSubmit={handleCreateFlow} className="mt-6 space-y-3">
                <h3 className="font-semibold text-sm">Create flow</h3>
                <input
                  type="text"
                  value={newFlow.name}
                  onChange={(e) => setNewFlow((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="Marketing sign-in"
                  required
                />
                <select
                  value={newFlow.trigger}
                  onChange={(e) => setNewFlow((prev) => ({ ...prev, trigger: e.target.value as FlowTrigger }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="signin">Sign in</option>
                  <option value="signup">Sign up</option>
                  <option value="pre_consent">Pre-consent</option>
                  <option value="post_consent">Post-consent</option>
                  <option value="custom">Custom</option>
                </select>
                <button
                  type="submit"
                  disabled={creatingFlow}
                  className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm"
                >
                  {creatingFlow ? 'Creating…' : 'Create flow'}
                </button>
              </form>
            </div>

            <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-4">
              <h2 className="font-semibold mb-4">Flow designer</h2>
              {!selectedFlow && <p className="text-sm text-gray-500">Select a flow to manage its nodes.</p>}
              {selectedFlow && (
                <div className="space-y-5">
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="font-semibold">{selectedFlow.name}</p>
                      <p className="text-xs text-gray-500">Trigger: {selectedFlow.trigger}</p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">Version {selectedFlow.version}</span>
                  </div>

                  <div className="space-y-3">
                    {selectedFlow.nodes.length === 0 && (
                      <p className="text-sm text-gray-500">No nodes yet. Add one below.</p>
                    )}
                    {selectedFlow.nodes.map((node) => (
                      <NodeCard
                        key={node.id}
                        node={node}
                        flowId={selectedFlow.id}
                        prompts={prompts}
                        onSave={updateNode}
                        onDelete={removeNode}
                      />
                    ))}
                  </div>

                  <form onSubmit={handleAddNode} className="border-t border-gray-200 pt-4 space-y-3">
                    <h3 className="font-semibold text-sm">Add node</h3>
                    <select
                      value={nodeForm.type}
                      onChange={(e) => setNodeForm((prev) => ({ ...prev, type: e.target.value as FlowNodeType }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="read_signals">ReadSignals</option>
                      <option value="check_captcha">CheckCaptcha</option>
                      <option value="prompt_ui">PromptUI</option>
                      <option value="metadata_write">MetadataWrite</option>
                      <option value="require_reauth">RequireReauth</option>
                      <option value="branch">Branch</option>
                      <option value="webhook">Webhook</option>
                      <option value="api_request">API Request</option>
                      <option value="finish">Finish</option>
                    </select>
                    <select
                      value={nodeForm.uiPromptId}
                      onChange={(e) => setNodeForm((prev) => ({ ...prev, uiPromptId: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">No prompt</option>
                      {prompts.map((prompt) => (
                        <option key={prompt.id} value={prompt.id}>
                          {prompt.title}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={nodeForm.config}
                      onChange={(e) => setNodeForm((prev) => ({ ...prev, config: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      rows={4}
                    />
                    <button type="submit" className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm">
                      Add node
                    </button>
                  </form>
                </div>
              )}
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Prompt library</h2>
              </div>
              <div className="space-y-3">
                {prompts.length === 0 && <p className="text-sm text-gray-500">No prompts yet.</p>}
                {prompts.map((prompt) => (
                  <div key={prompt.id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold">{prompt.title}</p>
                        <p className="text-xs text-gray-500">Fields: {prompt.schema.fields.length}</p>
                      </div>
                      <button
                        className="text-xs text-red-600"
                        onClick={() => deletePrompt(prompt.id)}
                      >
                        Delete
                      </button>
                    </div>
                    {prompt.description && <p className="text-sm text-gray-600 mt-1">{prompt.description}</p>}
                  </div>
                ))}
              </div>
              <form onSubmit={handleCreatePrompt} className="mt-5 space-y-3">
                <h3 className="font-semibold text-sm">Create prompt</h3>
                <input
                  type="text"
                  value={promptForm.title}
                  onChange={(e) => setPromptForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="Prompt title"
                  required
                />
                <input
                  type="text"
                  value={promptForm.description}
                  onChange={(e) => setPromptForm((prev) => ({ ...prev, description: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="Description"
                />
                <textarea
                  value={promptForm.schema}
                  onChange={(e) => setPromptForm((prev) => ({ ...prev, schema: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  rows={6}
                />
                <button type="submit" className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm">
                  Create prompt
                </button>
              </form>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Recent flow runs</h2>
              </div>
              <div className="space-y-3">
                {runs.length === 0 && <p className="text-sm text-gray-500">No flow executions yet.</p>}
                {runs.map((run) => (
                  <div key={run.id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold">{run.flowName}</p>
                        <p className="text-xs text-gray-500">{new Date(run.startedAt).toLocaleString()}</p>
                        <p className="text-xs text-gray-500">User: {run.user?.email ?? 'unknown'}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${run.status === 'success' ? 'bg-green-100 text-green-700' : run.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                        {run.status}
                      </span>
                    </div>
                    {run.events.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-sm text-indigo-600 cursor-pointer">Events ({run.events.length})</summary>
                        <ul className="mt-2 text-xs text-gray-600 space-y-1">
                          {run.events.map((event) => (
                            <li key={event.id}>
                              <span className="font-semibold">{event.type}</span> • {event.nodeType || 'unknown'} • {new Date(event.timestamp).toLocaleTimeString()}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function StatsRow({ stats }: { stats: FlowDashboardResponse['stats'] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <p className="text-sm text-gray-500">Total flows</p>
        <p className="text-2xl font-semibold">{stats.totalFlows}</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <p className="text-sm text-gray-500">Enabled flows</p>
        <p className="text-2xl font-semibold text-green-600">{stats.enabledFlows}</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <p className="text-sm text-gray-500">Recent failures</p>
        <p className="text-2xl font-semibold text-red-600">{stats.recentFailedRuns}</p>
        <p className="text-xs text-gray-400 mt-1">Last run: {stats.lastRunAt ? new Date(stats.lastRunAt).toLocaleString() : 'n/a'}</p>
      </div>
    </div>
  );
}

function NodeCard({
  node,
  flowId,
  prompts,
  onSave,
  onDelete,
}: {
  node: FlowNodeDto;
  flowId: string;
  prompts: UiPromptDto[];
  onSave: (flowId: string, node: FlowNodeDto, updates: { order?: number; config?: string; uiPromptId?: string | null }) => Promise<void>;
  onDelete: (flowId: string, nodeId: string) => Promise<void>;
}) {
  const [order, setOrder] = useState(node.order);
  const [configText, setConfigText] = useState(JSON.stringify(node.config ?? {}, null, 2));
  const [uiPromptId, setUiPromptId] = useState(node.uiPromptId || '');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setOrder(node.order);
    setConfigText(JSON.stringify(node.config ?? {}, null, 2));
    setUiPromptId(node.uiPromptId || '');
  }, [node.order, node.config, node.uiPromptId]);

  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold">{node.type}</p>
          <p className="text-xs text-gray-500">Order {node.order}</p>
        </div>
        <div className="flex gap-3 text-xs">
          <button className="text-indigo-600" onClick={() => setExpanded((prev) => !prev)}>
            {expanded ? 'Hide' : 'Edit'}
          </button>
          <button className="text-red-600" onClick={() => onDelete(flowId, node.id)}>
            Delete
          </button>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2 text-sm">
          <label className="block text-xs text-gray-500">Order</label>
          <input
            type="number"
            value={order}
            onChange={(e) => setOrder(Number(e.target.value))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <label className="block text-xs text-gray-500">Prompt</label>
          <select
            value={uiPromptId}
            onChange={(e) => setUiPromptId(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">None</option>
            {prompts.map((prompt) => (
              <option key={prompt.id} value={prompt.id}>
                {prompt.title}
              </option>
            ))}
          </select>
          <label className="block text-xs text-gray-500">Config</label>
          <textarea
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            rows={4}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <button
            className="bg-indigo-600 text-white rounded-lg px-3 py-2 text-sm"
            onClick={() => onSave(flowId, node, { order, config: configText, uiPromptId: uiPromptId || null })}
          >
            Save node
          </button>
        </div>
      )}
    </div>
  );
}
