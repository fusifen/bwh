// Temporary diagnostic probe. Delete after use.
// Wraps destructive fs calls so the last log line identifies the hang point.
import fs from 'node:fs';

const LOG = 'D:/Bwh/stellar-shell/.fs-probe.log';
const t0 = Date.now();

function log(line) {
  try {
    fs.appendFileSync(LOG, `${Date.now() - t0}ms ${line}\n`);
  } catch {}
}

log('probe loaded');

for (const name of ['rmSync', 'rmdirSync', 'unlinkSync', 'renameSync']) {
  const orig = fs[name];
  if (typeof orig !== 'function') continue;
  fs[name] = function (...args) {
    log(`${name} START ${String(args[0])}`);
    const result = orig.apply(this, args);
    log(`${name} END   ${String(args[0])}`);
    return result;
  };
}

const p = fs.promises;
for (const name of ['rm', 'rmdir', 'unlink', 'rename']) {
  const orig = p[name];
  if (typeof orig !== 'function') continue;
  p[name] = async function (...args) {
    log(`promises.${name} START ${String(args[0])}`);
    const result = await orig.apply(this, args);
    log(`promises.${name} END   ${String(args[0])}`);
    return result;
  };
}
