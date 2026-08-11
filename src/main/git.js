'use strict';

const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = promisify(execFile);

const FIELD_SEP = '\u001f';
const RECORD_SEP = '\u001e';

async function runGit(args, cwd, opts = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      windowsHide: true,
      ...opts,
    });
    return stdout;
  } catch (err) {
    const detail = (err.stderr || err.message || '').toString().trim();
    throw new Error(detail || `git ${args[0]} failed`);
  }
}

async function isRepo(dir) {
  try {
    await runGit(['rev-parse', '--is-inside-work-tree'], dir);
    return true;
  } catch {
    return false;
  }
}

async function repoRoot(dir) {
  const out = await runGit(['rev-parse', '--show-toplevel'], dir);
  return out.trim();
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out',
  '.cache', '.venv', 'venv', 'target', 'vendor', 'bower_components',
  '.next', '.nuxt', 'coverage', 'obj', 'bin', 'debug', 'release',
]);

async function scanForRepos(rootDir, maxDepth = 3) {
  const found = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const gitPath = path.join(full, '.git');
      if (fs.existsSync(gitPath)) {
        found.push(full);
        continue;
      }
      if (depth < maxDepth) walk(full, depth + 1);
    }
  };
  walk(rootDir, 0);
  found.sort((a, b) => a.localeCompare(b));
  const withMeta = [];
  for (const repoPath of found) {
    withMeta.push({
      path: repoPath,
      name: path.basename(repoPath),
      parent: path.dirname(repoPath),
    });
  }
  return withMeta;
}

async function getRepoMeta(repoPath) {
  const branch = await getBranch(repoPath);
  const head = await getHead(repoPath);
  const counts = await getStatusCounts(repoPath);
  return { name: path.basename(repoPath), path: repoPath, branch, head, counts };
}

async function getBranch(repoPath) {
  try {
    const out = await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], repoPath);
    return out.trim();
  } catch {
    return '(detached)';
  }
}

async function getHead(repoPath) {
  const out = await runGit(['rev-parse', '--short', 'HEAD'], repoPath);
  return out.trim();
}

function parseStatus(raw) {
  const entries = [];
  let branch = null;
  const lines = raw.split('\n').filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('##')) {
      const m = line.match(/^##\s+([^\s.]+)(?:\.\.\.(.*?))?(?:\s+\[(.*?)\])?\s*$/);
      if (m) {
        branch = {
          name: m[1],
          remote: m[2] || null,
          tracking: m[3] || '',
        };
      } else {
        branch = { name: line.slice(2).trim(), remote: null, tracking: '' };
      }
      continue;
    }
    const xy = line.slice(0, 2);
    const file = line.slice(3);
    entries.push({ xy, code: xy.trim(), file });
  }
  return { branch, entries };
}

async function getStatusCounts(repoPath) {
  const raw = await runGit(['status', '--porcelain=v1', '-b'], repoPath);
  const { branch, entries } = parseStatus(raw);
  let staged = 0, unstaged = 0, untracked = 0, conflicts = 0;
  for (const e of entries) {
    if (e.xy.includes('U') || /[ADU]{2}/.test(e.xy)) conflicts++;
    if (e.xy[0] !== ' ' && e.xy[0] !== '?') staged++;
    if (e.xy[1] !== ' ' && e.xy[1] !== '?') unstaged++;
    if (e.xy === '??') untracked++;
  }
  return { staged, unstaged, untracked, conflicts, total: entries.length };
}

function parseLog(raw) {
  const commits = [];
  const records = raw.split(RECORD_SEP);
  for (const rec of records) {
    if (!rec.trim()) continue;
    const fields = rec.replace(/^\n/, '').split(FIELD_SEP);
    const [hash, parentsRaw, author, email, date, subject, refsRaw = ''] = fields;
    const parents = parentsRaw ? parentsRaw.split(' ').filter(Boolean) : [];
    const refs = refsRaw
      ? refsRaw.split(', ').map((r) => r.trim()).filter((r) => r && r !== 'HEAD ->')
      : [];
    commits.push({
      hash,
      short: hash.slice(0, 7),
      parents,
      author,
      email,
      date,
      subject,
      refs,
      isMerge: parents.length > 1,
    });
  }
  return commits;
}

async function getLog(repoPath, count = 400) {
  const raw = await runGit(
    [
      'log', '--all', '--topo-order',
      `--max-count=${count}`,
      '--parents',
      '--date=iso-strict',
      `--pretty=format:%H${FIELD_SEP}%P${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%ad${FIELD_SEP}%s${FIELD_SEP}%D${RECORD_SEP}`,
    ],
    repoPath
  );
  return parseLog(raw);
}

function parseBranches(raw) {
  const lines = raw.split('\n').filter(Boolean);
  const branches = [];
  let current = null;
  for (const line of lines) {
    let name = line.trim();
    const isCurrent = line.startsWith('*');
    if (isCurrent) {
      name = name.replace(/^\*\s*/, '');
      current = name;
    }
    if (name.includes(' -> ')) continue;
    branches.push({ name, isCurrent, isRemote: name.startsWith('remotes/') });
  }
  return { branches, current };
}

async function getBranches(repoPath) {
  const raw = await runGit(['branch', '-a', '--no-color'], repoPath);
  return parseBranches(raw);
}

async function getFullStatus(repoPath) {
  const raw = await runGit(['status', '--porcelain=v1', '-b', '--untracked-files=all'], repoPath);
  const { branch, entries } = parseStatus(raw);
  return { branch, entries, counts: countStatus(entries) };
}

function countStatus(entries) {
  let staged = 0, unstaged = 0, untracked = 0, conflicts = 0;
  for (const e of entries) {
    if (e.xy.includes('U') || /^[ADU][ADU]$/.test(e.xy)) conflicts++;
    if (e.xy[0] !== ' ' && e.xy[0] !== '?') staged++;
    if (e.xy[1] !== ' ' && e.xy[1] !== '?') unstaged++;
    if (e.xy === '??') untracked++;
  }
  return { staged, unstaged, untracked, conflicts, total: entries.length };
}

async function getUntrackedDiff(repoPath, file) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--no-index', '--no-color', '/dev/null', '--', file],
      { cwd: repoPath, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, windowsHide: true }
    );
    return stdout;
  } catch (err) {
    return (err.stdout || '').toString();
  }
}

async function getDiffForFile(repoPath, file, mode) {
  const args = ['diff', '--no-color', '--no-ext-diff'];
  if (mode === 'staged') args.push('--cached');
  args.push('--');
  if (mode === 'worktree') args.push(file);
  const raw = await runGit(args, repoPath);
  return raw;
}

async function getDiffVsHead(repoPath, file) {
  const raw = await runGit(
    ['diff', '--no-color', '--no-ext-diff', 'HEAD', '--', file],
    repoPath
  );
  return raw;
}

async function getCommitPatch(repoPath, hash, stat = false) {
  const args = ['show', '--no-color', '--no-ext-diff', '--format=', hash];
  if (stat) args.push('--stat');
  const raw = await runGit(args, repoPath);
  return raw;
}

async function getCommitInfo(repoPath, hash) {
  const fmt = '%H' + FIELD_SEP + '%P' + FIELD_SEP + '%an' + FIELD_SEP + '%ae' + FIELD_SEP + '%ad' + FIELD_SEP + '%s' + RECORD_SEP;
  const raw = await runGit(
    ['show', '--no-ext-diff', '--stat', '--format=' + fmt, '--date=iso-strict', hash],
    repoPath
  );
  const [record, rest] = raw.replace(/^\n/, '').split(RECORD_SEP);
  const fields = (record || '').split(FIELD_SEP);
  const stat = (rest || '').split(/\n(?=diff --git )/)[0] || '';
  return {
    hash: fields[0] || hash,
    parents: (fields[1] || '').split(' ').filter(Boolean),
    author: fields[2] || '',
    email: fields[3] || '',
    date: fields[4] || '',
    subject: fields[5] || '',
    stat: stat.trim(),
  };
}

async function checkout(repoPath, ref) {
  await runGit(['checkout', ref], repoPath);
  return { ok: true, ref };
}

async function createBranch(repoPath, name, startFrom) {
  const args = ['checkout', '-b', name];
  if (startFrom) args.push(startFrom);
  await runGit(args, repoPath);
  return { ok: true, name };
}

async function deleteBranch(repoPath, name) {
  const args = ['branch', '-d', name];
  await runGit(args, repoPath);
  return { ok: true, name };
}

async function clone(url, destDir, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['clone', '--progress', url, destDir], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let errBuf = '';
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      errBuf += text;
      if (onProgress) {
        const m = text.match(/(\d+)\s*%|Receiving objects|Resolving deltas|Cloning into/);
        if (m) onProgress(m.join(' '));
        else onProgress(text.trim().slice(0, 120));
      }
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true, dest: destDir });
      else reject(new Error(errBuf.trim().slice(-500) || `git clone exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function getStats(repoPath) {
  const out = await runGit(['rev-list', '--all', '--count'], repoPath);
  return { commits: parseInt(out.trim(), 10) || 0 };
}

module.exports = {
  isRepo,
  repoRoot,
  scanForRepos,
  getRepoMeta,
  getBranch,
  getHead,
  getStatusCounts,
  getFullStatus,
  getUntrackedDiff,
  parseStatus,
  getLog,
  parseLog,
  getBranches,
  getDiffForFile,
  getDiffVsHead,
  getCommitPatch,
  getCommitInfo,
  checkout,
  createBranch,
  deleteBranch,
  clone,
  getStats,
};
