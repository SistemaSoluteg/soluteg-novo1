# Guia de Deployment do Soluteg

Este documento descreve como fazer deploy das alterações do Soluteg no VPS.

## Informações do VPS

| Informação | Valor |
|-----------|-------|
| **Host** | 129.121.36.243 |
| **Porta SSH** | 22022 |
| **Usuário** | root |
| **Diretório da App** | /var/www/soluteg/backend |
| **Processo PM2** | soluteg-sistema |
| **Domínio** | app.soluteg.com.br |
| **Banco de Dados** | MySQL em 69.6.213.57:3306 |


### 2. Conectar ao VPS

```bash
ssh -p 22022 root@129.121.36.243
```

### 3. Atualizar o Código

```bash
cd /var/www/soluteg/backend

### 4. Instalar Dependências

```bash
pnpm install
```

### 6. Reiniciar a Aplicação

```bash
# Parar a aplicação
pm2 stop soluteg-sistema

# Iniciar a aplicação
pm2 start soluteg-sistema

# Verificar status
pm2 status soluteg-sistema

# Ver logs
pm2 logs soluteg-sistema
```

## Verificar Status da Aplicação

### Ver logs em tempo real

```bash
pm2 logs soluteg-sistema
```

### Ver status do processo

```bash
pm2 status soluteg-sistema
```

### Acessar a aplicação

- **URL:** https://app.soluteg.com.br

## Troubleshooting

### A aplicação não está respondendo

1. Verificar logs:
   ```bash
   pm2 logs soluteg-sistema
   ```

2. Reiniciar a aplicação:
   ```bash
   pm2 restart soluteg-sistema
   ```

3. Verificar se a porta 3000 está aberta:
   ```bash
   netstat -tlnp | grep 3000
   ```

### Erro de conexão com banco de dados

1. Verificar se o banco de dados está acessível:
   ```bash
   mysql -h 69.6.213.57 -u d5ea2e96_jncdb -p d5ea2e96_jncdb
   ```

2. Verificar as variáveis de ambiente:
   ```bash
   cat /var/www/soluteg/backend/.env | grep DATABASE_URL
   ```

### Erro ao fazer build

1. Limpar node_modules:
   ```bash
   rm -rf node_modules
   pnpm install
   ```

2. Tentar build novamente:
   ```bash
   DEPLOY_ENV=vps pnpm run build
   ```

## Correções Recentes

