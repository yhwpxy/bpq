import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const env = {...process.env, ORCH_OFFLINE_VERIFY: '1'};
for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'OPENCODE_API_KEY']) delete env[key];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (command, args) => {
  const result = spawnSync(command, args, {cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' && command === npm});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run(process.execPath, ['scripts/verify-reference.mjs']);
if (process.argv[2] !== 'tests') {
  run(npm, ['--prefix', 'workflow-orchestrator', 'run', 'typecheck']);
  run(npm, ['--prefix', 'workflow-orchestrator', 'run', 'build']);
}
run(npm, ['--prefix', 'workflow-orchestrator', 'run', 'verify:gates']);
run(process.execPath, ['--experimental-transform-types', '--test',
  'requirements-engineering/verify/hama.test.ts',
  ...readdirSync(resolve(root, 'software-design/verify')).filter(f => f.endsWith('.test.ts')).sort().map(f => `software-design/verify/${f}`),
]);
