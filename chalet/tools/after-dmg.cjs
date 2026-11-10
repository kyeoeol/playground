// electron-builder afterAllArtifactBuild hook: recompresses the DMG with LZMA (ULMO).
// electron-builder only offers zlib (UDZO) or lzfse (ULFO). For the Electron binary
// LZMA is about 25% smaller. ULMO opens on macOS 10.15 and later (Electron needs 12+).
const { execFileSync } = require('node:child_process');
const { renameSync } = require('node:fs');

module.exports = async function afterAllArtifactBuild(result) {
  for (const file of result.artifactPaths.filter((p) => p.endsWith('.dmg'))) {
    const tmp = file.replace(/\.dmg$/, '.ulmo.dmg');
    execFileSync('hdiutil', ['convert', file, '-format', 'ULMO', '-o', tmp, '-ov', '-quiet']);
    renameSync(tmp, file);
  }
  return [];
};
