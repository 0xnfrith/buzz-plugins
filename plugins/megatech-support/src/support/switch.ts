/** The saved on/off choice for the agent type and its tools. Off until the user turns it on; read once, when the plugin starts. */
export const SWITCH_KEY = "megatech.support.agent.v1";

export type SwitchStorage = Pick<Storage, "getItem" | "setItem">;

export function createSwitch(storage: SwitchStorage) {
  return {
    get(): boolean {
      try {
        return storage.getItem(SWITCH_KEY) === "on";
      } catch {
        return false;
      }
    },
    set(on: boolean): void {
      try {
        storage.setItem(SWITCH_KEY, on ? "on" : "off");
      } catch {
        // A profile that will not keep it stays off: the card shows what is saved by reading it back.
      }
    },
  };
}

export type Switch = ReturnType<typeof createSwitch>;
