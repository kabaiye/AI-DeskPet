#!/usr/bin/env node

const { spawn } = require('child_process');
const os = require('os');

// Get command line arguments
const args = process.argv.slice(2);
const isDev = args.includes('--dev');

console.log('🚀 Starting XiaoHeiCat...');
console.log(`Platform: ${os.platform()}`);
console.log(`Mode: ${isDev ? 'Development' : 'Production'}`);

if (os.platform() === 'win32') {
  console.log('🔧 Setting Windows console encoding...');
  
  // Windows: Use PowerShell to set encoding and start Electron
  const psCommand = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;',
    '[Console]::InputEncoding = [System.Text.Encoding]::UTF8;',
    'chcp 65001;',
    `electron .${isDev ? ' --dev' : ''}`
  ].join(' ');
  
  const electron = spawn('powershell', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command', psCommand
  ], {
    stdio: 'inherit',
    shell: true
  });
  
  electron.on('error', (err) => {
    console.error('❌ Failed to start Electron:', err.message);
    process.exit(1);
  });
  
  electron.on('exit', (code) => {
    console.log(`\n👋 XiaoHeiCat exited with code ${code}`);
    process.exit(code);
  });
  
} else {
  console.log('🔧 Starting Electron directly...');
  
  // Non-Windows: Start Electron directly
  const electron = spawn('electron', [
    '.',
    ...(isDev ? ['--dev'] : [])
  ], {
    stdio: 'inherit',
    shell: true
  });
  
  electron.on('error', (err) => {
    console.error('❌ Failed to start Electron:', err.message);
    process.exit(1);
  });
  
  electron.on('exit', (code) => {
    console.log(`\n👋 XiaoHeiCat exited with code ${code}`);
    process.exit(code);
  });
}
