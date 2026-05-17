import { Request, Response } from "express";
import { z } from "zod";
import { AcceptInviteUseCase } from "../../../application/usecases/auth/accept-invite-usecase.js";
import { LoginUseCase } from "../../../application/usecases/auth/login-usecase.js";
import { ManageProfileUseCase } from "../../../application/usecases/auth/manage-profile-usecase.js";
import { RequestPasswordResetUseCase } from "../../../application/usecases/auth/request-password-reset-usecase.js";
import { ResetPasswordUseCase } from "../../../application/usecases/auth/reset-password-usecase.js";
import { SignupUseCase } from "../../../application/usecases/auth/signup-usecase.js";
import { AuthSessionService } from "../../../application/services/auth-session-service.js";
import { AuthThreatDetectionService } from "../../../application/services/auth-threat-detection-service.js";
import { LicensePolicyService } from "../../../application/services/license-policy-service.js";
import { OAuthIntent, SocialOAuthService } from "../../../application/services/social-oauth-service.js";
import { PrivacyNoticeService } from "../../../application/services/privacy-notice-service.js";
import { env } from "../../../shared/config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import {
  REFRESH_COOKIE_NAME,
  clearAuthCookies,
  getCookieValue,
  issueCsrfToken,
  setAccessCookie,
  setCsrfCookie,
  setRefreshCookie
} from "../utils/auth-cookies.js";
import {
  acceptInviteSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  updateProfileSchema
} from "../validators/auth-validators.js";

export class AuthController {
  constructor(
    private readonly signupUseCase: SignupUseCase,
    private readonly loginUseCase: LoginUseCase,
    private readonly requestPasswordResetUseCase: RequestPasswordResetUseCase,
    private readonly resetPasswordUseCase: ResetPasswordUseCase,
    private readonly acceptInviteUseCase: AcceptInviteUseCase,
    private readonly manageProfileUseCase: ManageProfileUseCase,
    private readonly licensePolicyService: LicensePolicyService,
    private readonly authSessionService: AuthSessionService,
    private readonly authThreatDetectionService: AuthThreatDetectionService,
    private readonly socialOAuthService: SocialOAuthService,
    private readonly privacyNoticeService: PrivacyNoticeService
  ) {}

  signup = async (req: Request, res: Response) => {
    const input = signupSchema.parse(req.body);
    const result = await this.signupUseCase.execute(input);
    if (input.privacyAccepted) {
      await this.privacyNoticeService.accept({
        tenantId: result.tenantId,
        userId: result.user.id,
        source: "signup",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]
      });
    }
    res.status(201).json(result);
  };

  login = async (req: Request, res: Response) => {
    const input = loginSchema.parse(req.body);
    await this.authThreatDetectionService.assertAllowed(req.ip, input.email);
    try {
      const result = await this.loginUseCase.execute(input, {
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]
      });
      const csrfToken = issueCsrfToken();
      setAccessCookie(res, result.token);
      setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
      setCsrfCookie(res, csrfToken);
      await this.authThreatDetectionService.onSuccess(req.ip, input.email);
      res.json({
        refreshExpiresAt: result.refreshExpiresAt,
        user: result.user,
        csrfToken
      });
    } catch (error) {
      await this.authThreatDetectionService.onFailure(req.ip, input.email);
      throw error;
    }
  };

  googleAuthStart = async (req: Request, res: Response) => {
    const intent = this.parseOAuthIntent(req);
    const state = this.socialOAuthService.createState("google", intent);
    const authorizationUrl = this.socialOAuthService.getAuthorizationUrl("google", state);
    res.redirect(authorizationUrl);
  };

  googleAuthCallback = async (req: Request, res: Response) => {
    await this.handleOAuthCallback("google", req, res);
  };

  appleAuthStart = async (req: Request, res: Response) => {
    const intent = this.parseOAuthIntent(req);
    const state = this.socialOAuthService.createState("apple", intent);
    const authorizationUrl = this.socialOAuthService.getAuthorizationUrl("apple", state);
    res.redirect(authorizationUrl);
  };

  appleAuthCallback = async (req: Request, res: Response) => {
    await this.handleOAuthCallback("apple", req, res);
  };

  forgotPassword = async (req: Request, res: Response) => {
    const input = forgotPasswordSchema.parse(req.body);
    const result = await this.requestPasswordResetUseCase.execute(input.email);
    res.json(result);
  };

  resetPassword = async (req: Request, res: Response) => {
    const input = resetPasswordSchema.parse(req.body);
    const result = await this.resetPasswordUseCase.execute(input);
    res.json(result);
  };

  acceptInvite = async (req: Request, res: Response) => {
    const input = acceptInviteSchema.parse(req.body);
    const result = await this.acceptInviteUseCase.execute(input);
    res.json(result);
  };

  me = async (req: Request, res: Response) => {
    const result = await this.manageProfileUseCase.me(req.auth!.userId);
    res.json(result);
  };

  entitlements = async (req: Request, res: Response) => {
    const result = await this.licensePolicyService.getTenantEntitlements(req.auth!.tenantId);
    res.json({
      plan: result.plan,
      priceMonthly: result.priceMonthly,
      features: result.features,
      license: result.license
    });
  };

  privacyCurrent = async (req: Request, res: Response) => {
    const result = await this.privacyNoticeService.getCurrentForUser(req.auth?.tenantId, req.auth?.userId);
    res.json(result);
  };

  privacyAccept = async (req: Request, res: Response) => {
    const input = z
      .object({
        source: z.enum(["banner", "signup", "profile", "contract", "manual"]).optional().default("banner")
      })
      .optional()
      .parse(req.body);
    const result = await this.privacyNoticeService.accept({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      source: input?.source ?? "banner",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"]
    });
    res.json(result);
  };

  updateProfile = async (req: Request, res: Response) => {
    const input = updateProfileSchema.parse(req.body);
    const result = await this.manageProfileUseCase.updateProfile(req.auth!.tenantId, req.auth!.userId, input);
    res.json(result);
  };

  changePassword = async (req: Request, res: Response) => {
    const input = changePasswordSchema.parse(req.body);
    const result = await this.manageProfileUseCase.changePassword(req.auth!.tenantId, req.auth!.userId, input);
    res.json(result);
  };

  licenseStatus = async (req: Request, res: Response) => {
    const result = await this.licensePolicyService.evaluateAccess(req.auth!.tenantId);
    res.json(result.license);
  };

  refresh = async (req: Request, res: Response) => {
    const payload = z
      .object({
        refreshToken: z.string().min(20).optional()
      })
      .optional()
      .parse(req.body);

    const refreshToken = payload?.refreshToken ?? getCookieValue(req, REFRESH_COOKIE_NAME);
    if (!refreshToken) {
      throw new AppError("Refresh token mancante", 401, "UNAUTHORIZED");
    }

    const refreshed = await this.authSessionService.refresh(refreshToken, req.headers["user-agent"], req.ip);
    const access = await this.licensePolicyService.evaluateAccess(refreshed.user.tenantId);
    if (access.blocked) {
      if (access.reason === "TENANT_INACTIVE") throw new AppError("Tenant disattivato. Contatta l'amministratore.", 403, "TENANT_INACTIVE");
      if (access.reason === "LICENSE_SUSPENDED") throw new AppError("Licenza sospesa. Contatta il supporto.", 403, "LICENSE_SUSPENDED");
      throw new AppError("Licenza scaduta. Rinnova per continuare.", 402, "LICENSE_EXPIRED");
    }
    const csrfToken = issueCsrfToken();
    setAccessCookie(res, refreshed.accessToken);
    setRefreshCookie(res, refreshed.refreshToken, refreshed.refreshExpiresAt);
    setCsrfCookie(res, csrfToken);
    res.json({
      refreshExpiresAt: refreshed.refreshExpiresAt,
      user: refreshed.user,
      csrfToken
    });
  };

  sessions = async (req: Request, res: Response) => {
    const data = await this.authSessionService.list(req.auth!.userId);
    res.json(data);
  };

  revokeSession = async (req: Request, res: Response) => {
    await this.authSessionService.revokeById(req.params.id, req.auth!.userId);
    res.json({ revoked: true });
  };

  revokeAllSessions = async (req: Request, res: Response) => {
    await this.authSessionService.revokeAll(req.auth!.userId);
    clearAuthCookies(res);
    res.json({ revoked: true });
  };

  logout = async (req: Request, res: Response) => {
    if (req.auth?.sessionId) {
      await this.authSessionService.revokeCurrent(req.auth.sessionId, req.auth.userId);
    }
    clearAuthCookies(res);
    res.json({ revoked: true });
  };

  private async handleOAuthCallback(provider: "google" | "apple", req: Request, res: Response) {
    const providerError = req.query.error ? String(req.query.error) : null;
    if (providerError) {
      this.redirectOauthError(res, `Accesso ${provider} annullato: ${providerError}`);
      return;
    }

    try {
      const code = String(req.query.code ?? req.body?.code ?? "");
      const state = String(req.query.state ?? req.body?.state ?? "");
      const statePayload = this.socialOAuthService.verifyState(provider, state);

      const identity = await this.socialOAuthService.exchangeCode(provider, code);
      if (!identity.emailVerified) {
        throw new AppError("Email social non verificata dal provider", 403, "SOCIAL_EMAIL_NOT_VERIFIED");
      }

      const context = {
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]
      };

      let session;
      if (statePayload.intent === "signup") {
        try {
          session = await this.loginUseCase.executeTrustedEmail(identity.email, context);
        } catch (error) {
          if (error instanceof AppError && error.code === "SOCIAL_USER_NOT_FOUND") {
            await this.signupUseCase.executeSocial({
              email: identity.email,
              provider,
              firstName: identity.givenName,
              lastName: identity.familyName,
              fullName: identity.fullName
            });
            session = await this.loginUseCase.executeTrustedEmail(identity.email, context);
          } else {
            throw error;
          }
        }
      } else {
        session = await this.loginUseCase.executeTrustedEmail(identity.email, context);
      }

      const payload = new URLSearchParams();
      payload.set("refreshExpiresAt", session.refreshExpiresAt);
      payload.set("user", Buffer.from(JSON.stringify(session.user), "utf-8").toString("base64url"));
      const csrfToken = issueCsrfToken();
      setAccessCookie(res, session.token);
      setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
      setCsrfCookie(res, csrfToken);
      const target = new URL(env.OAUTH_CALLBACK_URL);
      target.hash = payload.toString();
      res.redirect(target.toString());
    } catch (error) {
      this.redirectOauthError(res, (error as Error).message);
    }
  }


  private parseOAuthIntent(req: Request): OAuthIntent {
    const rawIntent = String(req.query.intent ?? "login").toLowerCase();
    return rawIntent === "signup" ? "signup" : "login";
  }

  private redirectOauthError(res: Response, message: string) {
    const payload = new URLSearchParams();
    payload.set("error", message || "Accesso social non riuscito");
    const target = new URL(env.OAUTH_CALLBACK_URL);
    target.hash = payload.toString();
    res.redirect(target.toString());
  }
}
