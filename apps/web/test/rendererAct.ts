import { act as reactAct } from "react";

// Node renderer fixtures need synchronous flushing as well as awaited async updates.
export function act(callback: () => Promise<void>): Promise<void>;
export function act(callback: () => void): ReturnType<typeof reactAct>;
export function act(
  callback: () => void | Promise<void>,
): ReturnType<typeof reactAct> | Promise<void> {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let asynchronous = false;
  try {
    const result = reactAct(() => {
      const pending = callback();
      asynchronous = pending !== undefined;
      return pending;
    });
    if (asynchronous) {
      return Promise.resolve(result).finally(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
      });
    }
    return result;
  } catch (error) {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
    throw error;
  } finally {
    if (!asynchronous) globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}
