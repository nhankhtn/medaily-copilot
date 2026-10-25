/**
 * Agent loop: perceive → plan (API) → confirm mutating steps → act → observe.
 * UI hooks provided by chatbox via MedailyAgentRuntime.attach(ui).
 */
(() => {
  const MAX_STEPS = 15;

  /** @type {null | {
   *   setStatus: (s: string) => void,
   *   appendLog: (line: string, kind?: string) => void,
   *   askConfirm: (desc: {tool:string,target:string,reason:string,step:number,max:number}) => Promise<"approve"|"skip"|"stop">,
   *   onDone: (summary: string) => void,
   * }} */
  let ui = null;
  let running = false;
  let abort = false;

  function attach(hooks) {
    ui = hooks;
  }

  function stop() {
    abort = true;
  }

  function isRunning() {
    return running;
  }

  async function planTurn(payload) {
    const res = await chrome.runtime.sendMessage({
      type: "MEDAILY_AGENT_PLAN",
      payload,
    });
    if (chrome.runtime.lastError) {
      throw new Error(chrome.runtime.lastError.message);
    }
    if (!res?.ok) {
      throw new Error(res?.error || "Agent plan failed");
    }
    return res;
  }

  /**
   * @param {string} goal
   */
  async function run(goal) {
    if (running) {
      ui?.setStatus?.("Agent already running — Stop first.");
      return;
    }
    const tools = globalThis.MedailyAgentTools;
    if (!tools) {
      ui?.setStatus?.("Agent tools missing — reload extension.");
      return;
    }

    running = true;
    abort = false;
    const caps = globalThis.MedailySiteRegistry?.getCapabilities?.() || {};
    /** @type {string[]} */
    const historyLines = [];
    let step = 0;

    ui?.setStatus?.("Agent starting…");
    ui?.appendLog?.(`Goal: ${goal}`, "user");

    try {
      while (step < MAX_STEPS && !abort) {
        step += 1;
        ui?.setStatus?.(`Perceive · step ${step}/${MAX_STEPS}`);
        const snap = tools.buildSnapshot(35);

        ui?.setStatus?.(`Plan · step ${step}/${MAX_STEPS}`);
        const plan = await planTurn({
          goal,
          pageSnapshot: snap.text,
          toolHistory: historyLines.slice(-12).join("\n") || undefined,
          caps: { insert: Boolean(caps.insert), send: Boolean(caps.send) },
        });

        if (plan.assistantMessage) {
          ui?.appendLog?.(plan.assistantMessage, "assistant");
        }

        const actions = Array.isArray(plan.actions) ? plan.actions : [];
        if (plan.done && !actions.length) {
          ui?.setStatus?.("Done");
          ui?.onDone?.(plan.assistantMessage || "Goal complete.");
          break;
        }
        if (!actions.length) {
          ui?.setStatus?.("No actions — stopped");
          ui?.onDone?.(plan.assistantMessage || "Planner returned no actions.");
          break;
        }

        for (const action of actions) {
          if (abort) break;
          if (step > MAX_STEPS) break;

          const desc = tools.describeAction(action);
          const mutating = tools.isMutating(action.tool);

          if (mutating) {
            ui?.setStatus?.(`Confirm · ${action.tool}`);
            const decision = await ui?.askConfirm?.({
              ...desc,
              step,
              max: MAX_STEPS,
            });
            if (decision === "stop") {
              abort = true;
              ui?.appendLog?.("Stopped by user.", "system");
              break;
            }
            if (decision === "skip") {
              historyLines.push(
                `${action.tool} SKIPPED — ${desc.reason || desc.target}`
              );
              ui?.appendLog?.(`Skipped ${action.tool}`, "system");
              continue;
            }
          }

          ui?.setStatus?.(`Act · ${action.tool}`);
          ui?.appendLog?.(
            `→ ${action.tool} ${desc.target ? `(${desc.target})` : ""}`.trim(),
            "system"
          );

          let result;
          try {
            result = await tools.runTool(action.tool, action.args || {});
          } catch (err) {
            result = { ok: false, error: err?.message || String(err) };
          }

          const summary = result?.ok
            ? JSON.stringify(result).slice(0, 500)
            : `ERROR: ${result?.error || "failed"}`;
          historyLines.push(
            `${action.tool}(${JSON.stringify(action.args || {}).slice(0, 120)}) → ${summary}`
          );
          ui?.appendLog?.(
            result?.ok ? `✓ ${action.tool}` : `✗ ${action.tool}: ${result?.error}`,
            result?.ok ? "ok" : "err"
          );

          // After a mutating act, re-perceive on next outer loop.
          if (mutating) {
            step += 0; // keep step; break inner to replan
            break;
          }
        }

        if (abort) break;
        if (plan.done) {
          ui?.setStatus?.("Done");
          ui?.onDone?.(plan.assistantMessage || "Done.");
          break;
        }
      }

      if (!abort && step >= MAX_STEPS) {
        ui?.setStatus?.("Max steps reached");
        ui?.appendLog?.("Stopped at max steps (15).", "system");
        ui?.onDone?.("Reached max steps.");
      }
    } catch (err) {
      ui?.setStatus?.("Agent error");
      ui?.appendLog?.(err?.message || String(err), "err");
      ui?.onDone?.(err?.message || String(err));
    } finally {
      running = false;
      if (abort) ui?.setStatus?.("Stopped");
    }
  }

  globalThis.MedailyAgentRuntime = {
    attach,
    run,
    stop,
    isRunning,
    MAX_STEPS,
  };
})();
