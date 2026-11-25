import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createOrchestratorRuntime} from '../src/server/runtime.ts';
import type {
  BootstrapSnapshot,
  RunDetailSnapshot,
  WorkflowDetailSnapshot,
} from '../src/shared/api.ts';

async function run(): Promise<void> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'orch-verify-smoke-'));
  const rendererDir = resolve(import.meta.dirname, '../dist/renderer');
  const runtime = await createOrchestratorRuntime({
    dataDir: tempRoot,
    port: 0,
    staticDir: existsSync(rendererDir) ? rendererDir : null,
    seedSample: true,
  });

  try {
    // 1. Health endpoint open; protected routes fail closed without Bearer token
    const healthResp = await fetch(`${runtime.baseUrl}/api/health`);
    assert.equal(healthResp.status, 200);
    const healthJson = (await healthResp.json()) as {ok: boolean};
    assert.equal(healthJson.ok, true);

    const unauthResp = await fetch(`${runtime.baseUrl}/api/bootstrap`);
    assert.equal(unauthResp.status, 401);

    const headers = {
      Authorization: `Bearer ${runtime.sessionToken}`,
      'Content-Type': 'application/json',
    };

    // 2. Authenticated bootstrap + SSE connectivity check
    const bootResp = await fetch(`${runtime.baseUrl}/api/bootstrap`, {headers});
    assert.equal(bootResp.status, 200);
    const bootstrap = (await bootResp.json()) as BootstrapSnapshot;
    assert.ok(bootstrap.workspaces.length >= 1);
    assert.ok(bootstrap.workflows.length >= 1);
    assert.ok(bootstrap.capabilities.length >= 4);
    assert.ok(bootstrap.designSpecPresets.length >= 3);
    assert.ok(bootstrap.skills.length >= 1);
    assert.ok(bootstrap.mcpServers.length >= 1);
    assert.ok(bootstrap.constitution.blockedCommands.length >= 1);

    const sseAc = new AbortController();
    const sseResp = await fetch(
      `${runtime.baseUrl}/api/events?token=${encodeURIComponent(runtime.sessionToken)}`,
      {signal: sseAc.signal},
    );
    assert.equal(sseResp.status, 200);
    const reader = sseResp.body!.getReader();
    const firstChunk = await reader.read();
    const sseText = new TextDecoder().decode(firstChunk.value);
    assert.ok(sseText.includes('event: connected'));
    sseAc.abort();

    // 3. HTTP pipeline: import PRD -> trial -> confirm v1.0 -> launch run -> inspect evidence
    const importResp = await fetch(
      `${runtime.baseUrl}/api/workflows/import-requirements`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          workspaceId: bootstrap.workspaces[0]!.id,
          title: 'HTTP Smoke Workflow',
          markdown:
            '# Smoke Flow\n## Functional Requirements\n- FR-01: Execute smoke check\n## Acceptance Criteria\n- AC-01: Exit code 0',
          verifyCommand: 'node -e "process.exit(0)"',
          permissionTier: 'supervised',
        }),
      },
    );
    assert.equal(importResp.status, 201);
    const wf = (await importResp.json()) as WorkflowDetailSnapshot;

    const trialResp = await fetch(
      `${runtime.baseUrl}/api/workflows/${wf.workflow.id}/trial`,
      {method: 'POST', headers, body: '{}'},
    );
    assert.equal(trialResp.status, 200);
    const trialed = (await trialResp.json()) as WorkflowDetailSnapshot;
    assert.equal(trialed.latestTrial?.passed, true);

    const confirmResp = await fetch(
      `${runtime.baseUrl}/api/workflows/${wf.workflow.id}/confirm-version`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({label: 'Smoke v1.0', frozenBy: 'smoke-test'}),
      },
    );
    assert.equal(confirmResp.status, 201);

    const runResp = await fetch(`${runtime.baseUrl}/api/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({workflowId: wf.workflow.id}),
    });
    assert.equal(runResp.status, 201);
    const startedRun = (await runResp.json()) as RunDetailSnapshot;

    const deadline = Date.now() + 15_000;
    let finalRun = startedRun;
    while (
      Date.now() < deadline &&
      finalRun.run.status !== 'succeeded' &&
      finalRun.run.status !== 'failed'
    ) {
      await new Promise(resolveDelay => setTimeout(resolveDelay, 60));
      const pollResp = await fetch(
        `${runtime.baseUrl}/api/runs/${startedRun.run.id}`,
        {headers},
      );
      assert.equal(pollResp.status, 200);
      finalRun = (await pollResp.json()) as RunDetailSnapshot;
    }
    assert.equal(finalRun.run.status, 'succeeded');

    const searchResp = await fetch(
      `${runtime.baseUrl}/api/evidence/search?q=Synthesized`,
      {headers},
    );
    assert.equal(searchResp.status, 200);
    const searchJson = (await searchResp.json()) as {
      hits: Array<{id: string}>;
    };
    assert.ok(searchJson.hits.length > 0);

    const exportResp = await fetch(
      `${runtime.baseUrl}/api/workflows/${wf.workflow.id}/export`,
      {headers},
    );
    assert.equal(exportResp.status, 200);
    const exported = (await exportResp.json()) as {
      mermaid: string;
      markdown: string;
    };
    assert.ok(exported.mermaid.includes('flowchart LR'));

    const anchorResp = await fetch(
      `${runtime.baseUrl}/api/workflows/${wf.workflow.id}/review-anchor`,
      {method: 'POST', headers, body: '{}'},
    );
    assert.equal(anchorResp.status, 200);

    const dreamResp = await fetch(`${runtime.baseUrl}/api/dream/consolidate`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    assert.equal(dreamResp.status, 200);

    const probeMcpResp = await fetch(
      `${runtime.baseUrl}/api/mcp-servers/${bootstrap.mcpServers[0]!.id}/probe`,
      {method: 'POST', headers, body: '{}'},
    );
    assert.equal(probeMcpResp.status, 200);

    const doctorResp = await fetch(`${runtime.baseUrl}/api/doctor`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    assert.equal(doctorResp.status, 200);
    const doctorJson = (await doctorResp.json()) as {
      prunedWorktrees: unknown[];
    };
    assert.ok(Array.isArray(doctorJson.prunedWorktrees));

    if (existsSync(rendererDir)) {
      const htmlResp = await fetch(`${runtime.baseUrl}/`);
      assert.equal(htmlResp.status, 200);
      const html = await htmlResp.text();
      assert.ok(html.includes('<div id="root"></div>'));
    }

    console.log(
      '[PASS] fullstack-smoke: HTTP Bearer Auth + SSE + PRD->Trial->Version->Run + Static Bundle',
    );
  } finally {
    await runtime.stop();
    rmSync(tempRoot, {recursive: true, force: true});
  }
}

void run().catch(err => {
  console.error(err);
  process.exit(1);
});
