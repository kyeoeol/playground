// Starts the Vite dev server, then opens it in Electron (hot reload works as in the browser).
// Quits the dev server when the Electron window closes.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron'; // the path to the Electron binary

const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];
server.printUrls();

const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
