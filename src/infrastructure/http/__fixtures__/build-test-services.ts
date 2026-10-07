import { DevHeaderAuthenticator } from '../../../modules/identity/infrastructure/dev-header-authenticator.js';
import { ActivePrincipalReader } from '../../../modules/identity/infrastructure/active-principal-reader.js';
import { TenantContextResolver } from '../../../modules/authorization/application/tenant-context-resolver.js';
import { AuthorizationService } from '../../../modules/authorization/application/authorization.service.js';
import { OrganizationService } from '../../../modules/organizations/application/organization.service.js';
import { AccountService } from '../../../modules/organizations/application/account.service.js';
import { MemberService } from '../../../modules/organizations/application/member.service.js';
import { WorkspaceService } from '../../../modules/workspaces/application/workspace.service.js';
import { AuditQueryService } from '../../../modules/audit/application/audit-query.service.js';
import { AgentService } from '../../../modules/agents/application/agent.service.js';
import type { AppServices } from '../app-services.js';
import {
  FakeAgentDraftRepository,
  FakeAgentRepository,
  FakeAgentVersionRepository,
  FakeAuditLog,
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

  const services: AppServices = {
    authenticator: new DevHeaderAuthenticator(new ActivePrincipalReader(principals)),
    tenantContextResolver: new TenantContextResolver(memberships, workspaces, workspaceMemberships),
    authorizationService,
    organizationService: new OrganizationService(organizations, memberships, authorizationService, audit),
    memberService: new MemberService(memberships, principals, authorizationService, audit),
    accountService: new AccountService(organizations, memberships),
    workspaceService: new WorkspaceService(workspaces, authorizationService, audit),
    agentService: new AgentService(
      new FakeAgentRepository(),
      new FakeAgentDraftRepository(),
      new FakeAgentVersionRepository(),
      authorizationService,
      audit,
    ),
    auditQueryService: new AuditQueryService(audit, authorizationService),
  };

  return { services, principals, audit };
}
