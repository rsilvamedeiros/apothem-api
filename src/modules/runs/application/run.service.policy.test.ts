import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRunKit, contextFor, ORG, textResult, toolCallResult, WORKSPACE } from './__fixtures__/run-kit.js';
import { ConflictError } from '../../../common/errors.js';
import type { ToolExecutorPort } from '../../tools/application/tool-executor.js';

const builder = contextFor('builder');
const admin = contextFor('admin', 'approver');
const owner = contextFor('owner', 'owner');
const OTHER_WORKSPACE = '99999999-9999-4999-8999-999999999999';

describe('RunService with workspace tool rules (ADR-015)', () => {
  let kit: ReturnType<typeof buildRunKit>;

  const clockAuto = { tool: 'get_current_time', approval: 'auto' };
  const noteAuto = { tool: 'create_note', approval: 'auto' };
  const noteRequired = { tool: 'create_note', approval: 'required' };
  const note = { title: 'Call back', body: 'Tomorrow 10am' };

  beforeEach(async () => {
    kit = buildRunKit();
    await kit.addMember('owner', 'owner');
    await kit.addMember('admin', 'approver');
  });

  async function start(toolBindings: object[], proposal: ReturnType<typeof toolCallResult>, ctx = builder) {
    const { agent } = await kit.publishedAgent({ toolBindings });
    kit.gateway.respondWith(proposal, textResult('done'));
    return { agent, ...(await kit.runService.start(ctx, agent.id, { input: 'please' })) };
  }

  describe('blocked', () => {
    it('does not even offer a blocked tool to the model, but still offers the others', async () => {
      await kit.toolPolicyService.set(owner, 'get_current_time', 'blocked');
      const { agent } = await kit.publishedAgent({ toolBindings: [clockAuto, noteRequired] });
      await kit.runService.start(builder, agent.id, { input: 'hi' });
      expect(kit.gateway.calls[0]!.request.tools?.map((t) => t.name)).toEqual(['create_note']);
    });

    it('offers no tools at all when every bound tool is blocked', async () => {
      await kit.toolPolicyService.set(owner, 'get_current_time', 'blocked');
      const { agent } = await kit.publishedAgent({ toolBindings: [clockAuto] });
      await kit.runService.start(builder, agent.id, { input: 'hi' });
      expect(kit.gateway.calls[0]!.request.tools).toBeUndefined();
    });

    it('fails the run with TOOL_BLOCKED_BY_POLICY if the model proposes a blocked tool anyway, and runs nothing', async () => {
      const execute = vi.fn<ToolExecutorPort['execute']>(async () => ({ ok: true, result: {} }));
      kit = buildRunKit({ executor: { execute } });
      await kit.addMember('owner', 'owner');
      await kit.toolPolicyService.set(owner, 'create_note', 'blocked');

      const { run } = await start([noteAuto], toolCallResult('create_note', note));

      expect(run).toMatchObject({
        status: 'failed',
        errorCode: 'TOOL_BLOCKED_BY_POLICY',
        errorMessage: 'A workspace policy does not allow this tool.',
      });
      expect(execute).not.toHaveBeenCalled();
      expect(kit.approvals.rows).toHaveLength(0);
      expect(kit.notes.rows).toHaveLength(0);
    });

    it('records the blocked step against the tool, without the arguments, and audits the failure by code', async () => {
      await kit.toolPolicyService.set(owner, 'create_note', 'blocked');
      const { run } = await start([noteAuto], toolCallResult('create_note', note));

      const step = (await kit.steps.listByRun(run.id))[1]!;
      expect(step).toMatchObject({
        type: 'tool_call',
        status: 'failed',
        errorCode: 'TOOL_BLOCKED_BY_POLICY',
        detail: { tool: 'create_note', outcome: 'executed' },
      });
      expect(step.detail).not.toHaveProperty('arguments');
      expect(JSON.stringify(step)).not.toContain('Tomorrow 10am');
      expect(kit.audit.events.find((e) => e.action === 'run.failed')!.metadata).toMatchObject({ errorCode: 'TOOL_BLOCKED_BY_POLICY' });
    });

    it('keeps reporting an unbound tool as not bound, even when the workspace blocks it', async () => {
      await kit.toolPolicyService.set(owner, 'create_note', 'blocked');
      const { run } = await start([clockAuto], toolCallResult('create_note', note));
      expect(run).toMatchObject({ status: 'failed', errorCode: 'TOOL_NOT_BOUND' });
    });

    it('applies from the next run, without rewriting the published version', async () => {
      const { agent, version } = await kit.publishedAgent({ toolBindings: [noteAuto] });
      kit.gateway.respondWith(toolCallResult('create_note', note), textResult('saved'));
      expect((await kit.runService.start(builder, agent.id, { input: 'one' })).run.status).toBe('completed');

      await kit.toolPolicyService.set(owner, 'create_note', 'blocked');
      kit.gateway.respondWith(toolCallResult('create_note', note), textResult('saved'));
      const second = await kit.runService.start(builder, agent.id, { input: 'two' });
      expect(second.run).toMatchObject({ status: 'failed', errorCode: 'TOOL_BLOCKED_BY_POLICY', agentVersionId: version.id });
      expect(kit.notes.rows).toHaveLength(1);

      await kit.toolPolicyService.remove(owner, 'create_note');
      kit.gateway.respondWith(toolCallResult('create_note', note), textResult('saved'));
      expect((await kit.runService.start(builder, agent.id, { input: 'three' })).run.status).toBe('completed');
    });

    it('does not affect another workspace', async () => {
      await kit.toolPolicyService.set(contextFor('owner', 'owner', OTHER_WORKSPACE), 'create_note', 'blocked');
      const { run } = await start([noteAuto], toolCallResult('create_note', note));
      expect(run.status).toBe('completed');
    });
  });

  describe('approval required', () => {
    it('makes a read-only tool the binding sets to auto wait for a person', async () => {
      const execute = vi.fn<ToolExecutorPort['execute']>(async () => ({ ok: true, result: { now: 'noon' } }));
      kit = buildRunKit({ executor: { execute } });
      await kit.addMember('owner', 'owner');
      await kit.addMember('admin', 'approver');
      await kit.toolPolicyService.set(owner, 'get_current_time', 'approval_required');

      const { run } = await start([clockAuto], toolCallResult('get_current_time', {}));

      expect(run.status).toBe('waiting_approval');
      expect(execute).not.toHaveBeenCalled();
      expect(kit.approvals.rows).toEqual([expect.objectContaining({ toolName: 'get_current_time', status: 'pending' })]);
    });

    it('makes a write the binding sets to auto wait for a person, and a decision completes it', async () => {
      await kit.toolPolicyService.set(owner, 'create_note', 'approval_required');
      const { run } = await start([noteAuto], toolCallResult('create_note', note));
      expect(run.status).toBe('waiting_approval');
      expect(kit.notes.rows).toHaveLength(0);

      const decided = await kit.approvalService.decide(admin, kit.approvals.rows[0]!.id, { decision: 'approve' });
      expect(decided.run.status).toBe('completed');
      expect(kit.notes.rows).toHaveLength(1);
    });

    it('keeps the audit trail of the request without the arguments', async () => {
      await kit.toolPolicyService.set(owner, 'create_note', 'approval_required');
      await start([noteAuto], toolCallResult('create_note', note));
      expect(kit.audit.events.map((e) => e.action)).toContain('approval.requested');
      expect(JSON.stringify(kit.audit.events)).not.toContain('Tomorrow 10am');
    });
  });

  describe('work already waiting', () => {
    async function waitingNote() {
      const { run } = await start([noteRequired], toolCallResult('create_note', note));
      return { run, approval: kit.approvals.rows[0]! };
    }

    it('invalidates a pending approval when its tool is blocked afterwards, and performs nothing', async () => {
      const { run, approval } = await waitingNote();
      await kit.toolPolicyService.set(owner, 'create_note', 'blocked');

      await expect(kit.approvalService.decide(admin, approval.id, { decision: 'approve' })).rejects.toThrow(ConflictError);

      expect(kit.approvals.rows[0]).toMatchObject({ status: 'rejected', decisionReason: 'Invalidated: the tool is blocked by a workspace policy' });
      expect((await kit.runService.get(admin, run.id)).run).toMatchObject({ status: 'failed', errorCode: 'APPROVAL_INVALIDATED' });
      expect(kit.notes.rows).toHaveLength(0);
    });

    it('still lets a person reject it', async () => {
      const { approval } = await waitingNote();
      await kit.toolPolicyService.set(owner, 'create_note', 'blocked');
      const result = await kit.approvalService.decide(admin, approval.id, { decision: 'reject' });
      expect(result.run).toMatchObject({ status: 'failed', errorCode: 'APPROVAL_REJECTED' });
    });

    it('does not perform the action even if resumed directly after the tool was blocked', async () => {
      const { run, approval } = await waitingNote();
      await kit.toolPolicyService.set(owner, 'create_note', 'blocked');

      const resumed = await kit.runService.resumeAfterApproval(approval, 'x');

      expect(resumed).toMatchObject({ id: run.id, status: 'failed', errorCode: 'TOOL_BLOCKED_BY_POLICY' });
      expect(kit.notes.rows).toHaveLength(0);
      const step = (await kit.steps.listByRun(run.id)).at(-1)!;
      expect(step).toMatchObject({ status: 'failed', errorCode: 'TOOL_BLOCKED_BY_POLICY', detail: { tool: 'create_note', outcome: 'executed' } });
    });

    it('still completes an approved action when the rule only asks for approval', async () => {
      const { approval } = await waitingNote();
      await kit.toolPolicyService.set(owner, 'create_note', 'approval_required');
      const result = await kit.approvalService.decide(admin, approval.id, { decision: 'approve' });
      expect(result.run.status).toBe('completed');
      expect(kit.notes.rows).toHaveLength(1);
    });
  });

  it('fails closed, without calling the model, when the rules cannot be loaded', async () => {
    const { agent } = await kit.publishedAgent({ toolBindings: [clockAuto] });
    vi.spyOn(kit.toolPolicies, 'listByWorkspace').mockRejectedValueOnce(new Error('db at 10.0.0.5 refused'));

    const { run } = await kit.runService.start(builder, agent.id, { input: 'hi' });

    expect(run).toMatchObject({ status: 'failed', errorCode: 'RUN_INTERNAL_ERROR' });
    expect(JSON.stringify(run)).not.toContain('10.0.0.5');
    expect(kit.gateway.calls).toHaveLength(0);
  });

  it('reads the rules of the run workspace only', async () => {
    const { agent } = await kit.publishedAgent({ toolBindings: [clockAuto] });
    const spy = vi.spyOn(kit.toolPolicies, 'listByWorkspace');
    await kit.runService.start(builder, agent.id, { input: 'hi' });
    expect(spy).toHaveBeenCalledWith(WORKSPACE);
    expect(ORG).toBeDefined();
  });
});
