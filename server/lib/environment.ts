/**
 * Validações de ambiente para operações destrutivas.
 *
 * Este módulo garante que scripts perigosos (migrations, limpezas,
 * resets de dados) só sejam executados no ambiente correto.
 *
 * Como usar:
 *   import { assertStagingEnvironment } from '../lib/environment';
 *   assertStagingEnvironment(); // lança erro se não for staging
 *
 * Chame SEMPRE no topo de qualquer script de migração ou manutenção.
 */

/** Nome do banco de produção — nunca alterar dados aqui sem processo formal */
export const PRODUCTION_DB_NAME = 'd5ea2e96_solutegdb';

/** Nome do banco de staging — ambiente seguro para testes e migrações */
export const STAGING_DB_NAME = 'd5ea2e96_tst';

/**
 * Garante que o script está rodando no ambiente de staging.
 * Lança um erro detalhado se o DB_NAME for produção ou desconhecido.
 * Deve ser chamada no início de qualquer script de migração ou manutenção.
 */
export function assertStagingEnvironment(): void {
  const dbName = process.env.DB_NAME;

  // Sem DB_NAME definido: qualquer operação é perigosa
  if (!dbName) {
    throw new Error('ABORT: DB_NAME não está definido no .env');
  }

  // Tentativa de rodar em produção: bloqueio absoluto
  if (dbName === PRODUCTION_DB_NAME) {
    throw new Error(
      `ABORT CRÍTICO: Este script só pode rodar em staging.\n` +
      `DB_NAME atual: ${dbName}\n` +
      `Para executar em produção, há um processo formal de deploy.`
    );
  }

  // Banco desconhecido (nem produção, nem staging): paramos por precaução
  if (dbName !== STAGING_DB_NAME) {
    throw new Error(
      `ABORT: DB_NAME inesperado: ${dbName}\n` +
      `Esperado: ${STAGING_DB_NAME}`
    );
  }

  console.log(`✓ Ambiente confirmado: STAGING (${dbName})`);
}

/**
 * Garante que o script está rodando no ambiente de produção.
 * Usada em scripts de deploy formal que só devem tocar em produção.
 */
export function assertProductionEnvironment(): void {
  const dbName = process.env.DB_NAME;

  if (dbName !== PRODUCTION_DB_NAME) {
    throw new Error(
      `ABORT: Este script é para produção, mas DB_NAME é: ${dbName}`
    );
  }

  console.log(`✓ Ambiente confirmado: PRODUÇÃO (${dbName})`);
}

/**
 * Mascara número de telefone para logs seguros.
 * Exemplo: "+5513998765432" → "+55139****5432"
 *
 * Nunca logar telefone completo — use esta função em logs de auditoria.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone || phone.length < 8) return '***';
  return phone.slice(0, 6) + '****' + phone.slice(-4);
}

/**
 * Mascara endereço de e-mail para logs seguros.
 * Exemplo: "user@example.com" → "u***@example.com"
 *
 * Nunca logar e-mail completo — use esta função em logs de auditoria.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '***';
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  // Preserva só o primeiro caractere do usuário
  const maskedUser = user.length > 2
    ? user[0] + '***'
    : '***';
  return `${maskedUser}@${domain}`;
}

/**
 * Mascara string genérica para logs seguros.
 * Exemplo: "senha123" → "se***23"
 *
 * Útil para tokens, chaves de API e qualquer valor sensível.
 */
export function maskString(value: string | null | undefined): string {
  if (!value) return '***';
  if (value.length <= 4) return '***';
  return value.slice(0, 2) + '***' + value.slice(-2);
}
