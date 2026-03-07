import { spawn } from 'node:child_process'
import process from 'node:process'
import { PassThrough } from 'node:stream'

import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js'

type StdioServerParameters = {
  command: string
  args?: string[]
  env?: Record<string, string>
  stderr?: 'pipe' | 'overlapped' | 'inherit'
  cwd?: string
}

export const DEFAULT_INHERITED_ENV_VARS = process.platform === 'win32'
  ? [
      'APPDATA',
      'HOMEDRIVE',
      'HOMEPATH',
      'LOCALAPPDATA',
      'PATH',
      'PROCESSOR_ARCHITECTURE',
      'SYSTEMDRIVE',
      'SYSTEMROOT',
      'TEMP',
      'USERNAME',
      'USERPROFILE',
      'PROGRAMFILES'
    ]
  : ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER']

export function getDefaultEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}

  for (const key of DEFAULT_INHERITED_ENV_VARS) {
    const value = process.env[key]
    if (value === undefined || value.startsWith('()')) {
      continue
    }

    env[key] = value
  }

  return env
}

export class JsonRpcLineBuffer {
  private buffer?: Buffer

  append(chunk: Buffer): void {
    this.buffer = this.buffer ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk)
  }

  readMessage(): unknown | null {
    if (!this.buffer) {
      return null
    }

    const index = this.buffer.indexOf('\n')
    if (index === -1) {
      return null
    }

    const line = this.buffer.toString('utf8', 0, index).replace(/\r$/, '')
    const nextOffset = index + 1

    if (nextOffset < this.buffer.length) {
      this.buffer = Buffer.from(this.buffer.subarray(nextOffset))
    } else {
      this.buffer = undefined
    }

    return JSONRPCMessageSchema.parse(JSON.parse(line))
  }

  clear(): void {
    this.buffer = undefined
  }
}

export class StdioClientTransport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: unknown) => void

  private readonly readBuffer = new JsonRpcLineBuffer()
  private readonly stderrStream: PassThrough | null
  private processHandle?: ReturnType<typeof spawn>

  constructor(private readonly serverParams: StdioServerParameters) {
    this.stderrStream = serverParams.stderr === 'pipe' || serverParams.stderr === 'overlapped'
      ? new PassThrough()
      : null
  }

  async start(): Promise<void> {
    if (this.processHandle) {
      throw new Error('StdioClientTransport already started!')
    }

    await new Promise<void>((resolve, reject) => {
      this.processHandle = spawn(this.serverParams.command, this.serverParams.args ?? [], {
        env: {
          ...getDefaultEnvironment(),
          ...this.serverParams.env
        },
        stdio: ['pipe', 'pipe', this.serverParams.stderr ?? 'inherit'],
        shell: false,
        windowsHide: process.platform === 'win32' && isElectron(),
        cwd: this.serverParams.cwd
      })

      this.processHandle.on('error', (error: Error) => {
        reject(error)
        this.onerror?.(error)
      })

      this.processHandle.on('spawn', () => {
        resolve()
      })

      this.processHandle.on('close', () => {
        this.processHandle = undefined
        this.readBuffer.clear()
        this.onclose?.()
      })

      this.processHandle.stdin?.on('error', (error: Error) => {
        this.onerror?.(error)
      })

      this.processHandle.stdout?.on('data', (chunk: Buffer) => {
        this.readBuffer.append(chunk)
        this.processReadBuffer()
      })

      this.processHandle.stdout?.on('error', (error: Error) => {
        this.onerror?.(error)
      })

      if (this.stderrStream && this.processHandle.stderr) {
        this.processHandle.stderr.pipe(this.stderrStream)
      }
    })
  }

  get stderr(): NodeJS.ReadableStream | null {
    return this.stderrStream ?? this.processHandle?.stderr ?? null
  }

  get pid(): number | null {
    return this.processHandle?.pid ?? null
  }

  async close(): Promise<void> {
    if (this.processHandle) {
      const processToClose = this.processHandle
      this.processHandle = undefined
      const closePromise = new Promise<void>((resolve) => {
        processToClose.once('close', () => {
          resolve()
        })
      })

      try {
        processToClose.stdin?.end()
      } catch {
        // ignore
      }

      await Promise.race([closePromise, new Promise((resolve) => setTimeout(resolve, 2000).unref())])

      if (processToClose.exitCode === null) {
        try {
          processToClose.kill('SIGTERM')
        } catch {
          // ignore
        }
        await Promise.race([closePromise, new Promise((resolve) => setTimeout(resolve, 2000).unref())])
      }

      if (processToClose.exitCode === null) {
        try {
          processToClose.kill('SIGKILL')
        } catch {
          // ignore
        }
      }
    }

    this.readBuffer.clear()
  }

  async send(message: unknown): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.processHandle?.stdin) {
        throw new Error('Not connected')
      }

      const json = JSON.stringify(message) + '\n'
      if (this.processHandle.stdin.write(json)) {
        resolve()
      } else {
        this.processHandle.stdin.once('drain', resolve)
      }
    })
  }

  private processReadBuffer(): void {
    while (true) {
      try {
        const message = this.readBuffer.readMessage()
        if (message === null) {
          break
        }

        this.onmessage?.(message)
      } catch (error) {
        this.onerror?.(error as Error)
      }
    }
  }
}

function isElectron(): boolean {
  return 'type' in process
}
