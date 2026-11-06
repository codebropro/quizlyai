// Cloudflare Pages Function -> /api   (needs: KV binding "KV", env TOKEN_SECRET, ANTHROPIC_API_KEY, optional LICENSE_CODES)
const FREE_SETS = 10, FREE_AI = 5, enc = new TextEncoder();
const J = (o, c = 200) => new Response(JSON.stringify(o), { status: c, headers: { "content-type": "application/json" } });
const err = (m, c = 400) => J({ error: m }, c);
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const hmac = async (secret, msg) => b64u(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), enc.encode(msg)));
const pbk = async (pw, salt) => b64u(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" }, await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]), 256));
const same = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const rnd = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, "0")).join("");
const cut = (s, n) => String(s ?? "").slice(0, n);
const today = () => new Date().toISOString().slice(0, 10);
const cleanDeck = d => ({ id: cut(d.id, 30).replace(/\W/g, ""), title: cut(d.title, 80), emo: cut(d.emo, 4), best: Number.isFinite(d.best) ? d.best : null,
  cards: (Array.isArray(d.cards) ? d.cards : []).slice(0, 200).map(c => ({ q: cut(c.q, 400), a: cut(c.a, 300), wrong: (Array.isArray(c.wrong) ? c.wrong : []).slice(0, 3).map(w => cut(w, 300)) })).filter(c => c.q && c.a) });

export const onRequestGet = ({ env }) => J({ kv: !!env.KV, secret: (env.TOKEN_SECRET || "").length >= 16, ai: !!env.ANTHROPIC_API_KEY });

export async function onRequestPost({ request, env }) {
  if (!env.KV) return err("KV niet gekoppeld: Settings > Bindings > KV namespace, naam KV", 500);
  const SECRET = env.TOKEN_SECRET || ""; if (SECRET.length < 16) return err("TOKEN_SECRET ontbreekt (min. 16 tekens)", 500);
  let b; try { b = await request.json(); } catch { return err("bad"); }
  const get = k => env.KV.get(k, "json"), put = (k, v, o) => env.KV.put(k, JSON.stringify(v), o);
  const sign = async u => { const p = b64u(enc.encode(JSON.stringify({ u, e: Date.now() + 30 * 864e5 }))); return p + "." + await hmac(SECRET, p); };
  const verify = async t => { try { const [p, s] = String(t || "").split("."); if (!s || !same(s, await hmac(SECRET, p))) return null; const j = JSON.parse(new TextDecoder().decode(unb64u(p))); return j.e > Date.now() ? j.u : null; } catch { return null; } };
  const a = b.action;
  try {
    if (a === "register") {
      const name = String(b.name || "").toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(name)) return err("Gebruikersnaam: 3-20 tekens (letters, cijfers, _)");
      if (String(b.password || "").length < 8) return err("Wachtwoord: minimaal 8 tekens");
      if (await get("user:" + name)) return err("Naam is al bezet");
      const salt = rnd(16);
      await put("user:" + name, { salt, hash: await pbk(b.password, salt), emo: "😀", bio: "", pro: false, created: Date.now() });
      return J({ token: await sign(name) });
    }
    if (a === "login") {
      const name = String(b.name || "").toLowerCase(), u = await get("user:" + name);
      if (!u || !same(await pbk(String(b.password || ""), u.salt), u.hash)) return err("Onjuiste gegevens", 401);
      return J({ token: await sign(name) });
    }
    if (a === "profile") {
      const n = String(b.name || "").toLowerCase(), u = await get("user:" + n);
      if (!u) return err("niet gevonden", 404);
      const idx = (await get("index")) || [];
      return J({ name: n, emo: u.emo, bio: u.bio, pro: u.pro, quizzes: idx.filter(q => q.author === n) });
    }
    const name = await verify(b.token); if (!name) return err("Niet ingelogd", 401);
    const u = await get("user:" + name); if (!u) return err("Niet ingelogd", 401);
    const ukey = "use:" + name + ":" + today(), used = Number(await env.KV.get(ukey)) || 0;
    const aiLeft = u.pro ? 999 : Math.max(0, FREE_AI - used);

    if (a === "me") return J({ user: { name, emo: u.emo, bio: u.bio, pro: u.pro }, decks: (await get("decks:" + name)) || [], aiLeft });
    if (a === "saveDecks") {
      const list = (Array.isArray(b.decks) ? b.decks : []).map(cleanDeck);
      if (!u.pro && list.length > FREE_SETS) return err("Maximaal " + FREE_SETS + " sets op het gratis plan");
      await put("decks:" + name, list.slice(0, 500)); return J({ ok: true });
    }
    if (a === "updateProfile") { u.emo = cut(b.emo, 4); u.bio = cut(b.bio, 140); await put("user:" + name, u); return J({ ok: true }); }
    if (a === "redeem") {
      const codes = (env.LICENSE_CODES || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
      if (!codes.includes(String(b.code || "").trim().toUpperCase())) return err("Ongeldige code");
      u.pro = true; await put("user:" + name, u); return J({ ok: true });
    }
    if (a === "publish") {
      const d = ((await get("decks:" + name)) || []).find(x => x.id === b.deckId);
      if (!d || d.cards.length < 2) return err("Minstens 2 kaarten nodig");
      const id = "q" + rnd(5);
      await put("quiz:" + id, { id, title: d.title, emo: d.emo, author: name, cards: d.cards, likes: 0, liked: [], ts: Date.now() });
      const idx = (await get("index")) || [];
      idx.unshift({ id, title: d.title, emo: d.emo, author: name, n: d.cards.length, likes: 0, ts: Date.now() });
      await put("index", idx.slice(0, 1000)); return J({ id });
    }
    if (a === "browse") {
      const q = String(b.q || "").toLowerCase(), idx = (await get("index")) || [];
      return J({ list: idx.filter(x => !q || x.title.toLowerCase().includes(q) || x.author.includes(q)).slice(0, 60) });
    }
    if (a === "get") {
      const q = await get("quiz:" + String(b.id || "").replace(/\W/g, "")); if (!q) return err("niet gevonden", 404);
      delete q.liked; return J({ quiz: q });
    }
    if (a === "like") {
      const id = String(b.id || "").replace(/\W/g, ""), q = await get("quiz:" + id); if (!q) return err("niet gevonden", 404);
      q.liked = q.liked || []; const i = q.liked.indexOf(name); i < 0 ? q.liked.push(name) : q.liked.splice(i, 1); q.likes = q.liked.length;
      await put("quiz:" + id, q);
      const idx = (await get("index")) || [], r = idx.find(x => x.id === id); if (r) { r.likes = q.likes; await put("index", idx); }
      return J({ likes: q.likes });
    }
    if (a === "generate") {
      if (aiLeft <= 0) return err("limit", 429);
      if (!env.ANTHROPIC_API_KEY) return err("ANTHROPIC_API_KEY ontbreekt", 500);
      const text = String(b.text || ""); if (text.length < 40 || text.length > 12000) return err("Tekst te kort of te lang");
      const n = Math.min(30, Math.max(3, parseInt(b.n) || 10));
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
        headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 4000, messages: [{ role: "user", content:
          `Maak een quiz in de taal van de tekst, op basis van ALLEEN deze tekst. Precies ${n} kaarten. Antwoord uitsluitend met JSON: {"title":"korte titel","cards":[{"q":"vraag","a":"kort juist antwoord","wrong":["fout1","fout2","fout3"]}]}. Foute antwoorden moeten plausibel zijn.\n\nTEKST:\n${text}` }] }) });
      if (!r.ok) return err("AI fout " + r.status, 502);
      const j = await r.json(), o = JSON.parse((j.content?.[0]?.text || "").replace(/```json|```/g, "").trim());
      await env.KV.put(ukey, String(used + 1), { expirationTtl: 172800 });
      return J({ title: cut(o.title, 80), cards: cleanDeck({ cards: o.cards }).cards, aiLeft: u.pro ? 999 : aiLeft - 1 });
    }
    return err("onbekend");
  } catch (e) { return err("Serverfout: " + (e && e.message), 500); }
}
