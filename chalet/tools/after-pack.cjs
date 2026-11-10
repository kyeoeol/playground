// electron-builder afterPack hook: removes Electron parts this app never uses, before signing.
const { rmSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const libs = join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries');
  // SwiftShader is Chromium's software (CPU) GPU fallback, about 16 MB. Chromium loads it at
  // runtime only when it has no real GPU and is started with --enable-unsafe-swiftshader,
  // so every Mac uses its Metal GPU instead. Nothing links to it.
  for (const f of ['libvk_swiftshader.dylib', 'vk_swiftshader_icd.json']) {
    rmSync(join(libs, f), { force: true });
  }
};
