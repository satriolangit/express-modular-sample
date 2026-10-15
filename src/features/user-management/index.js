export default {
  prefix: "/users",

  async init(deps) {
    const { nats, ws, logger, scheduler } = deps;

    logger.info("[user-management] init");

    // ── Setup function: idempotent, dipanggil berulang ──
    function setupNatsSubscriptions() {
      if (!nats.isAvailable()) {
        logger.warn("[user-management] NATS not available — skip setup");
        return;
      }

      logger.info("[user-management] setting up NATS subscriptions");

      // ── Core NATS ────────────────────────────────────
      const createdSub = nats.subscribeJson("user.created");
      (async () => {
        for await (const { data } of createdSub) {
          logger.info("[user-management] user.created", data);
        }
      })().catch((err) =>
        logger.debug("[user-management] sub ended", {
          error: err.message,
        }),
      );

      // ── JetStream consumer ──────────────────────────
      (async () => {
        try {
          const consumer = await nats.consume(
            "USERS",
            "user-management-worker",
          );
          const messages = await consumer.consume();

          for await (const m of messages) {
            try {
              const data = JSON.parse(nats.get().sc.decode(m.data));
              logger.info("[user-management] js", data);
              m.ack();
            } catch (err) {
              logger.error("[user-management] js handler", {
                error: err.message,
              });
              m.nak();
            }
          }
        } catch (err) {
          logger.warn("[user-management] JS consumer setup failed", {
            error: err.message,
          });
        }
      })();
    }

    // ── Register callback — fire setiap connect sukses ──
    nats.onConnected(setupNatsSubscriptions);

    // ── Handle case: sudah connected saat init ──────────
    if (nats.isAvailable()) {
      setupNatsSubscriptions();
    }

    // ── WebSocket handler ──────────────────────────
    ws.register(
      "/ws/users",
      (socket, req) => {
        logger.info("[user-management] ws connected", {
          ip: req.socket.remoteAddress,
        });

        socket.send(
          JSON.stringify({ type: "welcome", feature: "user-management" }),
        );

        socket.on("message", (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            logger.debug("[user-management] ws message", msg);
            socket.send(
              JSON.stringify({ echo: msg, at: new Date().toISOString() }),
            );
          } catch (err) {
            socket.send(JSON.stringify({ error: "invalid json" }));
          }
        });

        socket.on("close", () => {
          logger.info("[user-management] ws closed");
        });
      },
      { owner: "user-management" },
    );

    // --- feature level scheduler register ---
    scheduler.register({
      name: "user-management:sample scheduler task",
      schedule: "0 * * * *", // hourly
      owner: "user-management",
      handler: () => {
        logger.info("[user-management] user-management:sample scheduler task");
      },
    });
  },
};
