export type ParsedCliInput = {
  command?: string;
  args: Record<string, string>;
};

export function parseCliArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current?.startsWith('--')) {
      continue;
    }

    const [rawKey = '', inlineValue] = current.slice(2).split('=');
    const key = rawKey.trim();
    if (!key) {
      continue;
    }

    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
      continue;
    }

    args[key] = 'true';
  }

  return args;
}

export function parseCliInput(argv: string[]): ParsedCliInput {
  const [firstArg] = argv;
  const command = firstArg && !firstArg.startsWith('--') ? firstArg : undefined;
  const args = parseCliArgs(command ? argv.slice(1) : argv);

  return {
    command,
    args
  };
}
