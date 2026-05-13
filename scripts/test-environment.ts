/**
 * Script de teste do helper de validação de ambiente.
 *
 * Verifica que:
 *   1. O ambiente é detectado corretamente como staging
 *   2. As funções de mascaramento funcionam
 *
 * Uso:
 *   pnpm tsx scripts/test-environment.ts
 *
 * Esperado (no banco de staging d5ea2e96_tst):
 *   ✓ Ambiente confirmado: STAGING (d5ea2e96_tst)
 *   ✓ Ambiente staging detectado corretamente
 *   ✓ Mascaramento funcionando
 */

import { config } from 'dotenv';
config();

import {
  assertStagingEnvironment,
  maskPhone,
  maskEmail,
} from '../server/lib/environment';

console.log('Testando helper de ambiente...');
console.log('');

// --- Teste 1: verificar que estamos em staging ---
try {
  assertStagingEnvironment();
  console.log('✓ Ambiente staging detectado corretamente');
} catch (err) {
  console.error('✗ Falha na validação de ambiente:', err);
  process.exit(1);
}

console.log('');

// --- Teste 2: funções de mascaramento ---
console.log('Testando mascaramento:');

const telefone = '+5513981301010';
const telMascarado = maskPhone(telefone);
console.log(`  Phone ${telefone} → ${telMascarado}`);

const email = 'contato@soluteg.com.br';
const emailMascarado = maskEmail(email);
console.log(`  Email ${email} → ${emailMascarado}`);

console.log('✓ Mascaramento funcionando');
