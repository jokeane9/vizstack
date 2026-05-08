#!/usr/bin/env node

const fs   = require('fs');
const path = require('path');

const root   = path.resolve(process.argv[2] || '.');
const outArg = process.argv[3];
const out    = outArg ? path.resolve(outArg) : path.join(root, 'codebase-viz.html');

// ─── Framework detection ───────────────────────────────────────────────────

function detectFramework(root) {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps['@remix-run/node'] || deps['@remix-run/react'] || deps['@remix-run/serve']) return 'remix';
  if (deps['react-router'] && fs.existsSync(path.join(root, 'app', 'routes'))) return 'remix';
  if (deps['next']) {
    const hasAppDir = fs.existsSync(path.join(root, 'app')) || fs.existsSync(path.join(root, 'src', 'app'));
    return hasAppDir ? 'nextjs-app' : 'nextjs-pages';
  }
  if (deps['@sveltejs/kit']) return 'sveltekit';
  if (deps['nuxt'] || deps['nuxt3'] || deps['@nuxt/core']) return 'nuxt';
  return null;
}

// ─── File utilities ────────────────────────────────────────────────────────

const ROUTE_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.svelte', '.vue'];

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function walk(dir, exts) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/node_modules|\.next|\.nuxt|dist|build|\.git/.test(entry.name)) continue;
      results.push(...walk(full, exts));
    } else if (exts.some(e => entry.name.endsWith(e))) results.push(full);
  }
  return results;
}

// ─── Static analysis ───────────────────────────────────────────────────────

const AI_PATTERNS = [
  { re: /anthropic\s*[\.(]/i,                       label: 'Claude (Anthropic)' },
  { re: /new\s+Anthropic\s*\(/,                     label: 'Claude (Anthropic)' },
  { re: /openai\s*[\.(]/i,                          label: 'OpenAI' },
  { re: /new\s+OpenAI\s*\(/,                        label: 'OpenAI' },
  { re: /generateText|streamText|generateObject/,   label: 'Vercel AI SDK' },
  { re: /from\s+['"]ai['"]/,                        label: 'Vercel AI SDK' },
  { re: /cohere\s*[\.(]/i,                          label: 'Cohere' },
  { re: /HuggingFace|InferenceApi/i,                label: 'HuggingFace' },
  { re: /groq\s*[\.(]/i,                            label: 'Groq' },
  { re: /replicate\s*[\.(]/i,                       label: 'Replicate' },
  { re: /gemini|generativelanguage\.googleapis/i,   label: 'Google Gemini' },
  { re: /mistral\s*[\.(]/i,                         label: 'Mistral' },
];

const KNOWN_SERVICES = {
  stripe: 'Stripe', sendgrid: 'SendGrid', mailchimp: 'Mailchimp',
  mailgun: 'Mailgun', postmark: 'Postmark', resend: 'Resend',
  twilio: 'Twilio', slack: 'Slack', discord: 'Discord',
  github: 'GitHub API', shopify: 'Shopify API',
  s3: 'AWS S3', amazonaws: 'AWS', cloudinary: 'Cloudinary',
  uploadthing: 'UploadThing', algolia: 'Algolia', typesense: 'Typesense',
  pusher: 'Pusher', ably: 'Ably', planetscale: 'PlanetScale',
  neon: 'Neon', turso: 'Turso', firebase: 'Firebase',
  lemon: 'Lemon Squeezy', loops: 'Loops', cal: 'Cal.com',
  linear: 'Linear API', notion: 'Notion API',
};

function domainToService(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    for (const [key, label] of Object.entries(KNOWN_SERVICES)) {
      if (host.includes(key)) return label;
    }
    const parts = host.split('.');
    return parts[parts.length - 2] || parts[0];
  } catch { return url.slice(0, 40); }
}

function analyzeContent(content) {
  const dbReads  = new Set();
  const dbWrites = new Set();
  const aiCalls  = new Set();
  const external = new Set();

  // Prisma / db-aliased-Prisma reads/writes
  const prismaRe = /(?:prisma|db)\.(\w+)\.(findUnique|findFirst|findMany|count|aggregate|groupBy|create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g;
  let m;
  while ((m = prismaRe.exec(content)) !== null) {
    const [, table, op] = m;
    if (/find|count|aggregate|groupBy/.test(op)) dbReads.add(table);
    else dbWrites.add(table);
  }

  // Supabase
  const supRe = /\.from\(['"](\w+)['"]\)\s*\.(\w+)/g;
  while ((m = supRe.exec(content)) !== null) {
    const [, table, op] = m;
    if (/select|eq|lt|gt|gte|lte|like|ilike|in|is/.test(op)) dbReads.add(table);
    else if (/insert|update|upsert|delete/.test(op)) dbWrites.add(table);
  }

  // Drizzle: db.select().from(table) / db.insert(table)
  const drizzleReadRe  = /(?:db|tx)\.select\b[\s\S]{0,200}?\.from\(\s*(?:\w+\.)?(\w+)\s*\)/g;
  const drizzleWriteRe = /(?:db|tx)\.(insert|update|delete)\(\s*(?:\w+\.)?(\w+)\s*\)/g;
  while ((m = drizzleReadRe.exec(content)) !== null)  dbReads.add(m[1]);
  while ((m = drizzleWriteRe.exec(content)) !== null) dbWrites.add(m[2]);

  // Raw SQL
  if (/(?:db|pool|client|sql)\.(?:query|execute|run)\s*\(`?\s*SELECT\b/i.test(content))
    dbReads.add('(raw SQL)');
  if (/(?:db|pool|client|sql)\.(?:query|execute|run)\s*\(`?\s*(?:INSERT|UPDATE|DELETE)\b/i.test(content))
    dbWrites.add('(raw SQL)');

  // AI providers
  for (const { re, label } of AI_PATTERNS) {
    if (re.test(content)) aiCalls.add(label);
  }

  // External fetch / axios
  const domRe = /fetch\s*\(\s*[`'"](https?:\/\/[^`'"?\s]+)/g;
  while ((m = domRe.exec(content)) !== null) external.add(domainToService(m[1]));
  const axRe = /axios\s*\.\s*\w+\s*\(\s*[`'"](https?:\/\/[^`'"?\s]+)/g;
  while ((m = axRe.exec(content)) !== null) external.add(domainToService(m[1]));

  // Env-var hints for known services
  const envRe = /process\.env\.([A-Z_]+)/g;
  while ((m = envRe.exec(content)) !== null) {
    const key = m[1].toLowerCase();
    for (const [k, label] of Object.entries(KNOWN_SERVICES)) {
      if (key.includes(k)) external.add(label);
    }
  }

  return {
    dbReads:  [...dbReads],
    dbWrites: [...dbWrites],
    aiCalls:  [...aiCalls],
    external: [...external],
  };
}

// ─── Import resolution (one level deep) ───────────────────────────────────

function resolveImports(filePath, repoRoot) {
  const content = readFile(filePath);
  const importRe = /from\s+['"]([^'"]+)['"]/g;
  const results  = [];
  let m;
  while ((m = importRe.exec(content)) !== null) {
    const imp = m[1];
    let resolved;
    if (imp.startsWith('.')) {
      resolved = path.resolve(path.dirname(filePath), imp);
    } else if (imp.startsWith('~/')) {
      resolved = path.resolve(path.join(repoRoot, 'app'), imp.slice(2));
    } else if (imp.startsWith('@/')) {
      resolved = path.resolve(repoRoot, imp.slice(2));
    } else continue;

    for (const ext of ROUTE_EXTS) {
      const c = resolved.endsWith(ext) ? resolved : resolved + ext;
      if (fs.existsSync(c)) { results.push(c); break; }
      const idx = path.join(resolved, 'index') + ext;
      if (fs.existsSync(idx)) { results.push(idx); break; }
    }
  }
  return results;
}

function analyzeWithImports(filePath, repoRoot) {
  const main = analyzeContent(readFile(filePath));
  for (const imp of resolveImports(filePath, repoRoot).slice(0, 8)) {
    const sub = analyzeContent(readFile(imp));
    main.dbReads  = [...new Set([...main.dbReads,  ...sub.dbReads])];
    main.dbWrites = [...new Set([...main.dbWrites, ...sub.dbWrites])];
    main.aiCalls  = [...new Set([...main.aiCalls,  ...sub.aiCalls])];
    main.external = [...new Set([...main.external, ...sub.external])];
  }
  return main;
}

// ─── Prisma schema parser ──────────────────────────────────────────────────

function parsePrismaSchema(root) {
  const schemaPath = [
    path.join(root, 'prisma', 'schema.prisma'),
    path.join(root, 'db', 'schema.prisma'),
  ].find(p => fs.existsSync(p));
  if (!schemaPath) return {};

  const content = readFile(schemaPath);
  const models  = {};
  const SCALAR  = new Set(['String','Int','Float','Boolean','DateTime','Json','Bytes','BigInt','Decimal','Unsupported']);

  // State-machine scan
  let currentModel = null;
  let fields = [], relations = [];

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!currentModel) {
      const mm = line.match(/^model\s+(\w+)\s*\{/);
      if (mm) { currentModel = mm[1]; fields = []; relations = []; }
      continue;
    }
    if (line === '}') {
      models[currentModel.toLowerCase()] = {
        name: currentModel, fields, relations, fieldCount: fields.length,
      };
      currentModel = null; continue;
    }
    if (!line || line.startsWith('//') || line.startsWith('@@') || line.startsWith('@')) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const fieldName = parts[0];
    if (!fieldName || fieldName.startsWith('@')) continue;

    const rawType   = parts[1];
    const baseType  = rawType.replace(/[?\[\]]/g, '');
    const isOptional = rawType.includes('?');
    const isArray   = rawType.includes('[]');
    const rest      = parts.slice(2).join(' ');

    if (rest.includes('@relation')) {
      relations.push({ field: fieldName, model: baseType, isArray });
    } else if (SCALAR.has(baseType)) {
      fields.push({ name: fieldName, type: baseType, optional: isOptional });
    } else if (/^[A-Z]/.test(baseType) && !baseType.startsWith('@')) {
      if (isArray) {
        relations.push({ field: fieldName, model: baseType, isArray: true });
      } else {
        // Enum or single-model relation without @relation
        fields.push({ name: fieldName, type: baseType, optional: isOptional });
      }
    }
  }

  return models;
}

// ─── Shared modules / services detection ─────────────────────────────────

function parseSharedModules(root, routes) {
  const sharedDirs = [
    'app/lib','app/utils','app/helpers','app/services',
    'lib','utils','helpers','services',
    'src/lib','src/utils',
  ].map(d => path.join(root, d)).filter(d => fs.existsSync(d));

  const compDirs = [
    'app/components','components','src/components',
  ].map(d => path.join(root, d)).filter(d => fs.existsSync(d));

  if (!sharedDirs.length && !compDirs.length) return { modules: [], routeImports: {} };

  const sharedFiles = new Set(sharedDirs.flatMap(d => walk(d, ROUTE_EXTS)));
  const compFiles   = new Set(compDirs.flatMap(d => walk(d, ROUTE_EXTS)));
  const allCandidates = new Set([...sharedFiles, ...compFiles]);

  if (!allCandidates.size) return { modules: [], routeImports: {} };

  const importCount    = {};  // fp → count
  const importedByUrls = {};  // fp → [url]
  const routeImports   = {};  // routeId → [fp]

  for (const route of routes) {
    routeImports[route.id] = [];
    const routeFile = path.join(root, route.file);
    const content   = readFile(routeFile);
    const importRe  = /from\s+['"]([^'"]+)['"]/g;
    const seen      = new Set();
    let m;

    while ((m = importRe.exec(content)) !== null) {
      const imp = m[1];
      let resolved;

      if (imp.startsWith('.')) {
        resolved = path.resolve(path.dirname(routeFile), imp);
      } else if (imp.startsWith('~/')) {
        resolved = path.resolve(path.join(root, 'app'), imp.slice(2));
      } else if (imp.startsWith('@/')) {
        resolved = path.resolve(root, imp.slice(2));
      } else continue;

      let found = null;
      for (const ext of ROUTE_EXTS) {
        const c = resolved.endsWith(ext) ? resolved : resolved + ext;
        if (allCandidates.has(c)) { found = c; break; }
      }
      if (!found && allCandidates.has(resolved)) found = resolved;

      if (found && !seen.has(found)) {
        seen.add(found);
        importCount[found]    = (importCount[found] || 0) + 1;
        importedByUrls[found] = importedByUrls[found] || [];
        importedByUrls[found].push(route.url);
        routeImports[route.id].push(found);
      }
    }
  }

  const threshold = routes.length > 100 ? 5 : routes.length > 50 ? 3 : 2;

  const modules = Object.entries(importCount)
    .filter(([, count]) => count >= threshold)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 30)
    .map(([fp, count]) => {
      const rel     = path.relative(root, fp);
      const bname   = path.basename(fp);
      const label   = bname.replace(/\.(server|client)?\.(tsx|ts|jsx|js)$/, '').replace(/\.(tsx|ts|jsx|js)$/, '');
      const isComp  = compFiles.has(fp) || /components?/i.test(rel);
      const cat     = isComp ? 'component'
        : /\bai\b|llm|openai|claude|anthropic|gemini/i.test(rel) ? 'ai'
        : /\bdb\b|database|prisma|drizzle|pool|supabase/i.test(bname) ? 'db'
        : /\bauth\b|session\b/i.test(bname) ? 'auth'
        : /email|mail/i.test(rel) ? 'email'
        : /shopify|stripe|billing/i.test(bname) ? 'payment'
        : 'util';
      const id = `shared_${rel.replace(/[/\\. ]/g, '_')}`;
      return {
        id, file: rel, label,
        importCount: count,
        importedByUrls: [...new Set(importedByUrls[fp])],
        category: cat, isComponent: isComp,
      };
    });

  const moduleIdSet = new Set(modules.map(m => m.id));
  const filteredRouteImports = {};
  for (const [routeId, fps] of Object.entries(routeImports)) {
    const modIds = fps
      .map(fp => `shared_${path.relative(root, fp).replace(/[/\\. ]/g, '_')}`)
      .filter(id => moduleIdSet.has(id));
    if (modIds.length) filteredRouteImports[routeId] = modIds;
  }

  return { modules, routeImports: filteredRouteImports };
}

// ─── Framework-specific route parsers ──────────────────────────────────────

function remixIdToUrl(id) {
  let s = id;
  s = s.replace(/^_[^.]+\./, '');
  s = s.replace(/\._index$/, '');
  s = s.replace(/\./g, '/');
  s = s.replace(/\$/g, ':');
  if (!s || s === '_index') return '/';
  return '/' + s;
}

function remixParent(id) {
  const parts = id.split('.');
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join('.');
}

function parseRemix(root) {
  const dir = path.join(root, 'app', 'routes');
  if (!fs.existsSync(dir)) return [];

  const routes = [];

  function collectRouteFile(fp, id) {
    const content = readFile(fp);
    routes.push({
      id,
      url:          remixIdToUrl(id),
      file:         path.relative(root, fp),
      hasLoader:    /export\s+(?:async\s+)?function\s+loader\b/.test(content),
      hasAction:    /export\s+(?:async\s+)?function\s+action\b/.test(content),
      hasComponent: /export\s+default\b/.test(content),
      authGated:    /requireUser|requireAuth|getUser|sessionUser|redirectIfNotAuth/i.test(content),
      parent:       remixParent(id),
      analysis:     analyzeWithImports(fp, root),
    });
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const subDir = path.join(dir, entry.name);
      for (const sub of fs.readdirSync(subDir, { withFileTypes: true })) {
        if (!sub.isFile() || !ROUTE_EXTS.some(e => sub.name.endsWith(e))) continue;
        const base = sub.name.replace(/\.(tsx|ts|jsx|js)$/, '');
        collectRouteFile(path.join(subDir, sub.name), `${entry.name}.${base}`);
      }
    } else if (ROUTE_EXTS.some(e => entry.name.endsWith(e))) {
      const id = entry.name.replace(/\.(tsx|ts|jsx|js)$/, '');
      collectRouteFile(path.join(dir, entry.name), id);
    }
  }

  return routes;
}

function parseNextApp(root) {
  const appDir = fs.existsSync(path.join(root, 'app'))
    ? path.join(root, 'app')
    : path.join(root, 'src', 'app');
  if (!fs.existsSync(appDir)) return [];

  const routes = [];
  const pageFiles = walk(appDir, ROUTE_EXTS).filter(f =>
    /\/(page|route|layout)\.(tsx|ts|jsx|js)$/.test(f)
  );

  for (const fp of pageFiles) {
    const rel     = path.relative(appDir, fp);
    const content = readFile(fp);
    const isPage  = /page\.(tsx|ts|jsx|js)$/.test(fp);
    const isLayout = /layout\.(tsx|ts|jsx|js)$/.test(fp);

    let urlPart = path.dirname(rel).replace(/\\/g, '/')
      .replace(/\(([^)]+)\)/g, '')
      .replace(/\/+/g, '/')
      .replace(/\[\.\.\.(\w+)\]/, '*')
      .replace(/\[(\w+)\]/g, ':$1')
      .replace(/^\./, '');
    if (!urlPart || urlPart === '.') urlPart = '';
    const url = '/' + urlPart;

    const httpMethods = ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']
      .filter(m => new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b`).test(content));

    routes.push({
      id:           rel.replace(/[/\\]/g, '_'),
      url,
      file:         path.relative(root, fp),
      hasLoader:    /export\s+(?:async\s+)?function\s+GET\b/.test(content) || isPage,
      hasAction:    httpMethods.filter(m => m !== 'GET').length > 0,
      hasComponent: isPage || isLayout,
      isLayout,
      httpMethods:  httpMethods.length ? httpMethods : undefined,
      authGated:    /getServerSession|getSession|auth\(\)|requireAuth|redirect.*login/i.test(content),
      parent:       null,
      analysis:     analyzeWithImports(fp, root),
    });
  }
  return routes;
}

function parseSvelteKit(root) {
  const dir = path.join(root, 'src', 'routes');
  if (!fs.existsSync(dir)) return [];

  const files = walk(dir, ROUTE_EXTS).filter(f => /^\+(?:page|layout|server)/.test(path.basename(f)));
  const routeMap = {};

  for (const fp of files) {
    const rel     = path.relative(dir, fp);
    const base    = path.basename(fp);
    const dirPart = path.dirname(rel).replace(/\\/g, '/');
    const content = readFile(fp);

    let urlPart = dirPart === '.' ? '' : dirPart;
    urlPart = urlPart
      .replace(/\[\.\.\.(\w+)\]/, '*')
      .replace(/\[(\w+)\]/g, ':$1')
      .replace(/\(([^)]+)\)/g, '');
    const url = '/' + urlPart.replace(/^\//, '');
    const key = url || '/';

    if (!routeMap[key]) {
      routeMap[key] = {
        id:           `route_${url.replace(/\//g, '_').replace(/:/g, 'p_')}` || 'root',
        url:          key, file: path.relative(root, fp),
        hasLoader: false, hasAction: false, hasComponent: false, authGated: false,
        parent: null,
        analysis: { dbReads: [], dbWrites: [], aiCalls: [], external: [] },
      };
    }
    const r = routeMap[key];
    if (base.startsWith('+page.svelte')) r.hasComponent = true;
    if (base.startsWith('+page.server') || base.startsWith('+server')) {
      if (/export\s+(?:async\s+)?function\s+load\b/.test(content)) r.hasLoader = true;
      if (/export\s+const\s+actions/.test(content)) r.hasAction = true;
    }
    if (/requireLogin|getUser|locals\.user|session\?\.user/i.test(content)) r.authGated = true;
    const a = analyzeWithImports(fp, root);
    r.analysis.dbReads  = [...new Set([...r.analysis.dbReads,  ...a.dbReads])];
    r.analysis.dbWrites = [...new Set([...r.analysis.dbWrites, ...a.dbWrites])];
    r.analysis.aiCalls  = [...new Set([...r.analysis.aiCalls,  ...a.aiCalls])];
    r.analysis.external = [...new Set([...r.analysis.external, ...a.external])];
  }

  return Object.values(routeMap);
}

function parseNuxt(root) {
  const pagesDir  = path.join(root, 'pages');
  const apiDir    = path.join(root, 'server', 'api');
  const routes    = [];

  if (fs.existsSync(pagesDir)) {
    for (const fp of walk(pagesDir, ['.vue', '.ts', '.js'])) {
      const rel = path.relative(pagesDir, fp).replace(/\\/g, '/');
      const content = readFile(fp);
      let url = '/' + rel
        .replace(/\/index\.(vue|ts|js)$/, '')
        .replace(/\.(vue|ts|js)$/, '')
        .replace(/\[\.\.\.(\w+)\]/, '*')
        .replace(/\[(\w+)\]/g, ':$1');
      routes.push({
        id:           `page_${rel.replace(/[./]/g, '_')}`,
        url,
        file:         path.relative(root, fp),
        hasLoader:    /useAsyncData|useFetch/i.test(content),
        hasAction:    false,
        hasComponent: true,
        authGated:    /useAuth|requireAuth/i.test(content),
        parent:       null,
        analysis:     analyzeWithImports(fp, root),
      });
    }
  }

  if (fs.existsSync(apiDir)) {
    for (const fp of walk(apiDir, ['.ts', '.js'])) {
      const rel     = path.relative(apiDir, fp).replace(/\\/g, '/');
      const content = readFile(fp);
      routes.push({
        id:           `api_${rel.replace(/[./]/g, '_')}`,
        url:          '/api/' + rel.replace(/\.(ts|js)$/, '').replace(/\[(\w+)\]/g, ':$1'),
        file:         path.relative(root, fp),
        hasLoader:    /defineEventHandler/.test(content),
        hasAction:    true,
        hasComponent: false,
        authGated:    /requireAuth|getServerSession/i.test(content),
        parent:       null,
        analysis:     analyzeWithImports(fp, root),
      });
    }
  }

  return routes;
}

// ─── Trigger detection ────────────────────────────────────────────────────

function detectTrigger(url) {
  if (/webhook/i.test(url))                                      return { type: 'event',  label: '📨 inbound' };
  if (/\/auth\/|\/login|\/oauth|\/callback/i.test(url))          return { type: 'user',   label: '⚡ OAuth' };
  if (/status|progress|poll/i.test(url) && /\/api\//.test(url)) return { type: 'polled', label: '↺ polled' };
  if (/\/cron|\/jobs?\/|\/scheduled|\/tasks?\//i.test(url))      return { type: 'async',  label: '⏰ scheduled' };
  if (/\/api\//i.test(url))                                      return { type: 'user',   label: '⚡ API call' };
  return { type: 'user', label: '⚡ user' };
}

// ─── Graph builder ─────────────────────────────────────────────────────────

function buildGraph(routes, framework, prismaModels, sharedData) {
  const { modules: sharedModules = [], routeImports = {} } = sharedData || {};
  const nodes      = {};
  const edges      = [];
  const tables     = new Set();
  const ais        = new Set();
  const exts       = new Set();
  const dbReaders  = {};
  const dbWriters  = {};

  for (const r of routes) {
    const group = r.url.split('/').filter(Boolean)[0] || 'root';
    nodes[r.id] = {
      layer:        'routes',
      label:        r.url,
      file:         r.file,
      url:          r.url,
      group,
      hasLoader:    r.hasLoader,
      hasAction:    r.hasAction,
      hasComponent: r.hasComponent,
      authGated:    r.authGated,
      badges:       [
        r.hasLoader    ? 'L'  : null,
        r.hasAction    ? 'A'  : null,
        r.hasComponent ? 'UI' : null,
      ].filter(Boolean),
      dbReads:      r.analysis.dbReads,
      dbWrites:     r.analysis.dbWrites,
      aiCalls:      r.analysis.aiCalls,
      external:     r.analysis.external,
      trigger:      detectTrigger(r.url),
    };

    const a = r.analysis;
    for (const t of a.dbReads)  { tables.add(t); edges.push({ from: r.id, to: `db_${t}`,  type: 'read',     label: 'reads'  }); (dbReaders[t] = dbReaders[t] || []).push(r.url); }
    for (const t of a.dbWrites) { tables.add(t); edges.push({ from: r.id, to: `db_${t}`,  type: 'write',    label: 'writes' }); (dbWriters[t] = dbWriters[t] || []).push(r.url); }
    for (const ai of a.aiCalls) { ais.add(ai);   edges.push({ from: r.id, to: `ai_${ai}`, type: 'ai',       label: 'calls'  }); }
    for (const ex of a.external){ exts.add(ex);  edges.push({ from: r.id, to: `ex_${ex}`, type: 'external', label: 'calls'  }); }
  }

  for (const t of tables) {
    const schema = prismaModels && prismaModels[t.toLowerCase()];
    nodes[`db_${t}`] = {
      layer:      'db', label: t, tag: 'DB',
      fields:     schema ? schema.fields.slice(0, 15) : [],
      fieldCount: schema ? schema.fieldCount : null,
      relations:  schema ? schema.relations : [],
      readers:    [...new Set(dbReaders[t] || [])],
      writers:    [...new Set(dbWriters[t] || [])],
    };
  }
  for (const ai of ais) {
    nodes[`ai_${ai}`] = { layer: 'ai',  label: ai, tag: 'AI' };
  }
  for (const ex of exts) {
    nodes[`ex_${ex}`] = { layer: 'ext', label: ex, tag: 'API' };
  }

  // Shared module nodes
  for (const sm of sharedModules) {
    nodes[sm.id] = {
      layer:          'shared',
      label:          sm.label,
      file:           sm.file,
      tag:            sm.isComponent ? 'COMP' : 'SVC',
      category:       sm.category,
      importCount:    sm.importCount,
      importedByUrls: sm.importedByUrls,
    };
  }

  // Edges: routes → shared modules
  for (const [routeId, modIds] of Object.entries(routeImports)) {
    for (const modId of modIds) {
      if (nodes[modId]) edges.push({ from: routeId, to: modId, type: 'shared', label: 'uses' });
    }
  }

  // Deduplicate edges
  const seen = new Set();
  const dedupedEdges = edges.filter(e => {
    const key = `${e.from}→${e.to}→${e.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { nodes, edges: dedupedEdges, framework, routeCount: routes.length };
}

// ─── HTML template ─────────────────────────────────────────────────────────

const VIZ_TEMPLATE = fs.readFileSync(path.join(__dirname, 'viz-template.html'), 'utf8');

// ─── Main ──────────────────────────────────────────────────────────────────

const framework = detectFramework(root);
if (!framework) {
  console.error('Could not detect framework. Is this a JS project with a package.json?');
  process.exit(1);
}

console.log(`Detected: ${framework}`);

const parsers = {
  'remix':        parseRemix,
  'nextjs-app':   parseNextApp,
  'nextjs-pages': parseNextApp,
  'sveltekit':    parseSvelteKit,
  'nuxt':         parseNuxt,
};

const routes       = parsers[framework](root);
console.log(`Found ${routes.length} routes`);

const prismaModels = parsePrismaSchema(root);
const prismaCount  = Object.keys(prismaModels).length;
if (prismaCount) console.log(`Prisma schema: ${prismaCount} models`);

const sharedData   = parseSharedModules(root, routes);
console.log(`Shared modules: ${sharedData.modules.length}`);

const graph        = buildGraph(routes, framework, prismaModels, sharedData);

const tableCount  = Object.values(graph.nodes).filter(n => n.layer === 'db').length;
const aiCount     = Object.values(graph.nodes).filter(n => n.layer === 'ai').length;
const extCount    = Object.values(graph.nodes).filter(n => n.layer === 'ext').length;
const sharedCount = Object.values(graph.nodes).filter(n => n.layer === 'shared').length;
console.log(`DB tables: ${tableCount}, AI: ${aiCount}, External: ${extCount}, Services: ${sharedCount}, Edges: ${graph.edges.length}`);

const projectName = path.basename(root);
const fwLabels    = {
  remix: 'Remix', 'nextjs-app': 'Next.js App Router',
  'nextjs-pages': 'Next.js Pages', sveltekit: 'SvelteKit', nuxt: 'Nuxt'
};

const html = VIZ_TEMPLATE
  .replace('__TITLE__',        projectName)
  .replace('__PROJECT__',      projectName)
  .replace('__FRAMEWORK__',    fwLabels[framework] || framework)
  .replace('__ROUTE_COUNT__',  routes.length)
  .replace('__DB_COUNT__',     tableCount)
  .replace('__AI_COUNT__',     aiCount)
  .replace('__EXT_COUNT__',    extCount)
  .replace('__SHARED_COUNT__', sharedCount)
  .replace('__DATA_JSON__',    JSON.stringify(graph));

fs.writeFileSync(out, html, 'utf8');
console.log(`Written: ${out}`);
