"""reCAPTCHA Enterprise token assessment.

Verification is opt-in: it runs only when project_id + api_key +
site_key are all configured. Otherwise verify_recaptcha logs a warning
and returns True so logins keep working before/while GCP creds are
being provisioned — the rate limiter still protects /auth/login.
"""
import logging
from typing import Optional

import httpx

from ..config import settings

logger = logging.getLogger(__name__)


async def verify_recaptcha(token: Optional[str], expected_action: str = "LOGIN") -> bool:
    """Return True if the token passes the configured assessment.

    Validation steps (Google's recommended flow):
      1. tokenProperties.valid is True (well-formed, unexpired token)
      2. tokenProperties.action matches the action the client sent
      3. riskAnalysis.score >= recaptcha_min_score
    """
    project_id = settings.recaptcha_project_id
    api_key = settings.recaptcha_api_key
    site_key = settings.recaptcha_site_key

    if not (project_id and api_key and site_key):
        logger.warning(
            "reCAPTCHA verification skipped: project_id / api_key / "
            "site_key not all configured"
        )
        return True

    if not token:
        logger.info("reCAPTCHA token missing on login attempt")
        return False

    url = (
        f"https://recaptchaenterprise.googleapis.com/v1/projects/"
        f"{project_id}/assessments?key={api_key}"
    )
    payload = {
        "event": {
            "token": token,
            "siteKey": site_key,
            "expectedAction": expected_action,
        }
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, json=payload)
        data = r.json()
    except Exception as exc:
        # Fail-closed on network errors would lock everyone out if Google
        # is unreachable. We log loud and let the request through — the
        # rate limiter and password check still apply.
        logger.error("reCAPTCHA assessment request failed: %s", exc)
        return True

    props = data.get("tokenProperties") or {}
    if not props.get("valid"):
        logger.info(
            "reCAPTCHA token invalid: reason=%s",
            props.get("invalidReason"),
        )
        return False

    actual_action = props.get("action")
    if actual_action != expected_action:
        logger.info(
            "reCAPTCHA action mismatch: expected=%s got=%s",
            expected_action, actual_action,
        )
        return False

    score = (data.get("riskAnalysis") or {}).get("score")
    if score is None:
        logger.warning("reCAPTCHA assessment returned no score: %s", data)
        return False

    if score < settings.recaptcha_min_score:
        logger.info(
            "reCAPTCHA score below threshold: score=%.2f min=%.2f",
            score, settings.recaptcha_min_score,
        )
        return False

    return True
