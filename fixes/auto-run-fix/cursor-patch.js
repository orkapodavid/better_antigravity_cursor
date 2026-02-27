#!/usr/bin/env node

/**
 * Cursor "Always Auto-Accept" Patch
 * ==================================
 * 
 * Patches Cursor's shouldAutoRun_runEverythingMode() to always return true,
 * bypassing all approval gates (terminal, MCP, web fetch, file edits).
 * 
 * Usage:
 *   node cursor-patch.js          - Apply patch
 *   node cursor-patch.js --revert - Restore original files
 *   node cursor-patch.js --check  - Check patch status
 * 
 * License: MIT
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Patch Marker ───────────────────────────────────────────────────────────
const PATCH_MARKER = '/*cursor-autorun-patch*/';

// ─── Installation Detection ─────────────────────────────────────────────────

function findCursorPath() {
    const candidates = [];
    if (process.platform === 'win32') {
        candidates.push(
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cursor'),
            path.join(process.env.PROGRAMFILES || '', 'cursor'),
        );
    } else if (process.platform === 'darwin') {
        candidates.push(
            '/Applications/Cursor.app/Contents/Resources',
            path.join(os.homedir(), 'Applications', 'Cursor.app', 'Contents', 'Resources')
        );
    } else {
        candidates.push(
            '/usr/share/cursor',
            '/opt/cursor',
            path.join(os.homedir(), '.local', 'share', 'cursor'),
            // AppImage / extracted locations
            path.join(os.homedir(), '.local', 'lib', 'cursor'),
        );
    }

    for (const c of candidates) {
        const f = path.join(c, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
        if (fs.existsSync(f)) return c;
    }
    return null;
}

// ─── Pattern Definitions ────────────────────────────────────────────────────

/**
 * Cursor's approval architecture has two key methods:
 * 
 * 1. shouldAutoRun_runEverythingMode() — master gate for "run everything" mode
 *    Returns true only when auto-run is enabled AND fullAutoRun is on.
 *    Patching this to return true bypasses ALL approval gates.
 * 
 * 2. shouldAutoRun_eitherUseAllowlistOrRunEverythingMode() — secondary gate
 *    Returns true when auto-run (YOLO mode) is enabled at all.
 *    Patching this as a belt-and-suspenders backup.
 * 
 * Both methods check NH().isDisabledByAdmin first, which we also bypass.
 */
const PATCHES = [
    {
        label: 'shouldAutoRun_runEverythingMode',
        // Match: shouldAutoRun_runEverythingMode(){return NH().isDisabledByAdmin?!1:...}
        // The method body varies but always starts with the admin check
        pattern: /shouldAutoRun_runEverythingMode\(\)\{return\s*\w+\(\)\.isDisabledByAdmin\?\!1:[^}]+\}/,
        replacement: (match) => `shouldAutoRun_runEverythingMode(){return${PATCH_MARKER}!0}`,
        verify: (content) => content.includes(`shouldAutoRun_runEverythingMode(){return${PATCH_MARKER}!0}`),
    },
    {
        label: 'shouldAutoRun_eitherUseAllowlistOrRunEverythingMode',
        // Match: shouldAutoRun_eitherUseAllowlistOrRunEverythingMode(){return NH().isDisabledByAdmin?!1:...}
        pattern: /shouldAutoRun_eitherUseAllowlistOrRunEverythingMode\(\)\{return\s*\w+\(\)\.isDisabledByAdmin\?\!1:[^}]+\}/,
        replacement: (match) => `shouldAutoRun_eitherUseAllowlistOrRunEverythingMode(){return${PATCH_MARKER}!0}`,
        verify: (content) => content.includes(`shouldAutoRun_eitherUseAllowlistOrRunEverythingMode(){return${PATCH_MARKER}!0}`),
    },
];

// ─── File Operations ────────────────────────────────────────────────────────

function patchFile(filePath) {
    if (!fs.existsSync(filePath)) {
        console.log(`  ❌ File not found: ${filePath}`);
        return false;
    }

    console.log(`  📄 Reading ${path.basename(filePath)} (${(fs.statSync(filePath).size / 1024 / 1024).toFixed(1)} MB)...`);
    const content = fs.readFileSync(filePath, 'utf8');

    // Check if already patched
    if (content.includes(PATCH_MARKER)) {
        console.log(`  ⏭️  Already patched`);
        return true;
    }

    let patched = content;
    let patchCount = 0;

    for (const p of PATCHES) {
        const match = patched.match(p.pattern);
        if (!match) {
            console.log(`  ⚠️  [${p.label}] Pattern not found — may be a different Cursor version`);
            continue;
        }

        console.log(`  📋 [${p.label}] Found at offset ${match.index}`);
        console.log(`     Original: ${match[0].substring(0, 80)}...`);

        const newContent = p.replacement(match[0]);
        patched = patched.replace(match[0], newContent);
        console.log(`     Patched:  ${newContent}`);
        patchCount++;
    }

    if (patchCount === 0) {
        console.log(`  ❌ No patchable patterns found. This Cursor version may not be compatible.`);
        return false;
    }

    // Backup
    const bakPath = filePath + '.bak';
    if (!fs.existsSync(bakPath)) {
        fs.copyFileSync(filePath, bakPath);
        console.log(`  📦 Backup created: ${path.basename(bakPath)}`);
    }

    // Write patched content
    fs.writeFileSync(filePath, patched, 'utf8');

    const diff = fs.statSync(filePath).size - fs.statSync(bakPath).size;
    console.log(`  ✅ Patched ${patchCount}/${PATCHES.length} methods (${diff >= 0 ? '+' : ''}${diff} bytes)`);
    return true;
}

function revertFile(filePath) {
    const bakPath = filePath + '.bak';
    if (!fs.existsSync(bakPath)) {
        console.log(`  ⏭️  No backup found, skipping`);
        return;
    }
    fs.copyFileSync(bakPath, filePath);
    console.log(`  ✅ Restored from backup`);
}

function checkFile(filePath) {
    if (!fs.existsSync(filePath)) {
        console.log(`  ❌ Not found: ${filePath}`);
        return false;
    }

    console.log(`  📄 Reading ${path.basename(filePath)} (${(fs.statSync(filePath).size / 1024 / 1024).toFixed(1)} MB)...`);
    const content = fs.readFileSync(filePath, 'utf8');
    const hasBak = fs.existsSync(filePath + '.bak');

    // Check if patched
    if (content.includes(PATCH_MARKER)) {
        let patchedCount = 0;
        for (const p of PATCHES) {
            if (p.verify(content)) {
                console.log(`  ✅ [${p.label}] PATCHED`);
                patchedCount++;
            }
        }
        console.log(`  📊 ${patchedCount}/${PATCHES.length} patches active` + (hasBak ? ' (backup exists)' : ''));
        return true;
    }

    // Check if patchable
    let patchableCount = 0;
    for (const p of PATCHES) {
        const match = content.match(p.pattern);
        if (match) {
            console.log(`  ⬜ [${p.label}] NOT PATCHED (patchable)`);
            patchableCount++;
        } else {
            console.log(`  ⚠️  [${p.label}] Pattern not found (may be incompatible)`);
        }
    }
    console.log(`  📊 ${patchableCount}/${PATCHES.length} patchable` + (hasBak ? ' (backup exists)' : ''));
    return false;
}

// ─── Version Info ───────────────────────────────────────────────────────────

function getVersion(basePath) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(basePath, 'resources', 'app', 'package.json'), 'utf8'));
        return `${pkg.version}`;
    } catch { return 'unknown'; }
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
    const args = process.argv.slice(2);
    const action = args.includes('--revert') ? 'revert'
        : args.includes('--check') ? 'check'
            : 'apply';

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  Cursor "Always Auto-Accept" Patch              ║');
    console.log('║  Patches shouldAutoRun_runEverythingMode()      ║');
    console.log('╚══════════════════════════════════════════════════╝');

    const basePath = findCursorPath();
    if (!basePath) {
        console.log('\n❌ Cursor not found! Make sure Cursor is installed.');
        console.log('   Expected locations:');
        if (process.platform === 'win32') {
            console.log(`   - ${path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cursor')}`);
        } else if (process.platform === 'darwin') {
            console.log('   - /Applications/Cursor.app/Contents/Resources');
        } else {
            console.log('   - /usr/share/cursor or /opt/cursor');
        }
        process.exit(1);
    }

    console.log(`\n📍 ${basePath}`);
    console.log(`📦 Version: ${getVersion(basePath)}`);
    console.log('');

    const workbenchPath = path.join(
        basePath, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js'
    );

    switch (action) {
        case 'check':
            console.log('🔍 Checking patch status...\n');
            checkFile(workbenchPath);
            break;

        case 'revert':
            console.log('🔄 Reverting patch...\n');
            revertFile(workbenchPath);
            console.log('\n✨ Restored! Restart Cursor to take effect.');
            break;

        case 'apply':
            console.log('🔧 Applying patch...\n');
            const ok = patchFile(workbenchPath);
            if (ok) {
                console.log('\n✨ Done! Restart Cursor to take effect.');
                console.log('💡 Run with --revert to undo.');
                console.log('⚠️  Re-run after Cursor updates (patches are overwritten by updates).');
            } else {
                console.log('\n⚠️  Patch failed. This Cursor version may not be compatible.');
            }
            break;
    }
    console.log('');
}

main();
