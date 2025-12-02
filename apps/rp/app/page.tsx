import Link from 'next/link';
import { getSession } from '../src/session';

export default async function Home() {
  const { session } = await getSession();
  return (
    <main style={{ padding: 24 }}>
      <h1>Waygate RP</h1>
      {!session ? (
        <>
          <p>This is a demo relying party that authenticates via Waygate.</p>
          <p>
            <a href="/auth/login">Sign in</a>
          </p>
        </>
      ) : (
        <>
          <p>Signed in. Visit the protected page to see your claims.</p>
          <p>
            <Link href="/protected">Protected page</Link>
          </p>
          <form action="/auth/logout" method="post" style={{ marginTop: 16 }}>
            <button type="submit">Sign out</button>
          </form>
        </>
      )}
    </main>
  );
}
