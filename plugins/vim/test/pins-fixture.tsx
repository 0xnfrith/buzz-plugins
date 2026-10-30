// A second plugin page placed in the top bar, for the spec of g1 to g9. The harness has one such page already (the "page placement"
// fixture's "A deliberately long topbar destination"); this one sorts before it by name and is registered after it, so a bar that
// followed the order of registration, or the order of the pages' keys, would put the two the other way round.
// run.sh copies this file into the checkout next to the plugin and adds it to the harness's list of installed fixtures, off by
// default: a test turns it on with {"vim-test.pins": true} in the plugin store, next to "fixture.page-placement".
export const inject = ["pages"];
export function apply(ctx: { pages: { register(page: object): void } }) {
  ctx.pages.register({
    id: "bar",
    title: "A bar",
    placement: "topbar",
    primary: true,
    component: () => <h1>A bar</h1>,
  });
}
