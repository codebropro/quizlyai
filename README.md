# Quizly on Cloudflare Pages (free)
1. Put this folder in a GitHub repo (index.html + functions/api.js at the root).
2. Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git > pick the repo. Build command: empty. Output directory: /  > Save and Deploy.
3. Workers & Pages > KV > Create namespace "quizly".
4. Your Pages project > Settings > Bindings > Add > KV namespace: variable name KV, pick "quizly".
5. Settings > Variables and Secrets: TOKEN_SECRET (random, 16+ chars), ANTHROPIC_API_KEY, LICENSE_CODES (e.g. PRO-ABC,PRO-XYZ).
6. Deployments > Retry deployment (settings only apply to a new deploy).
7. Check https://YOURSITE.pages.dev/api  -> must show {"kv":true,"secret":true,"ai":true}
