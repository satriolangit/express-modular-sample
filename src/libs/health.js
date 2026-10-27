/**
 * Compute readiness from infrastructure checks.
 * NATS is optional unless NATS_REQUIRED=true; PostgreSQL is always required.
 */
export function computeHealth(checks, { natsRequired = false } = {}) {
  return {
    ok: Boolean(checks.pg) && (Boolean(checks.nats) || !natsRequired),
    degraded: !checks.nats,
    checks,
  };
}
