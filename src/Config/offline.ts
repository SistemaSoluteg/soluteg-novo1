/**
 * Flags de configuração do modo offline.
 * Altere aqui para ligar/desligar funcionalidades sem mexer no código de produção.
 */

// Compressão de fotos antes de salvar no IndexedDB.
// Desligado por padrão — ligar se o armazenamento local ficar cheio com frequência.
// Quando ligado, reduz fotos para maxWidth=1920px e qualidade JPEG 0.85.
export const COMPRESS_PHOTOS = false;
