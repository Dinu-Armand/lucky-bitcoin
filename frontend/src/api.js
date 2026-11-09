async function req(method, path, body) {
  const r = await fetch('/api' + path, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!r.ok) {
    const e = new Error((data && data.error) || r.statusText);
    e.status = r.status;
    e.code = data && data.code;
    throw e;
  }
  return data;
}

export const api = {
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b ?? {}),
  put: (p, b) => req('PUT', p, b ?? {}),
  del: (p) => req('DELETE', p),
};

export const reportUrl = (kind, format, lang, params = {}) => {
  const q = new URLSearchParams({ format, lang, ...params });
  return `/api/reports/${kind}?${q.toString()}`;
};
