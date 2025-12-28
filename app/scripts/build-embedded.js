/**
 * Build script that embeds Azure credentials from .env into the application
 * Usage: node scripts/build-embedded.js
 * 
 * This creates a standalone executable that doesn't require environment variables
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Load .env file
const envPath = path.join(__dirname, '..', '.env');

if (!fs.existsSync(envPath)) {
  console.error('❌ Error: .env file not found!');
  console.error('   Please copy env.example to .env and fill in your Azure credentials.');
  process.exit(1);
}

// Parse .env file
const envContent = fs.readFileSync(envPath, 'utf-8');
const envVars = {};

envContent.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const [key, ...valueParts] = trimmed.split('=');
    if (key && valueParts.length > 0) {
      envVars[key.trim()] = valueParts.join('=').trim();
    }
  }
});

const speechKey = envVars.SPEECH_KEY;
const speechRegion = envVars.SPEECH_REGION;

if (!speechKey || speechKey === 'your_azure_speech_key_here') {
  console.error('❌ Error: SPEECH_KEY not set in .env file');
  process.exit(1);
}

if (!speechRegion || speechRegion === 'your_azure_region_here') {
  console.error('❌ Error: SPEECH_REGION not set in .env file');
  process.exit(1);
}

console.log('✅ Found Azure credentials in .env');
console.log(`   Region: ${speechRegion}`);
console.log(`   Key: ${speechKey.substring(0, 8)}...${speechKey.substring(speechKey.length - 4)}`);

// Create embedded config JSON file in dist-electron after build
// But first we need to make sure the folder exists or we write it to electron/ and let it be copied
const configContent = JSON.stringify({
  SPEECH_KEY: speechKey,
  SPEECH_REGION: speechRegion
}, null, 2);

const electronSrcPath = path.join(__dirname, '..', 'electron', 'embedded-config.json');
fs.writeFileSync(electronSrcPath, configContent);
console.log('✅ Generated temporary embedded-config.json in electron/');

// Run the build
console.log('\n📦 Building application...\n');

try {
  execSync('npm run build', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  
  // After build, also copy the JSON to dist-electron if it's not there
  const distPath = path.join(__dirname, '..', 'dist-electron', 'embedded-config.json');
  fs.writeFileSync(distPath, configContent);
  console.log('✅ Injected embedded-config.json into dist-electron/');
  
  console.log('\n✅ Build completed');
} catch (error) {
  console.error('❌ Build failed');
  process.exit(1);
} finally {
  // Clean up the temporary secret file in source folder
  if (fs.existsSync(electronSrcPath)) {
    fs.unlinkSync(electronSrcPath);
    console.log('🧹 Cleaned up temporary secret file from source');
  }
}

// Run electron-builder
console.log('\n📦 Packaging application...\n');

try {
  execSync('npx electron-builder --win portable', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  console.log('\n✅ Packaging completed');
} catch (error) {
  console.error('❌ Packaging failed');
  process.exit(1);
}

console.log('\n🎉 Embedded build complete!');
console.log('   Output: release/Meeting Translator-1.0.0-portable.exe');
console.log('\n⚠️  Warning: Do not distribute this exe publicly as it contains your API key.');
