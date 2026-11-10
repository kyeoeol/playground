/*
 * Folder browsing for the in-app folder picker (pickFolder in src/village/Dialogs.js), in
 * place of the system's open dialog. The page asks for one folder's subfolders at a time;
 * each comes marked with the house it already belongs to, if any (one folder, one house).
 */
import { conflictChecker } from './rex.js';
import { listFolder, listError } from './listFolder.js';

export function makeFolderChannels() {
  return {
    'folder:list': async ({ reqId, path, prefix }, reply) => {
      try {
        reply('folder:listed', { reqId, ...(await listFolder(path, conflictChecker(), prefix || '')) });
      } catch (e) {
        reply('folder:listed', { reqId, error: listError(e) });
      }
    },
  };
}
