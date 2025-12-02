import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '../../src/session';
import { discover } from '../../src/waygate';

export default async function ProtectedPage() {
  const { session, idClaims, accessClaims } = await getSession();
  if (!session) return redirect('/auth/login');

  // Optionally call userinfo to demonstrate API call
  let userinfo: any = null;
  try {
    const cfg = await discover();
    if (cfg.userinfo_endpoint) {
      const res = await fetch(cfg.userinfo_endpoint, {
        headers: { authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      });
      if (res.ok) userinfo = await res.json();
    }
  } catch (e) {
    console.error('Failed to load userinfo', e);
  }

  return (
    <main style={{ padding: 24, maxWidth: 800 }}>
      <h1>Protected</h1>
      <p>You are signed in.</p>

      <section>
        <h2>ID Token Claims</h2>
        <pre>{JSON.stringify(idClaims, null, 2)}</pre>
      </section>

      <section>
        <h2>Access Token Claims</h2>
        <pre>{JSON.stringify(accessClaims, null, 2)}</pre>
      </section>

      {userinfo && (
        <section>
          <h2>Userinfo</h2>
          <pre>{JSON.stringify(userinfo, null, 2)}</pre>
        </section>
      )}

      <form action="/auth/logout" method="post" style={{ marginTop: 16 }}>
        <button type="submit">Sign out</button>
      </form>
      <p style={{ marginTop: 16 }}>
        <Link href="/">Back to home</Link>
      </p>
    </main>
  );
}
