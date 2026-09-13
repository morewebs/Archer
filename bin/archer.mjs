#!/usr/bin/env node

/**
 * Archer CLI
 * Command-line runner for validating and compiling Archer architecture mindmaps.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpec } from '../src/validator.js';
import { compileArcher } from '../src/compiler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RECIPES_DIR = path.join(__dirname, '..', 'recipes');

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
Archer - Enterprise Architecture Mindmap Compiler

Usage:
  archer validate <spec.json> [--json]
  archer build <spec.json> [-o <output.html>]
  archer recipe <name> [-o <output.json>]
  archer list-recipes
  archer --help

Commands:
  validate       Check specification syntax, schema rules, cycles, and integrity
  build          Compile specification into zero-dependency standalone HTML
  recipe         Scaffold candidate specification from a built-in enterprise recipe
  list-recipes   Display available built-in enterprise recipes
`);
}

function getAvailableRecipes() {
  if (!fs.existsSync(RECIPES_DIR)) return [];
  return fs.readdirSync(RECIPES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''));
}

async function main() {
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    process.exit(0);
  }

  if (command === 'list-recipes') {
    const recipes = getAvailableRecipes();
    console.log('\nAvailable Archer Enterprise Recipes:');
    recipes.forEach(r => console.log(`  - ${r}`));
    console.log('\nUse: archer recipe <name> -o my-diagram.json\n');
    process.exit(0);
  }

  if (command === 'recipe') {
    const recipeName = args[1];
    if (!recipeName) {
      console.error('Error: Recipe name required. Run "archer list-recipes" to see options.');
      process.exit(1);
    }

    const recipeFile = path.join(RECIPES_DIR, `${recipeName}.json`);
    if (!fs.existsSync(recipeFile)) {
      console.error(`Error: Unknown recipe "${recipeName}".`);
      console.error(`Available recipes: ${getAvailableRecipes().join(', ')}`);
      process.exit(1);
    }

    let outPath = `${recipeName}.json`;
    const oIdx = args.indexOf('-o');
    if (oIdx !== -1 && args[oIdx + 1]) {
      outPath = args[oIdx + 1];
    }

    const content = fs.readFileSync(recipeFile, 'utf8');
    const resolvedOut = path.resolve(outPath);
    const dir = path.dirname(resolvedOut);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(resolvedOut, content, 'utf8');
    console.log(`[Archer] Recipe "${recipeName}" written to ${outPath}`);
    process.exit(0);
  }

  if (command === 'validate') {
    const specPath = args[1];
    const isJson = args.includes('--json');

    if (!specPath || specPath.startsWith('-')) {
      if (isJson) {
        console.log(JSON.stringify({ valid: false, errors: ['Specification file path is required.'] }));
      } else {
        console.error('Error: Specification file path is required.');
      }
      process.exit(1);
    }

    if (!fs.existsSync(specPath)) {
      if (isJson) {
        console.log(JSON.stringify({ valid: false, errors: [`File not found: ${specPath}`] }));
      } else {
        console.error(`Error: File not found: ${specPath}`);
      }
      process.exit(1);
    }

    let spec;
    try {
      spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    } catch (e) {
      if (isJson) {
        console.log(JSON.stringify({ valid: false, errors: [`JSON Parse error: ${e.message}`] }));
      } else {
        console.error(`Error: Invalid JSON syntax in ${specPath}: ${e.message}`);
      }
      process.exit(1);
    }

    const receipt = validateSpec(spec);

    if (isJson) {
      console.log(JSON.stringify(receipt, null, 2));
      process.exit(receipt.valid ? 0 : 1);
    }

    if (receipt.valid) {
      console.log('\n[Archer Validation Receipt]');
      console.log(`  Status: PASS (0 errors)`);
      console.log(`  Nodes: ${receipt.stats.nodeCount} | Edges: ${receipt.stats.edgeCount} | Boundaries: ${receipt.stats.boundaryCount}`);
      if (receipt.warnings.length > 0) {
        console.log('\n  Warnings:');
        receipt.warnings.forEach(w => console.log(`   * ${w}`));
      }
      console.log('');
      process.exit(0);
    } else {
      console.error('\n[Archer Validation Receipt]');
      console.error(`  Status: FAIL (${receipt.errors.length} errors)`);
      receipt.errors.forEach(e => console.error(`   x ${e}`));
      if (receipt.warnings.length > 0) {
        console.error('\n  Warnings:');
        receipt.warnings.forEach(w => console.error(`   * ${w}`));
      }
      console.error('');
      process.exit(1);
    }
  }

  if (command === 'build') {
    const specPath = args[1];
    if (!specPath) {
      console.error('Error: Specification file path is required.');
      process.exit(1);
    }

    if (!fs.existsSync(specPath)) {
      console.error(`Error: File not found: ${specPath}`);
      process.exit(1);
    }

    let outPath = specPath.replace(/\.json$/, '') + '.html';
    const oIdx = args.indexOf('-o');
    if (oIdx !== -1 && args[oIdx + 1]) {
      outPath = args[oIdx + 1];
    }

    let spec;
    try {
      spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    } catch (e) {
      console.error(`Error: Invalid JSON syntax in ${specPath}: ${e.message}`);
      process.exit(1);
    }

    try {
      compileArcher(spec, outPath);
      console.log(`[Archer Build Success] Standalone HTML created: ${outPath}`);
      process.exit(0);
    } catch (e) {
      console.error(`[Archer Build Error] ${e.message}`);
      process.exit(1);
    }
  }

  console.error(`Unknown command: "${command}". Run "archer --help" for usage.`);
  process.exit(1);
}

main().catch(err => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
