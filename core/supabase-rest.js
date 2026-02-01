export async function sbFetch(path, { method="GET", query=null, body=null } = {}) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.__ENV__ || {};
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_ANON_KEY in env.js");
  }

  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  if (query) for (const [k,v] of Object.entries(query)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    method,
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: body ? JSON.stringify(body) : null
  });

  if (!res.ok) {
    const t = await res.text().catch(()=> "");
    throw new Error(`Supabase REST ${res.status}: ${t}`);
  }
  return res.json();
}

