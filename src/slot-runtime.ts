import { createWriteStream, WriteStream } from 'node:fs'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { CompatibilityCallToolResultSchema, ListRootsRequestSchema, type Root, type Tool } from '@modelcontextprotocol/sdk/types.js'

import { extractTabIndices } from './browser-tabs.js'
import { buildSlotPaths } from './config.js'
import { buildForwardedRootsSignature, ForwardedRootsState } from './forwarded-roots.js'
import { killProfileProcesses } from './profile-process.js'
import { StdioClientTransport } from './stdio-client-transport.js'
import type { PlaywrightPoolConfig, ToolCallResult } from './types.js'

type SlotHandle = {
  client: Client
  fallbackRootPath: string
  forwardedRoots: ForwardedRootsState
  logStream: WriteStream
  pid: number | null
  profileDir: string
  release: () => void
  rootsSignature: string
  transport: StdioClientTransport
}

export type SlotRuntimeStatus = {
  slotId: number
  started: boolean
  pid: number | null
  logFile: string
}

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url))
const SLOT_SERVER_JS_PATH = path.join(CURRENT_DIR, 'slot-server.js')
const SLOT_SERVER_TS_PATH = path.join(CURRENT_DIR, 'slot-server.ts')

type SlotLaunchTarget = {
  command: string
  args: string[]
  cwd: string
}

export class SlotRuntime {
  private readonly clients = new Map<number, SlotHandle>()

  constructor(
    private readonly config: PlaywrightPoolConfig,
    private readonly configPath: string
  ) {}

  async discoverTools(): Promise<Tool[]> {
    const temporaryHandle = await this.startClient(1, [])
    try {
      const result = await temporaryHandle.client.listTools()
      return result.tools
    } finally {
      await this.stopClient(temporaryHandle)
    }
  }

  async callTool(
    slotId: number,
    toolName: string,
    args: Record<string, unknown>,
    roots: Root[] = []
  ): Promise<ToolCallResult> {
    const handle = await this.ensureClient(slotId, roots)
    const result = await handle.client.callTool(
      {
        name: toolName,
        arguments: args
      },
      CompatibilityCallToolResultSchema
    )

    return result as ToolCallResult
  }

  listStatuses(): SlotRuntimeStatus[] {
    return Array.from({ length: this.config.pool.size }, (_, index) => {
      const slotId = index + 1
      const slotPaths = buildSlotPaths(this.config.pool, slotId)
      const handle = this.clients.get(slotId)

      return {
        slotId,
        started: this.clients.has(slotId),
        pid: handle?.pid ?? null,
        logFile: slotPaths.logFile
      }
    })
  }

  async closeAll(): Promise<void> {
    const handles = Array.from(this.clients.values())
    this.clients.clear()
    await Promise.all(handles.map((handle) => this.stopClient(handle)))
  }

  private async ensureClient(slotId: number, roots: Root[]): Promise<SlotHandle> {
    const existingHandle = this.clients.get(slotId)
    if (existingHandle) {
      const nextRootsSignature = buildForwardedRootsSignature(roots, existingHandle.fallbackRootPath)
      if (nextRootsSignature === existingHandle.rootsSignature) {
        return existingHandle
      }

      this.clients.delete(slotId)
      await this.stopClient(existingHandle)
    }

    const handle = await this.startClient(slotId, roots)
    this.clients.set(slotId, handle)
    return handle
  }

  private async startClient(slotId: number, roots: Root[]): Promise<SlotHandle> {
    const slotPaths = buildSlotPaths(this.config.pool, slotId)
    await Promise.all([
      mkdir(slotPaths.profileDir, { recursive: true }),
      mkdir(slotPaths.outputDir, { recursive: true }),
      mkdir(path.dirname(slotPaths.logFile), { recursive: true })
    ])

    const launchTarget = await this.resolveLaunchTarget(slotId)
    const forwardedRoots = new ForwardedRootsState(launchTarget.cwd, roots)
    const transport = new StdioClientTransport({
      command: launchTarget.command,
      args: launchTarget.args,
      cwd: launchTarget.cwd,
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      ),
      stderr: 'pipe'
    })
    const logStream = createWriteStream(slotPaths.logFile, { flags: 'a' })
    const stderrStream = transport.stderr
    stderrStream?.pipe(logStream)

    const client = new Client(
      {
        name: 'playwright-pool',
        version: '0.1.0'
      },
      {
        capabilities: {
          roots: {}
        }
      }
    )
    client.setRequestHandler(ListRootsRequestSchema, async () => {
      return {
        roots: forwardedRoots.list()
      }
    })

    let handle: SlotHandle | null = null
    let released = false
    const releaseHandle = () => {
      if (released) {
        return
      }

      released = true
      stderrStream?.unpipe(logStream)
      logStream.end()
      if (handle && this.clients.get(slotId) === handle) {
        this.clients.delete(slotId)
      }
    }

    transport.onclose = () => {
      releaseHandle()
    }

    await client.connect(transport)

    handle = {
      client,
      fallbackRootPath: launchTarget.cwd,
      forwardedRoots,
      logStream,
      pid: transport.pid,
      profileDir: slotPaths.profileDir,
      release: releaseHandle,
      rootsSignature: forwardedRoots.signature(),
      transport
    }

    return handle
  }

  private async stopClient(handle: SlotHandle): Promise<void> {
    const tabs = await handle.client
      .callTool(
        {
          name: 'browser_tabs',
          arguments: {
            action: 'list'
          }
        },
        CompatibilityCallToolResultSchema
      )
      .then((result) => extractTabIndices(result as ToolCallResult))
      .catch(() => [])

    for (const index of tabs) {
      await handle.client
        .callTool(
          {
            name: 'browser_tabs',
            arguments: {
              action: 'close',
              index
            }
          },
          CompatibilityCallToolResultSchema
        )
        .catch(() => undefined)
    }

    await handle.client.close().catch(() => undefined)
    await killProfileProcesses(handle.profileDir)
    handle.release()
  }

  private async resolveLaunchTarget(slotId: number): Promise<SlotLaunchTarget> {
    if (await this.pathExists(SLOT_SERVER_JS_PATH)) {
      return {
        command: process.execPath,
        args: [SLOT_SERVER_JS_PATH, '--config', this.configPath, '--slot', String(slotId)],
        cwd: CURRENT_DIR
      }
    }

    if (await this.pathExists(SLOT_SERVER_TS_PATH)) {
      const projectRoot = path.resolve(CURRENT_DIR, '..')
      return {
        command: process.execPath,
        args: ['--import', 'tsx', SLOT_SERVER_TS_PATH, '--config', this.configPath, '--slot', String(slotId)],
        cwd: projectRoot
      }
    }

    throw new Error(`未找到 slot-server 入口文件，已检查 ${SLOT_SERVER_JS_PATH} 和 ${SLOT_SERVER_TS_PATH}`)
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath)
      return true
    } catch {
      return false
    }
  }
}
