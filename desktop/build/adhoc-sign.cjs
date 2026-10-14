// electron-builder afterPack hook: without an Apple developer certificate the
// Mac app is left unsigned, and Apple Silicon Macs report an unsigned app as
// "damaged". An ad-hoc signature fixes that; macOS then only asks you to
// allow it once (System Settings → Privacy & Security → Open Anyway).
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
};
