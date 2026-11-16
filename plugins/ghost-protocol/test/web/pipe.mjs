// Node side of the browser fixture's streaming mode (test/web/fixture.tsx): exposes `__gpOpen`, `__gpWrite`, `__gpEnd` and `__gpKill` to the
// page, which starts the fake `docker` (test/fake-docker) for the declared process the plugin names and the arguments it gives, writes the
// plugin's stdin to it as it comes, and sends the fake's output and exit back as the fake produces them. The command line is what the
// real host builds: the program `docker`, the words manifest.json declares for that process, then the caller's arguments. A process the
// manifest does not declare is refused, as the host refuses it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export async function exposeDocker(page, fake, pluginDir) {
  const manifest = JSON.parse(readFileSync(join(pluginDir, "manifest.json"), "utf8"));
  const processes = new Map();
  const queues = new Map();
  /** Calls a function in the page, one after another for one process, so that its output and its exit arrive in order. */
  const tell = (handle, fn, value) => {
    const next = (queues.get(handle) ?? Promise.resolve()).then(() => page.evaluate(fn, [handle, value])).catch(() => undefined);
    queues.set(handle, next);
    return next;
  };
  await page.exposeFunction("__gpOpen", (handle, id, args) => {
    const declared = manifest.host.processes.find((process) => process.id === id);
    if (!declared) throw new Error(`process ${id} is not declared in manifest.json`);
    const proc = fake.start([...(declared.args ?? []), ...args]);
    processes.set(handle, proc);
    proc.child.stdout.on("data", (text) => void tell(handle, ([h, t]) => window.__gpPipes?.[h]?.out(t), text));
    proc.child.stderr.on("data", (text) => void tell(handle, ([h, t]) => window.__gpPipes?.[h]?.err(t), text));
    void proc.exited.then((result) => tell(handle, ([h, code]) => window.__gpPipes?.[h]?.exit(code), result.code));
  });
  await page.exposeFunction("__gpWrite", (handle, data) => {
    processes.get(handle)?.write(data);
  });
  await page.exposeFunction("__gpEnd", (handle, data) => {
    const proc = processes.get(handle);
    if (data !== null) proc?.write(data);
    proc?.end();
  });
  await page.exposeFunction("__gpKill", (handle) => {
    processes.get(handle)?.kill();
  });
}
