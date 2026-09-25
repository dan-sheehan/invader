// Builds next-invader.app for this Mac, to open from the Finder or the Dock
// without a terminal: `npm run app`. It lands in dist/, inside this folder,
// and is not installed, moved or published anywhere.
//
// The app is Electron, from the copy npm already downloaded, with this
// folder's main/ and window/ and only the packages the app runs on,
// node-pty's own build for this Mac among them. It keeps next-invader's
// name, and so its own data folder, apart from invader's. It is signed only
// for this computer (ad hoc), so macOS will open it here; it is not signed to
// be given to anyone else.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist');
const pkg = require('./package.json');

// What goes in: everything the app reads when it runs, and nothing else.
const KEEP_TOP = new Set(['package.json', 'main', 'window', 'icon.png', 'node_modules', 'LICENSE']);
function ignore(file) {
  if (!file) return false;
  const parts = file.split('/').filter(Boolean);
  if (!KEEP_TOP.has(parts[0])) return true;
  const name = parts.at(-1);
  if (name === '.DS_Store') return true;
  if (/\.test\.js$/.test(name)) return true;
  // The app tests' driver runs only from the tests.
  if (parts[0] === 'main' && /^drive(-scenarios)?\.js$/.test(name)) return true;
  // node-pty's builds for other computers.
  if (parts.includes('prebuilds') && parts.length > parts.indexOf('prebuilds') + 1 && parts[parts.indexOf('prebuilds') + 1] !== 'darwin-' + process.arch) return true;
  return false;
}

// The rocket as a macOS icon, made from icon.png with the Mac's own tools.
function makeIcon(dir) {
  const set = path.join(dir, 'next-invader.iconset');
  fs.mkdirSync(set);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const px = size * scale;
      const name = 'icon_' + size + 'x' + size + (scale === 2 ? '@2x' : '') + '.png';
      execFileSync('/usr/bin/sips', ['-z', String(px), String(px), path.join(ROOT, 'icon.png'), '--out', path.join(set, name)], { stdio: 'ignore' });
    }
  }
  const icns = path.join(dir, 'next-invader.icns');
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', set, '-o', icns]);
  return icns;
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('npm run app builds the Mac app, on a Mac.');
  const { packager } = await import('@electron/packager');
  const electronVersion = require('electron/package.json').version;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'next-invader-pack-'));
  try {
    const icon = makeIcon(tmp);
    const [appDir] = await packager({
      dir: ROOT,
      out: OUT,
      name: pkg.productName,
      executableName: pkg.productName,
      appBundleId: 'local.next-invader',
      appCategoryType: 'public.app-category.developer-tools',
      platform: 'darwin',
      arch: process.arch,
      electronVersion,
      icon,
      overwrite: true,
      prune: true,
      asar: false,
      ignore,
      quiet: true,
    });
    const app = path.join(appDir, pkg.productName + '.app');
    // Checks that the parts the app cannot run without are there.
    const res = path.join(app, 'Contents', 'Resources', 'app');
    for (const need of ['main/main.js', 'window/index.html', 'node_modules/node-pty/prebuilds/darwin-' + process.arch + '/pty.node', 'node_modules/@xterm/xterm/lib/xterm.js', 'node_modules/marked']) {
      if (!fs.existsSync(path.join(res, need))) throw new Error('The app was built without ' + need);
    }
    // What pruning leaves behind: links to programs it removed, npm's own
    // list, and emptied folders.
    const mods = path.join(res, 'node_modules');
    fs.rmSync(path.join(mods, '.bin'), { recursive: true, force: true });
    fs.rmSync(path.join(mods, '.package-lock.json'), { force: true });
    for (const name of fs.readdirSync(mods)) {
      const dir = path.join(mods, name);
      if (name.startsWith('@') && fs.statSync(dir).isDirectory() && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
    }
    const helper = path.join(res, 'node_modules/node-pty/prebuilds/darwin-' + process.arch + '/spawn-helper');
    fs.chmodSync(helper, 0o755);
    for (const left of ['node_modules/electron', 'node_modules/@electron/packager', 'bench', 'kit']) {
      if (fs.existsSync(path.join(res, left))) throw new Error('The app was built with ' + left + ', which it does not need');
    }
    // Signed for this computer only, so macOS opens it here.
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
    console.log('Built ' + path.relative(ROOT, app));
    console.log('Open it from the Finder, or with: open ' + JSON.stringify(path.relative(ROOT, app)));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
