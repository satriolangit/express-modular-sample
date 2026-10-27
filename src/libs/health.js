/**
 * Compute readiness from infrastructure checks.
 * NATS is optional unless NATS_REQUIRED=true; PostgreSQL is always required.
 */
export function computeHealth(checks, { natsRequired = false } = {}) {
  const natsOk = Boolean(checks.nats);
  const jetstreamOk = checks.jetstream !== false;

  return {
    ok: Boolean(checks.pg) && (natsOk || !natsRequired),
    degraded: !natsOk || !jetstreamOk,
    checks,
  };
}
