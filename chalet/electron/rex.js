/*
 * The village store and the houses' Claude Code sessions, run on the Rex server.
 *
 * Each house on the map is one Claude Code session in one folder. It runs as the
 * interactive `claude` program in a Rex session of its own, so:
 *  - the work goes on when this app quits (the Rex server is a separate process),
 *  - the same session can be watched and used in the Rex app.
 *
 * This file talks to Rex only through the `rex` CLI:
 *  - `rex new LABEL -c DIR -- claude --session-id ID`   start a house's Claude Code
 *  - `rex api call block.event` (paste) + `rex send-key enter`   send a prompt
 *  - `rex events --all --json`   status reports: Claude Code reports idle / working /
 *    blocked / done itself (the Program Status Protocol, OSC 7501)
 *  - `rex send-key escape`   stop a turn; `rex kill`   close a house's session
 * The chat a house shows is read from Claude Code's transcript
 * (~/.claude/projects/<folder>/<session id>.jsonl): every prompt, and the last text
 * Claude wrote in each turn. Prompts typed in the Rex app show up there too.
 *
 * Store: <userData>/village.json { builds: [...] }. A house keeps
 *   { id, type, s, w, rot, variant, name, cwd, mode, sessionId, rexSession, rexBlock, messages }
 * A decoration (decor: true) is a build with no folder and no session.
 */
import { app } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { readFile, writeFile, rename, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const MODES = new Set(['auto', 'acceptEdits', 'default']);
const START_TIMEOUT = 15000; // no status this long after a start: something is waiting in the terminal
const TRUST_DELAY = 1500; // the trust question needs a moment to appear after a start
const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32';

// ---- store ----------------------------------------------------------------------------
const storePath = () => join(app.getPath('userData'), 'village.json');
let builds = [];
let saveTimer = null;
const live = new Map(); // house id -> runtime state (not saved), see state()

/** Fields kept on disk. Runtime state (status, timers, transcript cursor) lives in `live`. */
const SAVED = ['id', 'type', 's', 'w', 'rot', 'variant', 'name', 'cwd', 'mode', 'sessionId', 'rexSession', 'rexBlock', 'messages', 'unread', 'decor', 'createdAt'];

export async function loadStore() {
  try {
    const data = JSON.parse(await readFile(storePath(), 'utf8'));
    builds = Array.isArray(data.builds) ? data.builds : [];
  } catch {
    builds = [];
  }
  dedupeSessions();
}

function snapshot() {
  return JSON.stringify({ builds: builds.map((b) => Object.fromEntries(SAVED.filter((k) => k in b).map((k) => [k, b[k]]))) }, null, 1);
}

let writing = null; // the store write in progress, if any

/** Write the store through a temp file and a rename (never a half-written file), one write at a time. */
function writeStore() {
  const run = (writing || Promise.resolve()).then(async () => {
    const tmp = storePath() + '.tmp';
    await writeFile(tmp, snapshot());
    await rename(tmp, storePath());
  });
  writing = run.catch(() => {});
  return run;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeStore().catch((e) => console.error('[store]', e));
  }, 300);
}

/** Write any pending change now and wait until the store is on disk (before quitting). */
export async function flushStore() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    await writeStore();
  } else await writing;
}

const find = (id) => builds.find((b) => b.id === id);
const houses = () => builds.filter((b) => !b.decor);

// ---- duplicates -------------------------------------------------------------------------

/** A folder in one canonical form: symlinks resolved, no trailing slash, case folded where the disk ignores case. */
export function canonicalDir(dir) {
  let p = String(dir || '');
  try { p = realpathSync.native(p); } catch { /* a missing folder: compare it as written */ }
  if (p.length > 1) p = p.replace(/[\\/]+$/, '');
  return CASE_INSENSITIVE ? p.toLowerCase() : p;
}

/**
 * How `dir` relates to the folders houses already use:
 *  { kind: 'same', house }    the folder is already a house's: not allowed
 *  { kind: 'inside', house }  it is inside a house's folder
 *  { kind: 'contains', house } a house's folder is inside it
 *  null                        no overlap
 */
export function folderConflict(dir, exceptId = null) {
  return conflictChecker(exceptId)(dir);
}

/** folderConflict for many folders at once: the houses' folders are resolved only once. */
export function conflictChecker(exceptId = null) {
  const others = houses()
    .filter((b) => b.id !== exceptId && b.cwd)
    .map((b) => ({ o: canonicalDir(b.cwd), house: { id: b.id, name: b.name } }));
  return (dir) => {
    const c = canonicalDir(dir);
    let near = null;
    for (const { o, house } of others) {
      if (o === c) return { kind: 'same', house };
      if (!near && c.startsWith(o + sep)) near = { kind: 'inside', house };
      if (!near && o.startsWith(c + sep)) near = { kind: 'contains', house };
    }
    return near;
  };
}

/** No two houses may share a Claude session or a Rex session (a hand-edited or old store). */
function dedupeSessions() {
  const seen = { sessionId: new Set(), rexSession: new Set() };
  for (const b of houses()) {
    for (const k of ['sessionId', 'rexSession']) {
      if (!b[k]) continue;
      if (seen[k].has(b[k])) {
        console.warn(`[village] ${b.name}: ${k} is used by another house, dropped`);
        b[k] = null;
        if (k === 'rexSession') b.rexBlock = null;
      } else seen[k].add(b[k]);
    }
  }
}

// ---- the shell environment: rex, claude and a login-shell PATH ---------------------------
// An app opened from Finder or the Dock does not get the user's shell PATH, so `rex` and
// `claude` would not be found. Read them from a login shell once.
//  - First `-lc` (login, not interactive): reads .zprofile and friends, and always exits.
//  - Only if something is still missing, `-ilc` (also reads .zshrc). An interactive shell
//    with no terminal can hang, and it ignores SIGTERM, so it is killed with SIGKILL.
//  - Known install places last, so a broken shell setup never blocks the village.
function readShell(flags) {
  const shell = process.env.SHELL || '/bin/zsh';
  const script = 'printf "__PATH__%s\\n" "$PATH"; printf "__REX__%s\\n" "$(command -v rex)"; printf "__CLAUDE__%s\\n" "$(command -v claude)"';
  return new Promise((resolve) => {
    execFile(shell, [flags, script], { timeout: 5000, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, TERM: 'dumb' } },
      (err, stdout = '') => {
        const pick = (tag) => String(stdout).split('\n').find((l) => l.startsWith(tag))?.slice(tag.length).trim() || '';
        resolve({ path: pick('__PATH__'), rex: pick('__REX__'), claude: pick('__CLAUDE__') });
      });
  });
}

let envReady = null;
function shellEnv() {
  envReady ??= (async () => {
    const ok = (p) => !!p && existsSync(p);
    let got = await readShell('-lc');
    if (!ok(got.rex) || !ok(got.claude)) {
      const more = await readShell('-ilc');
      got = { path: more.path || got.path, rex: ok(got.rex) ? got.rex : more.rex, claude: ok(got.claude) ? got.claude : more.claude };
    }
    const first = (list) => list.find(ok) || '';
    const home = homedir();
    const rex = first([got.rex, join(home, 'Library/Application Support/com.superlogical.rex/RexServer/Versions/Current/Rex Server.app/Contents/MacOS/rex'), '/opt/homebrew/bin/rex', '/usr/local/bin/rex']);
    const claude = first([got.claude, join(home, '.local/bin/claude'), join(home, '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']);
    const extra = [join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
    const path = [...new Set([...(got.path || process.env.PATH || '').split(':'), ...extra].filter(Boolean))].join(':');
    return { path, rex, claude };
  })();
  return envReady;
}

/** Run the rex CLI. Resolves the parsed JSON output (or the text with json: false). */
async function rex(args, { json = true, timeout = 15000 } = {}) {
  const env = await shellEnv();
  if (!env.rex) throw new Error('Could not find the rex command. Check that Rex is installed.');
  return new Promise((resolve, reject) => {
    execFile(env.rex, args, { timeout, env: { ...process.env, PATH: env.path }, maxBuffer: 16 << 20 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim().split('\n').pop()));
      if (!json) return resolve(stdout);
      try { resolve(stdout.trim() ? JSON.parse(stdout) : null); } catch { resolve(stdout); }
    });
  });
}

/** Press a key in a house's Claude Code pane. */
const sendKey = (b, key) => rex(['send-key', '-s', b.rexSession, '-b', b.rexBlock, key], { json: false });
/** Close a Rex session; a session that is already gone is fine. */
const killSession = (sid) => rex(['kill', sid], { json: false }).catch(() => {});

// ---- folder trust ---------------------------------------------------------------------------

/**
 * Has the user told Claude Code to trust this folder? Claude Code keeps the answer in
 * ~/.claude.json under projects[<folder>].hasTrustDialogAccepted. A trusted parent folder
 * counts too. Only read here: the question stays the user's to answer.
 */
async function isTrusted(dir) {
  let projects = {};
  try { projects = JSON.parse(await readFile(join(homedir(), '.claude.json'), 'utf8')).projects || {}; } catch { return false; }
  const accepted = new Set(Object.entries(projects).filter(([, v]) => v?.hasTrustDialogAccepted).map(([k]) => canonicalDir(k)));
  for (let p = canonicalDir(dir); p; ) {
    if (accepted.has(p)) return true;
    const up = p.slice(0, p.lastIndexOf(sep));
    if (!up || up === p) break;
    p = up;
  }
  return false;
}

// ---- transcript: the chat a house shows -----------------------------------------------------

const projectSlug = (dir) => dir.replace(/[^a-zA-Z0-9]/g, '-');

function transcriptPath(b) {
  const root = join(homedir(), '.claude', 'projects');
  const names = [b.cwd];
  try { names.push(realpathSync.native(b.cwd)); } catch { /* gone */ }
  for (const d of names) {
    const p = join(root, projectSlug(d), `${b.sessionId}.jsonl`);
    if (existsSync(p)) return p;
  }
  return join(root, projectSlug(names.at(-1)), `${b.sessionId}.jsonl`);
}

/** Text of a user entry that the user typed (not a tool result, a command wrapper or meta). */
function typedText(e) {
  if (e.isSidechain || e.isMeta || e.isCompactSummary) return null;
  const c = e.message?.content;
  let t = typeof c === 'string' ? c : Array.isArray(c) && !c.some((x) => x.type === 'tool_result')
    ? c.filter((x) => x.type === 'text').map((x) => x.text).join('\n') : null;
  if (!t) return null;
  t = t.trim();
  if (/^<(command-|local-command|bash-|system-reminder|task-notification)/.test(t)) return null;
  return t;
}

/** A prompt Claude Code made itself (a background task finished, ...), not one the user typed. */
const automatic = (e) => e.origin?.kind && e.origin.kind !== 'human';

/**
 * Read what was added to the transcript since last time and fold it into turns:
 * [{ user, at, final, finalAt, stopped, last }]. `final` is the last text Claude wrote in the
 * turn; `last` is 'text' when the turn so far ends on that text, 'tool' when a tool step followed.
 */
function readTranscript(b) {
  // one read at a time per house: two reads from the same offset would add the same turns twice
  const st = state(b);
  const run = (st.tRead || Promise.resolve()).then(() => readTranscriptNow(b));
  st.tRead = run.catch(() => {});
  return run;
}

async function readTranscriptNow(b) {
  const st = state(b);
  const path = transcriptPath(b);
  const fresh = { tOffset: 0, tCarry: Buffer.alloc(0), turns: [] };
  if (st.tPath !== path) Object.assign(st, { tPath: path, ...fresh });
  let size;
  try { size = statSync(path).size; } catch { return st.turns; }
  if (size < st.tOffset) Object.assign(st, fresh); // rewritten
  if (size === st.tOffset) return st.turns;
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(size - st.tOffset);
    await fh.read(buf, 0, buf.length, st.tOffset);
    st.tOffset = size;
    // split at the last newline byte, before decoding: the rest (a line still being written)
    // is kept as bytes, so a character cut at the end of this read is decoded whole next time
    const data = Buffer.concat([st.tCarry, buf]);
    const end = data.lastIndexOf(0x0a) + 1;
    st.tCarry = Buffer.from(data.subarray(end));
    const lines = data.subarray(0, end).toString('utf8').split('\n');
    lines.pop(); // the empty string after the last newline
    for (const line of lines) {
      if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      const at = Date.parse(e.timestamp) || Date.now();
      if (e.type === 'user') {
        if (!e.isSidechain && line.includes('[Request interrupted by user')) { // stopped (Esc), also inside a tool result
          const turn = st.turns.at(-1);
          if (turn) turn.stopped = true;
          continue;
        }
        if (automatic(e) && !e.isSidechain) { // a turn of its own, with no prompt to show
          st.turns.push({ user: null, at, final: '', finalAt: 0, stopped: false, last: '' });
          continue;
        }
        const t = typedText(e);
        if (t == null) {
          const turn = st.turns.at(-1);
          if (turn && !e.isSidechain && Array.isArray(e.message?.content) && e.message.content.some((x) => x.type === 'tool_result')) turn.last = 'tool';
          continue;
        }
        st.turns.push({ user: t, at, final: '', finalAt: 0, stopped: false, last: '' });
      } else if (e.type === 'assistant' && !e.isSidechain) {
        const content = e.message?.content || [];
        const text = content.filter((x) => x.type === 'text').map((x) => x.text).join('\n').trim();
        const turn = st.turns.at(-1);
        if (!turn) continue;
        if (text) Object.assign(turn, { final: text, finalAt: at, last: 'text' });
        if (content.some((x) => x.type === 'tool_use')) turn.last = 'tool'; // more work follows: not the answer yet
      }
    }
  } finally {
    await fh.close();
  }
  return st.turns;
}

/** The chat for the page: each prompt, and each finished turn's last text. */
function chat(b) {
  const st = state(b);
  if (!st.turns && !st.sent && !st.queued) return b.messages || []; // the transcript is not read yet
  const turns = st.turns || [];
  if (st.sent && turns.length > st.sent.base) st.sent = null; // the transcript has the prompt now
  const busy = st.status === 'working' || st.status === 'blocked' || st.status === 'starting';
  const out = [];
  turns.forEach((t, i) => {
    if (t.user != null) out.push({ role: 'user', text: t.user, at: t.at });
    const open = i === turns.length - 1 && busy && !st.sent; // a sent prompt not in the file yet: the last turn there is done
    if (open) return;
    if (t.stopped && !t.final && t.user != null) out.push({ role: 'claude', error: true, text: 'Stopped the task.', at: t.at });
    else if (t.final) out.push({ role: 'claude', text: t.final, at: t.finalAt, ...(t.stopped ? { error: true } : {}) });
  });
  if (st.sent) out.push({ role: 'user', text: st.sent.text, at: st.sent.at });
  if (st.queued) out.push({ role: 'user', text: st.queued.text, at: st.queued.at, queued: true });
  return out;
}

// ---- house runtime ------------------------------------------------------------------------

/**
 * Runtime state of a house:
 *  status: 'off' (no Claude running) | 'starting' | 'idle' | 'working' | 'blocked' | 'stuck'
 *  needsTrust: Claude Code is asking whether to trust the folder (from ~/.claude.json)
 */
function state(b) {
  if (!live.has(b.id)) live.set(b.id, { status: b.rexSession ? 'idle' : 'off', startedAt: null, needsTrust: false, blocked: null, queued: null, launchedAt: 0, turns: null });
  return live.get(b.id);
}

let emit = () => {};

function publicBuild(b) {
  if (b.decor) return { ...b };
  const st = state(b);
  return {
    ...b,
    messages: chat(b),
    status: st.status,
    working: st.status === 'working' || st.status === 'blocked',
    startedAt: st.startedAt,
    needsTrust: st.needsTrust,
    blocked: st.blocked,
    launchedAt: st.launchedAt,
  };
}

/** False once the house was removed: work that was still running must not bring it back. */
const exists = (b) => builds.includes(b);

function changed(b, extra = {}) {
  if (!exists(b)) return;
  if (!b.decor) b.messages = chat(b).filter((m) => !m.queued);
  save();
  emit(b, extra);
}

/** Start the house's Claude Code in a new Rex session (resuming its conversation if it has one). */
async function launch(b) {
  const st = state(b);
  if (st.launching) return st.launching; // already starting: one session per house
  st.launching = launchOnce(b).finally(() => { st.launching = null; });
  return st.launching;
}

async function launchOnce(b) {
  const st = state(b);
  if (!existsSync(b.cwd)) throw new Error(`Folder not found: ${b.cwd}`);
  b.sessionId ||= randomUUID();
  if (houses().some((o) => o !== b && o.sessionId === b.sessionId)) b.sessionId = randomUUID(); // never share
  const resume = existsSync(transcriptPath(b));
  const env = await shellEnv();
  const mode = MODES.has(b.mode) ? b.mode : 'auto';
  const args = ['new', `Chalet · ${b.name}`, '-c', b.cwd, '--json', '--', env.claude || 'claude',
    ...(resume ? ['--resume', b.sessionId] : ['--session-id', b.sessionId]), '--permission-mode', mode];
  Object.assign(st, { status: 'starting', needsTrust: !(await isTrusted(b.cwd)), launchedAt: Date.now(), blocked: null });
  changed(b);
  const out = await rex(args);
  if (!builds.includes(b) || b.rexSession) {
    // the house was removed, or got a session another way, while this one started: close it
    killSession(out.session_id);
    return;
  }
  const sid = (b.rexSession = out.session_id);
  b.rexBlock = out.initial_windows?.[0]?.block_ids?.[0] ?? null;
  st.modeLaunched = mode;
  changed(b);
  // no status at all after a while: something in the terminal waits for the user
  clearTimeout(st.startTimer);
  st.startTimer = setTimeout(() => {
    if (st.status === 'starting' && !st.needsTrust) { st.status = 'stuck'; changed(b); }
  }, START_TIMEOUT);
  // a report Claude Code sent before `rex new` returned was dropped (no house had the session yet)
  // (not awaited: settle() after an idle report can take seconds, and launch() should not wait for it)
  programStatus(b).then((rec) => {
    if (rec && b.rexSession === sid && st.status === 'starting') return onStatus(b, rec);
  }).catch(() => {});
}

/** The house's current Program Status record, or null if it has not reported. */
async function programStatus(b) {
  const ps = await rex(['block', 'call', '-s', b.rexSession, '-b', b.rexBlock, 'program_status']);
  return ps?.records?.find((r) => !r.id) || ps?.records?.[0] || null;
}

/** Type `text` into the house's Claude Code and press Return. */
async function deliver(b, text) {
  await rex(['api', 'call', '-s', b.rexSession, 'block.event', JSON.stringify({ block_id: b.rexBlock, event: { type: 'paste', payload: { text } } })]);
  await sendKey(b, 'enter');
}

async function flushQueued(b) {
  const st = state(b);
  const q = st.queued;
  if (!q || st.status !== 'idle' || !b.rexBlock) return;
  st.queued = null;
  st.status = 'working'; // until Claude Code reports
  st.startedAt = Date.now();
  st.sent = { text: q.text, at: q.at, base: st.turns?.length ?? 0 }; // shown until the transcript has it
  changed(b);
  try {
    await deliver(b, q.text);
  } catch (e) {
    st.status = 'idle';
    st.startedAt = null;
    st.sent = null;
    note(b, `Could not send: ${e.message}`);
  }
}

/** A message from the village itself (not Claude), shown at the end of the chat. */
function note(b, text) {
  if (!exists(b)) return;
  b.notice = { text, at: Date.now() };
  emit(b, { notice: b.notice });
}

/** Status reported by the house's Claude Code. */
async function onStatus(b, record) {
  const st = state(b);
  const s = record?.state;
  const was = st.status;
  clearTimeout(st.startTimer);
  if (s === 'working') {
    Object.assign(st, { status: 'working', needsTrust: false, blocked: null });
    st.startedAt ||= Date.now();
  } else if (s === 'blocked') {
    let msg = '';
    try { msg = record.msg ? Buffer.from(record.msg, 'base64').toString('utf8') : ''; } catch { /* keep empty */ }
    Object.assign(st, { status: 'blocked', blocked: { kind: record.kind || '', msg } });
    st.startedAt ||= Date.now();
  } else if (s === 'idle' || s === 'done' || s === 'error') {
    Object.assign(st, { status: 'idle', needsTrust: false, blocked: null });
    const busy = was === 'working' || was === 'blocked';
    st.startedAt = null;
    await settle(b);
    if (busy) b.unread = true;
    changed(b, busy ? { done: true } : {});
    if (st.modeLaunched && st.modeLaunched !== (b.mode || 'auto') && !st.queued) restart(b); // a new permission mode
    else flushQueued(b);
    return;
  } else return;
  await readTranscript(b).catch(() => {}); // the status counts even if the file cannot be read now
  changed(b);
}

/**
 * Read the transcript once a turn has ended. Claude Code reports the end a moment before
 * its last lines reach the file, so read again for a few seconds until the turn's answer
 * (or its stop) is there.
 */
async function settle(b) {
  const st = state(b);
  for (let i = 0; i < 12; i++) {
    const turns = await readTranscript(b).catch(() => []);
    const t = turns.at(-1);
    if (!t || t.last === 'text' || t.stopped) return; // the turn ended on Claude's text: its answer
    if (st.status !== 'idle') return; // a new turn started
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** The house's Claude Code ended (its pane closed): close its empty Rex session too. */
async function onExit(b) {
  const st = state(b);
  const sid = b.rexSession;
  Object.assign(st, { status: 'off', startedAt: null, blocked: null, needsTrust: false });
  b.rexSession = b.rexBlock = null;
  await readTranscript(b).catch(() => {});
  changed(b);
  if (sid) killSession(sid);
  if (st.queued) start(b);
}

async function start(b) {
  try {
    await launch(b);
  } catch (e) {
    Object.assign(state(b), { status: 'off' });
    note(b, String(e.message || e));
    changed(b);
  }
}

/** Close the running Claude Code (it resumes on the next prompt), for example after a mode change. */
async function restart(b) {
  const sid = b.rexSession;
  if (!sid) return;
  b.rexSession = b.rexBlock = null;
  Object.assign(state(b), { status: 'off' });
  changed(b);
  await killSession(sid);
}

// ---- events from the Rex server -----------------------------------------------------------

let events = null;
function watchEvents() {
  shellEnv().then((env) => {
    if (!env.rex || events) return;
    events = spawn(env.rex, ['events', '--all', '--json'], { env: { ...process.env, PATH: env.path }, stdio: ['ignore', 'pipe', 'ignore'] });
    createInterface({ input: events.stdout }).on('line', (line) => {
      let e;
      try { e = JSON.parse(line); } catch { return; }
      handleEvent(e);
    });
    events.on('exit', () => {
      events = null;
      if (!quitting) setTimeout(() => { watchEvents(); syncAll(); }, 2000); // the server restarted, or the stream broke
    });
  });
}

function handleEvent(e) {
  handleEventAsync(e)?.catch((err) => console.error('[rex] event:', err));
}

function handleEventAsync(e) {
  const b = houses().find((h) => h.rexSession && h.rexSession === e.payload?.session_id);
  if (e.type === 'session_destroyed') return b && onExit(b);
  if (e.type !== 'session_event') return;
  const ev = e.payload?.event;
  if (!b || !ev) return;
  if (ev.type === 'block_closed' && ev.payload?.block_id === b.rexBlock) return onExit(b);
  if (ev.type !== 'block_event' || ev.payload?.block_id !== b.rexBlock) return;
  const p = ev.payload;
  if (p.name === 'program_status_changed' && !p.payload?.id) return onStatus(b, p.payload?.record);
  if (p.name === 'program_status_removed') return onStatus(b, { state: 'idle' });
}

/** Match the store to the Rex server: sessions that are gone, and each house's current status. */
async function syncAll() {
  let alive;
  try {
    const out = await rex(['session', 'ls', '--json']);
    alive = new Set(JSON.stringify(out).match(/session:[0-9a-f-]{36}/g) || []);
  } catch {
    return; // no server: keep what we know
  }
  // each house is independent: check them all at once
  await Promise.all(houses().map((b) => syncHouse(b, alive).catch((e) => console.error('[rex] sync:', e))));
}

async function syncHouse(b, alive) {
  await readTranscript(b).catch(() => {});
  if (!b.rexSession) return changed(b);
  if (!alive.has(b.rexSession)) { b.rexSession = b.rexBlock = null; state(b).status = 'off'; return changed(b); }
  let rec;
  try {
    rec = await programStatus(b);
  } catch {
    return onExit(b); // its pane is gone
  }
  if (rec) await onStatus(b, rec);
  else { state(b).status = 'stuck'; changed(b); } // running, but has not reported (it may be asking something)
}

/** Start following the Rex server (after loadStore). */
export function startWatching() {
  watchEvents();
  syncAll();
}

let quitting = false;
export function stopWatching() {
  quitting = true;
  events?.kill();
}

// ---- bridge channels ------------------------------------------------------------------------
/**
 * Channels for electron/main.js. Every change to a build is sent back as 'build:changed'
 * (the whole build, with its chat) to all pages.
 */
export function makeChannels({ openFolder, broadcast }) {
  emit = (b, extra = {}) => broadcast('build:changed', { ...publicBuild(b), ...extra });
  return {
    'village:load': async (_d, reply) => {
      reply('village:data', { builds: builds.map(publicBuild) }); // the map first
      const env = await shellEnv(); // a login shell: can take a second
      reply('village:data', { builds: [], rex: env.rex || null, claude: env.claude || null });
    },
    'folder:open': ({ id }) => { const b = find(id); if (b?.cwd) openFolder(b.cwd); },
    'build:add': async (d) => {
      if (find(d.id)) return;
      const place = { id: d.id, type: d.type, s: d.s, w: d.w, rot: d.rot || 0, variant: d.variant || 0, createdAt: Date.now() };
      if (d.decor) {
        const b = { ...place, decor: true, name: String(d.name || d.type).slice(0, 40) };
        builds.push(b);
        changed(b);
        return;
      }
      // the last word on duplicates: one folder, one house
      const c = folderConflict(d.cwd);
      if (c?.kind === 'same') return broadcast('build:rejected', { id: d.id, reason: `'${c.house.name}' is already connected to this folder.`, house: c.house });
      if (!d.cwd || !existsSync(d.cwd) || !statSync(d.cwd).isDirectory()) return broadcast('build:rejected', { id: d.id, reason: 'Folder not found.' });
      d.cwd = realpathSync.native(d.cwd); // one spelling of the folder, for the transcript path too
      const b = { ...place, name: String(d.name || basename(d.cwd)).slice(0, 40), cwd: d.cwd, mode: MODES.has(d.mode) ? d.mode : 'auto', sessionId: null, rexSession: null, rexBlock: null, messages: [] };
      builds.push(b);
      changed(b);
      start(b); // Claude Code starts right away, so a trust question is up when the chat opens
    },
    'build:update': ({ id, patch }) => {
      const b = find(id);
      if (!b) return;
      if (typeof patch.name === 'string' && patch.name.trim()) b.name = patch.name.trim().slice(0, 40);
      if (Number.isFinite(patch.rot)) b.rot = patch.rot;
      if (Number.isInteger(patch.variant)) b.variant = patch.variant;
      if (typeof patch.unread === 'boolean') b.unread = patch.unread;
      if (!b.decor && MODES.has(patch.mode) && patch.mode !== b.mode) {
        b.mode = patch.mode;
        if (state(b).status === 'idle' || state(b).status === 'off') restart(b); // takes effect at the next start
      }
      if (!b.decor && patch.newChat && !['working', 'blocked'].includes(state(b).status)) {
        restart(b);
        b.sessionId = null;
        b.messages = [];
        Object.assign(state(b), { turns: null, tPath: null, queued: null });
      }
      changed(b);
    },
    'build:remove': ({ id }) => {
      const b = find(id);
      if (!b) return;
      builds = builds.filter((x) => x.id !== id);
      live.delete(id);
      if (b.rexSession) killSession(b.rexSession);
      save();
      broadcast('build:removed', { id });
    },
    'claude:send': ({ id, text }) => {
      const b = find(id);
      text = String(text || '').trim();
      if (!b || b.decor || !text) return;
      const st = state(b);
      if (st.status === 'working' || st.status === 'blocked' || st.queued) return; // one prompt at a time
      st.queued = { text, at: Date.now() };
      b.notice = null;
      changed(b);
      if (st.status === 'off') start(b);
      else flushQueued(b); // idle: now; starting: when Claude Code first reports idle
    },
    'claude:stop': ({ id }) => {
      const b = find(id);
      if (b?.rexSession) sendKey(b, 'escape').catch(() => {});
    },
    // Claude Code asks whether to trust the folder; the user clicked "Trust and start".
    // The question's first choice is "No, exit": move down to "Yes, I trust this folder", then Return.
    'claude:trust': async ({ id }) => {
      const b = find(id);
      const st = b && state(b);
      if (!st?.needsTrust || !b.rexSession || Date.now() - st.launchedAt < TRUST_DELAY) return;
      st.needsTrust = false;
      changed(b);
      await sendKey(b, 'down').catch(() => {});
      await sendKey(b, 'enter').catch(() => {});
    },
    // Show the house's session in the Rex app.
    'rex:open': async ({ id }) => {
      const b = find(id);
      if (!b) return;
      if (!b.rexSession) await start(b);
      if (!b.rexSession) return;
      try {
        await rex(['do', 'session.select', `session_id=${b.rexSession}`], { json: false });
      } catch {
        // several Rex apps connected: use the first Mac app
        try {
          const list = await rex(['client', 'ls', '--json']);
          const c = (Array.isArray(list) ? list : list?.clients || [])[0];
          if (c) await rex(['-C', c.client_id || c.id, 'do', 'session.select', `session_id=${b.rexSession}`], { json: false });
        } catch (e) {
          note(b, `Could not open the Rex app: ${e.message}`);
        }
      }
    },
  };
}
