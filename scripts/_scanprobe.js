const git = require('../src/main/git');
(async () => {
  const t0 = Date.now();
  const found = await git.scanForRepos('E:\\SCRIPTS', 12);
  console.log('found=' + found.length + ' elapsedMs=' + (Date.now() - t0));
  for (const r of found) {
    const rel = r.path.slice('E:\\SCRIPTS'.length).replace(/^[\\/]+/, '');
    const depth = rel.split(/[\\/]/).length;
    console.log(depth + '\t' + r.path);
  }
})().catch((e) => { console.error(e); process.exit(1); });
