export default function Home() {
  return (
    <main className="wrap">
      <span className="eyebrow">Äventyret · rig</span>
      <h1>Hackaton</h1>
      <p>
        The base is up. This Next.js app is served through the rig at <code>www.hackaton.test</code> — start building the project on top of it in <code>www/app</code>.
      </p>
      <ul className="facts">
        <li>
          <span>Stack</span>
          <code>nextjs (www)</code>
        </li>
        <li>
          <span>Dev URL</span>
          <code>https://www.hackaton.test</code>
        </li>
        <li>
          <span>Run</span>
          <code>rig up</code> · <code>rig down</code> · <code>rig logs www</code>
        </li>
      </ul>
    </main>
  );
}
