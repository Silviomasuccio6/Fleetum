import { AppError } from "../../shared/errors/app-error.js";

type AccessContext = {
  permissions: string[];
  roles?: string[];
};

export class AuthorizationPolicyService {
  assertPermissions(context: AccessContext, required: string[]) {
    // ADMIN is the tenant's highest built-in role. Keep existing admin sessions
    // usable when a newly introduced permission has not yet been refreshed in its token.
    if (context.roles?.includes("ADMIN")) return;

    const hasAll = required.every((permission) => context.permissions.includes(permission));
    if (!hasAll) throw new AppError("Permessi insufficienti", 403, "FORBIDDEN");
  }
}
