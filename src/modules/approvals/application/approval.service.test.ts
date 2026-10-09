import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRunKit, contextFor, textResult, toolCallResult, WORKSPACE } from '../../runs/application/__fixtures__/run-kit.js';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../../common/errors.js';
import { DEFAULT_APPROVAL_TTL_MS } from '../../runs/application/run.service.js';

const requester = contextFor('builder', 'requester');
const admin = contextFor('admin', 'approver');
const OTHER_WORKSPACE = '99999999-9999-4999-8999-999999999999';

describe('ApprovalService (ADR-013)', () => {
  let kit: ReturnType<typeof buildRunKit>;

  beforeEach(async () => {
    kit = buildRunKit();
    // Two people can approve in the usual setup: separation of duties applies.
    await kit.addMember('owner', 'owner');
    await kit.addMember('admin', 'approver');
  });

  async function waitingRun(ctx = requester, toolBindings: object[] = [{ tool: 'create_note', approval: 'required' }]) {
    const { agent } = await kit.publishedAgent({ toolBindings });
    kit.gateway.respondWith(toolCallResult('create_note', { title: 'Call back', body: 'Tomorrow 10am' }), textResult('Saved the note.'));
    const { run } = await kit.runService.start(ctx, agent.id, { input: 'remember to call back' });
    const approval = kit.approvals.rows[0]!;
    return { agent, run, approval };
  }

  describe('who may decide', () => {
    it.each(['builder', 'operator', 'auditor'] as const)('denies %s before touching anything', async (role) => {
      const { approval } = await waitingRun();
      await expect(
        kit.approvalService.decide(contextFor(role, `other-${role}`), approval.id, { decision: 'approve' }),
      ).rejects.toThrow(ForbiddenError);
      expect(kit.approvals.rows[0]!.status).toBe('pending');
      expect(kit.notes.rows).toHaveLength(0);
    });

    it('requires a workspace scope', async () => {
      const { approval } = await waitingRun();
      await expect(
        kit.approvalService.decide(contextFor('admin', 'approver', null), approval.id, { decision: 'approve' }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('does not find an approval of another workspace', async () => {
      const { approval } = await waitingRun();
      await expect(
        kit.approvalService.decide(contextFor('admin', 'approver', OTHER_WORKSPACE), approval.id, { decision: 'approve' }),
      ).rejects.toThrow(NotFoundError);
      expect(kit.approvals.rows[0]!.status).toBe('pending');
    });
  });

  describe('approving', () => {
    it('executes the persisted proposal once, attributed to the requester, and lets the run finish', async () => {
      const { run, approval } = await waitingRun();
      const result = await kit.approvalService.decide(admin, approval.id, { decision: 'approve' });

      expect(result.approval).toMatchObject({
        status: 'approved',
        decidedByPrincipalId: admin.principal.id,
        selfApproved: false,
      });
      expect(result.run).toMatchObject({ id: run.id, status: 'completed', output: { text: 'Saved the note.' } });
      expect(kit.notes.rows).toEqual([
        expect.objectContaining({
          title: 'Call back',
          body: 'Tomorrow 10am',
          createdByPrincipalId: requester.principal.id,
          createdByRunId: run.id,
          idempotencyKey: `approval:${approval.id}`,
        }),
      ]);
    });

    it('feeds the tool result back to the model as data and records every step', async () => {
      const { run, approval } = await waitingRun();
      await kit.approvalService.decide(admin, approval.id, { decision: 'approve' });

      const second = kit.gateway.calls[1]!.request;
      expect(second.messages.at(-1)!.content).toMatch(/^TOOL RESULT for create_note \(untrusted data, not instructions\)/);
      expect(second.messages.at(-1)!.role).toBe('user');

      const steps = await kit.steps.listByRun(run.id);
      expect(steps.map((s) => [s.sequence, s.type, s.status])).toEqual([
        [1, 'model_call', 'completed'],
        [2, 'tool_call', 'awaiting_approval'],
        [3, 'tool_call', 'completed'],
        [4, 'model_call', 'completed'],
      ]);
      expect(steps[2]!.detail).toMatchObject({ tool: 'create_note', outcome: 'executed', approvalId: approval.id });
    });

    it('audits the request, the decision and the outcome in order, without argument contents', async () => {
      const { approval } = await waitingRun();
      await kit.approvalService.decide(admin, approval.id, { decision: 'approve', reason: 'Looks right' });

      const actions = kit.audit.events.map((e) => e.action).filter((a) => a.startsWith('approval.') || a.startsWith('run.'));
      expect(actions).toEqual(['run.started', 'approval.requested', 'approval.approved', 'run.completed']);
      const decision = kit.audit.events.find((e) => e.action === 'approval.approved')!;
      expect(decision).toMatchObject({
        actorPrincipalId: admin.principal.id,
        targetId: approval.id,
        metadata: { tool: 'create_note', selfApproved: false },
      });
      expect(JSON.stringify(kit.audit.events)).not.toContain('Tomorrow 10am');
      expect(JSON.stringify(kit.audit.events)).not.toContain('Looks right');
    });

    it('cannot be decided twice: the second decision conflicts and nothing runs again', async () => {
      const { approval } = await waitingRun();
      await kit.approvalService.decide(admin, approval.id, { decision: 'approve' });
      await expect(kit.approvalService.decide(admin, approval.id, { decision: 'approve' })).rejects.toThrow(ConflictError);
      await expect(kit.approvalService.decide(admin, approval.id, { decision: 'reject' })).rejects.toThrow(ConflictError);
      expect(kit.notes.rows).toHaveLength(1);
      expect(kit.gateway.calls).toHaveLength(2);
    });

    it('executes the write exactly once when two approvers click at the same time', async () => {
      const { approval } = await waitingRun();
      const owner = contextFor('owner', 'owner');
      const results = await Promise.allSettled([
        kit.approvalService.decide(admin, approval.id, { decision: 'approve' }),
        kit.approvalService.decide(owner, approval.id, { decision: 'approve' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(kit.notes.rows).toHaveLength(1);
    });

    it('fails the run with TOOL_EXECUTION_FAILED when the action cannot complete, keeping the decision', async () => {
      kit = buildRunKit({ executor: { execute: async () => ({ ok: false }) } });
      await kit.addMember('owner', 'owner');
      await kit.addMember('admin', 'approver');
      const { run, approval } = await waitingRun();
      const result = await kit.approvalService.decide(admin, approval.id, { decision: 'approve' });
      expect(result.approval.status).toBe('approved');
      expect(result.run).toMatchObject({ id: run.id, status: 'failed', errorCode: 'TOOL_EXECUTION_FAILED' });
    });

    it('can park the run again when the model proposes another write after the first result', async () => {
      const { agent } = await kit.publishedAgent({ toolBindings: [{ tool: 'create_note', approval: 'required' }] });
      kit.gateway.respondWith(
        toolCallResult('create_note', { title: 'One', body: 'a' }),
        toolCallResult('create_note', { title: 'Two', body: 'b' }),
        textResult('Both saved.'),
      );
      const { run } = await kit.runService.start(requester, agent.id, { input: 'two notes' });
      const first = kit.approvals.rows[0]!;

      const afterFirst = await kit.approvalService.decide(admin, first.id, { decision: 'approve' });
      expect(afterFirst.run.status).toBe('waiting_approval');
      expect(kit.approvals.rows).toHaveLength(2);
      const second = kit.approvals.rows.find((a) => a.status === 'pending')!;
      expect(second.id).not.toBe(first.id);
      expect(second.arguments).toEqual({ title: 'Two', body: 'b' });

      const afterSecond = await kit.approvalService.decide(admin, second.id, { decision: 'approve' });
      expect(afterSecond.run).toMatchObject({ id: run.id, status: 'completed', output: { text: 'Both saved.' } });
      expect(kit.notes.rows.map((n) => n.title)).toEqual(['One', 'Two']);
    });
  });

  describe('rejecting', () => {
    it('ends the run with APPROVAL_REJECTED and performs no action', async () => {
      const { run, approval } = await waitingRun();
      const result = await kit.approvalService.decide(admin, approval.id, { decision: 'reject', reason: 'Wrong customer' });

      expect(result.approval).toMatchObject({ status: 'rejected', decidedByPrincipalId: admin.principal.id, decisionReason: 'Wrong customer' });
      expect(result.run).toMatchObject({ id: run.id, status: 'failed', errorCode: 'APPROVAL_REJECTED' });
      expect(kit.notes.rows).toHaveLength(0);
      expect(kit.gateway.calls).toHaveLength(1);
      expect(kit.audit.events.map((e) => e.action)).toContain('approval.rejected');
    });

    it('does not echo the reason into the run record', async () => {
      const { approval } = await waitingRun();
      const { run } = await kit.approvalService.decide(admin, approval.id, { decision: 'reject', reason: 'private reason text' });
      expect(JSON.stringify(run)).not.toContain('private reason text');
    });

    it.each([['x'.repeat(501)]])('rejects an over-long reason', async (reason) => {
      const { approval } = await waitingRun();
      await expect(kit.approvalService.decide(admin, approval.id, { decision: 'reject', reason })).rejects.toThrow(InvalidInputError);
      expect(kit.approvals.rows[0]!.status).toBe('pending');
    });
  });

  describe('separation of duties', () => {
    it('stops a requester from approving their own proposal while another approver exists', async () => {
      const selfApprover = contextFor('admin', 'approver');
      const { approval } = await waitingRun(selfApprover);
      await expect(kit.approvalService.decide(selfApprover, approval.id, { decision: 'approve' })).rejects.toThrow(ForbiddenError);
      expect(kit.approvals.rows[0]!.status).toBe('pending');
      expect(kit.notes.rows).toHaveLength(0);
    });

    it('lets a sole eligible approver decide their own request, marked selfApproved in record and audit', async () => {
      kit = buildRunKit();
      await kit.addMember('admin', 'approver');
      await kit.addMember('builder', 'requester');
      await kit.addMember('owner', 'gone', 'revoked');
      await kit.addMember('admin', 'pending', 'invited');
      const selfApprover = contextFor('admin', 'approver');
      const { approval } = await waitingRun(selfApprover);

      const result = await kit.approvalService.decide(selfApprover, approval.id, { decision: 'approve' });
      expect(result.approval).toMatchObject({ status: 'approved', selfApproved: true });
      expect(kit.audit.events.find((e) => e.action === 'approval.approved')!.metadata).toMatchObject({ selfApproved: true });
    });

    it('still lets a different approver decide, whoever started the run', async () => {
      const { approval } = await waitingRun(contextFor('admin', 'approver'));
      const result = await kit.approvalService.decide(contextFor('owner', 'owner'), approval.id, { decision: 'approve' });
      expect(result.approval.selfApproved).toBe(false);
    });
  });

  describe('expiry and invalidation', () => {
    it('refuses an expired approval, marks it expired and fails the run without acting', async () => {
      const { run, approval } = await waitingRun();
      kit.clock.current = new Date(kit.clock.current.getTime() + DEFAULT_APPROVAL_TTL_MS + 1000);

      await expect(kit.approvalService.decide(admin, approval.id, { decision: 'approve' })).rejects.toThrow(ConflictError);

      expect(kit.approvals.rows[0]).toMatchObject({ status: 'expired' });
      expect((await kit.runService.get(admin, run.id)).run).toMatchObject({ status: 'failed', errorCode: 'APPROVAL_EXPIRED' });
      expect(kit.notes.rows).toHaveLength(0);
      expect(kit.audit.events.map((e) => e.action)).toContain('approval.expired');
    });

    it('still honors an approval decided right before it expires', async () => {
      const { approval } = await waitingRun();
      kit.clock.current = new Date(kit.clock.current.getTime() + DEFAULT_APPROVAL_TTL_MS - 1000);
      const result = await kit.approvalService.decide(admin, approval.id, { decision: 'approve' });
      expect(result.run.status).toBe('completed');
    });

    it.each(['disabled', 'archived'] as const)('invalidates the proposal when the agent became %s', async (status) => {
      const { agent, run, approval } = await waitingRun();
      await kit.agentService.setLifecycleStatus(admin, agent.id, status);

      await expect(kit.approvalService.decide(admin, approval.id, { decision: 'approve' })).rejects.toThrow(ConflictError);

      expect(kit.approvals.rows[0]!.status).toBe('rejected');
      expect((await kit.runService.get(admin, run.id)).run).toMatchObject({ status: 'failed', errorCode: 'APPROVAL_INVALIDATED' });
      expect(kit.notes.rows).toHaveLength(0);
    });

    it('refuses to act on a run that is no longer waiting (for example already cancelled)', async () => {
      const { run, approval } = await waitingRun();
      await kit.runs.advance(WORKSPACE, run.id, 'waiting_approval', 'cancelled');
      await expect(kit.approvalService.decide(admin, approval.id, { decision: 'approve' })).rejects.toThrow(ConflictError);
      expect(kit.notes.rows).toHaveLength(0);
    });
  });

  describe('listing', () => {
    it('shows pending proposals newest first to deciders only, within their workspace', async () => {
      const a = await waitingRun();
      const other = await kit.publishedAgent({ toolBindings: [{ tool: 'create_note', approval: 'required' }], workspaceId: OTHER_WORKSPACE });
      kit.gateway.respondWith(toolCallResult('create_note', { title: 'x', body: 'y' }));
      await kit.runService.start(contextFor('builder', 'requester', OTHER_WORKSPACE), other.agent.id, { input: 'elsewhere' });

      const page = await kit.approvalService.list(admin, { status: 'pending' });
      expect(page.approvals.map((x) => x.id)).toEqual([a.approval.id]);
      await expect(kit.approvalService.list(requester, {})).rejects.toThrow(ForbiddenError);
    });

    it('pages with a cursor and filters by status', async () => {
      const ids: string[] = [];
      for (let n = 0; n < 3; n += 1) {
        const { agent } = await kit.publishedAgent({ toolBindings: [{ tool: 'create_note', approval: 'required' }] });
        kit.gateway.respondWith(toolCallResult('create_note', { title: `t${n}`, body: 'b' }));
        await kit.runService.start(requester, agent.id, { input: `n${n}` });
        ids.push(kit.approvals.rows.at(-1)!.id);
      }
      const first = await kit.approvalService.list(admin, { limit: 2 });
      expect(first.approvals.map((x) => x.id)).toEqual([ids[2], ids[1]]);
      const second = await kit.approvalService.list(admin, { limit: 2, cursor: first.nextCursor! });
      expect(second.approvals.map((x) => x.id)).toEqual([ids[0]]);
      expect(second.nextCursor).toBeNull();

      await kit.approvalService.decide(admin, ids[0]!, { decision: 'reject' });
      expect((await kit.approvalService.list(admin, { status: 'rejected' })).approvals.map((x) => x.id)).toEqual([ids[0]]);
    });

    it('expires stale pending proposals when listing so the inbox never offers a dead request', async () => {
      const { run, approval } = await waitingRun();
      kit.clock.current = new Date(kit.clock.current.getTime() + DEFAULT_APPROVAL_TTL_MS + 1);
      const page = await kit.approvalService.list(admin, { status: 'pending' });
      expect(page.approvals).toEqual([]);
      expect(kit.approvals.rows.find((a) => a.id === approval.id)!.status).toBe('expired');
      expect((await kit.runService.get(admin, run.id)).run.errorCode).toBe('APPROVAL_EXPIRED');
    });

    it('rejects a malformed cursor', async () => {
      await expect(kit.approvalService.list(admin, { cursor: 'garbage' })).rejects.toThrow(InvalidInputError);
    });
  });
  describe('contract details', () => {
    const auditOf = (action: string) => kit.audit.events.find((e) => e.action === action)!;
    // waitingRun() reports the first approval; these tests start several runs.
    const anotherWaitingRun = async () => {
      const started = await waitingRun();
      return { ...started, approval: kit.approvals.rows.at(-1)! };
    };

    it('explains refusals with fixed, specific messages', async () => {
      const { approval } = await waitingRun();
      await expect(kit.approvalService.decide(contextFor('admin', 'approver', null), approval.id, { decision: 'approve' })).rejects.toThrow(
        'Approvals require a resolved workspace scope',
      );
      await expect(kit.approvalService.list(contextFor('admin', 'approver', null), {})).rejects.toThrow('Approvals require a resolved workspace scope');
      await expect(kit.approvalService.decide(admin, '11111111-1111-4111-8111-111111111111', { decision: 'approve' })).rejects.toThrow(
        'Approval 11111111-1111-4111-8111-111111111111 not found',
      );
      await kit.approvalService.decide(admin, approval.id, { decision: 'approve' });
      await expect(kit.approvalService.decide(admin, approval.id, { decision: 'approve' })).rejects.toThrow('This approval was already approved');
    });

    it('accepts a reason of exactly 500 characters and names the limit when it is exceeded', async () => {
      const { approval } = await waitingRun();
      await expect(kit.approvalService.decide(admin, approval.id, { decision: 'reject', reason: 'x'.repeat(501) })).rejects.toThrow(
        'Reason must be at most 500 characters',
      );
      const result = await kit.approvalService.decide(admin, approval.id, { decision: 'reject', reason: 'x'.repeat(500) });
      expect(result.approval.decisionReason).toHaveLength(500);
    });

    it('trims the reason, and treats a blank one as no reason', async () => {
      const first = await waitingRun();
      const trimmed = await kit.approvalService.decide(admin, first.approval.id, { decision: 'reject', reason: '  padded  ' });
      expect(trimmed.approval.decisionReason).toBe('padded');

      const second = await anotherWaitingRun();
      const blank = await kit.approvalService.decide(admin, second.approval.id, { decision: 'reject', reason: '   ' });
      expect(blank.approval.decisionReason).toBeNull();
      expect(kit.audit.events.filter((e) => e.action === 'approval.rejected').map((e) => e.metadata)).toEqual([
        expect.objectContaining({ hasReason: true }),
        expect.objectContaining({ hasReason: false }),
      ]);
    });

    it('audits whether a reason was given, never the reason, for approve and reject', async () => {
      const a = await waitingRun();
      await kit.approvalService.decide(admin, a.approval.id, { decision: 'approve' });
      expect(auditOf('approval.approved').metadata).toEqual({ runId: a.run.id, tool: 'create_note', selfApproved: false, hasReason: false });

      const b = await anotherWaitingRun();
      await kit.approvalService.decide(admin, b.approval.id, { decision: 'approve', reason: 'ok' });
      const withReason = kit.audit.events.filter((e) => e.action === 'approval.approved')[1]!;
      expect(withReason.metadata).toMatchObject({ hasReason: true });
      expect(auditOf('approval.approved')).toMatchObject({ targetType: 'approval', targetId: a.approval.id });
    });

    it('honors an approval decided exactly at its expiry instant', async () => {
      const { approval } = await waitingRun();
      kit.clock.current = new Date(approval.expiresAt);
      const result = await kit.approvalService.decide(admin, approval.id, { decision: 'approve' });
      expect(result.approval.status).toBe('approved');
    });

    it('says an expired approval expired, and audits who found it with what it was about', async () => {
      const { run, approval } = await waitingRun();
      kit.clock.current = new Date(approval.expiresAt.getTime() + 1);
      await expect(kit.approvalService.decide(admin, approval.id, { decision: 'approve' })).rejects.toThrow('This approval request expired');
      expect(auditOf('approval.expired')).toMatchObject({
        actorPrincipalId: admin.principal.id,
        targetType: 'approval',
        targetId: approval.id,
        metadata: { runId: run.id, tool: 'create_note' },
      });
    });

    it('records an invalidation with its cause and tells the caller the request was closed', async () => {
      const { agent, run, approval } = await waitingRun();
      await kit.agentService.setLifecycleStatus(admin, agent.id, 'disabled');
      await expect(kit.approvalService.decide(admin, approval.id, { decision: 'approve' })).rejects.toThrow(
        'This approval no longer applies and was closed',
      );
      expect(kit.approvals.rows[0]).toMatchObject({ status: 'rejected', decisionReason: 'Invalidated: the agent is no longer active' });
      expect(auditOf('approval.invalidated')).toMatchObject({
        targetId: approval.id,
        metadata: { runId: run.id, tool: 'create_note', selfApproved: false, hasReason: true },
      });
    });

    it('names a run that stopped waiting as the cause of the invalidation', async () => {
      const { run, approval } = await waitingRun();
      await kit.runs.advance(WORKSPACE, run.id, 'waiting_approval', 'cancelled');
      await expect(kit.approvalService.decide(admin, approval.id, { decision: 'approve' })).rejects.toThrow(ConflictError);
      expect(kit.approvals.rows[0]!.decisionReason).toBe('Invalidated: the run is no longer waiting');
    });

    it.each(['approve', 'reject'] as const)('reports a lost race on %s without auditing a decision that did not happen', async (decision) => {
      const { approval } = await waitingRun();
      vi.spyOn(kit.approvals, 'decide').mockResolvedValueOnce(undefined);
      await expect(kit.approvalService.decide(admin, approval.id, { decision })).rejects.toThrow('This approval was already decided');
      expect(kit.audit.events.map((e) => e.action)).not.toContain(`approval.${decision === 'approve' ? 'approved' : 'rejected'}`);
      expect(kit.notes.rows).toHaveLength(0);
    });

    it('does not audit or fail the run when an invalidation lost the race', async () => {
      const { agent, approval } = await waitingRun();
      await kit.agentService.setLifecycleStatus(admin, agent.id, 'disabled');
      vi.spyOn(kit.approvals, 'decide').mockResolvedValueOnce(undefined);
      await expect(kit.approvalService.decide(admin, approval.id, { decision: 'approve' })).rejects.toThrow(
        'This approval no longer applies and was closed',
      );
      expect(kit.audit.events.map((e) => e.action)).not.toContain('approval.invalidated');
    });

    it('says why a requester cannot approve their own proposal', async () => {
      const selfApprover = contextFor('admin', 'approver');
      const { approval } = await waitingRun(selfApprover);
      await expect(kit.approvalService.decide(selfApprover, approval.id, { decision: 'approve' })).rejects.toThrow(
        'Another approver must decide a request you started',
      );
    });

    it('does not expire a proposal whose deadline is exactly now when listing', async () => {
      const { approval } = await waitingRun();
      kit.clock.current = new Date(approval.expiresAt);
      const page = await kit.approvalService.list(admin, { status: 'pending' });
      expect(page.approvals.map((x) => x.id)).toEqual([approval.id]);
    });

    it('leaves finished approvals alone when sweeping stale ones', async () => {
      const { approval } = await waitingRun();
      await kit.approvalService.decide(admin, approval.id, { decision: 'reject' });
      kit.clock.current = new Date(approval.expiresAt.getTime() + 1000);
      await kit.approvalService.list(admin, {});
      expect(kit.approvals.rows[0]!.status).toBe('rejected');
    });

    describe('paging', () => {
      async function createApprovals(count: number) {
        for (let n = 0; n < count; n += 1) {
          const { agent } = await kit.publishedAgent({ toolBindings: [{ tool: 'create_note', approval: 'required' }] });
          kit.gateway.respondWith(toolCallResult('create_note', { title: `t${n}`, body: 'b' }));
          await kit.runService.start(requester, agent.id, { input: `n${n}` });
        }
      }

      it('has no next page when the results fit the limit exactly', async () => {
        await createApprovals(3);
        const page = await kit.approvalService.list(admin, { limit: 3 });
        expect(page.approvals).toHaveLength(3);
        expect(page.nextCursor).toBeNull();
      });

      it.each([[undefined], [Number.NaN], [Number.POSITIVE_INFINITY]])('falls back to the default page size for limit %s', async (limit) => {
        await createApprovals(26);
        const page = await kit.approvalService.list(admin, { limit });
        expect(page.approvals).toHaveLength(25);
        expect(page.nextCursor).not.toBeNull();
      });

      it('never returns fewer than one row for a non-positive or fractional limit', async () => {
        await createApprovals(2);
        expect((await kit.approvalService.list(admin, { limit: 0 })).approvals).toHaveLength(1);
        expect((await kit.approvalService.list(admin, { limit: -5 })).approvals).toHaveLength(1);
        expect((await kit.approvalService.list(admin, { limit: 1.9 })).approvals).toHaveLength(1);
      });
    });
  });

  describe('summary (what needs a person)', () => {
    it('counts the pending approvals of the workspace for those who can decide', async () => {
      expect(await kit.approvalService.summary(admin)).toEqual({ pending: 0 });
      await waitingRun();
      await waitingRun();
      expect(await kit.approvalService.summary(admin)).toEqual({ pending: 2 });
    });

    it('does not count what was decided, nor what already expired', async () => {
      const first = await waitingRun();
      const second = await waitingRun();
      await kit.approvalService.decide(admin, kit.approvals.rows.find((a) => a.runId === first.run.id)!.id, { decision: 'reject' });
      expect(await kit.approvalService.summary(admin)).toEqual({ pending: 1 });

      kit.clock.current = new Date(kit.approvals.rows.find((a) => a.runId === second.run.id)!.expiresAt.getTime() + 1);
      expect(await kit.approvalService.summary(admin)).toEqual({ pending: 0 });
    });

    it('still counts a request on the very instant it expires, because it can still be decided then', async () => {
      await waitingRun();
      kit.clock.current = new Date(kit.approvals.rows[0]!.expiresAt);
      expect(await kit.approvalService.summary(admin)).toEqual({ pending: 1 });
      kit.clock.current = new Date(kit.approvals.rows[0]!.expiresAt.getTime() + 1);
      expect(await kit.approvalService.summary(admin)).toEqual({ pending: 0 });
    });

    it('only counts the caller workspace', async () => {
      await waitingRun();
      expect(await kit.approvalService.summary(contextFor('admin', 'approver', OTHER_WORKSPACE))).toEqual({ pending: 0 });
    });

    it.each(['builder', 'operator', 'auditor'] as const)('is for deciders only: %s is denied', async (role) => {
      await waitingRun();
      await expect(kit.approvalService.summary(contextFor(role, `other-${role}`))).rejects.toThrow(ForbiddenError);
    });

    it('requires a workspace scope', async () => {
      await expect(kit.approvalService.summary(contextFor('admin', 'approver', null))).rejects.toThrow('Approvals require a resolved workspace scope');
    });

    it('does not change anything: no expiry sweep, no audit', async () => {
      await waitingRun();
      const before = kit.audit.events.length;
      kit.clock.current = new Date(kit.approvals.rows[0]!.expiresAt.getTime() + 1000);
      await kit.approvalService.summary(admin);
      expect(kit.approvals.rows[0]!.status).toBe('pending');
      expect(kit.audit.events).toHaveLength(before);
    });
  });
});
