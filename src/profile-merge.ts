import { access, cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const COOKIE_COLUMNS = [
  'creation_utc',
  'host_key',
  'top_frame_site_key',
  'name',
  'value',
  'encrypted_value',
  'path',
  'expires_utc',
  'is_secure',
  'is_httponly',
  'last_access_utc',
  'has_expires',
  'is_persistent',
  'priority',
  'samesite',
  'source_scheme',
  'source_port',
  'last_update_utc',
  'source_type',
  'has_cross_site_ancestor'
];

const LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'RunningChromeVersion', 'DevToolsActivePort'];
const SESSION_RESTORE_PATHS = [
  path.join('Default', 'Sessions'),
  path.join('Default', 'Current Session'),
  path.join('Default', 'Current Tabs'),
  path.join('Default', 'Last Session'),
  path.join('Default', 'Last Tabs')
];

type BuildGoldenProfileOptions = {
  baseDir: string;
  overlayDirs: string[];
  targetDir: string;
};

export async function buildGoldenProfile(options: BuildGoldenProfileOptions): Promise<void> {
  const { baseDir, overlayDirs, targetDir } = options;

  await rm(targetDir, { force: true, recursive: true });
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(baseDir, targetDir, { recursive: true, force: true });
  await removeLockFiles(targetDir);
  await removeSessionRestoreArtifacts(targetDir);

  for (const overlayDir of overlayDirs) {
    await mergeCookies(
      path.join(targetDir, 'Default', 'Cookies'),
      path.join(overlayDir, 'Default', 'Cookies')
    );
    await copyMissingOriginDirs(
      path.join(targetDir, 'Default', 'IndexedDB'),
      path.join(overlayDir, 'Default', 'IndexedDB')
    );
  }

  await removeLockFiles(targetDir);
  await removeSessionRestoreArtifacts(targetDir);
}

export async function copyMissingOriginDirs(targetRoot: string, overlayRoot: string): Promise<void> {
  const entries = await readdir(overlayRoot, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const targetPath = path.join(targetRoot, entry.name);
    const overlayPath = path.join(overlayRoot, entry.name);
    const exists = await pathExists(targetPath);
    if (exists) {
      continue;
    }

    await mkdir(targetRoot, { recursive: true });
    await cp(overlayPath, targetPath, { recursive: true, force: true });
  }
}

export async function mergeCookies(targetDbPath: string, overlayDbPath: string): Promise<void> {
  const quotedOverlayPath = overlayDbPath.replaceAll("'", "''");
  const sql = [
    `ATTACH DATABASE '${quotedOverlayPath}' AS overlay_db;`,
    'UPDATE cookies AS target',
    'SET',
    'creation_utc = (SELECT overlay.creation_utc FROM overlay_db.cookies AS overlay WHERE overlay.host_key = target.host_key AND overlay.top_frame_site_key = target.top_frame_site_key AND overlay.has_cross_site_ancestor = target.has_cross_site_ancestor AND overlay.name = target.name AND overlay.path = target.path AND overlay.source_scheme = target.source_scheme AND overlay.source_port = target.source_port),',
    'value = (SELECT overlay.value FROM overlay_db.cookies AS overlay WHERE overlay.host_key = target.host_key AND overlay.top_frame_site_key = target.top_frame_site_key AND overlay.has_cross_site_ancestor = target.has_cross_site_ancestor AND overlay.name = target.name AND overlay.path = target.path AND overlay.source_scheme = target.source_scheme AND overlay.source_port = target.source_port),',
    'encrypted_value = (SELECT overlay.encrypted_value FROM overlay_db.cookies AS overlay WHERE overlay.host_key = target.host_key AND overlay.top_frame_site_key = target.top_frame_site_key AND overlay.has_cross_site_ancestor = target.has_cross_site_ancestor AND overlay.name = target.name AND overlay.path = target.path AND overlay.source_scheme = target.source_scheme AND overlay.source_port = target.source_port),',
    'expires_utc = (SELECT overlay.expires_utc FROM overlay_db.cookies AS overlay WHERE overlay.host_key = target.host_key AND overlay.top_frame_site_key = target.top_frame_site_key AND overlay.has_cross_site_ancestor = target.has_cross_site_ancestor AND overlay.name = target.name AND overlay.path = target.path AND overlay.source_scheme = target.source_scheme AND overlay.source_port = target.source_port),',
    'is_secure = (SELECT overlay.is_secure FROM overlay_db.cookies AS overlay WHERE overlay.host_key = target.host_key AND overlay.top_frame_site_key = target.top_frame_site_key AND overlay.has_cross_site_ancestor = target.has_cross_site_ancestor AND overlay.name = target.name AND overlay.path = target.path AND overlay.source_scheme = target.source_scheme AND overlay.source_port = target.source_port),',
    'is_httponly = (SELECT overlay.is_httponly FROM overlay_db.cookies AS overlay WHERE overlay.host_key = target.host_key AND overlay.top_frame_site_key = target.top_frame_site_key AND overlay.has_cross_site_ancestor = target.has_cross_site_ancestor AND overlay.name = target.name AND overlay.path = target.path AND overlay.source_scheme = target.source_scheme AND overlay.source_port = target.source_port),',
    'last_access_utc = (SELECT overlay.last_access_utc FROM overlay_db.cookies AS overlay WHERE overlay.host_key = target.host_key AND overlay.top_frame_site_key = target.top_frame_site_key AND overlay.has_cross_site_ancestor = target.has_cross_site_ancestor AND overlay.name = target.name AND overlay.path = target.path AND overlay.source_scheme = target.source_scheme AND overlay.source_port = target.source_port),',
    'has_expires = (SELECT overlay.has_expires FROM overlay_db.cookies AS overlay WHERE overlay.host_key = target.host_key AND overlay.top_frame_site_key = target.top_frame_site_key AND overlay.has_cross_site_ancestor = target.has_cross_site_ancestor AND overlay.name = target.name AND overlay.path = target.path AND overlay.source_scheme = target.source_scheme AND overlay.source_port = target.source_port),',
    'is_persistent = (SELECT overlay.is_persistent FROM overlay_db.cookies AS overlay WHERE overlay.host_key = target.host_key AND overlay.top_frame_site_key = target.top_frame_site_key AND overlay.has_cross_site_ancestor = target.has_cross_site_ancestor AND overlay.name = target.name AND overlay.path = target.path AND overlay.source_scheme = target.source_scheme AND overlay.source_port = target.source_port),',
    'priority = (SELECT overlay.priority FROM overlay_db.cookies AS overlay WHERE overlay.host_key = target.host_key AND overlay.top_frame_site_key = target.top_frame_site_key AND overlay.has_cross_site_ancestor = target.has_cross_site_ancestor AND overlay.name = target.name AND overlay.path = target.path AND overlay.source_scheme = target.source_scheme AND overlay.source_port = target.source_port),',
    'samesite = (SELECT overlay.samesite FROM overlay_db.cookies AS overlay WHERE overlay.host_key = target.host_key AND overlay.top_frame_site_key = target.top_frame_site_key AND overlay.has_cross_site_ancestor = target.has_cross_site_ancestor AND overlay.name = target.name AND overlay.path = target.path AND overlay.source_scheme = target.source_scheme AND overlay.source_port = target.source_port),',
    'last_update_utc = (SELECT overlay.last_update_utc FROM overlay_db.cookies AS overlay WHERE overlay.host_key = target.host_key AND overlay.top_frame_site_key = target.top_frame_site_key AND overlay.has_cross_site_ancestor = target.has_cross_site_ancestor AND overlay.name = target.name AND overlay.path = target.path AND overlay.source_scheme = target.source_scheme AND overlay.source_port = target.source_port),',
    'source_type = (SELECT overlay.source_type FROM overlay_db.cookies AS overlay WHERE overlay.host_key = target.host_key AND overlay.top_frame_site_key = target.top_frame_site_key AND overlay.has_cross_site_ancestor = target.has_cross_site_ancestor AND overlay.name = target.name AND overlay.path = target.path AND overlay.source_scheme = target.source_scheme AND overlay.source_port = target.source_port)',
    'WHERE EXISTS (',
    '  SELECT 1 FROM overlay_db.cookies AS overlay',
    '  WHERE overlay.host_key = target.host_key',
    '    AND overlay.top_frame_site_key = target.top_frame_site_key',
    '    AND overlay.has_cross_site_ancestor = target.has_cross_site_ancestor',
    '    AND overlay.name = target.name',
    '    AND overlay.path = target.path',
    '    AND overlay.source_scheme = target.source_scheme',
    '    AND overlay.source_port = target.source_port',
    '    AND overlay.last_update_utc >= target.last_update_utc',
    ');',
    `INSERT OR IGNORE INTO cookies (${COOKIE_COLUMNS.join(', ')})`,
    `SELECT ${COOKIE_COLUMNS.join(', ')} FROM overlay_db.cookies;`,
    'DETACH DATABASE overlay_db;'
  ].join('\n');

  await execFile('sqlite3', [targetDbPath, sql]);
}

export async function removeLockFiles(profileDir: string): Promise<void> {
  await Promise.all(
    LOCK_FILES.map((fileName) => rm(path.join(profileDir, fileName), { force: true, recursive: true }))
  );
}

export async function removeSessionRestoreArtifacts(profileDir: string): Promise<void> {
  await Promise.all(
    SESSION_RESTORE_PATHS.map((relativePath) => rm(path.join(profileDir, relativePath), { force: true, recursive: true }))
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
