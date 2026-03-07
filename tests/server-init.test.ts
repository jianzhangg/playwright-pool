import { describe, expect, it, vi } from 'vitest';

import { runInitCommand } from '../src/server.js';

const edgeWizardResult = {
  browser: 'edge' as const,
  browserChannel: 'msedge' as const,
  browserExecutablePath: 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  configPath: 'D:/Users/alice/Documents/playwright-pool/config.toml',
  runtimeRoot: 'D:/Users/alice/Documents/playwright-pool',
  sourceProfileDir: 'D:/Profiles/Edge',
  size: 3
};

describe('runInitCommand', () => {
  it('init 命令会先运行向导，再把结果交给 initializePlaywrightPool', async () => {
    const io = {
      readLine: vi.fn(),
      writeLine: vi.fn(),
      close: vi.fn()
    };
    const runInitWizard = vi.fn().mockResolvedValue(edgeWizardResult);
    const initializePlaywrightPool = vi.fn().mockResolvedValue(edgeWizardResult);
    const writeOutput = vi.fn();

    await runInitCommand(
      {
        force: 'true'
      },
      {
        createWizardIO: () => io,
        runInitWizard,
        initializePlaywrightPool,
        writeOutput
      }
    );

    expect(runInitWizard).toHaveBeenCalledWith(io, {
      initialConfigPath: undefined
    });
    expect(initializePlaywrightPool).toHaveBeenCalledWith({
      configPath: edgeWizardResult.configPath,
      force: true,
      size: edgeWizardResult.size,
      browser: edgeWizardResult.browser,
      browserChannel: edgeWizardResult.browserChannel,
      sourceProfileDir: edgeWizardResult.sourceProfileDir,
      browserExecutablePath: edgeWizardResult.browserExecutablePath
    });
    expect(writeOutput).toHaveBeenCalledTimes(1);
    expect(writeOutput.mock.calls[0]?.[0]).toContain('playwright_pool 初始化完成');
    expect(writeOutput.mock.calls[0]?.[0]).toContain('浏览器可执行文件');
    expect(writeOutput.mock.calls[0]?.[0]).toContain(edgeWizardResult.sourceProfileDir);
    expect(io.close).toHaveBeenCalledTimes(1);
  });

  it('用户取消向导后不会继续初始化', async () => {
    const io = {
      readLine: vi.fn(),
      writeLine: vi.fn(),
      close: vi.fn()
    };
    const runInitWizard = vi.fn().mockResolvedValue(null);
    const initializePlaywrightPool = vi.fn();
    const writeOutput = vi.fn();

    await runInitCommand(
      {},
      {
        createWizardIO: () => io,
        runInitWizard,
        initializePlaywrightPool,
        writeOutput
      }
    );

    expect(initializePlaywrightPool).not.toHaveBeenCalled();
    expect(writeOutput).not.toHaveBeenCalled();
    expect(io.close).toHaveBeenCalledTimes(1);
  });
});
