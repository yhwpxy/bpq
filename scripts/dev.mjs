import { spawn } from 'node:child_process';
const commands = [['backend', ['server.js']], ['frontend', ['../node_modules/vite/bin/vite.js']]];
const children = commands.map(([cwd, args]) => spawn(process.execPath, args, {cwd: new URL(`../${cwd}/`, import.meta.url), stdio:'inherit'}));
let stopping = false;
function stop(code=0) { if (stopping) return; stopping=true; children.forEach(c=>c.kill('SIGTERM')); process.exitCode=code; }
children.forEach(c=>c.on('exit',code=>stop(code || 0)));
process.on('SIGINT',()=>stop()); process.on('SIGTERM',()=>stop());
