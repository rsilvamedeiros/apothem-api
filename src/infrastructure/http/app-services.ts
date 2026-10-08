import type { Database } from '../database/client.js';
import { PrincipalRepository } from '../../modules/identity/infrastructure/principal.repository.js';
import { PrincipalProvisioner } from '../../modules/identity/application/principal-provisioner.js';
import { ActivePrincipalReader } from '../../modules/identity/infrastructure/active-principal-reader.js';
import type { Env } from './env.js';
import { buildAuthenticator } from './build-authenticator.js';
import { MembershipRepository } from '../../modules/organizations/infrastructure/membership.repository.js';
import { OrganizationRepository } from '../../modules/organizations/infrastructure/organization.repository.js';
import { WorkspaceRepository } from '../../modules/workspaces/infrastructure/workspace.repository.js';
import { WorkspaceMembershipRepository } from '../../modules/workspaces/infrastructure/workspace-membership.repository.js';
import { AuditLogRepository } from '../../modules/audit/infrastructure/audit-log.repository.js';
import { AuditQueryService } from '../../modules/audit/application/audit-query.service.js';
import { TenantContextResolver } from '../../modules/authorization/application/tenant-context-resolver.js';
import { AuthorizationService } from '../../modules/authorization/application/authorization.service.js';
import { OrganizationService } from '../../modules/organizations/application/organization.service.js';
import { MemberService } from '../../modules/organizations/application/member.service.js';
import { AccountService } from '../../modules/organizations/application/account.service.js';
import { WorkspaceService } from '../../modules/workspaces/application/workspace.service.js';
import { AgentRepository } from '../../modules/agents/infrastructure/agent.repository.js';
import { AgentDraftRepository } from '../../modules/agents/infrastructure/agent-draft.repository.js';
import { AgentVersionRepository } from '../../modules/agents/infrastructure/agent-version.repository.js';
import { AgentService } from '../../modules/agents/application/agent.service.js';
import { RunService } from '../../modules/runs/application/run.service.js';
import { RunRepository, RunStepRepository } from '../../modules/runs/infrastructure/run.repository.js';
import { ApprovalService } from '../../modules/approvals/application/approval.service.js';
import { ApprovalRepository } from '../../modules/approvals/infrastructure/approval.repository.js';
import { NoteRepository } from '../../modules/tools/infrastructure/note.repository.js';
import { BuiltInToolExecutor } from '../../modules/tools/application/tool-executor.js';
import { KnowledgeBaseRepository } from '../../modules/knowledge/infrastructure/knowledge-base.repository.js';
import { KnowledgeDocumentRepository } from '../../modules/knowledge/infrastructure/knowledge-document.repository.js';
import { KnowledgeSearchRepository } from '../../modules/knowledge/infrastructure/knowledge-search.repository.js';
import { KnowledgeRetriever } from '../../modules/knowledge/application/knowledge-retriever.js';
import { KnowledgeService } from '../../modules/knowledge/application/knowledge.service.js';
import { ToolPolicyRepository } from '../../modules/tools/infrastructure/tool-policy.repository.js';
import { ToolPolicyService } from '../../modules/tools/application/tool-policy.service.js';
import { buildModelRouter } from '../ai/model-registry.js';
import type { AuthenticationPort } from '../../modules/identity/application/authentication.port.js';

export interface AppServices {
  authenticator: AuthenticationPort;
  tenantContextResolver: TenantContextResolver;
  authorizationService: AuthorizationService;
  organizationService: OrganizationService;
  memberService: MemberService;
  accountService: AccountService;
  workspaceService: WorkspaceService;
  agentService: AgentService;
  runService: RunService;
  approvalService: ApprovalService;
  knowledgeService: KnowledgeService;
  toolPolicyService: ToolPolicyService;
  auditQueryService: AuditQueryService;
}

/**
 * Composition root for request-scoped services. `authenticator` is chosen by
 * AUTH_MODE (see build-authenticator.ts): the dev header adapter locally, a
 * verified-JWT adapter in production. Callers only depend on AuthenticationPort.
 */
export function buildAppServices(db: Database, env: Env): AppServices {
  const principals = new PrincipalRepository(db);
  const memberships = new MembershipRepository(db);
  const workspaces = new WorkspaceRepository(db);
  const auditLog = new AuditLogRepository(db);
  const organizationRepository = new OrganizationRepository(db);
  const agentRepository = new AgentRepository(db);
  const approvalRepository = new ApprovalRepository(db);
  const agentVersionRepository = new AgentVersionRepository(db);
  const authorizationService = new AuthorizationService();
  const knowledgeBases = new KnowledgeBaseRepository(db);
  const knowledgeDocuments = new KnowledgeDocumentRepository(db);
  const knowledgeRetriever = new KnowledgeRetriever(new KnowledgeSearchRepository(db));
  const toolPolicies = new ToolPolicyRepository(db);

  const authenticator = buildAuthenticator(env, new ActivePrincipalReader(principals), new PrincipalProvisioner(principals));
  const tenantContextResolver = new TenantContextResolver(
    memberships,
    workspaces,
    new WorkspaceMembershipRepository(db),
  );

  const runService = new RunService(
    agentRepository,
    agentVersionRepository,
    new RunRepository(db),
    new RunStepRepository(db),
    approvalRepository,
    buildModelRouter(env),
    new BuiltInToolExecutor(new NoteRepository(db), () => new Date(), knowledgeRetriever),
    authorizationService,
    auditLog,
    () => new Date(),
    { toolPolicies },
  );

  return {
    authenticator,
    tenantContextResolver,
    authorizationService,
    organizationService: new OrganizationService(
      new OrganizationRepository(db),
      memberships,
      authorizationService,
      auditLog,
    ),
    memberService: new MemberService(memberships, principals, authorizationService, auditLog),
    accountService: new AccountService(organizationRepository, memberships),
    workspaceService: new WorkspaceService(workspaces, authorizationService, auditLog),
    agentService: new AgentService(
      agentRepository,
      new AgentDraftRepository(db),
      agentVersionRepository,
      authorizationService,
      auditLog,
    ),
    approvalService: new ApprovalService(approvalRepository, runService, agentRepository, memberships, authorizationService, auditLog),
    runService,
    knowledgeService: new KnowledgeService(knowledgeBases, knowledgeDocuments, knowledgeRetriever, authorizationService, auditLog),
    toolPolicyService: new ToolPolicyService(toolPolicies, authorizationService, auditLog),
    auditQueryService: new AuditQueryService(auditLog, authorizationService),
  };
}
