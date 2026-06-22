"""reCAPTCHA Enterprise assessment via the official google-cloud SDK.

The SDK uses Application Default Credentials — set
GOOGLE_APPLICATION_CREDENTIALS to the path of a service-account JSON
that has the `roles/recaptchaenterprise.agent` role on the project.

Verification is opt-in: if project_id / site_key / ADC are not all
available, verify_recaptcha logs a warning and returns True so the
app stays usable. Rate limiting on /auth/login still applies in that
case.
"""
import asyncio
import logging
from functools import lru_cache
from typing import Optional

from ..config import settings

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _client():
    """Lazy, cached SDK client.

    Caching matters: instantiating the gRPC client is expensive
    (channel setup, credentials discovery), so we build it once per
    process. Returns None if creds aren't configured — callers treat
    None as "skip assessment".
    """
    try:
        from google.cloud import recaptchaenterprise_v1
    except ImportError:
        logger.warning("google-cloud-recaptcha-enterprise not installed")
        return None
    try:
        return recaptchaenterprise_v1.RecaptchaEnterpriseServiceClient()
    except Exception as exc:
        # No ADC, no service-account JSON, or it's malformed.
        logger.warning("reCAPTCHA SDK client init failed: %s", exc)
        return None


def _assess_sync(token: str, expected_action: str) -> bool:
    """Blocking SDK call — must run off the event loop.

    Returns True only when the token is valid, the action matches,
    and the score meets recaptcha_min_score. Any other outcome is
    treated as failure.
    """
    from google.cloud import recaptchaenterprise_v1

    client = _client()
    if client is None:
        return True  # fail-open: client not configured

    event = recaptchaenterprise_v1.Event()
    event.site_key = settings.recaptcha_site_key
    event.token = token

    assessment = recaptchaenterprise_v1.Assessment()
    assessment.event = event

    request = recaptchaenterprise_v1.CreateAssessmentRequest()
    request.parent = f"projects/{settings.recaptcha_project_id}"
    request.assessment = assessment

    try:
        response = client.create_assessment(request)
    except Exception as exc:
        # Fail-open on transport/auth errors — locking everyone out if
        # Google is unreachable would be worse than the brief loss of
        # bot protection. The rate limiter and password check stay.
        logger.error("reCAPTCHA assessment call failed: %s", exc)
        return True

    props = response.token_properties
    if not props.valid:
        logger.info("reCAPTCHA token invalid: reason=%s", props.invalid_reason)
        return False

    if props.action != expected_action:
        logger.info(
            "reCAPTCHA action mismatch: expected=%s got=%s",
            expected_action, props.action,
        )
        return False

    score = response.risk_analysis.score
    if score < settings.recaptcha_min_score:
        logger.info(
            "reCAPTCHA score below threshold: score=%.2f min=%.2f reasons=%s",
            score, settings.recaptcha_min_score,
            list(response.risk_analysis.reasons),
        )
        return False

    return True


async def verify_recaptcha(token: Optional[str], expected_action: str = "LOGIN") -> bool:
    if not (settings.recaptcha_project_id and settings.recaptcha_site_key):
        logger.warning(
            "reCAPTCHA verification skipped: project_id / site_key not configured"
        )
        return True

    if _client() is None:
        # Warning already logged in _client() — keep this branch
        # fail-open so a misconfigured server stays usable.
        return True

    if not token:
        logger.info("reCAPTCHA token missing on login attempt")
        return False

    return await asyncio.to_thread(_assess_sync, token, expected_action)
