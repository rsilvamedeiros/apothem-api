import { DevHeaderAuthenticator } from '../../../modules/identity/infrastructure/dev-header-authenticator.js';
import { ActivePrincipalReader } from '../../../modules/identity/infrastructure/active-principal-reader.js';
import { TenantContextResolver } from '../../../modules/authorization/application/tenant-context-resolver.js';
import { AuthorizationService } from '../../../modules/authorization/application/authorization.service.js';
import { OrganizationService } from '../../../modules/organizations/application/organization.service.js';
import { AccountService } from '../../../modules/organizations/application/account.service.js';
import { MemberService } from '../../../modules/organizations/application/member.service.js';
import { WorkspaceService } from '../../../modules/workspaces/application/workspace.service.js';
import { AuditQueryService } from '../../../modules/audit/application/audit-query.service.js';
import { BuiltInToolExecutor } from '../../../modules/tools/application/tool-executor.js';
import { ApprovalService } from '../../../modules/approvals/application/approval.service.js';
import { RunService } from '../../../modules/runs/application/run.service.js';
import { ModelRouter } from '../../../modules/models/application/model-router.js';
import { MockModelAdapter } from '../../ai/mock-model.adapter.js';
import { AgentService } from '../../../modules/agents/application/agent.service.js';
import { KnowledgeRetriever } from '../../../modules/knowledge/application/knowledge-retriever.js';
import { KnowledgeService } from '../../../modules/knowledge/application/knowledge.service.js';
import {
  FakeKnowledgeBaseRepository,
  FakeKnowledgeDocumentRepository,
  FakeKnowledgeSearch,
} from '../../../modules/knowledge/application/__fixtures__/fake-knowledge-repositories.js';
import { ToolPolicyService } from '../../../modules/tools/application/tool-policy.service.js';
import { FakeToolPolicyRepository } from '../../../modules/tools/application/__fixtures__/fake-tool-policy-repository.js';
import type { AppServices } from '../app-services.js';
import {
  FakeAgentDraftRepository,
  FakeAgentRepository,
  FakeAgentVersionRepository,
  FakeApprovalRepository,
  FakeAuditLog,
  FakeNoteRepository,
  FakeRunRepository,
  FakeRunStepRepository,
  FakeMembershipRepository,
  FakeOrganizationRepository,
  FakePrincipalRepository,
  FakeWorkspaceMembershipRepository,
  FakeWorkspaceRepository,
} from './fake-repositories.js';

export interface TestServices {
  services: AppServices;
  principals: FakePrincipalRepository;
  audit: FakeAuditLog;
}

/** Wires the real application services to in-memory fakes for HTTP integration tests. */
export function buildTestServices(): TestServices {
  const principals = new FakePrincipalRepository();
  const memberships = new FakeMembershipRepository();
  const workspaces = new FakeWorkspaceRepository();
  const workspaceMemberships = new FakeWorkspaceMembershipRepository();
  const organizations = new FakeOrganizationRepository();
  const audit = new FakeAuditLog();
  const authorizationService = new AuthorizationService();
  const agentRepository = new FakeAgentRepository();
  const agentVersionRepository = new FakeAgentVersionRepository();
  const mock = new MockModelAdapter();
  const approvals = new FakeApprovalRepository();
  const notes = new FakeNoteRepository();
  const toolPolicies = new FakeToolPolicyRepository();
  const knowledgeBases = new FakeKnowledgeBaseRepository();
  const knowledgeDocuments = new FakeKnowledgeDocumentRepository();
  const knowledgeRetriever = new KnowledgeRetriever(new FakeKnowledgeSearch(knowledgeBases, knowledgeDocuments));

  const runService = new RunService(
    agentRepository,
    agentVersionRepository,
    new FakeRunRepository(),
    new FakeRunStepRepository(),
    approvals,
    new ModelRouter(new Map([['mock', mock]]), [
      {
        provider: 'mock',
        model: 'mock-1',
        qualityTier: mock.qualityTier,
        capabilities: mock.capabilities,
        pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
      },
    ]),
    new BuiltInToolExecutor(notes, () => new Date(), knowledgeRetriever),
    authorizationService,
    audit,
    () => new Date(),
    { toolPolicies },
  );

  const services: AppServices = {
    authenticator: new DevHeaderAuthenticator(new ActivePrincipalReader(principals)),
    tenantContextResolver: new TenantContextResolver(memberships, workspaces, workspaceMemberships),
    authorizationService,
    organizationService: new OrganizationService(organizations, memberships, authorizationService, audit),
    memberService: new MemberService(memberships, principals, authorizationService, audit),
    accountService: new AccountService(organizations, memberships),
    workspaceService: new WorkspaceService(workspaces, authorizationService, audit),
    agentService: new AgentService(agentRepository, new FakeAgentDraftRepository(), agentVersionRepository, authorizationService, audit),
    runService,
    knowledgeService: new KnowledgeService(knowledgeBases, knowledgeDocuments, knowledgeRetriever, authorizationService, audit),
    toolPolicyService: new ToolPolicyService(toolPolicies, authorizationService, audit),
    approvalService: new ApprovalService(approvals, runService, agentRepository, memberships, authorizationService, audit),
    auditQueryService: new AuditQueryService(audit, authorizationService),
  };

  return { services, principals, audit };
}
