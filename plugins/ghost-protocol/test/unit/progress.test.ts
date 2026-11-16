import { describe, expect, it, vi } from "vitest";
import { createProgress, createSecrets, STEP_ORDER } from "../../src/gp/progress";

describe("progress", () => {
  it("starts with nothing active and every step waiting", () => {
    const view = createProgress().view();
    expect(view.active).toBe(false);
    expect(view.steps.map((step) => step.id)).toEqual([...STEP_ORDER]);
    expect(view.steps.every((step) => step.state === "waiting")).toBe(true);
  });

  it("begins again from the start, and skips the helper step after a no", () => {
    const progress = createProgress();
    progress.begin({ skipUpdater: true });
    progress.set("docker", "done", "Docker 27");
    progress.fail("broke");
    progress.begin({ skipUpdater: true });
    const view = progress.view();
    expect(view.active).toBe(true);
    expect(view.failure).toBeUndefined();
    expect(view.steps.find((step) => step.id === "docker")?.state).toBe("waiting");
    expect(view.steps.find((step) => step.id === "updater")?.state).toBe("skipped");
  });

  it("resets to nothing active, with no step, failure, address or key left", () => {
    const progress = createProgress();
    progress.begin({ skipUpdater: false });
    progress.set("docker", "done", "Docker 27");
    progress.refused("c".repeat(64));
    progress.fail("broke");
    progress.reset();
    const view = progress.view();
    expect(view.active).toBe(false);
    expect(view.failure).toBeUndefined();
    expect(view.refused).toBeUndefined();
    expect(view.steps.every((step) => step.state === "waiting" && step.note === "")).toBe(true);
  });

  it("resumes with the first three steps done", () => {
    const progress = createProgress();
    progress.resume({ skipUpdater: false });
    expect(progress.view().steps.map((step) => step.state)).toEqual(["done", "done", "done", "waiting", "waiting", "waiting", "waiting", "waiting"]);
  });

  it("tells a listener on every change, and not after it unsubscribes", () => {
    const progress = createProgress();
    const listener = vi.fn();
    const off = progress.subscribe(listener);
    const before = progress.view();
    progress.set("pull", "running", "layer 1");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(progress.view()).not.toBe(before);
    expect(before.steps.find((step) => step.id === "pull")?.state).toBe("waiting");
    off();
    progress.set("pull", "done");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("remembers a refused agent's public key", () => {
    const progress = createProgress();
    progress.refused("c".repeat(64));
    expect(progress.view().refused).toEqual({ pubkey: "c".repeat(64) });
  });

  describe("the sign-in code", () => {
    const signal = () => new AbortController().signal;

    it("shows the address, hands the code to the one waiting, and clears the address", async () => {
      const progress = createProgress();
      const code = progress.askCode("https://claude.example/login", signal());
      expect(progress.view().login).toEqual({ url: "https://claude.example/login" });
      expect(progress.submitCode("  abc-123 \n")).toBe(true);
      await expect(code).resolves.toBe("abc-123");
      expect(progress.view().login).toBeUndefined();
    });

    it("takes no code when none is awaited or it is empty", () => {
      const progress = createProgress();
      expect(progress.submitCode("abc")).toBe(false);
      void progress.askCode("https://claude.example/login", signal()).catch(() => undefined);
      expect(progress.submitCode("   ")).toBe(false);
      expect(progress.view().login).toBeDefined();
    });

    it("rejects when the person cancels", async () => {
      const progress = createProgress();
      const code = progress.askCode("https://claude.example/login", signal());
      progress.cancelCode();
      await expect(code).rejects.toThrow(/cancelled/);
      expect(progress.view().login).toBeUndefined();
    });

    it("rejects when the caller goes away, and when it already has", async () => {
      const progress = createProgress();
      const abort = new AbortController();
      const code = progress.askCode("https://claude.example/login", abort.signal);
      abort.abort();
      await expect(code).rejects.toThrow();
      expect(progress.view().login).toBeUndefined();
      await expect(progress.askCode("https://claude.example/login", abort.signal)).rejects.toThrow();
    });

    it("lets a second sign-in take over from a first that nobody answered", async () => {
      const progress = createProgress();
      const first = progress.askCode("https://claude.example/one", signal());
      const second = progress.askCode("https://claude.example/two", signal());
      await expect(first).rejects.toThrow();
      progress.submitCode("code");
      await expect(second).resolves.toBe("code");
    });

    it("never puts the code in the view", async () => {
      const progress = createProgress();
      const code = progress.askCode("https://claude.example/login", signal());
      progress.submitCode("MADE-UP-CODE");
      await code;
      expect(JSON.stringify(progress.view())).not.toContain("MADE-UP-CODE");
    });
  });
});

describe("secrets", () => {
  it("holds a token until it is cleared, and tells listeners", () => {
    const secrets = createSecrets();
    const listener = vi.fn();
    secrets.subscribe(listener);
    secrets.setToken("abc");
    expect(secrets.token()).toBe("abc");
    secrets.setToken("abc");
    expect(listener).toHaveBeenCalledTimes(1);
    secrets.clear();
    expect(secrets.token()).toBe("");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
