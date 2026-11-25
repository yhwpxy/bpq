import {contextBridge} from 'electron';

function readArg(prefix: string): string {
  const hit = process.argv.find(a => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

contextBridge.exposeInMainWorld('workflowOrchestrator', {
  apiBaseUrl: readArg('--orch-api='),
  sessionToken: readArg('--orch-token='),
  platform: process.platform,
});
