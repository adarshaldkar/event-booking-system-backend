const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const downloadsDir = path.resolve(process.env.USERPROFILE || 'C:\\Users\\shrut', 'Downloads');
const outputZip = path.join(downloadsDir, 'event-booking-system-backend.zip');

console.log(`📦 Packaging clean project archive to: ${outputZip}`);

// Using PowerShell Compress-Archive excluding node_modules, .git, dist, .env
const tempStagingDir = path.join(rootDir, '.staging_zip');
if (fs.existsSync(tempStagingDir)) {
  fs.rmSync(tempStagingDir, { recursive: true, force: true });
}
fs.mkdirSync(tempStagingDir, { recursive: true });

const ignored = new Set([
  'node_modules',
  '.git',
  'dist',
  '.env',
  '.staging_zip',
  'coverage',
  '.vitest',
]);

function copyDirRecursive(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (ignored.has(entry.name) || entry.name.endsWith('.zip')) {
      continue;
    }
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDirRecursive(rootDir, tempStagingDir);

// Verify .env is strictly NOT in staging
if (fs.existsSync(path.join(tempStagingDir, '.env'))) {
  fs.unlinkSync(path.join(tempStagingDir, '.env'));
}

if (fs.existsSync(outputZip)) {
  fs.unlinkSync(outputZip);
}

// Compress staging dir to destination
const powershellCmd = `powershell -Command "Compress-Archive -Path '${tempStagingDir}\\*' -DestinationPath '${outputZip}' -Force"`;
execSync(powershellCmd, { stdio: 'inherit' });

// Cleanup staging
fs.rmSync(tempStagingDir, { recursive: true, force: true });

console.log(`✅ Clean zip created successfully at: ${outputZip}`);
