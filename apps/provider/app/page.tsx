import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Waygate Provider</h1>
      <p>Multi-tenant identity provider scaffold.</p>
      <ul>
        <li>
          <Link href="/a/example">Tenant example: /a/example</Link>
        </li>
        <li>
          <Link href="/a/example/api/ping">Check tenant context via API</Link>
        </li>
      </ul>
    </main>
  );
}
