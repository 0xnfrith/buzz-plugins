import type { Context } from '@buzz/author';

export const inject = ['react', 'pages'];

export function apply(ctx: Context) {
  const React = ctx.react;
  // Plugin resources belong in ctx.effect(() => cleanup).
  // React effects belong to the visible page and stop when navigating away.
  // primary gives the page a sidebar row; every active page is still listed in search.
  ctx.pages.register({ id: "main", title: "My page", primary: true, component: function Page() {
    const [count, setCount] = React.useState(0);
    return <section>
      <h1>My page</h1>
      <button type='button' onClick={() => setCount(count + 1)}>Clicked {count} times</button>
    </section>;
  }});
}
