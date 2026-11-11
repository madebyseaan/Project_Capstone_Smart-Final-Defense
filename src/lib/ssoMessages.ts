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

/**
 * Plain, non-sensitive user-facing messages for the SMART -> ATLAS admin-only
 * SSO flow. Never render raw HTTP responses, codes, secrets, or callback URLs.
 */
export function plainAtlasSsoMessage(code: string | null | undefined): string {
  switch (code) {
    case "COMPANION_REVERSE_SSO_ROLE_DENIED":
      return "ATLAS is available to SMART administrators only.";
    case "COMPANION_REVERSE_SSO_ACCOUNT_UNAVAILABLE":
      return "Your SMART account is not available. Please contact your school administrator.";
    case "COMPANION_SSO_CODE_INVALID":
      return "This sign-in link expired or was already used. Please start again from SMART.";
    case "COMPANION_SSO_CLIENT_INVALID":
      return "ATLAS sign-in is misconfigured. Please contact your school administrator.";
    case "COMPANION_REVERSE_SSO_CALLBACK_INVALID":
      return "ATLAS sign-in could not be started. Please start again from SMART.";
    case "COMPANION_REVERSE_SSO_NOT_CONFIGURED":
    case "COMPANION_SSO_NOT_CONFIGURED":
      return "ATLAS sign-in is not configured. Please contact your school administrator.";
    case "ACTIVE_SCHOOL_YEAR_REQUIRED":
    case "ACTIVE_SCHOOL_YEAR_CONFLICT":
      return "No active school year is available. Please contact your school administrator.";
    default:
      return "Could not open ATLAS. Please try again.";
  }
}

/**
 * Plain, non-sensitive user-facing messages for the ATLAS -> SMART reverse
 * SSO flow. Never render raw HTTP responses, codes, secrets, or callback URLs.
 */
export function plainAtlasReverseSsoMessage(code: string | null | undefined): string {
  switch (code) {
    case "COMPANION_REVERSE_SSO_NOT_CONFIGURED":
      return "SMART sign-in is not configured for ATLAS. Please contact your school administrator.";
    case "COMPANION_REVERSE_SSO_STATE_INVALID":
      return "This sign-in link expired or was tampered with. Please start again from ATLAS.";
    case "COMPANION_REVERSE_SSO_CALLBACK_INVALID":
      return "This sign-in link is invalid. Please start again from ATLAS.";
    case "COMPANION_REVERSE_SSO_CODE_INVALID":
    case "COMPANION_SSO_CODE_INVALID":
      return "This sign-in link expired or was already used. Please start again from ATLAS.";
    case "COMPANION_REVERSE_SSO_UNAVAILABLE":
    case "COMPANION_SSO_UNREACHABLE":
      return "ATLAS could not complete sign-in. Please try again.";
    case "COMPANION_REVERSE_SSO_RESPONSE_INVALID":
      return "ATLAS returned an invalid response. Please contact your school administrator.";
    case "COMPANION_REVERSE_SSO_LINK_REQUIRED":
      return "Your SMART account is not linked to ATLAS yet. Please contact your school administrator.";
    case "COMPANION_REVERSE_SSO_IDENTITY_CONFLICT":
      return "This ATLAS identity is linked to another SMART account. Please contact your school administrator.";
    case "COMPANION_REVERSE_SSO_ACCOUNT_UNAVAILABLE":
    case "COMPANION_SSO_ACCOUNT_UNAVAILABLE":
      return "Your linked SMART account is not available. Please contact your school administrator.";
    case "COMPANION_REVERSE_SSO_ROLE_DENIED":
    case "COMPANION_SSO_ROLE_DENIED":
      return "Only ATLAS administrators can sign in to SMART.";
    case "ACTIVE_SCHOOL_YEAR_REQUIRED":
    case "ACTIVE_SCHOOL_YEAR_CONFLICT":
      return "ATLAS and SMART do not have the same active school year. Please contact your school administrator.";
    default:
      return "Could not sign in with ATLAS. Please try again.";
  }
}

/**
 * Plain, non-sensitive user-facing messages for the AIMS <-> SMART SSO flows.
 * Never render raw HTTP responses, codes, secrets, or callback URLs.
 */
export function plainAimsSsoMessage(code: string | null | undefined): string {
  switch (code) {
    case "INVALID_CODE":
      return "This AIMS sign-in link is invalid. Please start again from AIMS.";
    case "CODE_ALREADY_USED":
      return "This AIMS sign-in link was already used. Please start again from AIMS.";
    case "CODE_EXPIRED":
      return "This AIMS sign-in link expired. Please start again from AIMS.";
    case "INVALID_CLIENT":
    case "SSO_NOT_CONFIGURED":
      return "AIMS sign-in is not configured. Please contact your school administrator.";
    case "AIMS_UNREACHABLE":
    case "AIMS_EXCHANGE_FAILED":
    case "EXCHANGE_FAILED":
      return "AIMS could not complete sign-in. Please try again.";
    case "AIMS_ACCOUNT_NOT_PROVISIONED":
      return "Your AIMS account is not linked to a SMART account yet. Ask your school administrator to link it.";
    case "AIMS_ACCOUNT_UNAVAILABLE":
      return "Your linked SMART account is not available. Please contact your school administrator.";
    case "AIMS_IDENTITY_AMBIGUOUS":
      return "More than one SMART account matches your AIMS identity. Please contact your school administrator.";
    case "AIMS_IDENTITY_CONFLICT":
      return "This AIMS identity is linked to another SMART account. Please contact your school administrator.";
    case "AIMS_IDENTITY_MISMATCH":
      return "Your AIMS identity does not match your SMART account. Please contact your school administrator.";
    case "AIMS_ROLE_MISMATCH":
    case "AIMS_ROLE_UNSUPPORTED":
      return "Your AIMS role does not match your SMART account. Please contact your school administrator.";
    case "AIMS_STUDENT_UNSUPPORTED":
      return "SMART does not provide student sign-in. Please continue using AIMS for your grades.";
    case "AIMS_RESPONSE_INVALID":
      return "AIMS returned an invalid sign-in response. Please contact your school administrator.";
    default:
      return "Could not sign in with AIMS. Please try again.";
  }
}
