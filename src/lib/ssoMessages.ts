/**
 * Plain, non-sensitive user-facing messages for stable SSO error codes.
 * Never render raw HTTP responses, codes, secrets, or callback URLs.
 */
export function plainSsoMessage(code: string | null | undefined): string {
  switch (code) {
    case "COMPANION_SSO_CODE_INVALID":
      return "This sign-in link expired or was already used. Please start again from EnrollPro.";
    case "COMPANION_SSO_CLIENT_INVALID":
      return "EnrollPro sign-in is misconfigured. Please contact your school administrator.";
    case "COMPANION_SSO_ROLE_DENIED":
    case "COMPANION_REVERSE_SSO_ROLE_DENIED":
      return "You do not have access to this system.";
    case "COMPANION_SSO_ACCOUNT_UNAVAILABLE":
    case "COMPANION_REVERSE_SSO_ACCOUNT_UNAVAILABLE":
      return "Your account is not available. Please contact your school administrator.";
    case "COMPANION_SSO_IDENTITY_INCOMPLETE":
      return "Your EnrollPro account details are incomplete. Please contact your school administrator.";
    case "COMPANION_SSO_SYSTEM_NOT_FOUND":
      return "EnrollPro sign-in is not available for this system. Please contact your school administrator.";
    case "COMPANION_SSO_NOT_CONFIGURED":
    case "COMPANION_REVERSE_SSO_NOT_CONFIGURED":
    case "COMPANION_REVERSE_SSO_CALLBACK_INVALID":
      return "EnrollPro sign-in is not configured. Please contact your school administrator.";
    case "COMPANION_REVERSE_SSO_SCHOOL_YEAR_MISMATCH":
    case "ACTIVE_SCHOOL_YEAR_REQUIRED":
    case "ACTIVE_SCHOOL_YEAR_CONFLICT":
      return "No active school year is available. Please contact your school administrator.";
    case "PASSWORD_CHANGE_REQUIRED":
      return "Please change your EnrollPro password before signing in.";
    default:
      return "Could not complete sign-in with EnrollPro. Please try again.";
  }
}
