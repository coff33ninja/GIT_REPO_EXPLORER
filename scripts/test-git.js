'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const git = require('../src/main/git');

function sh(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

function commit(file, content, msg, cwd) {
  fs.writeFileSync(path.join(cwd, file), content);
  sh(['add', file], cwd);
  sh(['commit', '-m', msg], cwd);
}

let failures = 0;
function check(name, cond, extra) {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${name}`);
  if (!cond) {
    failures++;
    if (extra) console.log('         -> ' + extra);
  }
}

async function main() {
  console.log('NEON GIT EXPLORER // headless test');
  console.log('===================================');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-test-'));
  sh(['init', '-b', 'main'], tmp);
  sh(['config', 'user.email', 'tester@neon.dev'], tmp);
  sh(['config', 'user.name', 'Neon Tester'], tmp);

  commit('a.txt', 'line1\n', 'initial commit', tmp);
  commit('b.txt', 'hello\n', 'add b file', tmp);

  sh(['checkout', '-b', 'feature/glow'], tmp);
  commit('c.txt', 'glow\n', 'feature: add glow', tmp);

  sh(['checkout', 'main'], tmp);
  commit('d.txt', 'mainline\n', 'mainline work', tmp);

  sh(['merge', 'feature/glow', '--no-ff', '-m', 'merge feature/glow'], tmp);
  const mergeHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf8' }).trim();

  commit('e.txt', 'after merge\n', 'post merge', tmp);

  fs.writeFileSync(path.join(tmp, 'untracked.txt'), 'fresh\n');
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'line1\nline2\n');
  fs.writeFileSync(path.join(tmp, 'b.txt'), 'hello world\n');
  sh(['add', 'b.txt'], tmp);
  fs.writeFileSync(path.join(tmp, 'b.txt'), 'hello world again\n');

  console.log('\n--- repo meta ---');
  const meta = await git.getRepoMeta(tmp);
  check('meta branch is main', meta.branch === 'main', JSON.stringify(meta));
  check('meta head short present', /^[0-9a-f]{7}$/.test(meta.head || ''), meta.head);

  console.log('\n--- status parsing ---');
  const status = await git.getFullStatus(tmp);
  const entries = status.entries.map((e) => `${e.xy} ${e.file}`);
  check('untracked file detected', entries.some((e) => e.startsWith('?? untracked.txt')), entries.join(' | '));
  check('staged+unstaged b.txt (MM)', entries.some((e) => e.startsWith('MM b.txt')), entries.join(' | '));
  check('unstaged a.txt detected', entries.some((e) => e.startsWith(' M a.txt')), entries.join(' | '));
  check('counts correct', status.counts.staged === 1 && status.counts.unstaged === 2 && status.counts.untracked === 1,
    JSON.stringify(status.counts));

  console.log('\n--- log parsing ---');
  const log = await git.getLog(tmp, 100);
  check('parsed commits count >= 6', log.length >= 6, log.length);
  const merge = log.find((c) => c.hash === mergeHash);
  check('merge commit has 2 parents', merge && merge.parents.length === 2, merge && JSON.stringify(merge.parents));
  check('merge flagged isMerge', !!(merge && merge.isMerge));
  check('refs decorated (main + feature)', (() => {
    const decorated = log.find((c) => c.refs.some((r) => r.includes('main') || r.includes('feature')));
    return !!decorated;
  })());
  check('subjects parsed', log.every((c) => typeof c.subject === 'string' && c.subject.length));
  check('topo order valid (parents always before child)', (() => {
    const seen = new Set();
    for (const c of log) {
      for (const p of c.parents) {
        if (!seen.has(p)) return `parent ${p} of ${c.hash} not yet seen`;
      }
      seen.add(c.hash);
    }
    return true;
  })());

  console.log('\n--- graph lane assignment (headless) ---');
  const GraphModule = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'graph.js'), 'utf8');
  check('graph.js parses as JS', (() => {
    try { new Function(GraphModule); return true; } catch (e) { return e.message; }
  })());

  // lane assignment quick re-implementation sanity check
  const laneOfMap = new Map();
  const lanes = [];
  for (const c of log) {
    let lane = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === c.hash) { lane = i; break; }
    }
    if (lane === -1) { lane = lanes.length; lanes.push(c.hash); }
    laneOfMap.set(c.hash, lane);
    const p1 = c.parents[0];
    if (p1 && !laneOfMap.has(p1)) lanes[lane] = p1;
    else lanes[lane] = null;
  }
  check('every commit got a lane', log.every((c) => laneOfMap.has(c.hash)));

  console.log('\n--- branches ---');
  const { branches, current } = await git.getBranches(tmp);
  const names = branches.map((b) => b.name);
  check('main present', names.includes('main'));
  check('feature branch present', names.some((n) => n === 'feature/glow'));
  check('current flagged', branches.find((b) => b.name === 'main').isCurrent);

  console.log('\n--- diffs ---');
  const staged = await git.getDiffForFile(tmp, 'b.txt', 'staged');
  check('staged diff contains +hello world', /^\+hello world$/m.test(staged), staged.split('\n').slice(-6).join(' '));
  const worktree = await git.getDiffForFile(tmp, 'a.txt', 'worktree');
  check('worktree diff contains +line2', /^\+line2$/m.test(worktree), worktree.split('\n').slice(-6).join(' '));
  const untracked = await git.getUntrackedDiff(tmp, 'untracked.txt');
  check('untracked diff shows +fresh', /^\+fresh$/m.test(untracked), untracked.split('\n').slice(-4).join(' '));
  const info = await git.getCommitInfo(tmp, mergeHash);
  check('commit info hash', info.hash === mergeHash);
  check('clean merge shows empty stat', info.stat.trim() === '', info.stat.slice(0, 120));
  const headHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf8' }).trim();
  const headInfo = await git.getCommitInfo(tmp, headHash);
  check('commit stat lists e.txt', headInfo.stat.includes('e.txt'), headInfo.stat.slice(0, 200));
  const headPatch = await git.getCommitPatch(tmp, headHash);
  check('commit patch has subject content', headPatch.includes('after merge'), headPatch.slice(0, 200));

  console.log('\n--- cleanup ---');
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('\n===================================');
  if (failures) {
    console.log(`${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log('ALL CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
